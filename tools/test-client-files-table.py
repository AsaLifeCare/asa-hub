"""Every paper in the clients' Drive folders (client_files) on its own table (clientFiles), not on a spreadsheet:
Clients' file list, Client meds' list and whole row, the Funds folder, the decoder's ledger, the generic rows and the
worker's tab door answer what they answered off the copy; a row changed through the generic doors lands in the table
alone; and a void takes it back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-client-files-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CLIENT_FILES_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_client_files_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CLIENT_FILES_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_meds as CM  # noqa: E402
import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import clients as C  # noqa: E402
import digest_lab as DL  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hub_rows as HR  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = "client_files", "clientFiles"


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
    tabled, kept, ledgers = HT.tabled, HR._kept_resource, dict(DL.TABLED)
    HT.tabled, HR._kept_resource = (lambda _tab: False), (lambda *_a: None)
    DL.TABLED.pop(TAB, None)
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled, HR._kept_resource = tabled, kept
        DL.TABLED.clear()
        DL.TABLED.update(ledgers)


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


sid = db.resolve(TAB).sheet_id


def door(r: L.Reads) -> list:
    ans = HR.tabs([{"sheet_id": sid, "tab": TAB, "fields": ["drive_id", "title", "client_key", "digest_state"]}],
                  db=db)[0]
    return [(int(rn), {h: str(HR.cell(v) or "") for h, v in raw.items()}) for rn, raw in ans.get("rows") or []]


slim = next((f for f in on_copy(C.client_files) if f.get("client_key")), {})
client = {"client_key": slim.get("client_key", ""), "name_key": gsjs.name_key(slim.get("client_name", ""))}
READERS = {
    "Clients' file list": C.client_files,
    "Client meds' file list": CM._client_files_all,
    "Client meds' whole row": lambda r: CM._file_whole(r, next((f for f in CM._client_files_all(r)
                                                                if f.get("_row") == slim.get("_row")), {})),
    "the Funds folder": lambda r: CS._funds_docs(r, client),
    "the decoder's ledger": lambda r: DL.ledger_rows(r, TAB),
    "the worker's tab door": door,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_generic = on_copy(lambda r: OS.rows(r, TAB))
facts["papers on the copy"] = len(copies["Clients' file list"])
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
        check("the generic rows answer the copy's", plain(SR.rows(L.Reads(db, None), RES)) == plain(copy_generic))
        wid = "Wzzclientfilescheck001"
        tok = SC._WRITE.set({"write_id": wid})
        target = next(r for r in SR.rows(L.Reads(db, None), RES) if r.get("id"))
        d = SR.update_row(L.Session(L.Reads(db, None), master), RES, {"id": target["id"], "folder": "zz check"})
        SC._WRITE.reset(tok)
        hit = next((r for r in SR.rows(L.Reads(db, None), RES) if r.get("id") == target["id"]), {})
        status = (d.answer if hasattr(d, "answer") else d).get("status")
        check("a row changed through the generic doors lands in the table", status == 200
              and hit.get("folder") == "zz check", (status, hit.get("folder")))
        RR.void(cur, wid)
        check("a void takes it back", plain(SR.rows(L.Reads(db, None), RES)) == plain(copy_generic))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
