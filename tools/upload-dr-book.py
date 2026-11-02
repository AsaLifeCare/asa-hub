"""The Dr Appointments book moved off its copy into its own tables, once (dr_book.upload): Dr Appt Archive and Dr Master
as every read showed them — the kept edits laid — then each reader checked against that view, row for row. Without
UPLOAD=1 it runs inside a transaction rolled back and says what it would do.

From the repo root:

    RUNNER=<scratchpad> python3 tools/upload-dr-book.py            (a rehearsal, rolled back)
    RUNNER=<scratchpad> UPLOAD=1 python3 tools/upload-dr-book.py   (kept)
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UPLOAD_DR_BOOK_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_dr_book.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"UPLOAD_DR_BOOK_INPROC": "1", "UPLOAD": os.environ.get("UPLOAD", "")})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import clients as C  # noqa: E402
import dr_book as DB  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import writes as W  # noqa: E402

keep = os.environ.get("UPLOAD") == "1"
results: dict[str, str] = {}
facts: dict[str, object] = {"kept": keep}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        before = L.Reads(db, None)
        check("Postgres holds neither tab yet", not any(DB.held(before, r) for r in DB.TABS))
        shown = {r: CS.estate_rows(before, r) for r in DB.TABS}
        shown_c = {r: C.estate(before, r) for r in DB.TABS}
        for r in DB.TABS:
            facts[r] = DB.upload(L.Reads(db, None), r)
        after = L.Reads(db, None)
        for r in DB.TABS:
            check(f"{r}: held", DB.held(after, r))
            check(f"{r}: every row the reads showed, cell for cell", CS.estate_rows(after, r) == shown[r],
                  f"{len(CS.estate_rows(after, r))} vs {len(shown[r])}")
            check(f"{r}: Clients' rows the same", C.estate(after, r) == shown_c[r])
        W.HELD.reset(token)
    if keep and all(v == "ok" for v in results.values()):
        conn.commit()
        facts["committed"] = True
    else:
        conn.rollback()
        facts["committed"] = False
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
