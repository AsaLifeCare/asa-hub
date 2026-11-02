"""The worker's tab door (/v1/hub-rows/tabRows, app/hub_rows.py) answers a house kept in its own table from that table,
in the copy's shape: for every uploaded house with a book, the rows (by sheet row), their cells and the headers equal
what the door answered off the copy; a house book's Data tab names its one house; `where` and `count` read the same;
and a row made in the table moves the signature and is seen by the next read — as the worker's form digest lane reads
form_files. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-hub-rows-kept.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("HUB_ROWS_KEPT_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_hub_rows_kept.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"HUB_ROWS_KEPT_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import hub_rows as HR  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
# the houses this round moves, uploaded inside the transaction; the rest were uploaded before
NEW = ("learnSkills", "learnAttempts", "financeConfig", "smartCommsDesk")


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def shape(ans: dict) -> tuple:
    rows = [(int(rn), {h: str(HR.cell(v) or "") for h, v in raw.items()}) for rn, raw in ans.get("rows") or []]
    return [h for h in ans.get("headers") or [] if h], rows


def on_copy(sid: str, tab: str, **ask) -> dict:
    """The door's answer off the copy: the same code, with no house kept in a table."""
    kept = HR._kept_resource
    HR._kept_resource = lambda *_a: None
    try:
        return HR.tabs([{"sheet_id": sid, "tab": tab, **ask}], db=db)[0]
    finally:
        HR._kept_resource = kept


conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        copies = {}
        for res in NEW:
            spec = SR.SPECS[res]
            r = db.resolve(spec["tab"])
            copies[res] = (r.sheet_id, r.ref.tab if r.ref else spec["tab"])
        token = W.HELD.set(cur)
        for res in NEW:
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, SR.SPECS[res]["tab"])
        cur.execute(f"select resource, sheet_id, tab_name from {RR.COLUMNS} where uploaded_at is not null"
                    " and coalesce(sheet_id, '') <> '' order by 1")
        kept = list(cur.fetchall())
        facts["houses with a book"] = len(kept)
        cur.execute(f"select resource from {RR.ROWS} where origin = 'postgres' or removed_at is not null"
                    " group by resource")
        written = {r for (r,) in cur.fetchall()}
        differ, lost, ahead = [], [], 0
        for res, sid, tab in kept:
            ref_tab = db.resolve(tab).ref
            copy_tab = ref_tab.tab if ref_tab is not None and ref_tab.sheet_id == sid else tab
            got = HR.tabs([{"sheet_id": sid, "tab": tab}], db=db)[0]
            was = on_copy(sid, copy_tab)
            if not was.get("tab_known"):
                continue
            g_h, g_rows = shape(got)
            w_h, w_rows = shape(was)
            if res in written:
                # the table is the record and has moved on: the copy's ids are all still answered, or were removed
                ahead += 1
                have = {raw.get("id") for _rn, raw in g_rows}
                gone = [raw.get("id") for _rn, raw in w_rows if raw.get("id") and raw.get("id") not in have]
                cur.execute(f"select count(*) from {RR.ROWS} where resource = %s and removed_at is not null", (res,))
                if len(gone) > cur.fetchone()[0]:
                    lost.append({"resource": res, "copy ids not answered": gone[:3]})
            elif g_rows != w_rows or sorted(g_h) != sorted(w_h):
                differ.append({"resource": res, "rows": (len(g_rows), len(w_rows)),
                               "first differing": next(((a, b) for a, b in zip(g_rows, w_rows) if a != b), None)})
        facts["houses written in Postgres since their upload"] = ahead
        check("every house untouched since its upload answers the copy's rows, cells and headers", not differ,
              differ[:2])
        check("a house written since answers every copy id it has not removed", not lost, lost[:2])
        sid, _tab = copies["smartCommsDesk"]
        got = HR.tabs([{"sheet_id": sid, "tab": hubdb.HOUSE_DATA_TAB}], db=db)[0]
        check("a house book's Data tab names its one house", shape(got) == shape(on_copy(sid, hubdb.HOUSE_DATA_TAB)))
        one = next(s["id"] for s in SC.read_situations(db))
        ask = {"where": {"id": one}, "fields": ["id", "enabled"]}
        check("where and fields read as the copy's", shape(HR.tabs([{"sheet_id": sid, "tab": "Data", **ask}],
                                                                   db=db)[0]) == shape(on_copy(sid, "Data", **ask)))
        check("count reads as the copy's", HR.tabs([{"sheet_id": sid, "tab": "Data", "count": "enabled"}],
                                                   db=db)[0]["counts"]
              == on_copy(sid, "Data", count="enabled")["counts"])
        ff_sid = db.resolve("form_files").sheet_id
        ask = {"sheet_id": ff_sid, "tab": "form_files"}
        before = HR._answer(db, ask)
        tok = SC._WRITE.set({"write_id": "Wzzhubrowskeptcheck01"})
        RR.create(None, "formFiles", {"id": "zzFF1", "file_id": "zzfile", "file_name": "check.pdf",
                                      "digest_state": "pending"}, "check")
        SC._WRITE.reset(tok)
        after = HR._answer(db, ask, before["sig"])
        check("a row made in the table moves the signature and the next read carries it",
              not after.get("same") and any(raw.get("id") == "zzFF1" and raw.get("digest_state") == "pending"
                                            for _rn, raw in after.get("rows") or []), after.get("same"))
        check("an unchanged house answers same", HR._answer(db, ask, after["sig"]).get("same") is True)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
