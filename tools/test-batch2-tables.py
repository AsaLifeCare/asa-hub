"""The Call Offs house, the appraisals, the four lane mirrors' houses, the People house, the helpful contacts, the mail
ledger and the staff profile's visits on their own tables, not on spreadsheets: every reader (the call-offs and their
raw cells, Staff › Performance's, My Work's lanes, the call-off form sweep's clone, the appraisals, the People roster,
the Houses page, the helpful contacts, the mail ledger's keys and the SSA's mail, a person's visits) answers what it
answered off the copies; the mirrors rewrite their tables and queue no book op, a call-off and a helpful contact are
taken out there, a helpful contact made there, peopleUpdate's change laid there, a rename rekeys the visits there; and
a void takes it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-batch2-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("BATCH2_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_batch2_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"BATCH2_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import book_ops as BO  # noqa: E402
import call_offs as CO  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import houses  # noqa: E402
import hubdb  # noqa: E402
import lane_mirror as LM  # noqa: E402
import lane_mirror_writes as LMW  # noqa: E402
import locations as L  # noqa: E402
import mail_log  # noqa: E402
import my_work as MW  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import ops_stragglers_writes as OSW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import ssa  # noqa: E402
import staff as SP  # noqa: E402
import staff_perf as SPF  # noqa: E402
import staff_writes as SW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"callOffs": "callOffsHouse", "perf_ai": "perfAi", "uiIncidents": "laneUiIncidents",
          "supportQueue": "laneSupportQueue", "dailyNotes": "laneDailyNotes", "cloneCallOffs": "laneCloneCallOffs",
          "people": "peopleHouse", "helpful_contacts": "helpfulContactsHouse", "mail": "mailLog",
          "staff_profile_visits": "staffProfileVisits"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)


class Through:
    """asa-hub-db as this transaction sees it: its queries on the transaction's cursor, the rest the real reader's."""

    def __init__(self, real: hubdb.HubDb, cur) -> None:
        self._real, self._cur = real, cur

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        self._cur.execute(sql, params)
        return list(self._cur.fetchall())

    def __getattr__(self, name: str):
        return getattr(self._real, name)


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


def clockless(v: object) -> object:
    """A read's answer without its own clock: each read tells the moment it was made, and when each copy was taken."""
    if isinstance(v, dict):
        return {k: clockless(x) for k, x in v.items()
                if k not in ("as_of", "now", "read_at", "generated_at", "stale", "until", "book", "last_sync_at",
                             "last_sync_status", "modified_time", "at")}
    if isinstance(v, (list, tuple)):
        return [clockless(x) for x in v]
    return v


def filled(rows: list) -> list:
    """Rows by what each cell holds: a blank cell and a missing one read alike."""
    return [{k: gsjs.js_str(v) for k, v in r.items() if gsjs.or_blank(v) != ""} if isinstance(r, dict) else r
            for r in rows]


def lanes(r: L.Reads) -> dict:
    got = MW.lanes_for(MW.HubBooks(r), ("callOffs", "supportQueue", "uiIncidents"))
    return clockless({k: {**v, "rows": filled(v.get("rows") or [])} for k, v in got.items()})


def houses_page(r: L.Reads) -> object:
    rows, why = houses.build_rows(r)
    return clockless([rows, why])


visit_keys = sorted({gsjs.str_(raw.get("staff_key")) for _rn, raw in db.rows(db.resolve("staff_profile_visits").ref)}
                    - {""})[:6]
