"""The hotline's log and call-off queue, the sidebar's sections and placement, and each person's preferences on their own
tables, not on spreadsheets: every reader (the log strip, the sweep's look, the filed check, the calls' log through the
tab door, the clock's call-off subjects, the shelf as the master sees it in both doors, each person's preferences as
Prefs, the release and the bundles read them) answers what it answered off the copies; the shelf's save rewrites its
two tables whole and queues no book op, prefsSet and the release stamp change the person's last row there, the filing
pass's kept records land in the tables alone; and a void takes it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-hotline-prefs-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("HOTLINE_PREFS_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_hotline_prefs_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"HOTLINE_PREFS_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import book_ops as BO  # noqa: E402
import bundles  # noqa: E402
import client_writes  # noqa: E402
import config_lane  # noqa: E402
import gsjs  # noqa: E402
import hotline as H  # noqa: E402
import hotline_calls as HC  # noqa: E402
import hotline_file as HF  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import prefs_doors as PD  # noqa: E402
import prefs_doors_writes as PDW  # noqa: E402
import release_user_writes as RUW  # noqa: E402
import release_users as RU  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_clock  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"hotline_log": "hotlineLog", "hotline_calloff_queue": "hotlineCalloffQueue", "app_sections": "appSections",
          "app_placement": "appPlacement", "user_prefs": "userPrefs"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
me = gsjs.str_(master.get("id"))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled = tabled


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


def calls_log(_r: L.Reads) -> list:
    """The calls' log read (hotline_calls through the tab door), its rows by what each cell holds."""
    return [{k: v for k, v in row.items() if k != "_row"} for row in HC._book_read(HC.HOTLINE_LOG, HC.L_FIELDS)()[0]["rows"]]


