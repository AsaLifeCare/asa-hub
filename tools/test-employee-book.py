"""The Asa Employee Database on tables of its own (sheet_resources.EMPLOYEE_BOOK_TABS): every reader (Staff's tab
reader and certificate reader, Compliance's Master, the certificate papers' Master, the hiring fill's Master, Emp360,
Transportation's drivers) answers what it answered off the copy; a withheld cell keeps its marker; an Emp360 cell edit
and the hiring fill's new row land in the tables alone (writes.into_tables), and a void takes them back; following the
sheet right after the upload changes nothing, and a copy that lost its rows is never followed. One transaction, rolled
back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-employee-book.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("EMPLOYEE_BOOK_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_employee_book.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"EMPLOYEE_BOOK_INPROC": "1"})], capture_output=True, text=True, timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import cert_docs as CD  # noqa: E402
import client_writes  # noqa: E402
import compliance as CO  # noqa: E402
import emp360  # noqa: E402
import followed_books as EB  # noqa: E402
import employee_db as ED  # noqa: E402
import employee_db_writes as EDW  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff as SP  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
BOOK = {r: t for r, t in EB.RESOURCES.items() if r.startswith("emp")}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
sid = SP.emp_db_id(L.Reads(db, None))
facts["the book"] = sid
facts["tabs"] = BOOK


def on_copy(read):
    tabled, within = HT.tabled, HT.resource_in
    HT.tabled, HT.resource_in = (lambda _tab: False), (lambda _r, _s, _t: None)
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled, HT.resource_in = tabled, within


def keyed(v: object) -> object:
    if isinstance(v, dict):
        return {str(k): keyed(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [keyed(x) for x in v]
    return v


def plain(v: object) -> str:
    return json.dumps(keyed(v), sort_keys=True, default=str)


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


def steady(read):
    """A reader's answer with its moment of reading taken out."""
    def go(r):
        got = read(r)
        return {k: v for k, v in got.items() if k not in ("as_of", "read_at")} if isinstance(got, dict) else got
    return go


