"""The release announcements' old log (AppReleaseLog, app_release_log) on its own table (appReleaseLog), not on a
spreadsheet: who was already told of which app (app_release.told, beside app.app_release_told) and Render Sheet's grid
of the tab answer what they answered off the copy. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-app-release-log-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("APP_RELEASE_LOG_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_app_release_log_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"APP_RELEASE_LOG_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import app_release as AR  # noqa: E402
import client_writes  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import render_sheet as RS  # noqa: E402
import resource_rows as RR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = AR.LOG_TAB, "appReleaseLog"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled = tabled


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=lambda x: sorted(x) if isinstance(x, set) else str(x))


def grid(r: L.Reads) -> tuple:
    header, body, _keys = RS.grid_of(r, RS.resolve(r, TAB))
    return header, body


copy_told = on_copy(AR.told)
copy_grid = grid(L.Reads(db, None))
facts["log rows on the copy"] = len(copy_grid[1])
facts["told on the copy"] = len(copy_told["map"])
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, TAB)
        got = AR.told(L.Reads(db, None))
        check("who was already told, and who declined, answers the copy's", plain(got) == plain(copy_told),
              (len(got["map"]), len(copy_told["map"])))
        got = grid(L.Reads(db, None))
        check("Render Sheet's grid of the tab answers the copy's", plain(got) == plain(copy_grid)
              and RS.resolve(L.Reads(db, None), TAB).resource == RES, (len(got[1]), len(copy_grid[1])))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
