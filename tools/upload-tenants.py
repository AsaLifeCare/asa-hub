"""The tenants onto a table of their own, ONE place: the Core book's copy uploaded (resource_rows.upload) and proved row
for row, then every row but headquarters marked removed — the operator's word (10-27): there is a single tenant, the
other one in the copy was invented for a test. Every reader (the envelope's, the studio's, the door gate's, the tenant
workbook's pointer) then answers that one place; in a rehearsal an edit laid by writes.into_tables lands on the table
and a void takes it back. A rehearsal, rolled back, unless UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> [UPLOAD=1] python3 tools/upload-tenants.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UPLOAD_TENANTS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_tenants.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"UPLOAD_TENANTS_INPROC": "1", "UPLOAD": os.environ.get("UPLOAD", "")})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import door_gate  # noqa: E402
import envelope  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import studio as ST  # noqa: E402
import tenant_ensure as TE  # noqa: E402
import writes as W  # noqa: E402

RES = "tenants"
HQ = "ten_asalifecareohio_6219"
BY = "operator: a single tenant (the other was invented for a test)"
keep = os.environ.get("UPLOAD") == "1"
results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


def ids(rows: list[dict]) -> list[str]:
    return sorted(gsjs.str_(r.get("tenantid")) for r in rows)


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
copy = SR.copy_of(db, RES)
facts["the copy's book"] = copy.sheet_id
copy_rows = [dict(raw) for _rn, raw in db.rows(copy.ref)] if copy.ref is not None else []
facts["the copy's tenants"] = {gsjs.str_(r.get("tenant_id")): gsjs.str_(r.get("status")) for r in copy_rows}
check("the copy holds headquarters", any(gsjs.str_(r.get("tenant_id")) == HQ for r in copy_rows))

READERS = {
    "the envelope": lambda r: envelope.tenants_rows(r),
    "the studio": lambda r: ST.tenants_rows(r),
    "the studio's tab": lambda r: r.db.normalized_rows(ST.tenants_tab(r).ref),
    "the door gate": lambda r: door_gate.tenant_rows(r),
    "the tenant workbook's pointer": lambda r: r.db.normalized_rows(TE.tenants_ref(r)[1]),
}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        tok = SC._WRITE.set({"write_id": "upload:tenants"})
        facts["upload"] = RR.upload(L.Reads(db, None), RES, "tenants", SR.DERIVE.get(RES))
        cur.execute(f"select cells from {RR.rows_of(RES)} where resource = %s and removed_at is null", (RES,))
        table = [RR._json(c) or {} for (c,) in cur.fetchall()]
        heads = [h for h in copy.ref.headers if h]
        by_id = {gsjs.str_(r.get("tenant_id")): r for r in table}
        unlike = [gsjs.str_(r.get("tenant_id")) for r in copy_rows
                  if {h: str(r[h]) for h in heads if r.get(h) not in (None, "")}
                  != {h: str(v) for h, v in by_id.get(gsjs.str_(r.get("tenant_id")), {}).items()}]
        check("every copied row is in the table, cell for cell", len(table) == len(copy_rows) and not unlike,
              (len(table), len(copy_rows), unlike))
        cur.execute(f"select row_key, cells from {RR.rows_of(RES)} where resource = %s and removed_at is null", (RES,))
        gone = []
        for key, cells in cur.fetchall():
            cells = RR._json(cells) or {}
            if gsjs.str_(cells.get("tenant_id")) != HQ:
                RR.remove(None, RES, key, cells, BY)  # type: ignore[arg-type]
                gone.append(gsjs.str_(cells.get("tenant_id")))
        facts["removed"] = gone
        SC._WRITE.reset(tok)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers one place, headquarters", ids(got) == [HQ], ids(got))
        hq = envelope.tenants_rows(L.Reads(db, None))
        check("headquarters is active and the home", envelope.home_from(hq) == HQ and
              gsjs.str_(hq[0].get("status")) == "active", hq)
        if not keep:
            wid = "Wzztenantscheck001"
            sid = TE.tenants_ref(L.Reads(db, None))[0]
            tok = SC._WRITE.set({"write_id": wid})
            edit = W.kept_record(sid, "tenants", "edit", W.COLS + "tenant_id", HQ, "check", {"city": "Zzcheck"},
                                 before={"city": "Canton"})
            W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, [edit], "check"),
                                         "check")
            SC._WRITE.reset(tok)
            got = envelope.tenants_rows(L.Reads(db, None))
            check("an edit lands on the table", [gsjs.str_(r.get("city")) for r in got] == ["Zzcheck"], got)
            cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
            check("app.edits keeps none of it", cur.fetchone()[0] == 0)
            RR.void(cur, wid)
            got = envelope.tenants_rows(L.Reads(db, None))
            check("a void takes it back", [gsjs.str_(r.get("city")) for r in got] == ["Canton"], got)
        W.HELD.reset(token)
    failed = [k for k, v in results.items() if v != "ok"]
    if keep and not failed:
        conn.commit()
        facts["committed"] = True
    else:
        conn.rollback()
        facts["committed"] = False
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
