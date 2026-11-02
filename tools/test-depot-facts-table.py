"""The depot's Facts in a table of their own (app.depot_facts), not on the Essencial spreadsheet: the depot as hubdb
reads it (its props, switchboard, house pointers and config), My Work's pointers and switchboard, the dissolved hiring
tabs, the facts of a subject, the staff comms' facts, the config with its saves laid, the tab door's narrowed reads and
the engine's count answer what they answered off the copy, every statement written against the copy's table running
on hubdb.from_sql's shape of it; the kept edits the copy did not carry are laid on it as their writes lay them; a fact
written lands in the table alone and every reader sees it at once (its mark moves); and a void takes it back. One
transaction, rolled back, read through a reader bound to it.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-depot-facts-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DEPOT_FACTS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_depot_facts_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DEPOT_FACTS_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidate_writes as CW  # noqa: E402
import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import editions  # noqa: E402
import hiring_engine as HE  # noqa: E402
import hiring_flow as HF  # noqa: E402
import hub_rows  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff_comms as STC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
RES = hubdb.FACTS_RESOURCE


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
conn = psycopg.connect(owner, autocommit=False)
conn.execute("set search_path to app, public")
# a reader bound to this transaction: hubdb's own statements see the table as it is laid here
db = hubdb.HubDb(connect=lambda: conn)
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


def first_diff(a: object, b: object, at: str = "") -> str:
    if type(a) is not type(b) and not (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))):
        return f"{at}: {str(a)[:80]} | {str(b)[:80]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if plain(a.get(k)) != plain(b.get(k)):
                return first_diff(a.get(k), b.get(k), f"{at}.{k}")
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return f"{at}: {len(a)} vs {len(b)} items"
        for i, (x, y) in enumerate(zip(a, b)):
            if plain(x) != plain(y):
                return first_diff(x, y, f"{at}[{i}]")
    return f"{at}: {str(a)[:80]} | {str(b)[:80]}"


def depot(r: L.Reads) -> dict:
    f = r.db.facts()
    return {k: f[k] for k in ("areas", "subjects", "config")}


ref0 = db.tab(hubdb.ESSENCIAL_ID, hubdb.FACTS_TAB)
some_subject = next(s for s, in db.query(f'select subject_id from sheets."{ref0.table}"'  # noqa: S608
                                          " where subject_id like 'cand%%' or subject_id like 'CAND%%' limit 1")) \
    if db.query(f'select 1 from sheets."{ref0.table}" where subject_id ilike %s limit 1', ("cand%",)) else ""  # noqa: S608
READERS = {
    "the depot as hubdb reads it": depot,
    "the props and switches": lambda r: {"props": r.db.switchboard("props"), "moved": r.db.switchboard("moved"),
                                         "HUB_DB_ID": r.db.prop("HUB_DB_ID"), "people": r.db.house_id("people")},
    "My Work's pointers and switchboard": lambda r: [MW.HubBooks(r).pointers(),
                                                     MW.HubBooks(r).switchboard(["switchboard:moved.people"])],
    "the dissolved hiring tabs": lambda r: {t: CW.dissolved_rows(r, t) for t in ("hiring_alerts_config",
                                                                                 "entity_candidates")},
    "a subject's facts": lambda r: HF.subject_facts(r, some_subject, "candidate") if some_subject else {},
    "the staff comms' facts": lambda r: STC._facts(r, "switchboard:props.", True),
    "the config with its saves laid": lambda r: r.config(),
    "the tab door's narrowed read": lambda r: [hub_rows.rows(hubdb.ESSENCIAL_ID, "Facts",
                                                             {"Source": "switchboard:moved.people"}, db=r.db),
                                               len(hub_rows.rows(hubdb.ESSENCIAL_ID, "Facts",
                                                                 {"Subject ID": "HUB_DB_ID"}, db=r.db))],
    "the engine's count": lambda r: HE.facts_count(r),
}
copies = {k: f(L.Reads(db, None)) for k, f in READERS.items()}
try:
    with conn.cursor() as cur:
        token = W.HELD.set(cur)
        done = RR.upload_in_db(RES, "Facts", ref0)
        unlike = RR.unlike_copy(RES, ref0)
        laid = RR.lay_kept_edits(hubdb.ESSENCIAL_ID, ["Facts"], "1970-01-01T00:00:00Z")
        facts["upload"], facts["unlike the copy"], facts["kept edits laid"] = done, unlike, laid
        check("the table holds every copied row as the copy has it", not unlike["missing"] and not unlike["differ"])
        hubdb.facts_touched()
        check("hubdb reads the Facts from their table now", db.facts_kept(db.tab(hubdb.ESSENCIAL_ID, "Facts")))
        check("a statement over the copy's shape runs on the table", "app.depot_facts" in db.from_sql(
            db.tab(hubdb.ESSENCIAL_ID, "Facts")))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        # a fact written: in the table alone, every reader sees it at once
        wid = "Wzzdepotfactscheck01"
        tok = SC._WRITE.set({"write_id": wid})
        rec = W.kept_record(hubdb.ESSENCIAL_ID, "Facts", "append", W.COLS + W.COLS_SEP.join(
            ("Subject ID", "Source", "Evidence")), W.COLS_SEP.join(("ZZ_CHECK_ID", "switchboard:props.ZZ_CHECK_ID",
                                                                    "zz")), "check",
            {"Subject ID": "ZZ_CHECK_ID", "Value": "zz-value", "Source": "switchboard:props.ZZ_CHECK_ID",
             "Evidence": "zz"})
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, [rec], "check"), "check")
        check("the fact is read at once", db.prop("ZZ_CHECK_ID") == "zz-value", db.prop("ZZ_CHECK_ID"))
        cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
        check("app.edits keeps none of it", cur.fetchone()[0] == 0)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        hubdb.facts_touched()
        check("a void takes it back", db.prop("ZZ_CHECK_ID") == "" and plain(depot(L.Reads(db, None)))
              == plain(copies["the depot as hubdb reads it"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    hubdb.facts_touched()
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