copy_log = on_copy(lambda r: H.log_strip(r))
call_ids = sorted({gsjs.str_(t.get("call_id")) for t in copy_log["tail"]} | {"zz-not-a-call"})
uids = sorted({PD.cell(raw, "user_id") for _rn, raw in on_copy(lambda r: PD.held_rows(r, "")["rows"])} - {""})
READERS = {
    "the log strip": lambda r: H.log_strip(r),
    "the sweep's look": lambda r: H.due(r),
    "the filed check": lambda r: {c: HF._filed_by_apps_script(r, c) for c in call_ids},
    "the calls' log through the tab door": calls_log,
    "the clock's call-off subjects": lambda r: smart_clock.hotline_subjects(r),
    "the shelf as Prefs answers it": lambda r: PD.shelf(r, master),
    "the shelf as the config lane answers it": lambda r: config_lane.shelf(r, master),
    "each person's preferences": lambda r: {u: PD.prefs_of(r, {"id": u}) for u in uids},
    "the release's preferences": lambda r: {u: RU.prefs_for(r, u) for u in uids},
    "the bundles' preferences": lambda r: bundles.prefs_rows(r),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
facts["people with preferences"] = len(uids)
facts["log lines"] = copies["the log strip"]["processed_total"] + copies["the log strip"]["blocked_total"]
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select resource, count(*) from {RR.ROWS} where resource = any(%s) and exists (select 1 from"
                    " jsonb_each_text(cells) c where c.value like '[withheld%%') group by 1", (list(HOUSES.values()),))
        check("no cell of the tables is withheld", not cur.fetchall())
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))

        def ops() -> int:
            cur.execute(f"select count(*) from {BO.table()}")
            return int(cur.fetchone()[0])

        def in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        ops0 = ops()
        # the shelf's save: one placement fewer, then back as it was
        shelf0 = copies["the shelf as Prefs answers it"]
        order = [(a, s) for s in [x["id"] for x in shelf0["sections"]] for a in shelf0["order"].get(s, [])]
        sections = [{"id": x["id"], "label": x["label"], "tint": x["tint"], "icon": x["icon"]}
                    for x in shelf0["sections"]]
        wid = "Wzzhotlineprefs00001"
        tok = SC._WRITE.set({"write_id": wid})
        d = PDW.shelf_set(L.Session(L.Reads(db, None), master),
                          {"sections": sections, "placement": [{"app_id": a, "section_id": s} for a, s in order[:-1]]})
        shelf1 = PD.shelf(L.Reads(db, None), master)
        check("the shelf's save answers", (d.answer or {}).get("status") == 200 and d.own, d.answer)
        check("its placement is the table's, one app fewer", sum(len(v) for v in shelf1["order"].values())
              == len(order) - 1 and order[-1][0] not in shelf1["placement"], shelf1["placement"])
        check("its sections stand", shelf1["sections"] == shelf0["sections"] or
              [x["id"] for x in shelf1["sections"]] == [x["id"] for x in shelf0["sections"]])
        PDW.shelf_set(L.Session(L.Reads(db, None), master),
                      {"sections": sections, "placement": [{"app_id": a, "section_id": s} for a, s in order]})
        shelf2 = PD.shelf(L.Reads(db, None), master)
        check("saved back, the shelf is as it was", plain({k: shelf2[k] for k in ("placement", "order")})
              == plain({k: shelf0[k] for k in ("placement", "order")}), first_diff(shelf2, shelf0))
        SC._WRITE.reset(tok)
        # prefsSet: the master's own row changed there
        wid2 = "Wzzhotlineprefs00002"
        tok = SC._WRITE.set({"write_id": wid2})
        was = PD.prefs_of(L.Reads(db, None), master)["prefs"] or {}
        d = PDW.prefs_set(L.Session(L.Reads(db, None), master), {"prefs": {**was, "zzcheck": 1}})
        now = PD.prefs_of(L.Reads(db, None), master)["prefs"] or {}
        check("prefsSet lands on the person's row", (d.answer or {}).get("status") == 200 and now.get("zzcheck") == 1
              and now.get(PD.RELEASED_KEY) == was.get(PD.RELEASED_KEY), (d.answer, now))
        SC._WRITE.reset(tok)
        # the release stamp on the same row
        wid3 = "Wzzhotlineprefs00003"
        tok = SC._WRITE.set({"write_id": wid3})
        _touched, more = RUW.marks_and_stamp(L.Reads(db, None), me, "2099-01-01T00:00:00.000Z", "check", "check")
        stamped = PD.prefs_of(L.Reads(db, None), master)["prefs"] or {}
        check("the release stamp lands there", not more and stamped.get(PD.RELEASED_KEY) == "2099-01-01T00:00:00.000Z"
              and stamped.get("zzcheck") == 1, stamped)
        SC._WRITE.reset(tok)
        check("no book op was queued", ops() == ops0, ops() - ops0)
        # the filing pass: a log line and a call-off queued, kept records laid on the tables
        wid4 = "Wzzhotlineprefs00004"
        r0 = L.Reads(db, None)
        tx = W.Tx(cur, "location")
        edits = [HF._hub_append(r0, HF.LOG_TAB, {"call_id": "zzcall1", "at": W.now_iso(r0), "caller": "check",
                                                 "items": "1", "kinds": "check", "status": "processed"},
                                ("call_id",), "zzcall1"),
                 HF._hub_append(r0, HF.CALLOFF_QUEUE_TAB, {"instance": "zzinst1", "employee": "zz check",
                                                           "queued_at": W.now_iso(r0)}, ("instance",), "zzcall1")]
        facts["the filing pass names"] = sorted({e["tab_name"] for e in edits})
        tx.record(wid4, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        r1 = L.Reads(db, None)
        check("the log line lands in its table", HF._filed_by_apps_script(r1, "zzcall1")
              and H.log_strip(r1)["tail"][0]["call_id"] == "zzcall1", H.log_strip(r1)["tail"][:1])
        check("the call-off lands in its table", any(s["instance"] == "zzinst1"
                                                     for s in smart_clock.hotline_subjects(r1)))
        check("app.edits keeps none of the filing", in_edits(wid4) == set(), in_edits(wid4))
        # newest first, as each write was taken back after the ones made on top of it
        for w in (wid4, wid3, wid2, wid):
            RR.void(cur, w)
        r2 = L.Reads(db, None)
        back = {k: READERS[k](r2) for k in ("the log strip", "the shelf as Prefs answers it", "each person's preferences",
                                             "the clock's call-off subjects")}
        check("a void takes it all back", all(plain(v) == plain(copies[k]) for k, v in back.items()),
              next((first_diff(v, copies[k], k) for k, v in back.items() if plain(v) != plain(copies[k])), ""))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
