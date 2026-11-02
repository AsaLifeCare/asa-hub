"""The compliance papers' ledger (cert_uploads) on its own table (certUploads), not on a spreadsheet: Staff's and Staff
comms' readers answer what they answered off the copy; certDocUpload files a paper's row in the table alone, every
column kept, as the write's own; the confirmation's stamp lands on that row; the worker's role reads the ledger through
app.cert_uploads_ledger (db/cert_uploads_ledger.sql) and nothing else of app.resource_rows; and a void takes the
write's rows back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-cert-uploads-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CERT_UPLOADS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_cert_uploads_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    with open("db/cert_uploads_ledger.sql", encoding="utf-8") as sql:
        env = {"CERT_UPLOADS_TABLE_INPROC": "1", "CERT_UPLOADS_VIEW_SQL": sql.read()}
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import cert_docs as CD  # noqa: E402
import client_writes  # noqa: E402
import drive as dr  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff as SP  # noqa: E402
import staff_comms as STC  # noqa: E402
import writes as W  # noqa: E402

VIEW_SQL = os.environ["CERT_UPLOADS_VIEW_SQL"]
results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = CD.TAB, "certUploads"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
drv = dr.Drive()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, drv).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
base = {"person": "Adrianna Williams", "req_id": "cpr", "filename": "cpr card.pdf", "mime": "application/pdf",
        "b64_chars": 1000}


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, drv))
    finally:
        HT.tabled = tabled


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


copy_sp = on_copy(SP.uploads)
copy_stc = on_copy(STC._uploads)
facts["rows on the copy"] = len(copy_sp or [])
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, drv), RES, TAB)
        check("Staff's ledger reader answers the copy's", plain(SP.uploads(L.Reads(db, drv))) == plain(copy_sp))
        check("Staff comms' too", plain(STC._uploads(L.Reads(db, drv))) == plain(copy_stc))
        cur.execute(VIEW_SQL)
        cur.execute("select count(*), count(row_key) from app.cert_uploads_ledger")
        check("the view names the uploaded ledger, one keyless row while it holds none",
              cur.fetchone() == (max(1, len(copy_sp or [])), len(copy_sp or [])))
        wid = "Wzzcertuploadscheck001"
        tok = SC._WRITE.set({"write_id": wid})
        d = CD.upload(L.Session(L.Reads(db, drv), master), {**base, "filed": {"file_id": "1AbCdEfGhIjKlMnOpQrStUv"}})
        rid = (d.answer.get("data") or {}).get("id", "")
        rows = SP.uploads(L.Reads(db, drv)) or []
        mine = next((r for r in rows if gsjs.str_(r.get("id")) == rid), {})
        cols = RR.columns(None, RES)
        check("certDocUpload files the paper's row in the table, every column kept, as the write's own",
              d.answer.get("status") == 200 and d.own and not d.edits and mine.get("readstate") == "pending"
              and mine.get("fileid") == "1AbCdEfGhIjKlMnOpQrStUv" and len(cols) == len(CD.LEDGER_HEADER),
              (d.answer.get("status"), d.own, d.edits, mine, cols))
        check("Staff comms reads it too", any(gsjs.str_(r.get("id")) == rid
                                              for r in STC._uploads(L.Reads(db, drv)) or []))
        stamp = CD.ledger_stamp(L.Reads(db, drv), rid, {"confirmed_on": "2026-10-26", "confirmed_by": "check"})
        mine = next((r for r in SP.uploads(L.Reads(db, drv)) or [] if gsjs.str_(r.get("id")) == rid), {})
        check("the confirmation's stamp lands on that row and carries no book", stamp is not None
              and stamp["sid"] == "" and gsjs.str_(mine.get("confirmedon")) == "2026-10-26", (stamp, mine))
        SC._WRITE.reset(tok)
        cur.execute("savepoint meds")
        cur.execute("set local role asa_hub_meds")
        cur.execute("select row_key, cells from app.cert_uploads_ledger order by position, created_at, row_key")
        seen = [c for k, c in cur.fetchall() if k is not None]
        try:
            cur.execute("savepoint denied")
            cur.execute("select 1 from app.resource_rows limit 1")
            denied = False
        except psycopg.errors.InsufficientPrivilege:
            cur.execute("rollback to savepoint denied")
            denied = True
        cur.execute("rollback to savepoint meds")
        check("the worker's role reads the ledger's rows through the view, and app.resource_rows not at all",
              any(c.get("id") == rid and c.get("read_state") == "pending" for c in seen) and denied,
              (len(seen), denied))
        RR.void(cur, wid)
        check("a void takes the write's rows back", plain(SP.uploads(L.Reads(db, drv))) == plain(copy_sp))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