ssa_mails = sorted({gsjs.str_(raw.get("to")) for _rn, raw in db.rows(db.resolve("mail").ref)} - {""})[:4]
READERS = {
    "the call-offs": lambda r: CO.rows(r),
    "the call-offs' raw cells": lambda r: CO.raw_rows(r),
    "Staff › Performance's call-offs": lambda r: SPF._hub_rows(r, "callOffs"),
    "the appraisals": lambda r: SPF._perf_rows(r, "perf_ai"),
    "the call-off form sweep's clone": lambda r: SCD.board_rows(r, "cloneCallOffs"),
    "the People roster": lambda r: SP._people(r),
    "the Houses page": houses_page,
    "the helpful contacts": lambda r: OS.rows(r, "helpful_contacts"),
    "the mail ledger's keys": lambda r: sorted(mail_log.seen_keys(r)),
    "the SSA's mail": lambda r: ssa.mail(r, ssa_mails, "2000-01-01"),
    "a person's visits": lambda r: {k: SP.own_rows(r, "staff_profile_visits", k) for k in visit_keys},
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_lanes = lanes(L.Reads(db, None))
facts["rows on the copies"] = {k: len(v) if isinstance(v, (list, dict)) else v for k, v in copies.items()}
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
        through = Through(db, cur)
        seen = lanes(L.Reads(through, None))
        check("My Work's lanes answer the copy's", plain(seen) == plain(copy_lanes), first_diff(seen, copy_lanes))
        hb = MW.HubBooks(L.Reads(through, None))
        ptrs = hb.pointers()
        found = {}
        for prop, want in (("HUB_HOTLINE_CALLOFFS_SHEET_ID", "callOffsHouse"),
                           ("HUB_HOUSE_UIINCIDENTS_ID", "laneUiIncidents"),
                           ("HUB_HOUSE_SUPPORTQUEUE_ID", "laneSupportQueue")):
            sid = ptrs.get(prop) or db.prop(prop) or (db.resolve("callOffs").sheet_id if want == "callOffsHouse" else "")
            found[prop] = (hb._kept_name(sid, MW.HOUSE_TAB), want)
        check("My Work's lane reads find each house's table", all(a == b for a, b in found.values()), found)

        def ops() -> int:
            cur.execute(f"select count(*) from {BO.table()}")
            return int(cur.fetchone()[0])

        def in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        ops0 = ops()
        # the mirrors: every house planned again from its estate book and rewritten in its table
        wid = "Wzzbatch2check00001"
        tok = SC._WRITE.set({"write_id": wid})
        kept = LMW._keep(L.Reads(db, None), list(LM.MIRRORS), "check")
        facts["mirrors rewritten in their tables"] = kept["rewrites"]
        facts["mirror lines"] = [(ln["resource"], ln["state"], ln.get("held", False)) for ln in kept["mirrored"]]
        again = LMW._keep(L.Reads(db, None), list(LM.MIRRORS), "check")
        check("a second pass finds every table as its book's newest rows", not again["rewrites"], again["rewrites"])
        check("the clone the sweep reads is the table the mirror rewrote",
              len(SCD.board_rows(L.Reads(db, None), "cloneCallOffs"))
              == next(ln["rows"] for ln in kept["mirrored"] if ln["resource"] == "cloneCallOffs"))
        SC._WRITE.reset(tok)
        # a call-off and a helpful contact taken out, a helpful contact made, a person's row changed, visits rekeyed
        wid2 = "Wzzbatch2check00002"
        tok = SC._WRITE.set({"write_id": wid2})
        r0 = L.Reads(db, None)
        gone = gsjs.str_(CO.rows(r0)[0].get("id"))
        held, OSW._held = OSW._held, lambda _reads: None
        try:
            d1 = OSW.call_off_delete(L.Session(L.Reads(db, None), master), {"id": gone})
            d2 = OSW.helpful_create(L.Session(L.Reads(db, None), master), {"name": "zz check", "phone": "5550000000"})
            made = gsjs.str_(((d2.answer or {}).get("data") or {}).get("id"))
            other = gsjs.str_(OS.rows(L.Reads(db, None), "helpful_contacts")[0].get("id"))
            d3 = OSW.helpful_delete(L.Session(L.Reads(db, None), master), {"id": other})
            pid = gsjs.str_(SP._people(L.Reads(db, None))[0].get("id"))
            d4 = OSW.people_update(L.Session(L.Reads(db, None), master), {"id": pid, "notes": "zz check"})
        finally:
            OSW._held = held
        check("the doors answer", all((d.answer or {}).get("status") == 200 for d in (d1, d2, d3, d4)),
              [(d.answer or {}).get("message") for d in (d1, d2, d3, d4)])
        tx = W.Tx(cur, "location")
        tx.record(wid2, "check", {"status": 200}, W.final({"status": 200}, d4.edits or [], "check"), "check")
        moved = SW.rekey_table(L.Reads(db, None), "staff_profile_visits", visit_keys[0], "zz-key", "Zz Check", "check")
        r1 = L.Reads(db, None)
        check("the call-off is taken out of its table", gone not in {gsjs.str_(r.get("id")) for r in CO.rows(r1)})
        hc = {gsjs.str_(r.get("id")): r for r in OS.rows(r1, "helpful_contacts")}
        check("the helpful contact is made there, the other taken out", made in hc and other not in hc, sorted(hc))
        person = next((p for p in SP._people(r1) if gsjs.str_(p.get("id")) == pid), {})
        check("peopleUpdate's change lands on the person's row", person.get("notes") == "zz check", person.get("notes"))
        check("the rename rekeys the visits there", moved > 0 and not SP.own_rows(r1, "staff_profile_visits",
                                                                                   visit_keys[0])
              and len(SP.own_rows(r1, "staff_profile_visits", "zz-key")) == moved, moved)
        check("app.edits keeps none of it", in_edits(wid2) == set(), in_edits(wid2))
        check("no book op was queued", ops() == ops0, ops() - ops0)
        SC._WRITE.reset(tok)
        for w in (wid2, wid):
            RR.void(cur, w)
        r2 = L.Reads(db, None)
        # a column a write added stays, blank, as a grown header stays on a sheet: rows compared by what they hold
        back = {k: filled(READERS[k](r2)) for k in ("the call-offs", "the People roster", "the helpful contacts")}
        back["a person's visits"] = {k: filled(v) for k, v in READERS["a person's visits"](r2).items()}
        was = {k: filled(copies[k]) for k in ("the call-offs", "the People roster", "the helpful contacts")}
        was["a person's visits"] = {k: filled(v) for k, v in copies["a person's visits"].items()}
        check("a void takes it all back", all(plain(v) == plain(was[k]) for k, v in back.items()),
              next((first_diff(v, was[k], k) for k, v in back.items() if plain(v) != plain(was[k])), ""))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
