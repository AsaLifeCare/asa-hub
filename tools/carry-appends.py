"""Rows a book's old writers appended or changed as kept edits (app.edits) after its upload began, carried into the
table the book is kept in now: each appended row whose key (its id, or the column its match names, as a trail's
event_id) the table does not hold yet is made there, its cells as kept; each change to a row named by its id (or a settings house's key) laid on that row, newest last. Run right after
the restart that moves the book's writers to the table. A rehearsal unless UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> RESOURCES=quoMessages,quoTranscripts SINCE=2026-10-27T00:00:00Z [UPLOAD=1] \
        python3 tools/carry-appends.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CARRY_APPENDS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "carry_appends.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"CARRY_APPENDS_INPROC": "1", **{k: os.environ.get(k, "") for k in ("RESOURCES", "SINCE", "UPLOAD")}}
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import psycopg  # noqa: E402

import gsjs  # noqa: E402
import hubdb  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

wanted = [r for r in os.environ.get("RESOURCES", "").split(",") if r]
since = os.environ.get("SINCE", "")
keep = os.environ.get("UPLOAD") == "1"
facts: dict[str, object] = {}
failed: list[str] = []
owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
if not since:
    failed.append("SINCE names no moment")
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for resource in wanted if since else []:
            spec = SR.SPECS.get(resource)
            if spec is None or not RR.uploaded(db, resource):
                failed.append(f"{resource}: not a resource kept in Postgres")
                continue
            res = SR.copy_of(db, resource)
            tabs = sorted({spec["tab"], res.ref.tab if res.ref is not None else spec["tab"], hubdb.HOUSE_DATA_TAB})
            cur.execute(f"select write_id, match_by, row_key, field, value from {W.EDITS_TABLE} where sheet_id = %s"
                        " and tab_name = any(%s) and kind = 'append' and at >= %s order by at, write_id, row_key",
                        (res.sheet_id, tabs, since))
            rows: dict[tuple[str, str], dict[str, str]] = {}
            matched: dict[tuple[str, str], str] = {}
            for wid, match, key, field, value in cur.fetchall():
                rows.setdefault((wid, key), {})[field] = value
                matched[(wid, key)] = match
            # a row the table holds already, by the column its match names (its id, or a trail's event_id)
            held: set[tuple[str, str]] = set()
            for match in set(matched.values()):
                col = match[len(W.COLS):] if match.startswith(W.COLS) and W.COLS_SEP not in match else "id"
                keys = [k for (w, k), m in matched.items() if m == match]
                cur.execute(f"select cells->>%s from {RR.rows_of(resource)} where resource = %s"
                            " and removed_at is null and cells->>%s = any(%s)", (col, resource, col, keys))
                held |= {(match, k) for (k,) in cur.fetchall()}
            made = 0
            for (wid, key), cells in rows.items():
                if (matched[(wid, key)], key) in held:
                    continue
                tok = SC._WRITE.set({"write_id": "carry:" + wid})
                try:
                    RR.create(None, resource, cells, "carry-appends")  # type: ignore[arg-type]
                finally:
                    SC._WRITE.reset(tok)
                held.add((matched[(wid, key)], key))
                made += 1
            # the cells the old writers changed on a row, by its id (or a settings house's key), newest last
            cur.execute(f"select write_id, match_by, row_key, field, value from {W.EDITS_TABLE} where sheet_id = %s"
                        " and tab_name = any(%s) and kind = 'edit' and at >= %s order by at, id",
                        (res.sheet_id, tabs, since))
            changes: dict[tuple[str, str, str], dict[str, str]] = {}
            for wid, match, key, field, value in cur.fetchall():
                changes.setdefault((wid, match, key), {})[field] = value
            changed = skipped = 0
            for (wid, match, key), cells in changes.items():
                col = "id" if match == "id" else match[len(W.COLS):] if match.startswith(W.COLS) and \
                    W.COLS_SEP not in match else ""
                hit = next(((k, c) for k, c in RR.table_rows(None, resource)  # type: ignore[arg-type]
                            if col and gsjs.trim(gsjs.or_blank(c.get(col))) == key), None)
                if hit is None:
                    skipped += 1
                    continue
                moved = {f: v for f, v in cells.items() if gsjs.or_blank(hit[1].get(f)) != v}
                if moved:
                    tok = SC._WRITE.set({"write_id": "carry:" + wid})
                    try:
                        RR.update(None, resource, hit[0], hit[1], moved, "carry-appends")  # type: ignore[arg-type]
                    finally:
                        SC._WRITE.reset(tok)
                    changed += 1
            facts[resource] = {"appended since": len(rows), "already in the table": len(rows) - made,
                               "carried": made, "edits since": len(changes), "rows changed": changed,
                               "edits on no row found": skipped}
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
