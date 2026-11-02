"""The Quo inbox's books (quo_transcripts, quo_messages, quo_summaries) in tables of their own (app.quo_calls,
app.quo_texts, app.quo_recaps; resource_rows.OWN_TABLES), not on spreadsheets: the line directory, the days the texts
cover, the column projections (every row, a phone's digits, a call id), the SSA's and a family member's texts and the
worker's tab door answer what they answered off the copies; the Filer makes a transcript, a summary and a text in the
tables alone and finds them again by their ids; and a void takes them back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-quo-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("QUO_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_quo_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"QUO_TABLES_INPROC": "1"})], capture_output=True, text=True, timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import family as FAM  # noqa: E402
import house_tables as HT  # noqa: E402
import hub_rows as HR  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import quo as Q  # noqa: E402
import quo_writes as QW  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC_  # noqa: E402
import ssa as SSA  # noqa: E402
import staff_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
BOOKS = {Q.TRANSCRIPTS_TAB: "quoTranscripts", Q.MESSAGES_TAB: "quoMessages", Q.SUMMARIES_TAB: "quoSummaries"}
TEXT = {"id": (("message_id",), None), "created": (("message_created",), None), "dir": (("direction",), None),
        "from": (("from_number",), None), "to": (("to_number",), None), "body": (("body",), None)}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled, kept = HT.tabled, HR._kept_resource
    HT.tabled, HR._kept_resource = (lambda _tab: False), (lambda *_a: None)
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled, HR._kept_resource = tabled, kept


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=lambda x: sorted(x) if isinstance(x, set) else str(x))


def texts(r: L.Reads, near=None) -> tuple:
    return SC._read_columns(r, SC._tab(r, Q.MESSAGES_TAB), TEXT, near)


first = on_copy(lambda r: texts(r))[1]
phone = next((d for _rn, c in first for d in SC._numbers(SC._js_text(c["from"], False)) if d), "")
call = on_copy(lambda r: next((str(c["id"]) for _rn, c in SC._read_columns(r, SC._tab(r, Q.TRANSCRIPTS_TAB),
                                                                           {"id": (("call_id",), None)})[1]
                               if c["id"]), ""))
calls_sid = db.resolve(Q.TRANSCRIPTS_TAB).sheet_id
own = {"mine": {phone: True}, "shared": 0}
READERS = {
    "the line directory": SC._line_directory_build,
    "the days the texts cover": SC._texts_days,
    "every text's columns": texts,
    # narrowed to a superset in the database, then kept as texts_facts keeps them: the phone on either side
    "a phone's texts (digits)": lambda r: [
        (rn, c) for rn, c in texts(r, ("digits", ("from", "to"), [phone]))[1]
        if phone in SC._numbers(SC._js_text(c["from"], False)) + SC._numbers(SC._js_text(c["to"], False))],
    # _project narrows to a superset of what its caller keeps: compared as transcript_read keeps them
    "a call by its id (contains)": lambda r: [
        row for row in SC._project(r, SC._tab(r, Q.TRANSCRIPTS_TAB), ["call_id", "direction"],
                                   ("contains", ["call_id"], [call])) if str(row[1].get("call_id") or "") == call],
    "the SSA's texts": lambda r: SSA.texts(r, own, "2000-01-01"),
    "a family member's texts": lambda r: FAM.texts(r, own, "2000-01-01"),
    "the worker's door on the calls book": lambda r: [
        (rn, {h: str(HR.cell(v) or "") for h, v in raw.items()})
        for rn, raw in HR.tabs([{"sheet_id": calls_sid, "tab": "Data", "fields": ["call_id", "direction"]}],
                               db=db)[0].get("rows") or []],
}
copies = {k: on_copy(f) for k, f in READERS.items()}
facts["the copies"] = {"texts": len(copies["every text's columns"][1]),
                       "phone": phone, "phone's texts": len(copies["a phone's texts (digits)"]),
                       "narrowed on the copy": len(on_copy(lambda r: texts(r, ("digits", ("from", "to"), [phone]))[1])),
                       "call rows": len(copies["a call by its id (contains)"])}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in BOOKS.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab)
            cur.execute(f"select count(*) from {RR.ROWS} where resource = %s", (res,))
            check(f"{tab}: its rows are in its own table, none in app.resource_rows", cur.fetchone()[0] == 0)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]),
                  (len(got) if isinstance(got, (list, tuple)) else "", len(copies[name])
                   if isinstance(got, (list, tuple)) else ""))
        wid = "Wzzquotablescheck00001"
        tok = SC_._WRITE.set({"write_id": wid})
        f = QW.Filer(L.Reads(db, None))
        f.create(Q.MESSAGES_TAB, {"message_id": "zzMSG1", "direction": "incoming", "from_number": "+15550000001",
                                  "body": "table check"})
        f.create(Q.TRANSCRIPTS_TAB, {"call_id": "zzCALL1", "direction": "incoming"})
        f.create(Q.SUMMARIES_TAB, {"call_id": "zzCALL1", "summary": "table check"})
        SC_._WRITE.reset(tok)
        g = QW.Filer(L.Reads(db, None))
        check("the Filer makes the three rows in their tables and leaves no edit", not f.edits
              and g.filed_anywhere(Q.MESSAGES_TAB, "message_id", "zzMSG1") is True
              and g.filed_anywhere(Q.TRANSCRIPTS_TAB, "call_id", "zzCALL1") is True
              and g.filed_anywhere(Q.SUMMARIES_TAB, "call_id", "zzCALL1") is True, f.edits)
        check("the new text is the newest seen", g.message_seen("zzMSG1") and "zzMSG1" in (g.seen_ids(5) or set()))
        check("an id never filed is not found", g.filed_anywhere(Q.MESSAGES_TAB, "message_id", "zzNOPE") is False
              and not g.message_seen("zzNOPE"))
        cur.execute("explain select 1 from app.quo_texts where resource = 'quoMessages'"
                    " and cells->>'message_id' = 'zzMSG1' and removed_at is null limit 1")
        plan = " ".join(r[0] for r in cur.fetchall())
        check("a text is found by its message id's index", "quo_texts_message" in plan, plan)
        RR.void(cur, wid)
        check("a void takes them back", not QW.Filer(L.Reads(db, None)).filed_anywhere(Q.MESSAGES_TAB, "message_id",
                                                                                         "zzMSG1"))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
