"""The comms mirror's three tabs (ignored_calls, summaries, transcripts) on their own tables, not on a spreadsheet: every
reader (screening's, the phone screens', the profile's comms, the rehearsal's transcripts, the line census, the riders)
answers what it answered off the copy; the retirements and the mirror's summaries land in the tables alone
(writes.into_tables); and a void takes it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-comms-book-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("COMMS_BOOK_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_comms_book_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"COMMS_BOOK_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hiring_riders  # noqa: E402
import hiring_sim_writes as HSW  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import line_directory as LD  # noqa: E402
import locations as L  # noqa: E402
import phone_screens as PS  # noqa: E402
import resource_rows as RR  # noqa: E402
import screening as SG  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import user_profiles as UP  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"ignored_calls": "commsIgnoredCalls", "summaries": "commsSummaries", "transcripts": "commsTranscripts"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
comms = gsjs.trim(db.prop("HUB_COMMS_ID"))


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


def raw_rows(r: L.Reads, tab: str) -> list:
    _sid, ref = SG.comms_ref(r, tab)
    return [{k: gsjs.js_str(v) for k, v in raw.items() if gsjs.or_blank(v) != ""} for _rn, raw in r.db.rows(ref)]


READERS = {
    **{f"{t}: screening's rows": (lambda r, t=t: SG.comms_rows(r, t)) for t in HOUSES},
    **{f"{t}: the phone screens' rows": (lambda r, t=t: PS.comms_rows(r, t)) for t in HOUSES},
    **{f"{t}: the profile's comms rows": (lambda r, t=t: UP._comms_rows(r, comms, t)) for t in HOUSES},
    **{f"{t}: the mirror's own rows": (lambda r, t=t: raw_rows(r, t)) for t in HOUSES},
    "the retired calls": lambda r: sorted(SG.ignored_calls(r)),
    "the rehearsal's transcripts": lambda r: HSW.comms_transcripts(r),
    "the line census's transcripts": lambda r: LD._transcripts(r),
    "the riders' transcripts": lambda r: hiring_riders.transcripts(r),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
facts["rows on the copy"] = {t: len(copies[f"{t}: screening's rows"]) for t in HOUSES}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select resource, sheet_id, tab_name from {RR.COLUMNS} where resource = any(%s)",
                    (list(HOUSES.values()),))
        check("each table names the comms book and its tab", all(s == comms and HOUSES[t] == r for r, s, t in
                                                                  cur.fetchall()))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))

        def in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        # a call retired by hand and a summary the mirror keeps
        wid = "Wzzcommsbookcheck001"
        tok = SC._WRITE.set({"write_id": wid})
        r0 = L.Reads(db, None)
        edits = PS._retired(r0, ["zzcall1"], "check", W.now_iso(r0), "check")
        ssid, sref = SG.comms_ref(r0, "summaries")
        edits.append(W.kept_record(ssid, sref.tab, "append", "cols:call_id", "zzcall1", "comms",
                                   {"call_id": "zzcall1", "summary": "zz check"}))
        facts["the writes name"] = sorted({(e["sheet_id"] == comms, e["tab_name"]) for e in edits})
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        r1 = L.Reads(db, None)
        check("the retired call lands in its table", "zzcall1" in SG.ignored_calls(r1))
        check("the summary lands in its table", any(s_.get("callid") == "zzcall1" for s_ in SG.comms_rows(r1, "summaries")))
        check("app.edits keeps none of it", in_edits(wid) == set(), in_edits(wid))
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        r2 = L.Reads(db, None)
        back = {k: READERS[k](r2) for k in ("the retired calls", "summaries: screening's rows")}
        check("a void takes it all back", all(plain(v) == plain(copies[k]) for k, v in back.items()))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
