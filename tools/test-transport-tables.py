"""Transportation's vehicles, trips, inbox, log and settings on their own tables (vcVehicles, vcTrips, vcInbox, vcLog,
vcSettings), not on spreadsheets: every reader (transportation_writes.tab_rows, transportation.load, the flows'
inbox_rows) answers the rows the copy's own path answered; a trip made and changed, a setting kept by its key, a log
line and an inbox item land in the tables alone and leave no edit; a verdict on them rests on no book; and the write is
kept as one (writes.plan_of). One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-transport-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("TRANSPORT_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_transport_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"TRANSPORT_TABLES_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402
import types  # noqa: E402

import psycopg  # noqa: E402

import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import transportation as T  # noqa: E402
import transportation_flows as TF  # noqa: E402
import transportation_setup as TS  # noqa: E402
import transportation_writes as TW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TABS = (TW.TABS["vehicles"], TW.TABS["trips"], TW.TABS["log"], TW.TABS["settings"])


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled = tabled


def same(v: object) -> object:
    """A cell as a value: JSON text and the list or object it reads as compare equal, whatever its spacing."""
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def key(rows: list[dict], header: tuple) -> list[str]:
    return sorted(json.dumps({h: same(r.get(h, "")) for h in header}, sort_keys=True) for r in rows)


copies = {t: on_copy(lambda r, t=t: TW.tab_rows(r, t)) for t in TABS}
client_copies = {k: on_copy(lambda r, k=k: CS._vc_rows(r, k)) for k in CS.VC_TABS}
try:
    inbox_copy = on_copy(TF.inbox_rows)
except Exception as e:  # noqa: BLE001 - a house the copy never held reads as nothing
    facts["inbox on the copy"] = repr(e)[:200]
    inbox_copy = []
facts["rows on the copies"] = {**{t: len(v) for t, v in copies.items()}, TF.INBOX: len(inbox_copy)}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for t in (*TABS, TF.INBOX):
            if not RR.uploaded(db, HT.resource_of(t)):
                RR.upload(L.Reads(db, None), HT.resource_of(t), t)
        for t in TABS:
            got = TW.tab_rows(L.Reads(db, None), t)
            check(f"{t}: the writes' reader answers the copy's rows", key(got, TW.HEADERS[t])
                  == key(copies[t], TW.HEADERS[t]), (len(got), len(copies[t])))
            check(f"{t}: the board's load too", key(T.load(L.Reads(db, None), t), TW.HEADERS[t])
                  == key(copies[t], TW.HEADERS[t]))
        for k, t in CS.VC_TABS.items():
            check(f"{t}: Clients' transport reader answers the copy's rows", key(CS._vc_rows(L.Reads(db, None), k),
                                                                                TW.HEADERS[t])
                  == key(client_copies[k], TW.HEADERS[t]), len(client_copies[k]))
        check("the inbox reader answers the copy's items", key(TF.inbox_rows(L.Reads(db, None)), TF.INBOX_HEADER)
              == key(inbox_copy, TF.INBOX_HEADER))
        check("a verdict on the tabled houses rests on no book",
              TW.books(L.Reads(db, None), *TABS, TF.INBOX) == ())
        tok = SC._WRITE.set({"write_id": "Wzztransporttablecheck01"})
        reads = L.Reads(db, None)
        sid, tab = TW.where(reads, TW.TABS["trips"])
        trip = {h: "" for h in TW.HEADERS["vc_trips"]}
        trip.update({"id": "VTzzcheck", "state": "requested", "day": "2026-10-26", "purpose": "table check"})
        made = TW.row_record(sid, tab, TW.HEADERS["vc_trips"], trip["id"], trip["id"], None, trip, "")
        hit = HT.find(L.Reads(db, None), tab, "id", "VTzzcheck")
        check("a new trip lands in its table and leaves no edit", made is None and hit is not None
              and hit[1].get("state") == "requested", (made, hit))
        now = {**trip, "state": "confirmed"}
        changed = TW.row_record(sid, tab, TW.HEADERS["vc_trips"], trip["id"], trip["id"], trip, now, "")
        hit = HT.find(L.Reads(db, None), tab, "id", "VTzzcheck")
        check("a trip's changed cell lands on its row", changed is None and hit is not None
              and hit[1].get("state") == "confirmed" and hit[1].get("purpose") == "table check", (changed, hit))
        check("the readers see the trip", any(r["id"] == "VTzzcheck" and r["state"] == "confirmed"
                                              for r in TW.tab_rows(L.Reads(db, None), TW.TABS["trips"])))
        got = TS._setting_edits(L.Reads(db, None), [{"key": "zz_table_check", "value": "1", "note": "",
                                                     "updated_at": "now", "updated_by": "check"}], "check")
        got += TS._setting_edits(L.Reads(db, None), [{"key": "zz_table_check", "value": "2", "note": "",
                                                      "updated_at": "now", "updated_by": "check"}], "check")
        hits = [c for _k, c in RR.table_rows(None, HT.resource_of(TW.TABS["settings"]))
                if c.get("key") == "zz_table_check"]
        check("a setting kept twice by its key is one row with the last value", got == [None, None]
              and len(hits) == 1 and hits[0].get("value") == "2", (got, hits))
        row = TW.log_row(None, "VTzzcheck", "", "check", "", {"state": "confirmed"}, "table check", "now")
        got = TW.log_record(L.Reads(db, None), row, "VTzzcheck", "")
        check("a log line lands in its table", got is None
              and HT.find(L.Reads(db, None), TW.TABS["log"], "id", row["id"]) is not None, got)
        item = {h: "" for h in TF.INBOX_HEADER}
        item.update({"id": "VIzzcheck", "trip_id": "VTzzcheck", "box": "inbox", "kind": "ask", "title": "check"})
        got = TF.inbox_records(L.Reads(db, None), TF.upserts([], [item]), "VTzzcheck")
        check("an inbox item lands in its table and the inbox reads it", got == [None]
              and any(r["id"] == "VIzzcheck" for r in TF.inbox_rows(L.Reads(db, None))), got)
        held = types.SimpleNamespace(query=lambda sql, p=(): (cur.execute(sql, p), cur.fetchall())[1])
        got = MW._vc_inbox_rows(types.SimpleNamespace(db=types.SimpleNamespace(db=held)))
        check("My Work reads Transportation's items off the table", got is not None
              and any(r.get("id") == "VIzzcheck" for r in got[0]), got)
        envelope = W.envelope(W.Decision({"status": 200}), "Wzztransporttablecheck01", None)
        check("the write that changed these rows is kept as one", (envelope.get("_write") or {}).get("final") is True,
              envelope)
        SC._WRITE.reset(tok)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
