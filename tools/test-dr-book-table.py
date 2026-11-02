"""The Dr Appointments book on its own tables (app/dr_book.py), on the live copy in asa-hub-db, in one transaction rolled
back:
- the upload carries every row of Dr Appt Archive and Dr Master, each by its sheet row;
- every reader answers the same from the tables as from the copy: Clients' estate rows, the appointments door of every
  client (Future Apts adds no visit the archive does not carry), Dr Appointments' lists, a rename's plan;
- New Appointment books a row the appointments door shows Upcoming, with its van and time; the same visit again, a day
  it cannot read, a field the form does not have are refused;
- New Doctor adds an Active doctor the door lists; the same doctor again is refused;
- the pencil changes a kept visit's cells; a stale witness changes nothing;
- a staff member who reads the client is refused without the edition and books with it; the master always.
Nothing is kept: the transaction is rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-dr-book-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DR_BOOK_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_dr_book_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DR_BOOK_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=900)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402
from datetime import timedelta  # noqa: E402

import psycopg  # noqa: E402

import client_care_records as CCR  # noqa: E402
import client_rename as CRN  # noqa: E402
import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import clients as C  # noqa: E402
import dr_appointments as DR  # noqa: E402
import dr_book as DB  # noqa: E402
import editions as E  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


def bare(answer: dict) -> dict:
    """The appointments door's answer without its clock: each tab's as_of."""
    data = json.loads(json.dumps(answer.get("data") or {}))
    for tab in (data.get("tabs") or {}).values():
        tab.pop("as_of", None)
    return data


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
first = L.Reads(db, None)
raw_users = first.users()
master = next((u for u in raw_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
check("the master's account is read", master is not None)
keys = sorted({gsjs.trim(gsjs.or_text(c.get("client_key"))) for c in C.derived(first)} - {""})
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        check("before the upload the book is the copy's", not DB.held(L.Reads(db, None), "drVisits"))
        rb = L.Reads(db, None)
        before = {r: CS.estate_rows(rb, r) for r in DB.TABS}
        before_c = {r: C.estate(rb, r) for r in DB.TABS}
        before_doors = {k: CS.appt_door(rb, {"client": k}) for k in keys}
        before_list = {r: DR._list(r)(L.Session(rb, master), {}) for r in DB.TABS}

        for r in DB.TABS:
            facts[f"upload {r}"] = DB.upload(L.Reads(db, None), r)
        ra = L.Reads(db, None)
        check("after the upload Postgres holds both tabs", all(DB.held(ra, r) for r in DB.TABS))
        for r in DB.TABS:
            check(f"{r}: the estate rows read the same from the table", CS.estate_rows(ra, r) == before[r],
                  f"{len(CS.estate_rows(ra, r))} vs {len(before[r])}")
            check(f"{r}: Clients' estate rows read the same from the table", C.estate(ra, r) == before_c[r])
            got = DR._list(r)(L.Session(ra, master), {})
            check(f"{r}: Dr Appointments' list answers the same", got == before_list[r])
        differ, future_only, doctors_differ = [], 0, []
        for k in keys:
            b, a = before_doors[k], CS.appt_door(ra, {"client": k})
            if b.get("status") != a.get("status"):
                differ.append((k, b.get("status"), a.get("status")))
                continue
            if b.get("status") != 200:
                continue
            bd, ad = bare(b), bare(a)
            if bd["tabs"]["doctors"] != ad["tabs"]["doctors"]:
                doctors_differ.append(k)
            kept = [{**v, "also_in": []} for v in bd["tabs"]["visits"]["rows"] if not v["id"].startswith("future:")]
            future_only += len(bd["tabs"]["visits"]["rows"]) - len(kept)
            if kept != ad["tabs"]["visits"]["rows"]:
                differ.append(k)
        facts["clients read"] = len(keys)
        facts["visits only on Future Apts before"] = future_only
        check("every client's visits read the same from the table (Future Apts adds none the archive lacks)", not differ,
              differ[:5])
        check("every client's doctors read the same from the table", not doctors_differ, doctors_differ[:5])

        # a client with a visit and a doctor on file
        pick = next((k for k in keys if (before_doors[k].get("data") or {}).get("tabs", {}).get("visits", {}).get("rows")
                     and before_doors[k]["data"]["tabs"]["doctors"]["rows"]), "")
        check("a client with visits and doctors", bool(pick))
        ctx = client_writes.client_of(ra, pick)
        plan = CRN.plan(ra, ctx, pick, ctx["name"] + " Probe")
        sid = gsjs.trim(ra.db.prop(DB.PROP))
        check("a rename's plan carries the kept tabs, never the copy's", "drVisits" in plan["kept"]
              and not any(e.get("sheet_id") == sid for e in plan["edits"])
              and not any(o.get("sheet_id") == sid for o in plan["ops"]), {k: len(v) for k, v in plan["kept"].items()})

        day = (ra.now + timedelta(days=40)).strftime("%Y-%m-%d")
        ms = L.Session(L.Reads(db, None), master)
        fields = {"date": day, "time": "14:30", "dr_name": "Dr Probe Visit", "dr_address": "1 Probe St", "van": "Yes"}
        got = CCR.appt_add(ms, {"client": pick, "fields": fields})
        row = (got.answer.get("data") or {}).get("row") or {}
        check("New Appointment books the visit", got.answer.get("status") == 200 and got.own and row.get("status") == "Upcoming"
              and row.get("van") is True and row.get("date") == day, got.answer)
        rid = gsjs.str_(row.get("id"))
        door = bare(CS.appt_door(L.Reads(db, None), {"client": pick}))
        mine = next((v for v in door["tabs"]["visits"]["rows"] if v["id"] == rid), None)
        check("the door shows the booked visit, editable, at 2:30 PM", mine is not None and mine["editable"]
              and mine["time"] == "2:30 PM" and mine["dr_name"] == "Dr Probe Visit" and mine["van_answer"] == "Yes", mine)
        again = CCR.appt_add(L.Session(L.Reads(db, None), master), {"client": pick, "fields": fields})
        check("the same visit again is refused", again.answer.get("status") == 409, again.answer)
        bad = CCR.appt_add(L.Session(L.Reads(db, None), master), {"client": pick, "fields": {**fields, "date": "2026-02-30"}})
        check("a day it cannot read is refused", bad.answer.get("status") == 400, bad.answer)
        odd = CCR.appt_add(L.Session(L.Reads(db, None), master), {"client": pick, "fields": {**fields, "manager": "x"}})
        check("a field the form does not have is refused", odd.answer.get("status") == 422, odd.answer)

        got = CCR.appt_save(L.Session(L.Reads(db, None), master),
                            {"client": pick, "id": rid, "witness": ctx["name"], "fields": {"time": "15:45"}})
        check("the pencil changes the kept visit", got.answer.get("status") == 200 and got.own
              and (got.answer.get("data") or {}).get("row", {}).get("time") == "15:45", got.answer)
        hit = DB.row_at(L.Reads(db, None), "drVisits", W.estate_row_num(rid))
        check("the table holds the change", hit is not None and hit[1].get("Appointment Start Time") == "15:45", hit)
        stale = CCR.appt_save(L.Session(L.Reads(db, None), master),
                              {"client": pick, "id": rid, "witness": "Somebody Else", "fields": {"time": "16:00"}})
        check("a stale witness changes nothing", stale.answer.get("status") == 409, stale.answer)

        doc = {"dr_name": "Dr Probe Doctor", "specialist": "Dental", "phone": "330-555-0199"}
        got = CCR.doctor_add(L.Session(L.Reads(db, None), master), {"client": pick, "fields": doc})
        check("New Doctor adds the doctor, Active", got.answer.get("status") == 200 and got.own
              and (got.answer.get("data") or {}).get("doctor", {}).get("status") == "Active", got.answer)
        door = bare(CS.appt_door(L.Reads(db, None), {"client": pick}))
        check("the door lists the doctor", any(d["dr_name"] == "Dr Probe Doctor" and d["specialist"] == "Dental"
                                               for d in door["tabs"]["doctors"]["rows"]))
        again = CCR.doctor_add(L.Session(L.Reads(db, None), master), {"client": pick, "fields": doc})
        check("the same doctor again is refused", again.answer.get("status") == 409, again.answer)

        # the daily look: a visit filed on the sheet after the upload is carried once
        ref = L.Reads(db, None).tab_of(sid, DB.TABS["drVisits"], "the Dr Appt Archive")
        real_rows = db.rows
        copy_rows = real_rows(ref)
        top = max(rn for rn, _r in copy_rows)
        filed = {**copy_rows[-1][1], "Timestamp": "10/27/2026 9:00:00", "Client Name": ctx["name"],
                 "Dr Name": "Dr Probe Form", "Appointment Date": "12/1/2026"}
        db.rows = lambda r: (copy_rows + [(top + 1, filed), (top + 2, dict(copy_rows[-1][1]))]
                             if getattr(r, "table", "") == ref.table else real_rows(r))
        try:
            first_look = DB.carry(L.Reads(db, None), "drVisits")
            second_look = DB.carry(L.Reads(db, None), "drVisits")
            doctors_look = DB.carry(L.Reads(db, None), "drAppointments")
        finally:
            db.rows = real_rows
        check("the daily look carries a row filed on the sheet once, never a copy of a row the table holds",
              (first_look, second_look, doctors_look) == (1, 0, 0), (first_look, second_look, doctors_look))
        door = bare(CS.appt_door(L.Reads(db, None), {"client": pick}))
        check("the carried visit is on the client's list", any(v["dr_name"] == "Dr Probe Form" and v["date"] == "2026-12-01"
                                                              for v in door["tabs"]["visits"]["rows"]))

        # a staff member who reads the client
        staffers = [u for u in (sc.user_from_row(r) for r in raw_users)
                    if u["role"].lower() == "staff" and not sc.is_master_email(u["email"])]
        reader = None
        for u in staffers[:80]:
            rdr = C.reader_for(L.Session(L.Reads(db, None), u), pick)
            if rdr and not C.own_only(rdr):
                reader = u
                break
        check("a staff member reads the client", reader is not None)
        if reader:
            shut = L.Reads(db, None)
            shut.config = lambda: {E.EDITIONS_KEY: ""}
            got = CCR.appt_add(L.Session(shut, reader), {"client": pick, "fields": {**fields, "time": "09:00"}})
            check("without the edition the staff member is refused", got.answer.get("message") == "Unknown action."
                  and not got.own, got.answer)
            opened = L.Reads(db, None)
            cfg = {E.EDITIONS_KEY: json.dumps([{"id": "clients.appointments", "on": True, "people": [reader["id"]]},
                                               {"id": "clients.doctors", "on": True, "people": [reader["id"]]}])}
            opened.config = lambda: cfg
            got = CCR.appt_add(L.Session(opened, reader), {"client": pick, "fields": {**fields, "time": "09:00"}})
            check("with the edition the staff member books", got.answer.get("status") == 200
                  and got.edition == "clients.appointments", got.answer)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
