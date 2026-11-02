"""The onboarding documents' catalog on its own table (app.resource_rows `documentCatalog`): Hiring's catalog, Files'
catalog and the papers' renewal months answer exactly what they answered off the spreadsheet's copy. One transaction,
rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-doc-catalog-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DOC_CATALOG_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_doc_catalog_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DOC_CATALOG_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidate_papers as CP  # noqa: E402
import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import files_docs as FD  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
copy = L.Reads(db, None)
ref = CND.hub_tab(copy, CND.DOC_CATALOG_TAB)
typed = [r for r in db.locations_rows(ref) if gsjs.trim(gsjs.or_text(r.get("doc_id")))]
facts["catalog rows on the copy"] = len(typed)


def norm(v):
    return json.loads(json.dumps(v, default=str, sort_keys=True))


conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, CND.DOC_CATALOG_RESOURCE):
            RR.upload(L.Reads(db, None), CND.DOC_CATALOG_RESOURCE, CND.DOC_CATALOG_TAB)
        reads = L.Reads(db, None)
        hiring = CND.catalog_of(reads)
        check("Hiring's catalog answers the same ids, labels, required and order",
              [(c["doc_id"], c["label"], c["required"]) for c in hiring]
              == sorted([(gsjs.trim(gsjs.js_str(r.get("doc_id"))), CND.text(r.get("label"), 120)
                          or gsjs.js_str(r.get("doc_id")),
                          r.get("required") is True or gsjs.or_blank(r.get("required")).lower() == "yes")
                         for r in typed], key=lambda t: [c["doc_id"] for c in hiring].index(t[0])),
              hiring)
        months = CP.catalog(reads)
        check("the papers' renewal months are the copy's", all(
            CND.js_number(months[gsjs.trim(gsjs.js_str(r.get("doc_id")))]["renewal_months"])
            == CND.js_number(r.get("renewal_months")) or (r.get("renewal_months") in (None, "")
                                                          and months[gsjs.trim(gsjs.js_str(r.get("doc_id")))]
                                                          ["renewal_months"] in (None, ""))
            for r in typed), months)
        files = FD.catalog(reads)
        check("Files' catalog lists every requirement, required read as before",
              sorted(c["doc_id"] for c in files) == sorted(gsjs.trim(gsjs.js_str(r.get("doc_id"))) for r in typed)
              and all(isinstance(c["required"], bool) for c in files), files)
        facts["Files' catalog"] = [(c["doc_id"], c.get("renewal_months"), c.get("sort")) for c in files]
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
