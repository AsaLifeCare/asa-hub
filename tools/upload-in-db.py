"""A house too long to hold in a process (the events trail, the depot's Facts) uploaded by the database itself
(resource_rows.upload_in_db), then proved there (every copied row in the table, each with the copy's cells), and the
kept edits the copy does not carry laid on it as each write lays them now (resource_rows.lay_kept_edits). A rehearsal
unless UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> RESOURCES=eventTrail [UPLOAD=1] [LAY_SINCE=<moment>] python3 tools/upload-in-db.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UPLOAD_IN_DB_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_in_db.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"UPLOAD_IN_DB_INPROC": "1", **{k: os.environ.get(k, "") for k in ("RESOURCES", "UPLOAD", "LAY_SINCE")}}
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=620)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import hubdb  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import writes as W  # noqa: E402

wanted = [r for r in os.environ.get("RESOURCES", "").split(",") if r]
keep = os.environ.get("UPLOAD") == "1"
lay_since = os.environ.get("LAY_SINCE", "")
facts: dict[str, object] = {}
failed: list[str] = []
owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for resource in wanted:
            spec = SR.SPECS.get(resource)
            if spec is None:
                failed.append(f"{resource}: not declared in sheet_resources.SPECS")
                continue
            ref = SR.copy_of(db, resource).ref
            if ref is None:
                failed.append(f"{resource}: the copy holds no tab behind {spec['tab']}")
                continue
            if lay_since:
                # after the restart: the kept edits the old writers left in app.edits since the upload, laid on it
                facts[f"{resource}: kept edits laid since {lay_since}"] = RR.lay_kept_edits(
                    ref.sheet_id, sorted({spec["tab"], ref.tab}), lay_since)
                continue
            t0 = time.time()
            done = RR.upload_in_db(resource, spec["tab"], ref)
            facts[resource] = {**done, "copy rows": ref.row_count, "seconds": round(time.time() - t0, 1)}
            unlike = RR.unlike_copy(resource, ref)
            facts[f"{resource}: unlike the copy"] = unlike
            if unlike["missing"] or unlike["differ"]:
                failed.append(f"{resource}: {unlike['missing']} row(s) missing, {unlike['differ']} unlike the copy")
                continue
            # the kept edits the copy's rows do not carry, laid as each write lays them now
            facts[f"{resource}: kept edits laid"] = RR.lay_kept_edits(ref.sheet_id, sorted({spec["tab"], ref.tab}),
                                                                      "1970-01-01T00:00:00Z")
        W.HELD.reset(token)
    if keep and not failed:
        conn.commit()
        facts["committed"] = True
    else:
        conn.rollback()
        facts["committed"] = False
finally:
    conn.close()

print(json.dumps({"facts": facts, "failed": failed}, indent=1, default=str))
