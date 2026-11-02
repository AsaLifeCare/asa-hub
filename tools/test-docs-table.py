"""Docs on its own table (app.resource_rows `documents`), not on a spreadsheet: the library listed, filtered, a document
registered, changed and taken out, each in the table alone, and a person who may not write refused — all inside one
transaction rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-docs-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DOCS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_docs_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DOCS_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import docs as D  # noqa: E402
import docs_import as DI  # noqa: E402
import docs_writes as DW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
users = reads.users()
master = next(u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT)
staff = next(sc.user_from_row(r) for r in users if gsjs.str_(r.get("role")).lower() == "staff")
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, D.RESOURCE):
            RR.upload(reads, D.RESOURCE, D.TAB)
        msess = L.Session(L.Reads(db, None), master)
        listed = D.docs_list(msess, {})
        facts["documents"] = len(listed.get("data") or [])
        check("the library lists off the table", listed.get("status") == 200 and facts["documents"] > 0, listed)
        first = (listed["data"] or [{}])[0]
        word = gsjs.js_str(first.get("title"))[:4]
        found = D.docs_list(msess, {"q": word})
        check("a filtered list answers here (q), no longer handed on", found.get("status") == 200
              and all(word.lower() in json.dumps(r).lower() for r in found["data"]), found.get("status"))
        paged = D.docs_list(msess, {"offset": 1, "limit": 2})
        check("offset and limit", paged.get("status") == 200 and len(paged["data"]) <= 2)
        made = DW.docs_create(L.Session(L.Reads(db, None), master), {"title": "Test doc", "url": "https://x.test/a",
                                                                      "category": "Test"})
        rid = gsjs.js_str((made.answer.get("data") or {}).get("id"))
        check("a document registered lands in the table", made.answer.get("status") == 200 and made.own
              and not made.edits and RR.find(L.Reads(db, None), D.RESOURCE, rid) is not None, made.answer)
        moved = DW.docs_update(L.Session(L.Reads(db, None), master), {"id": rid, "title": "Test doc 2"})
        hit = RR.find(L.Reads(db, None), D.RESOURCE, rid)
        check("a change lands in the table", moved.answer.get("status") == 200 and not moved.edits
              and hit is not None and hit[1].get("title") == "Test doc 2", moved.answer)
        gone = DW.docs_delete(L.Session(L.Reads(db, None), master), {"id": rid})
        check("a removal takes it out of the table", gone.answer.get("status") == 200 and not gone.edits
              and RR.find(L.Reads(db, None), D.RESOURCE, rid) is None, gone.answer)
        no = DW.docs_create(L.Session(L.Reads(db, None), staff), {"title": "Nope"})
        check("a staff member without the edition is refused", no.answer.get("status") == 403, no.answer)
        imported = DI.import_folder(L.Session(L.Reads(db, None), master), {
            "url": "https://drive.google.com/drive/folders/TESTFOLDERID0000000000",
            "prepared": {"folder": "Test folder", "added": [{"drive_id": "TESTFILEID000000000000001", "title": "T1",
                                                              "url": "https://docs.google.com/document/d/TESTFILEID000000000000001"}]}})
        check("a folder's import makes its rows in the table", imported.answer.get("status") == 200
              and (imported.answer.get("data") or {}).get("added") == 1 and not imported.edits, imported.answer)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
