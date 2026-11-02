#!/usr/bin/env python3
"""The Smart Comms test logs (comm_mock, comm_rehearsal) moved off their sheet-backed houses into their own tables
(db/comm_logs.sql, app/comm_logs.py), once: every row a read saw — the house's copy with the kept edits laid, in that
order — kept by its id, an id the table holds already left as it stands, so a second run adds only what landed since.
--retire then takes out of app.edits (and app.edit_sync) the cells of every row the table holds — nothing of them is
owed to a sheet any more — and pauses the old houses in app.record_books. Run inside asa-hub-db-sync with the app's own
modules streamed in; the writes as the writer role (asa_hub_app_rw), the reads as the copy holds them.

    python3 tools/import_comm_logs.py --dry-run      # what would be kept, nothing written
    python3 tools/import_comm_logs.py                # the rows kept
    python3 tools/import_comm_logs.py --retire       # the rows kept again, then their kept edits retired
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, sys, time
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = dict(blob["app"])
SRC["redaction"] = blob["rules"]
ARGS = blob["args"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
os.environ["HUB_RULES_DIR"] = "/nonexistent"
import psycopg
import hubdb, writes as W, client_writes as CW, comm_logs as CL

ro = psycopg.connect(hubdb._dsn(), autocommit=True, application_name="import-comm-logs")
ro.execute("set session characteristics as transaction read only")
db = hubdb.HubDb(connect=lambda: ro)
names = [CL.MOCK, CL.REHEARSAL]
edits = [W._edit_row(r) for r in ro.execute(f"select * from ({W.edits_sql()}) z where z.tab_name = any(%s)",
                                            (names,)).fetchall()]
own = CW.Own([], edits=edits, edits_at=time.time())
# autocommit, so the block below is the transaction itself (committed, or rolled back on a dry run), never a
# savepoint inside the one `set role` would open
rw = psycopg.connect(hubdb._dsn(), autocommit=True, application_name="import-comm-logs")
rw.execute("set role asa_hub_app_rw")
out = {}
try:
    with rw.transaction():
        cur = rw.cursor()
        for name in names:
            got = CL.sheet_rows(db, own, W.EDITS_TABLE, name)
            res = {"sheet_id": got["sheet_id"], "tab": got["tab"], "laid_rows": len(got["rows"]),
                   "from_the_copy_alone": sum(1 for r in got["rows"] if r["origin"] == "sheet"), "why": got["why"]}
            cur.execute("select to_regclass(%s) is not null", (CL.table(name),))
            ready = bool(cur.fetchone()[0])
            if not ready:
                res["why"] = res["why"] or f"{CL.table(name)} is not made yet: apply db/comm_logs.sql first"
            elif got["rows"]:
                res.update(CL.import_rows(cur, name, got["rows"]))
                if ARGS["retire"]:
                    res["retired"] = CL.retire(cur, name, W.EDITS_TABLE, W.beside("edit_sync"), got["sheet_id"],
                                               got["tab"])
                    # the old house owes the sheet nothing now, and is never checked: no one writes it any more
                    cur.execute("select to_regclass(%s) is not null", (W.beside("record_books"),))
                    if cur.fetchone()[0]:
                        cur.execute(f"update {W.beside('record_books')} set paused = true where sheet_id = %s",
                                    (got["sheet_id"],))
                        res["paused"] = cur.rowcount
            if ready:
                cur.execute(f"select count(*) from {CL.table(name)}")
                res["table_rows"] = int(cur.fetchone()[0])
            out[name] = res
        if ARGS["dry_run"]:
            raise psycopg.Rollback()
finally:
    rw.close()
    ro.close()
print(json.dumps({"dry_run": ARGS["dry_run"], "logs": out}))
'''


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="decide and count, write nothing")
    ap.add_argument("--retire", action="store_true", help="after keeping the rows, retire their kept edits")
    args = ap.parse_args()
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
            "rules": (ROOT / "server" / "redaction.py").read_text(encoding="utf-8"),
            "args": {"dry_run": args.dry_run, "retire": args.retire}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1800)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print(got.stderr.decode()[-3000:])
        return 1
    print(json.dumps(json.loads(lines[-1]), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
