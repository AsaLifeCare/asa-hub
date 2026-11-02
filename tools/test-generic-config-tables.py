"""The generic configuration book (its 34 tabs: the words, steps and prompts, the digest vocabulary, the bindings, the
request types and the rest) on tables of their own, each named with its book: every reader (the words book's lines,
the contacts' words, the decoder's vocabulary and lab, the digest settings, the bindings, the extra situations, the
request types, each tab whole) answers what it answered off the copy, a cell the copy withholds by its row's name kept
as it showed it; a request type appended, a binding seeded and a digest kind changed land in the tables alone
(writes.into_tables) and a void takes them back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-generic-config-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("GENERIC_CONFIG_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_generic_config_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"GENERIC_CONFIG_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidate_papers as CP  # noqa: E402
import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import comm_bindings as CB  # noqa: E402
import contacts_sync as CS  # noqa: E402
import digest_lab as D  # noqa: E402
import gsjs  # noqa: E402
import hotline as H  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import mail_designs as MD  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_clock  # noqa: E402
import smart_comms as SC  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
GC = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") == "HUB_GENERIC_CONFIG_ID"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
sid = gsjs.trim(db.prop("HUB_GENERIC_CONFIG_ID"))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
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


READERS = {
    "every tab whole, as the Hiring app's book reader reads it": lambda r: {t: CND._book_rows(r, sid, t)
                                                                           for t in sorted(GC.values())},
    "the words book's lines": lambda r: {t: CND.book_kv(r, t) for t in ("Steps", "Strings", "Prompts")},
    "the contacts' words": lambda r: {t: CS.book_rows(r, t) for t in ("Contacts Institutional", "Contacts Statuses",
                                                                       "Contacts Roles")},
    "the decoder's vocabulary": lambda r: CP.vocab(r),
    "the decoder lab's tabs": lambda r: {t: D.read_tab(r, t) for t in ("Digest Proposals", "Digest Kinds",
                                                                        "Digest Drawers", "Digest Issuers",
                                                                        "Digest Categories")},
    "the digest settings": lambda r: SCD.digest_settings(r),
    "the mail designs' bindings": lambda r: MD.bindings(r),
    "the comm bindings": lambda r: {k: v for k, v in CB.read_tab(r).items() if k != "ref"},
    "the extra situations": lambda r: smart_clock.extra_situations(r),
    "the request types": lambda r: H._types_book(r),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for res, tab in GC.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select resource, sheet_id, tab_name from {RR.COLUMNS} where resource = any(%s)", (list(GC),))
        named = cur.fetchall()
        check("each table names the book and its tab", len(named) == len(GC)
              and all(s == sid and GC[r] == t for r, s, t in named), named[:3])
        check("no tab name of this book is a house by its name alone",
              not any(t in SR.TAB_OF for t in GC.values()))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))

        def in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        wid = "Wzzgenericcfgcheck01"
        tok = SC._WRITE.set({"write_id": wid})
        kinds = D.read_tab(L.Reads(db, None), D.KINDS_TAB)[1]
        some_kind = gsjs.trim(gsjs.or_blank(kinds[0].get("kind")))
        bound = CB.read_tab(L.Reads(db, None))
        key_h, val_h = gsjs.trim(gsjs.js_str(bound["key"])), gsjs.trim(gsjs.js_str(bound["val"]))
        type_h = next(h for h in CND._book_rows(L.Reads(db, None), sid, "CommRequestTypes")[0] if h)
        edits = [W.kept_record(sid, "CommRequestTypes", "append", W.COLS + type_h, "Zz - Check", "check",
                               {type_h: "Zz - Check"}),
                 W.kept_record(sid, CB.TAB, "append", W.COLS + key_h, "zz.check", "check",
                               {key_h: "zz.check", val_h: "zz"}),
                 W.kept_record(sid, D.KINDS_TAB, "edit", W.COLS + "kind", some_kind, "check", {"notes": "zz check"})]
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        r1 = L.Reads(db, None)
        check("the request type lands in its table",
              any(gsjs.trim(gsjs.or_blank(t.get("type"))) == "Zz - Check" for t in H._types_book(r1))
              or any(row and row[0] == "Zz - Check" for row in (CND._book_rows(r1, sid, "CommRequestTypes") or
                                                                ([], []))[1]))
        check("the binding lands in its table", any("zz.check" in [gsjs.str_(c) for c in row]
                                                    for row in CND._book_rows(r1, sid, CB.TAB)[1]))
        kind_row = next(k for k in D.read_tab(r1, D.KINDS_TAB)[1] if gsjs.trim(gsjs.or_blank(k.get("kind"))) == some_kind)
        check("the digest kind's change lands on its row", kind_row.get("notes") == "zz check", kind_row)
        check("app.edits keeps none of it", in_edits(wid) == set(), in_edits(wid))
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        back = READERS["every tab whole, as the Hiring app's book reader reads it"](L.Reads(db, None))
        was = copies["every tab whole, as the Hiring app's book reader reads it"]
        check("a void takes it all back", plain(back) == plain(was), first_diff(back, was))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
