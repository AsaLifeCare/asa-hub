"""The events trail (the house `events`, 300k rows) in a table of its own, not on a spreadsheet: the events page's newest
window, a profile's activity by its subject and the onboarding calendar's note answer what they answered off the copy,
plus the events kept edits appended that those statements on the copy never showed; compliance's events land in the
table by its event id (an append of a held id laid on its row, never a second), found by the index; and a void takes
it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-events-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("EVENTS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_events_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"EVENTS_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=1500)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidate_papers as CP  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff as SP  # noqa: E402
import system_logs as SL  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
RES = "eventTrail"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
res = db.resolve("events")
sid, data_tab = W.where_of(res)
# the events kept edits appended: the copy's own statements never read them
appended = sorted({k for (k,) in db.query(f"select distinct row_key from {W.EDITS_TABLE} where sheet_id = %s"
                                          " and kind = 'append'", (sid,))})
facts["events only kept edits appended"] = appended


def on_copy(read):
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


# the trail's own newest rows: the page merges them with the Hub's own events, written live as people work
trail_ids = {gsjs.str_(raw.get("event_id")) for (raw,) in db.query(
    f'select _raw from sheets."{res.ref.table}" order by row_number desc limit 600')}  # noqa: S608


def page(r: L.Reads) -> list:
    """The page's first events from the trail itself, but for the ones kept edits appended (the table's window holds
    them, so its oldest few fall out of the window the copy's held)."""
    got = SL.events_list(L.Session(r, master), {"limit": 200})
    return [e for e in (got.get("data") or {}).get("events") or []
            if e.get("event_id") in trail_ids and e.get("event_id") not in appended][:150]


# subjects the appended events do not name, so each profile's activity is the copy's row for row
theirs = {v for (v,) in db.query(f"select value from {W.EDITS_TABLE} where sheet_id = %s and field = 'subject_key'",
                                  (sid,))}
subjects = sorted({gsjs.str_(raw.get("subject_key")) for (raw,) in db.query(
    f'select _raw from sheets."{res.ref.table}" order by row_number desc limit 400')} - {""} - theirs)[:8]  # noqa: S608
facts["subjects asked"] = len(subjects)
READERS = {
    "the events page's newest window": page,
    "a profile's activity by its subject": lambda r: {k: SP.events_for(r, k) for k in subjects},
}
copies = {k: on_copy(f) for k, f in READERS.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        t0 = time.time()
        if not RR.uploaded(db, RES):
            # by the database itself, as tools/upload-in-db.py lays it, then the kept appends as carry-appends does
            facts["upload"] = RR.upload_in_db(RES, "events", res.ref)
            cur.execute(f"select write_id, row_key, field, value from {W.EDITS_TABLE} where sheet_id = %s"
                        " and kind = 'append' order by at, id", (sid,))
            carried: dict[tuple, dict] = {}
            for w_id, rk, field, value in cur.fetchall():
                carried.setdefault((w_id, rk), {})[field] = value
            for cells in carried.values():
                RR.create(None, RES, cells, "carry-appends")  # type: ignore[arg-type]
        facts["upload seconds"] = round(time.time() - t0, 1)
        cur.execute(f"select count(*) from {RR.rows_of(RES)} where resource = %s", (RES,))
        facts["rows in the table"] = cur.fetchone()[0]
        cur.execute(f"select count(*) from {RR.ROWS} where resource = %s", (RES,))
        check("no row of the trail is in the shared table", cur.fetchone()[0] == 0)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        cur.execute(f"select count(*) from {RR.rows_of(RES)} where resource = %s and cells->>'event_id' = any(%s)",
                    (RES, appended))
        check("the events only kept edits appended are in the table", cur.fetchone()[0] == len(appended))
        by_event = RR.TRIMMED.format(col="'event_id'")
        cur.execute(f"explain select row_key from {RR.rows_of(RES)} where resource = %s and removed_at is null"
                    f" and {by_event} = any(%s::text[])", (RES, ["x"]))
        plan = " ".join(r[0] for r in cur.fetchall())
        check("an event is looked for by its index", "trail_events_event" in plan, plan[:200])

        def in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        # compliance's events: two appended by their event id, one again on its row; the onboarding calendar's note
        wid = "Wzzeventscheck000001"
        tok = SC._WRITE.set({"write_id": wid})
        heads = [h for h in RR.columns(L.Reads(db, None), RES) if h]
        evs = [W.kept_record(sid, data_tab, "append", "cols:event_id", e, "check",
                             {"event_id": e, "type": "zz.check", "subject_key": "zz-subject", "at": W.now_iso(L.Reads(db, None))})
               for e in ("zzev1", "zzev2")]
        evs.append(W.kept_record(sid, data_tab, "append", "cols:event_id", "zzev1", "check",
                                 {"event_id": "zzev1", "type": "zz.again"}))
        note = CP.calendar_note(L.Reads(db, None), "zzcand", "Zz Check", W.now_iso(L.Reads(db, None)), True)
        t1 = time.time()
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, evs + note, "check"),
                                     "check")
        facts["the write's seconds"] = round(time.time() - t1, 2)
        r1 = L.Reads(db, None)
        mine = SP.events_for(r1, "zz-subject")
        check("compliance's events land in the table, the held id laid on its row",
              sorted(e["type"] for e in mine) == ["zz.again", "zz.check"], mine)
        check("the onboarding note lands there", len(note) == 1 and CP.calendar_note(r1, "zzcand", "Zz Check",
                                                                                     W.now_iso(r1), True) == [])
        check("app.edits keeps none of it", in_edits(wid) == set(), in_edits(wid))
        check("the events page shows them", {"zzev1", "zzev2"} <= {e["event_id"] for e in (SL.events_list(
            L.Session(r1, master), {"limit": 200}).get("data") or {}).get("events") or []})
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes it all back", SP.events_for(L.Reads(db, None), "zz-subject") == [])
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
