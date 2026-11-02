"""Support Requests' record (support_events, support_decisions, support_inbox) on its own tables, not on
spreadsheets: every reader (the board's houses and the writers', the board as the master sees it, the clock's look,
My Work's and My Inbox's store) answers what it answered off the copies; a house book's Data tab is found as the
house it keeps, for these and for every house kept before them (house_tables.data_home); the writers' kept records
land in the tables alone (writes.into_tables), the item door's mark among them, an append whose key the table holds
laid on that row, a house still on its copy keeping its records in app.edits in the same write; and a void takes it
all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-support-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SUPPORT_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_support_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SUPPORT_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import support_desk as SD  # noqa: E402
import support_desk_clock as SDC  # noqa: E402
import support_desk_writes as SDW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"support_events": "supportEvents", "support_decisions": "supportDecisions",
          "support_inbox": "supportInbox"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users = L.Reads(db, None).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto"))
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


def filled(rows: list[dict]) -> list[dict]:
    """A store's rows by what each cell holds: a blank cell and a missing one read alike (a row a kept edit appended
    to the copy names only the cells written, the table every column)."""
    return [{k: gsjs.js_str(v) for k, v in r.items() if gsjs.or_blank(v) != ""} for r in rows]


def pointer(ptr: str) -> str:
    return MW.HubBooks(L.Reads(db, None)).pointers().get(ptr, "")


def store(r: L.Reads, ptr: str, tab: str = MW.HOUSE_TAB) -> tuple:
    """The rows, and whether the tab holds any: a copy counts its own rows, never the ones kept edits appended."""
    rows, total, _as_of = MW.HubBooks(r).tab(pointer(ptr), tab)
    return filled(rows), total > 0


def clockless(v: object) -> object:
    """A read's answer without its own clock: each read tells the moment it was made."""
    if isinstance(v, dict):
        return {k: clockless(x) for k, x in v.items() if k not in ("as_of", "now", "generated_at", "read_at")}
    if isinstance(v, (list, tuple)):
        return [clockless(x) for x in v]
    return v


def board(r: L.Reads) -> dict:
    return clockless(SD.support_desk_list(L.Session(r, master), {"completed": True}))


def look(r: L.Reads) -> dict:
    return {k: v for k, v in SDC.look(r).items() if k not in ("now", "as_of")}


