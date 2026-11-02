"""A book people still type into, moved onto its houses (sheet_resources.BOOKED by its prop, followed hourly by
app/followed_books.py): every tab uploaded and proved row for row. A rehearsal (rolled back) also proves, on its first
house, that the master opens it and an admin without App Control's row does not, that a row edited and a row added
through the generic verbs land there, and that following the sheet leaves both as the Hub has them. Prints only what
it proved. A rehearsal unless UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> BOOK=DIVISION_TASKS_ID [UPLOAD=1] python3 tools/upload-followed-book.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("FOLLOWED_BOOK_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_followed_book.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"FOLLOWED_BOOK_INPROC": "1", "UPLOAD": os.environ.get("UPLOAD", ""),
                                      "BOOK": os.environ["BOOK"]})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-3000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

keep = os.environ.get("UPLOAD") == "1"
TABS = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") == os.environ["BOOK"]}
results: dict[str, str] = {}
rows: dict[str, int] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:200]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users = L.Reads(db, None).users()
master = next(u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT)
other = next((u for u in users if gsjs.str_(u.get("role")) == "admin"
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        tok = SC._WRITE.set({"write_id": "upload:" + os.environ["BOOK"]})
        for res, tab in TABS.items():
            rows[res] = RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))["rows"]
            unlike = RR.unlike_copy(res, SR.copy_of(db, res).ref)
            check(f"{res} is its copy, row for row", not unlike["missing"] and not unlike["differ"], unlike)
        SC._WRITE.reset(tok)
        gated = [r for r in TABS if SR.SPECS[r].get("app")]
        if not keep and not gated:
            # a book its readers read alone (no page of its own): following it right after the upload changes nothing
            again = {r: RR.upload(L.Reads(db, None), r, t, SR.DERIVE.get(r)) for r, t in TABS.items()}
            check("following the sheet right after the upload changes nothing",
                  not any(c.get("added") or c.get("refreshed") or c.get("dropped") for c in again.values()), again)
        if not keep and gated:
            res, tab = gated[0], TABS[gated[0]]
            m = L.Session(L.Reads(db, None), master)
            check("the master opens it", SR.gate(m, res, "list") is None, SR.gate(m, res, "list"))
            if other is not None:
                got = SR.gate(L.Session(L.Reads(db, None), other), res, "list")
                check("an admin App Control has not released it to does not", (got or {}).get("status") == 403, got)
            tok = SC._WRITE.set({"write_id": "Wzzfollowedcheck01"})
            held = RR.read_all(L.Reads(db, None), res)[0]
            col = next(h for h in RR.columns(L.Reads(db, None), res) if h not in ("id", "createdAt", "updatedAt"))
            d = SR.update_row(m, res, {"id": held["id"], col: "zz edited in the Hub"})
            made = SR.create_row(L.Session(L.Reads(db, None), master), res, {col: "zz made in the Hub"})
            check("a row is edited and a row added through the generic verbs",
                  d.answer.get("status") == 200 and made.answer.get("status") == 200, (d.answer, made.answer))
            RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
            after = {gsjs.str_(c.get("id")): c for c in RR.read_all(L.Reads(db, None), res)}
            check("following the sheet leaves both as the Hub has them",
                  after.get(held["id"], {}).get(col) == "zz edited in the Hub"
                  and gsjs.str_(made.answer["data"]["id"]) in after, after.get(held["id"]))
            SC._WRITE.reset(tok)
        W.HELD.reset(token)
    failed = [k for k, v in results.items() if v != "ok"]
    if keep and not failed:
        conn.commit()
    else:
        conn.rollback()
finally:
    conn.close()

print(json.dumps({"rows": rows, "committed": keep and not failed,
                  "results": {k: v for k, v in results.items() if v != "ok"} or "all ok",
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=0, default=str))
