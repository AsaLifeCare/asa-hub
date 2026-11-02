"""The client entities book (its 8 tabs, the house registry among them) on tables of its own, each named with its book:
every reader (the registry as Locations reads it, the Houses page, the roster's house directory, the lanes' read by
id, each tab whole) answers what it answered off the copy, the card cells the copy withholds left out of the table; a
house's row saved by the master lands on its row there by its home id (writes.into_tables), and a void takes it
back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-client-entities-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CLIENT_ENTITIES_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_client_entities_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CLIENT_ENTITIES_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import houses  # noqa: E402
import hubdb  # noqa: E402
import lanes_sheets  # noqa: E402
import locations as L  # noqa: E402
import mw_roster  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
ENT = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") == "HUB_CLIENT_ENTITIES_SHEET_ID"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
sid = L.ENTITIES_FALLBACK
CARDS = ("tl_debit_card_number", "dc_pin")


def on_copy(read):
    tabled, within = HT.tabled, HT.resource_in
    HT.tabled, HT.resource_in = (lambda _tab: False), (lambda _r, _s, _t: None)
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled, HT.resource_in = tabled, within


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


def whole(r: L.Reads) -> dict:
    """Each tab whole, a card cell the copy withholds as no cell (the table keeps none of it)."""
    out = {}
    for t in sorted(ENT.values()):
        heads, rows = CND._book_rows(r, sid, t) or ([], [])
        out[t] = [{h: ("" if h in CARDS and str(v).startswith(RR.WITHHELD) else v) for h, v in zip(heads, row)}
                  for row in rows]
    return out


def clockless(v: object) -> object:
    if isinstance(v, dict):
        return {k: clockless(x) for k, x in v.items() if k not in ("read_at", "book", "state", "why")}
    if isinstance(v, (list, tuple)):
        return [clockless(x) for x in v]
    return v


READERS = {
    "each tab whole": whole,
    "the registry as Locations reads it": lambda r: r.homes(),
    "the Houses page": lambda r: clockless(houses.build_rows(r)),
    "the lanes' read by id": lambda r: lanes_sheets.data(sid, "entity_homes"),
    "the roster's house directory": lambda r: mw_roster.house_directory.read(r.db),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for res, tab in ENT.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select count(*) from {RR.ROWS} where resource = 'entClients' and (cells ? %s or cells ? %s)",
                    CARDS)
        check("no card cell is in the table", cur.fetchone()[0] == 0)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        # the master saves a house's phone: laid on its row by its home id
        wid = "Wzzentitiescheck0001"
        tok = SC._WRITE.set({"write_id": wid})
        home = L.Reads(db, None).homes()[0]
        d = W.house_save(L.Session(L.Reads(db, None), master),
                         {"house": home["code"], "home_name": home["home_name"],
                          "changes": [{"field": "telephone", "value": "555-000-0000",
                                       "expected": home["edit"].get("telephone", "")}]})
        check("the house's save answers", (d.answer or {}).get("status") == 200 and d.edits, d.answer)
        facts["the save names"] = [(e["tab_name"], e["match"]) for e in d.edits or []]
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, d, "check")
        after = next(h for h in L.Reads(db, None).homes() if h["code"] == home["code"])
        check("the save lands on the house's row", "".join(c for c in after["telephone"] if c.isdigit())
              == "5550000000", after["telephone"])
        cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
        check("app.edits keeps none of it", cur.fetchone()[0] == 0)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes it back", plain(L.Reads(db, None).homes()) == plain(copies["the registry as Locations "
                                                                                       "reads it"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