READERS = {
    **{f"{t}: the board's house": (lambda r, t=t: SD.read_house(r, t)) for t in HOUSES},
    **{f"{t}: the writers' house": (lambda r, t=t: SDW.tab_rows(r, t)) for t in HOUSES},
    "the writers' events, verdicts and items by ref": lambda r: [SDW.events_list(r), SDW.decisions_by_ref(r),
                                                                  SDW.items_by_ref(r)],
    "the board as the master sees it": board,
    "the clock's look": look,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
facts["rows on the copies"] = {t: len(copies[f"{t}: the writers' house"]) for t in HOUSES}
copy_items = store(L.Reads(db, None), MW.PTR_SUPPORT_INBOX)
# the houses read by pointer whose tables have not moved since their upload: the copy's rows are the table's
STILL = {MW.PTR_VC_INBOX: MW.HOUSE_TAB, MW.PTR_CATALOGUE: MW.HOUSE_TAB, MW.PTR_APPS: MW.TAB_POLICY_ACKS}
copy_still = {p: store(L.Reads(db, None), p, t) for p, t in STILL.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        through = Through(db, cur)
        seen = store(L.Reads(through, None), MW.PTR_SUPPORT_INBOX)
        check("My Work's and My Inbox's store reads the items' table as it read the copy",
              plain(seen) == plain(copy_items), first_diff(seen, copy_items))
        # every house kept in a table whose writes name its book's Data tab (writes.where_of: a declared house whose
        # book holds no tab of its own name) is found by that tab, and no other house is
        cur.execute(f"select resource, sheet_id, tab_name from {RR.COLUMNS} where uploaded_at is not null")
        kept_rows = cur.fetchall()
        by_book: dict[str, dict[str, str]] = {}
        for res, sid, tab in kept_rows:
            by_book.setdefault(sid, {})[tab] = res
        wrong = []
        homes = 0
        for res, sid, tab in kept_rows:
            got = db.resolve(tab)
            is_home = got.sheet_id == sid and got.declared_house and W.where_of(got)[1] == hubdb.HOUSE_DATA_TAB
            found = HT.data_home(db, sid, by_book[sid]) == res
            homes += is_home
            if is_home != found:
                wrong.append((res, is_home, found))
        facts["houses kept in their book's Data tab"] = homes
        check("each house kept from its book's Data tab is that tab's house, and only they are", not wrong, wrong[:5])
        hb = MW.HubBooks(L.Reads(through, None))
        want = {MW.PTR_STATES: "requirementStates", MW.PTR_SCHED_INBOX: "schedInbox", MW.PTR_VC_INBOX: "vcInbox",
                MW.PTR_CATALOGUE: "requirements", MW.PTR_SUPPORT_INBOX: "supportInbox",
                "HUB_HOUSE_LOG_STATUS_HISTORY_ID": "logStatusHistory"}
        found = {}
        for p in want:
            sid = hb.pointers().get(p, "") or db.prop(p)
            hb.tab(sid, MW.HOUSE_TAB)
            found[p] = hb.__dict__.get("_kept_of", {}).get((sid, MW.HOUSE_TAB))
        hb.tab(hb.pointers().get(MW.PTR_APPS, ""), MW.TAB_POLICY_ACKS)
        found[MW.PTR_APPS] = hb.__dict__["_kept_of"].get((hb.pointers().get(MW.PTR_APPS, ""), MW.TAB_POLICY_ACKS))
        want[MW.PTR_APPS] = "policyAcks"
        check("My Work's store finds every house read by pointer in its table", found == want,
              {p: (found.get(p), w) for p, w in want.items() if found.get(p) != w})
        for p, t in STILL.items():
            got = store(L.Reads(through, None), p, t)
            check(f"{p}: My Work's store reads the table's rows, the copy's", plain(got) == plain(copy_still[p]),
                  first_diff(got, copy_still[p]))
        tx = W.Tx(cur, "location")

        def kept_in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        r0 = L.Reads(db, None)
        # what the raise, the clock and the verdicts keep: an event, its item, a decision, an item's change; and a
        # settings row (its copy still) in the same write
        wid = "Wzzsupportcheck00001"
        tok = SC._WRITE.set({"write_id": wid})
        ev_sid, ev_tab = SDW.where(r0, SDW.TABS["events"])
        ev = {h: "" for h in SDW.HEADERS["support_events"]}
        ev.update(id="SE0000000CCC", kind="general", ref="SE0000000CCC", title="zz check",
                  created_at="2026-10-27T00:00:00Z")
        item = {h: "" for h in SDW.HEADERS["support_inbox"]}
        item.update(id="SN0000000CCC", ref="SE0000000CCC", box="inbox", kind="info", title="zz check",
                    to_uid=SDW.acting_id(master), to_name="check", state="new", created_at="2026-10-27T00:00:00Z")
        dec = SDW.decision_row(r0, ref="SE0000000CCC", source="event", verdict="note", note="zz check", by_uid="",
                               by_name="check", via="check")
        some = next(it for it in SDW.tab_rows(r0, SDW.TABS["inbox"]) if not gsjs.trim(it.get("note")))
        st_sid, st_tab = SDW.where(r0, SDW.TABS["settings"])
        edits = [W.kept_record(ev_sid, ev_tab, "append", "id", ev["id"], ev["ref"], ev),
                 SDW.item_record(r0, None, item, ev["ref"]), SDW.decision_record(r0, dec, ev["ref"]),
                 SDW.item_record(r0, some, {**some, "note": "zz check"}, some["ref"]),
                 W.kept_record(st_sid, st_tab, "append", "cols:key", "zzcheck", "settings",
                               {"key": "zzcheck", "value": "zz"})]
        facts["the houses' Data tabs the writers name"] = sorted({(e["tab_name"]) for e in edits[:4]})
        tx.record(wid, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        r1 = L.Reads(db, None)
        e1 = {gsjs.or_blank(r.get("id")): r for r in SDW.tab_rows(r1, SDW.TABS["events"])}
        i1 = {gsjs.or_blank(r.get("id")): r for r in SDW.tab_rows(r1, SDW.TABS["inbox"])}
        d1 = SDW.decisions_by_ref(r1).get("SE0000000CCC") or []
        check("the event is made in its table", e1.get("SE0000000CCC", {}).get("title") == "zz check",
              e1.get("SE0000000CCC"))
        check("its item is made there", i1.get("SN0000000CCC", {}).get("kind") == "info", i1.get("SN0000000CCC"))
        check("the decision is made there", len(d1) == 1 and d1[0].get("note") == "zz check", d1)
        check("an item's change lands on its row", i1[some["id"]].get("note") == "zz check")
        check("the board reads them", "SE0000000CCC" in {gsjs.or_blank(e.get("id")) for e in SD.events_(r1)})
        check("app.edits keeps only the house still on its copy", kept_in_edits(wid) == {st_tab}, kept_in_edits(wid))
        SC._WRITE.reset(tok)
        # the item door: its recipient marks the informative made above seen
        info = i1["SN0000000CCC"]
        wid2 = "Wzzsupportcheck00002"
        tok = SC._WRITE.set({"write_id": wid2, "tx": tx})
        gate, W.gate = W.gate, lambda _reads: None
        try:
            d = SDW.inbox_answer(L.Session(L.Reads(db, None), master), {"item_id": info["id"], "word": "seen"})
        finally:
            W.gate = gate
        check("the item door decides the mark", (d.answer or {}).get("status") == 200 and d.edits, d.answer)
        tx.record(wid2, "supportInboxAnswer", {"status": 200}, d, "check")
        i2 = {gsjs.or_blank(r.get("id")): r for r in SDW.tab_rows(L.Reads(db, None), SDW.TABS["inbox"])}
        check("the mark lands on the item's row", gsjs.or_blank(i2[info["id"]].get("answered_at")) != ""
              and gsjs.or_blank(i2[info["id"]].get("state")) != gsjs.or_blank(info.get("state")), i2[info["id"]])
        check("app.edits keeps none of the door's write", kept_in_edits(wid2) == set(), kept_in_edits(wid2))
        SC._WRITE.reset(tok)
        # an append whose id the table holds is laid on that row, never a second one
        wid3 = "Wzzsupportcheck00003"
        again = [W.kept_record(ev_sid, ev_tab, "append", "id", ev["id"], ev["ref"], {**ev, "title": "zz again"})]
        tx.record(wid3, "check", {"status": 200}, W.final({"status": 200}, again, "check"), "check")
        e3 = [r for r in SDW.tab_rows(L.Reads(db, None), SDW.TABS["events"]) if r.get("id") == "SE0000000CCC"]
        check("an append of an id the table holds is laid on its row", len(e3) == 1 and e3[0]["title"] == "zz again",
              e3)
        for w in (wid, wid2, wid3):
            RR.void(cur, w)
        r4 = L.Reads(db, None)
        check("a void takes it all back", all(plain(SDW.tab_rows(r4, t)) == plain(copies[f"{t}: the writers' house"])
                                              for t in HOUSES))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
