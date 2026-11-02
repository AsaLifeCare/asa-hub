"""A resource moved off its spreadsheet copy into asa-hub-db's own app.resource_rows, once (resource_rows.upload): the
copy's rows as every read showed them — the kept edits laid, the removals still on their way taken out — then checked
row for row against that view. Without UPLOAD=1 it runs inside a transaction rolled back and says what it would do.

From the repo root:

    RUNNER=<scratchpad> RESOURCES=documents python3 tools/upload-resources.py           (a rehearsal, rolled back)
    RUNNER=<scratchpad> RESOURCES=documents UPLOAD=1 python3 tools/upload-resources.py  (kept)
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UPLOAD_RESOURCES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_resources.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"UPLOAD_RESOURCES_INPROC": "1", "RESOURCES": os.environ.get("RESOURCES", ""),
                                      "UPLOAD": os.environ.get("UPLOAD", "")})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import row_ops as RO  # noqa: E402
import sheet_resources as SR  # noqa: E402
import writes as W  # noqa: E402

keep = os.environ.get("UPLOAD") == "1"
wanted = [r.strip() for r in os.environ.get("RESOURCES", "").split(",") if r.strip()]
results: dict[str, str] = {}
facts: dict[str, object] = {"kept": keep}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


def same(v: object) -> str:
    """A cell as a value: JSON text and the list or object it reads as compare equal, whatever its spacing."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return v
        if not isinstance(v, (dict, list)):
            return gsjs.js_str(v) if not isinstance(v, str) else v
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return gsjs.js_str(v)


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for resource in wanted:
            spec = SR.SPECS.get(resource)
            if spec is None:
                check(f"{resource}: declared in sheet_resources.SPECS", False, "not declared")
                continue
            res = SR.copy_of(db, resource)
            ref = res.ref
            # what every read showed: the copy, the kept edits laid, the removals on their way taken out
            shown = RO.unremoved(reads, ref, db.sheetdb_rows(ref)) if ref is not None else []
            derive = SR.DERIVE.get(resource) or {}
            done = RR.upload(reads, resource, spec["tab"], derive)
            # a cell the copy withholds is compared as the upload worked it out
            for r in shown:
                for h, work_out in derive.items():
                    if isinstance(r.get(h), str) and r[h].startswith(RR.WITHHELD):
                        r[h] = work_out(r) or ""
            facts[resource] = done
            ids_shown = sorted(gsjs.js_str(r["id"]) for r in shown if r.get("id") not in (None, ""))
            ids_held = set(ids_shown)
            gone = [i for i in sorted({gsjs.js_str(r["id"]) for r in RR.read_all(reads, resource)
                                       if r.get("id") not in (None, "")}) if ids_held and i not in ids_held]
            for rid in gone:
                hit = RR.find(reads, resource, rid)
                if hit is not None:
                    RR.remove(reads, resource, hit[0], hit[1], "upload: a removal still on its way")
            facts[f"{resource}: removals carried"] = len(gone)
            if not ids_shown:
                # a tab without ids (a trail): the rows compared whole, each its non-empty cells
                def whole(rs: list) -> list:
                    return sorted(json.dumps({k: same(v) for k, v in r.items() if v not in (None, "")},
                                             sort_keys=True) for r in rs)
                check(f"{resource}: every row the reads showed is in the table, cell for cell",
                      whole(shown) == whole(RR.read_all(reads, resource)), f"{len(shown)} shown")
                continue
            table = {gsjs.js_str(r.get("id")): r for r in RR.read_all(reads, resource)}
            check(f"{resource}: every row the reads showed is in the table, no other",
                  sorted(i for i in table if i) == ids_shown, f"{len(table)} vs {len(ids_shown)}")
            # each id's first row, as the reads find it
            first: dict[str, dict] = {}
            for r in shown:
                first.setdefault(gsjs.js_str(r.get("id")), r)
            differ = [i for i in ids_shown
                      for row in [first[i]]
                      if any(same(row.get(k)) != same(table[i].get(k))
                             for k in row if row.get(k) not in (None, ""))]
            check(f"{resource}: each row's cells as the reads showed them", not differ, differ[:5])
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