READERS = {
    **{f"Staff's reader of {tab}": (lambda t: lambda r: SP._emp_tab(r, t))(tab) for tab in BOOK.values()},
    **{f"the certificate reader of {w}": (lambda w: lambda r: SP.cert_read_tab(r, SP.cert_source_tab(r, w)))(w)
       for w in ("trainings", "mais", "master")},
    "Compliance's Master": steady(lambda r: CO.master_table(r)),
    # its raw rows as .get reads them: a column blank on every row is "" in the table, absent from some copy rows
    "the certificate papers' Master": lambda r: {**(s := CD.master_sheet(r)), "ref": None, "raw": [
        (rn, {h: v for h, v in raw.items() if v not in (None, "")}) for rn, raw in s["raw"]]},
    "the hiring fill's Master": lambda r: {k: v for k, v in ED.master(r).items()},
    "Emp360's Master": lambda r: emp360.read_tab(r, SP.CERT_SOURCE_PROP, SP.cert_source_tab(r, "master")),
    "Transportation's drivers": lambda r: SP.driver_index(r, SP.DRIVER_TAB),
    "Transportation's driver compliance": lambda r: SP.driver_index(r, SP.DRIVER_COMPLIANCE_TAB),
}
copies = {}
for k, f in READERS.items():
    try:
        copies[k] = on_copy(f)
    except Exception as exc:  # noqa: BLE001
        copies[k] = f"raised {type(exc).__name__}: {exc}"
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        tok = SC._WRITE.set({"write_id": "upload:employee-book"})
        for res, tab in BOOK.items():
            facts[f"upload {res}"] = RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        SC._WRITE.reset(tok)
        for res in BOOK:
            ref = SR.copy_of(db, res).ref
            unlike = RR.unlike_copy(res, ref)
            check(f"{res} holds every row of its copy, cell for cell", not unlike["missing"] and not unlike["differ"],
                  unlike)
        cur.execute(f"select count(*) from {RR.rows_of('empMaster')} where resource = 'empMaster'"
                    " and cells->>'SSN#' like '[withheld:%%'")
        check("the SSN# stays a marker, never a number", cur.fetchone()[0] > 0)
        cur.execute(f"select count(*) from {RR.rows_of('empMaster')} where resource = 'empMaster'"
                    " and cells->>'SSN#' ~ '^[0-9-]{9,11}$'")
        check("no SSN# number is in the table", cur.fetchone()[0] == 0)
        for name, f in READERS.items():
            try:
                got = f(L.Reads(db, None))
            except Exception as exc:  # noqa: BLE001
                got = f"raised {type(exc).__name__}: {exc}"
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        # an Emp360 cell edit, as emp360_writes keeps it
        m = ED.master(L.Reads(db, None))
        idx = ED.column_index(m["hdr"])
        at = next(i for i, (_rn, cells, _fp) in enumerate(m["rows"]) if cells[idx["Email"]] and cells[idx["City"]])
        email_h, city_h = m["keys"][idx["Email"]], m["keys"][idx["City"]]
        email, city = m["rows"][at][1][idx["Email"]], m["rows"][at][1][idx["City"]]
        wid = "Wzzemployeebookcheck1"
        tok = SC._WRITE.set({"write_id": wid})
        edit = W.kept_record(sid, m["tab"], "edit", W.COLS + email_h, email, "check", {city_h: "Zzcheckville"},
                             before={city_h: city})
        added = EDW._kept_append(m, {email_h: "zz.check@example.invalid", m["keys"][idx["First Name"]]: "Zz",
                                     m["keys"][idx["Last Name"]]: "Check"}, "CAN_zzcheck01")
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, [edit, added], "check"),
                                     "check")
        SC._WRITE.reset(tok)
        now = ED.master(L.Reads(db, None))
        cities = {r[1][idx["Email"]]: r[1][idx["City"]] for r in now["rows"]}
        check("an Emp360 cell edit lands on the Master's table", cities.get(email) == "Zzcheckville", cities.get(email))
        check("the hiring fill's new row lands on the Master's table", "zz.check@example.invalid" in cities)
        cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
        check("app.edits keeps none of it", cur.fetchone()[0] == 0)
        RR.void(cur, wid)
        back = ED.master(L.Reads(db, None))
        check("a void takes it all back", plain(back) == plain(copies["the hiring fill's Master"]),
              first_diff(back, copies["the hiring fill's Master"]))
        # Emp360 now edits what HR typed in the sheet: the papers', the background's and the training's dates
        check("Emp360 edits the papers', background and training dates",
              all(emp360.editable(k) for k in ("i_9_date", "bci_check_date", "sam", "cpr_exp_date", "med_1_exp_date")))
        check("Emp360 never edits a withheld or protected cell",
              not any(emp360.editable(k) for k in ("dl", "ssn", "date_of_birth", "login", "password")))
        row = {c[0]: "x" for c in emp360.DATA_COLUMNS}
        offered = {f["key"]: f["editable"] for g in ("docs", "background") for f in emp360.fields(
            L.Reads(db, None), row, g, True)}
        check("the screen offers a pencil exactly where the door takes the edit",
              all(v == emp360.editable(k) for k, v in offered.items()), offered)
        # following the sheet right after the upload changes nothing
        tok = SC._WRITE.set({"write_id": "follow:check"})
        again = {r: RR.upload(L.Reads(db, None), r, t, SR.DERIVE.get(r)) for r, t in BOOK.items()}
        SC._WRITE.reset(tok)
        moved = {r: c for r, c in again.items() if c.get("added") or c.get("refreshed") or c.get("dropped")}
        check("following the sheet right after the upload changes nothing", not moved, moved)
        check("a tab the copy holds is followed", EB._unsure(L.Reads(db, None), "empMaster") == "")
        cur.execute(f"select count(*) from {RR.rows_of('empMaster')} where resource = 'empMaster'")
        n = cur.fetchone()[0]
        cur.execute(f"insert into {RR.rows_of('empMaster')} (resource, row_key, row_id, position, cells, origin)"
                    " select 'empMaster', 'zzpad' || g, '', 9000 + g, '{}'::jsonb, 'sheet'"
                    " from generate_series(1, %s) g", (n,))
        check("a copy holding far fewer rows than the table is never followed",
              EB._unsure(L.Reads(db, None), "empMaster") != "")
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
