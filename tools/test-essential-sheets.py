"""The essential sheets' sweep (app/essential_sheets.py) against Google and the live tables, in one transaction rolled
back: every essential tab is read as asatech and laid on its table with nothing taken out; the shape of its rows is the
table's (most rows already held, few refreshed); a withheld column stays a marker; a sweep run twice adds nothing the
second time; and a sheet that lost its rows is not laid.

From the repo root (the runner's CREDS are asatech's Drive token):

    RUNNER=<scratchpad> python3 tools/test-essential-sheets.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("ESSENTIAL_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_essential_sheets.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"ESSENTIAL_INPROC": "1", "HUB_RULES_DIR": "/rules"})],
                         capture_output=True, text=True, timeout=900)
    sys.stdout.write(out.stdout[-8000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import tempfile  # noqa: E402
import time  # noqa: E402

import psycopg  # noqa: E402

held = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
json.dump(CREDS, held)  # noqa: F821 - handed in by the runner's driver
held.close()
os.environ["HUB_APP_GOOGLE_OWNER_FILE"] = held.name

import client_writes  # noqa: E402
import essential_sheets as ES  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

ES.SHEETS_API = ES.Sheets(held.name)
results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:400]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
tabs = ES.essential()
facts["essential tabs"] = len(tabs)
check("the essential tabs are the followed books' and the Dr Appointments'", len(tabs) >= 10 and
      {"drVisits", "drAppointments", "empMaster"} <= {r for r, _p, _t in tabs}, [r for r, _p, _t in tabs])

reads = L.Reads(db, None)
by_book: dict[str, list] = {}
for r, p, t in tabs:
    by_book.setdefault(reads.db.prop(p), []).append((r, t))
read = {}
t0 = time.time()
for sid, ts in by_book.items():
    read[sid] = ES.SHEETS_API.tabs(sid, list(dict.fromkeys(t for _r, t in ts)))
facts["google read s"] = round(time.time() - t0, 1)
check("every essential book is read from Google as asatech", all(read[s] for s in by_book), list(by_book))

conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        tok = SC._WRITE.set({"write_id": "essential:check"})
        first, second = {}, {}
        for laid in (first, second):
            for sid, ts in by_book.items():
                for r, t in ts:
                    cur.execute("savepoint t")
                    try:
                        laid[r] = ES._lay(L.Reads(db, None), r, sid, t, read[sid].get(t) or [])
                        cur.execute("release savepoint t")
                    except ES.NotSwept as exc:
                        cur.execute("rollback to savepoint t")
                        laid[r] = {"skipped": str(exc)}
        facts["first sweep"] = first
        skipped = {r: c for r, c in first.items() if c.get("skipped")}
        check("every essential tab is laid", not skipped, skipped)
        check("nothing is ever taken out", all(not c.get("dropped") for c in first.values()))
        shaped = {r: c for r, c in first.items() if c.get("rows") and c.get("refreshed", 0) > 0.2 * c["rows"]}
        check("the sheet's rows are keyed as the table's (few refreshed)", not shaped, shaped)
        again = {r: c for r, c in second.items() if c.get("added") or c.get("refreshed")}
        check("a second sweep adds and changes nothing", not again, again)
        cur.execute(f"select count(*) from {RR.rows_of('empMaster')} where resource = 'empMaster'"
                    " and cells->>'SSN#' ~ '^[0-9-]{9,11}$'")
        check("no SSN# number reaches the table", cur.fetchone()[0] == 0)
        sid = reads.db.prop("CERT_SOURCE_ID")
        values = read[sid].get({r: t for r, _p, t in tabs}["empMaster"]) or []
        try:
            ES._lay(L.Reads(db, None), "empMaster", sid, "Master", values[:5])
            check("a sheet that lost its rows is not laid", False)
        except ES.NotSwept as exc:
            check("a sheet that lost its rows is not laid", "row(s) against" in str(exc), exc)
        SC._WRITE.reset(tok)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()
    os.unlink(held.name)

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
