"""Forms on its own tables (app.resource_rows: forms, formSubmissions, formAnswers, formFiles, assetEvents), not on a
spreadsheet: a form made, renamed and archived, an answer marked handled, a public answer's row and an upload's trail
filed, the decoder's cells kept on a file's row, the generic list and a client's Transportation reading the
submissions — each in the tables alone, and a person who may not write refused. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-forms-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("FORMS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_forms_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"FORMS_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import digest_lab_writes as DLW  # noqa: E402
import form_file_store as FFS  # noqa: E402
import forms as F  # noqa: E402
import forms_public_writes as FPW  # noqa: E402
import forms_writes as FW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users = L.Reads(db, None).users()
master = next(u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT)
staff = next(sc.user_from_row(r) for r in users if gsjs.str_(r.get("role")).lower() == "staff")
service = {"is_service": True, "role": "admin", "id": "", "email": "", "visiting_member": ""}


def fresh() -> L.Reads:
    return L.Reads(db, None)


conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, resource in F.RESOURCES.items():
            if not RR.uploaded(db, resource):
                RR.upload(fresh(), resource, tab)
        facts["forms"] = len(F.rows(fresh(), F.FORMS_TAB))
        check("the forms read off their table", facts["forms"] > 0)
        made = FW.form_save(L.Session(fresh(), master), {"slug": "zz-table-check", "title": "Table check",
                                                         "fields": json.dumps([{"key": "q1", "label": "Q1",
                                                                               "kind": "text"}]),
                                                         "status": "draft"})
        row = F.form_by_slug(fresh(), "zz-table-check")
        check("a form made lands in its table", made.answer.get("status") == 200 and made.own and not made.edits
              and row is not None and bool(row.get("token")), made.answer)
        renamed = FW.form_rename(L.Session(fresh(), master), {"slug": "zz-table-check", "title": "Table check 2"})
        check("a rename lands there", renamed.answer.get("status") == 200 and not renamed.edits
              and (F.form_by_slug(fresh(), "zz-table-check") or {}).get("title") == "Table check 2", renamed.answer)
        archived = FW.form_archive(L.Session(fresh(), master), {"slug": "zz-table-check"})
        check("an archive lands there", archived.answer.get("status") == 200 and not archived.edits
              and gsjs.str_((F.form_by_slug(fresh(), "zz-table-check") or {}).get("archived")) == "true",
              archived.answer)
        sub = next((s for s in F.rows(fresh(), F.SUBMISSIONS_TAB) if s.get("id")), None)
        if sub is not None:
            was = gsjs.str_(sub.get("state"))
            to = "new" if was == "handled" else "handled"
            handled = FW.submission_handle(L.Session(fresh(), master), {"id": sub["id"], "state": to})
            now = next(s for s in F.rows(fresh(), F.SUBMISSIONS_TAB) if s.get("id") == sub["id"])
            check("an answer marked handled lands there", handled.answer.get("status") == 200
                  and not handled.edits and gsjs.str_(now.get("state")) == to, handled.answer)
        got = FPW.append(fresh(), FPW.ANSWERS_TAB, {"form_slug": "zz-table-check", "field_key": "q1",
                                                    "answer_text": "hi"}, "zz-table-check", W.now_iso(fresh()))
        check("a public answer's row lands in its table",
              RR.find(fresh(), "formAnswers", got["row_key"]) is not None, got)
        trail = len(RR.read_all(fresh(), "assetEvents"))
        FFS.asset_event(fresh(), "asset_zz", "forms", "zz.pdf", {"file_id": "x", "size_bytes": 1}, W.now_iso(fresh()))
        check("an upload's trail lands in its table", len(RR.read_all(fresh(), "assetEvents")) == trail + 1)
        ff = next((r for r in F.rows(fresh(), F.FILES_TAB) if r.get("id")), None)
        if ff is not None:
            kept = DLW.digest_keep(L.Session(fresh(), service), {"ledger": "form_files", "rows": [
                {"id": ff["id"], "cells": {"digest_error": "table check"}}]})
            hit = RR.find(fresh(), "formFiles", ff["id"])
            check("the decoder's cells land on the file's row in its table", kept.answer.get("status") == 200
                  and not kept.edits and hit is not None and hit[1].get("digest_error") == "table check", kept.answer)
        listed = SR.list_rows(L.Session(fresh(), master), "formSubmissions", {"limit": 5})
        check("the generic list reads the table", listed.get("status") == 200 and isinstance(listed.get("data"), list),
              listed)
        transport = CS._form_rows(fresh())
        check("a client's Transportation reads the submissions there", transport.get("rows") is not None, transport)
        no = FW.form_save(L.Session(fresh(), staff), {"slug": "zz-nope", "title": "Nope", "fields": []})
        check("a staff member without the edition is refused", no.answer.get("status") in (403, 404), no.answer)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
