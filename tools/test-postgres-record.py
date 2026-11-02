#!/usr/bin/env python3
"""Postgres as the record (app/record_books.py, app/sheet_sync.py, app/sheet_check.py, db/sync.py load_pulls), run in
asa-hub-db-sync with the app's and the clone's modules streamed in: a kept write read back at once and never undone by
the copy's refresh; the daily check bringing in a hand edit, a hand-added row and a hand-deleted one, while a cell both
sides changed goes to the newer side (logged) and a row the sheet lost with a change owed is kept and written again;
the backup pacing on 429, backing off and resuming; compaction losing nothing (Postgres' own text kept in the copy);
a tall tab read in windows; a partial check; a book no copy holds never read. Postgres: stand-in tables (pg_temp) and
the copy's own tables inside one transaction rolled back at the end. Google: a stand-in speaking the Sheets REST
shapes. Nothing is written to a live table and nothing reaches Google."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, sys, time, urllib.parse, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = dict(blob["app"])
SRC.update(blob["db"])
SRC["redaction"] = blob["rules"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
os.environ["HUB_RULES_DIR"] = "/nonexistent"
import psycopg
import hubdb, writes as W, client_writes as CW, locations as L
import sheet_sync as SS, sheet_check as SCK, record_books as RB, sheet_tabs as STB
import sync as SYNC

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:900]])


class Resp:
    def __init__(self, code, body):
        self.status_code, self._b, self.text = code, body, json.dumps(body)

    def json(self):
        return self._b


A1 = re.compile(r"^'((?:[^']|'')+)'(?:!(?:([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?|(\d+):(\d+)))?$")


def col_n(s):
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


class FakeGoogle:
    """The Sheets REST shapes the sync asks, over grids held here; a cell is shown as the sheet would type it."""

    def __init__(self, books, names):
        self.books, self.names = books, names
        self.calls, self.fail_on = [], {}

    @staticmethod
    def shown(head, v):
        v = "" if v is None else str(v)
        if v.startswith("'"):
            return v[1:]
        if head == "amount" and re.fullmatch(r"-?\$?[\d,]+(\.\d+)?", v):
            return "${:,.2f}".format(float(v.replace("$", "").replace(",", "")))
        return v

    def grid(self, sid, tab):
        return self.books[sid][tab]

    def values(self, sid, tab):
        g = [list(r) for r in self.grid(sid, tab)]
        for r in g:
            while r and r[-1] == "":
                r.pop()
        while g and not g[-1]:
            g.pop()
        return g

    def put(self, sid, tab, row, col, v):
        g = self.grid(sid, tab)
        while len(g) < row:
            g.append([])
        line = g[row - 1]
        while len(line) < col:
            line.append("")
        head = g[0][col - 1] if col - 1 < len(g[0]) else ""
        line[col - 1] = self.shown(head, v)
        return line[col - 1]

    def request(self, method, url, params=None, json=None, timeout=None, headers=None):
        path = url.split("/v4/spreadsheets/", 1)[1]
        sid, _s, rest = path.partition("/")
        self.calls.append((method, rest or "get", list((params or {}).get("ranges") or []), sid))
        code = self.fail_on.pop(rest or "get", None)
        if code:
            return Resp(code, {"error": {"code": code, "status": "RESOURCE_EXHAUSTED",
                                         "message": "Quota exceeded for quota metric 'Requests'"}})
        if sid not in self.books:
            return Resp(404, {"error": {"code": 404}})
        if rest == "":
            return Resp(200, {"properties": {"title": self.names.get(sid, "")}, "sheets": [
                {"properties": {"sheetId": i + 1, "title": t, "gridProperties": {
                    "rowCount": len(g) + 3, "columnCount": max(len(r) for r in g) if g else 1}}}
                for i, (t, g) in enumerate(self.books[sid].items())]})
        if rest == "values:batchGet":
            vrs = []
            for r in params["ranges"]:
                m = A1.match(r)
                tab = m.group(1).replace("''", "'") if m else ""
                if tab not in self.books[sid]:
                    return Resp(400, {"error": {"code": 400, "message": f"Unable to parse range: {r}"}})
                vals = self.values(sid, tab)
                if m.group(6):
                    vals = vals[int(m.group(6)) - 1:int(m.group(7))]
                    while vals and not vals[-1]:
                        vals.pop()
                vrs.append({"range": r, "values": vals})
            return Resp(200, {"valueRanges": vrs})
        if rest == "values:batchUpdate":
            res = []
            for d in json["data"]:
                m = A1.match(d["range"])
                v = self.put(sid, m.group(1).replace("''", "'"), int(m.group(3)), col_n(m.group(2)), d["values"][0][0])
                res.append({"updatedRange": d["range"], "updatedData": {"range": d["range"], "values": [[v]] if v else []}})
            return Resp(200, {"responses": res})
        if rest.startswith("values/") and rest.endswith(":append"):
            m = A1.match(urllib.parse.unquote(rest[len("values/"):-len(":append")]))
            tab, start = m.group(1).replace("''", "'"), int(m.group(3))
            g = self.grid(sid, tab)
            row = start
            while row - 1 < len(g) and any(c != "" for c in g[row - 1]):
                row += 1
            shown = [[self.put(sid, tab, row + i, j + 1, v) for j, v in enumerate(line)]
                     for i, line in enumerate(json["values"])]
            return Resp(200, {"updates": {"updatedRange": f"'{tab}'!A{row}:{SS.col_letter(len(json['values'][0]))}"
                                                          f"{row + len(shown) - 1}", "updatedData": {"values": shown}}})
        return Resp(400, {"error": {"code": 400, "message": "not a call the stand-in knows"}})


SID = "CHECKREC" + uuid.uuid4().hex[:12]
OUT = "CHECKOUT" + uuid.uuid4().hex[:12]
TAB, BIG = "rec_tab", "big_tab"
HEAD = ["id", "name", "notes", "amount", "status"]
SEED = [HEAD, ["R1", "Ann", "n1", "$10.00", "open"], ["R2", "Bob", "n2", "$20.00", "open"],
        ["R3", "Cy", "n3", "$30.00", "open"], ["R4", "Dee", "n4", "$40.00", "open"], ["R5", "Eve", "n5", "$50.00", "open"]]
BIG_SEED = [["id", "v"]] + [[f"B{i}", str(i)] for i in range(1, 10)]
fake = FakeGoogle({SID: {TAB: [list(r) for r in SEED], BIG: [list(r) for r in BIG_SEED]},
                   OUT: {TAB: [list(r) for r in SEED]}}, {SID: "Record check book", OUT: "Never copied"})
vt, sleeps = [0.0], []


def vsleep(s):
    sleeps.append(round(s, 3))
    vt[0] += s


sheets = SS.Sheets(http=fake, token=lambda: "stand-in", clock=lambda: vt[0], sleep=vsleep)

W.EDITS_TABLE = "pg_temp.hub_edits_check"
for name, t in (("PULLS", RB.pulls_table()), ("PULL_ROWS", RB.pull_rows_table()), ("RECORD_BOOKS", RB.books_table())):
    setattr(SYNC, name, t)
conn = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="postgres-record-check")
conn.execute("set statement_timeout = '120s'")
db = SS.Db(rw=lambda: conn, ro=lambda: conn)
hub = hubdb.HubDb(connect=lambda: conn)
clone = SYNC.Sync()
clone.hub = conn
eid = [0]


def edit(row_key, field, value, before="", kind="edit", tab=TAB):
    eid[0] += 1
    conn.execute(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                 " row_key, field, value, before, author) values (%s, 'check', 'checkEdit', %s, %s, %s, 'id', 'header',"
                 " %s, %s, %s, %s, 'Record Check')",
                 (f"Wrec-check-{eid[0]:04d}", SID, tab, kind, row_key, field, value, before))


def read(tab=TAB):
    """What every read shows: the copy with Python's kept edits laid (hubdb.rows under writes.Own)."""
    rows = [W._edit_row(r) for r in conn.execute(W.edits_sql()).fetchall()]
    own = CW.Own([], book=hub.book, edits=rows, edits_at=time.time())
    hub._cat["at"] = 0.0
    hub._rows.clear()
    tok = hubdb.OWN.set(own)
    try:
        ref = hub.tab(SID, tab) or own.virtual(SID, tab)
        return {raw.get("id"): dict(raw) for _rn, raw in hub.rows(ref)} if ref is not None else {}
    finally:
        hubdb.OWN.reset(tok)


def cell(rid, field, tab=TAB):
    return (read(tab).get(rid) or {}).get(field)


def gcell(rid, field, tab=TAB):
    g = fake.grid(SID, tab)
    at = g[0].index(field)
    row = next((r for r in g[1:] if r and r[0] == rid), None)
    return None if row is None else (row[at] if at < len(row) else "")


def states():
    return {r[0] + "." + r[1]: (r[2], r[3], int(r[4])) for r in conn.execute(
        f"select row_key, field, state, base_value, edit_id from {W.beside('edit_sync')} where sheet_id = %s",
        (SID,)).fetchall()}


def conflicts():
    return [(r[0], r[1], r[2], r[3]) for r in conn.execute(
        f"select row_key, field, winner, why from {W.beside('edit_conflicts')} where sheet_id = %s order by id",
        (SID,)).fetchall()]


def n_edits():
    return conn.execute(f"select count(*) from {W.EDITS_TABLE} where sheet_id = %s", (SID,)).fetchone()[0]


def book_row(sid=SID):
    return conn.execute(f"select owed, last_backup_at is not null, backup_next_at, backup_why, held_since is not null,"
                        f" check_why, check_tabs from {RB.books_table()} where sheet_id = %s", (sid,)).fetchone()


def mirror_load(sid, tab, grid):
    """The copy as the mirror path left it before the book's first check (db/sync.store_tab, a book row 'ok')."""
    rows = [(rn, dict(zip(grid[0], r + [""] * len(grid[0])))) for rn, r in enumerate(grid[1:], start=2)]
    taken = {r[0] for r in conn.execute("select table_name from catalog.tabs")}
    clone.store_tab(sid, tab, "Record check book", None, taken, list(grid[0]), list(grid[0]),
                    lambda put: [put(rn, d, None, None) for rn, d in rows], vacuum=[])
    conn.execute(SYNC.UPSERT_BOOK, (sid, "Record check book", SYNC.Jsonb([]), None, None, "ok", 1, len(rows)))


def cycle():
    SS.CHECKS_PER_ROUND = 0
    syncer.backoff_until = 0.0
    return syncer.cycle()


def run_check(sid=SID, tabs=None):
    got = SCK.Check(db, sheets, None).book(sid, tabs)
    stored = clone.load_pulls()
    return got, stored


try:
    with conn.transaction():
        db.ensure()
        mirror_load(SID, TAB, SEED)
        mirror_load(SID, BIG, BIG_SEED)
        syncer = SS.Syncer(db, sheets)

        # a kept write is the record at once
        edit("R1", "notes", "n1-pg", "n1")
        check("a kept write is read back at once, before Google holds it", cell("R1", "notes") == "n1-pg",
              read().get("R1"))
        RB.enroll(conn)
        check("every book a kept edit names joins the record set", book_row() is not None, book_row())

        # the first daily check: Google still holds the old value, the edit is owed and stays laid
        SCK.CELLS_PER_READ = 12
        n0 = len(fake.calls)
        got, stored = run_check()
        facts["first check"] = got
        reads = [c for c in fake.calls[n0:] if c[1] == "values:batchGet"]
        check("the first check reads the book (a tall tab in windows of rows) and is stored as its copy",
              got.get("ok") and stored == 1 and any("!1:6" in r for c in reads for r in c[2])
              and set(read(BIG)) == {f"B{i}" for i in range(1, 10)}, [got, reads])
        hub._cat["at"] = 0.0
        b = hub.book(SID)
        check("the stored check makes the book the record's: catalog status 'record', held_since set, never stale,"
              " and the mirror pass leaves it alone",
              b is not None and b.status == "record" and book_row()[4] and not hub.stale({SID})
              and abs(hub.as_of({SID}) - time.time()) < 5 and SYNC.held_by_record({"status": b.status}),
              [b, book_row()])
        check("the copy's refresh from Google never undoes the kept write (owed, not yet acknowledged)",
              cell("R1", "notes") == "n1-pg" and "R1.notes" not in states() and not conflicts(),
              [read().get("R1"), states(), conflicts()])

        # the backup carries it
        st = cycle()
        facts["backup 1"] = st.line()
        check("the backup writes the owed cell, Google acknowledges it, the book says its last success and owes 0",
              gcell("R1", "notes") == "n1-pg" and states().get("R1.notes", ("",))[0] == "synced"
              and book_row()[1] and st.written == 1, [st.line(), gcell("R1", "notes"), states(), book_row()])

        # Postgres' own text: an amount the sheet shows formatted
        edit("R2", "amount", "25", "$20.00")
        st = cycle()
        check("an amount written is shown formatted by the sheet; acknowledged all the same",
              gcell("R2", "amount") == "$25.00" and states().get("R2.amount", ("",))[0] == "synced", st.line())

        # hand edits in the sheet, and changes Postgres still owes
        fake.put(SID, TAB, 2, 3, "n1-hand")          # R1.notes: acknowledged, Postgres unchanged since → the sheet's
        fake.put(SID, TAB, 3, 3, "n2-hand")          # R2.notes: never touched by Postgres
        edit("R3", "notes", "n3-pg", "n3")           # owed …
        fake.put(SID, TAB, 4, 3, "n3-hand")          # … and the sheet changed it too, an open race: Postgres', logged
        edit("R2", "status", "closed-pg", "open")    # owed, made before the copy last read the row …
        conn.execute(f"update {W.EDITS_TABLE} set at = at - interval '600 seconds' where write_id = %s",
                     (f"Wrec-check-{eid[0]:04d}",))
        fake.put(SID, TAB, 3, 5, "held-hand")        # … and the sheet changed it after: the sheet is newer, logged
        edit("R4", "amount", "44", "$40.00")         # owed on a row the sheet then loses
        g = fake.grid(SID, TAB)
        g[:] = [r for r in g if not r or r[0] not in ("R4", "R5")]   # R4 (owed) and R5 (nothing owed) deleted
        g.append(["R6", "Fay", "n6", "$60.00", "open"])               # a row added by hand
        before_check = read()
        got, stored = run_check()
        facts["second check"] = got
        after_store = read()
        check("the second check is stored: a hand-edited untouched cell, a hand-added row and a hand-deleted row come"
              " in at once", stored == 1 and after_store.get("R2", {}).get("notes") == "n2-hand"
              and "R6" in after_store and "R5" not in after_store, [got, sorted(after_store)])
        k = conflicts()
        check("a hand edit in an open race (nothing bounds when it came, a record book's modified time not known) loses"
              " to the change Postgres owes, and the conflict is logged",
              after_store.get("R3", {}).get("notes") == "n3-pg"
              and any(x[:3] == ("R3", "notes", "postgres") and x[3].startswith(SS.WHY_AMBIGUOUS + ":") for x in k),
              [after_store.get("R3"), k])
        check("a hand edit newer than the change Postgres owes (the copy, read after that change, still held the agreed"
              " value) comes in: superseded, logged as the sheet's, counted per side",
              after_store.get("R2", {}).get("status") == "held-hand"
              and states().get("R2.status", ("",))[:2] == ("superseded", "held-hand") and got.get("sheet_won") == 1
              and any(x[:3] == ("R2", "status", "sheet") and x[3].startswith(SS.WHY_SHEET_NEWER + ":") for x in k),
              [after_store.get("R2"), states().get("R2.status"), got, k])
        check("a row the sheet lost while a change to it was owed is kept (carried into the copy), logged",
              after_store.get("R4", {}).get("amount") == "44" and after_store["R4"].get("name") == "Dee"
              and ("R4", "amount", "postgres", SCK.WHY_ROW_KEPT) in k, [after_store.get("R4"), k])
        check("until compaction the acknowledged edit still answers; the copy keeps Postgres' own text where the sheet"
              " says the same", after_store.get("R1", {}).get("notes") == "n1-pg"
              and after_store.get("R2", {}).get("amount") == "25", [after_store.get("R1"), after_store.get("R2")])

        # compaction
        e0 = n_edits()
        mark0 = tuple(conn.execute(W.edits_mark_sql()).fetchone())
        done = RB.compact(conn, -1.0)
        facts["compaction"] = done
        after = read()
        expected = {rid: dict(row) for rid, row in after_store.items()}
        expected["R1"]["notes"] = "n1-hand"
        check("compaction: the acknowledged and the sheet's cells' edits go, the owed ones stay, the marker moves",
              done["edits"] == 3 and n_edits() == e0 - done["edits"]
              and tuple(conn.execute(W.edits_mark_sql()).fetchone()) != mark0
              and {r[0] + "." + r[1] for r in conn.execute(
                  f"select row_key, field from {W.EDITS_TABLE} where sheet_id = %s", (SID,)).fetchall()}
              == {"R3.notes", "R4.amount"}, [done, n_edits(), e0])
        check("compaction loses nothing: every read is the same, but the cell the sheet took, which shows the sheet's"
              " value now", after == expected,
              {r: (after.get(r), expected.get(r)) for r in set(after) | set(expected) if after.get(r) != expected.get(r)})

        # the backup writes the owed change over the hand edit and writes the lost row again
        n1 = len(fake.calls)
        st = cycle()
        facts["backup 3"] = st.line()
        k = conflicts()
        check("the backup writes Postgres' change over the sheet's (logged) and appends the row the sheet lost, whole",
              gcell("R3", "notes") == "n3-pg" and gcell("R4", "amount") == "$44.00" and gcell("R4", "name") == "Dee"
              and any(x[:3] == ("R3", "notes", "postgres") and x[3].startswith(SS.WHY_PG_NEWER + ":") for x in k)
              and ("R4", "amount", "postgres", SS.WHY_GONE_OWED) in k and gcell("R2", "status") == "held-hand",
              [st.line(), fake.grid(SID, TAB), k])
        got, stored = run_check()
        RB.compact(conn, -1.0)
        final = read()
        google = {r[0]: dict(zip(HEAD, r + [""] * 5)) for r in fake.grid(SID, TAB)[1:] if r}
        google["R2"]["amount"] = "25"
        google["R4"]["amount"] = "44"
        check("after a third check and its compaction no kept edit is left and the record equals the sheet (Postgres'"
              " own text where the sheet formats the same)", n_edits() == 0 and final == google,
              [n_edits(), {r: (final.get(r), google.get(r)) for r in set(final) | set(google)
                           if final.get(r) != google.get(r)}])

        # the backup paces on 429, backs off doubling, and resumes
        edit("R6", "notes", "n6-pg", "n6")
        fake.fail_on = {"values:batchGet": 429}
        syncer.backoff_s = SS.BACKOFF_MIN_S
        t0 = time.time()
        st = syncer.cycle()
        row = book_row()
        check("a 429: the round stops, the cell stays owed, the book says why and when it is asked again",
              st.refused and gcell("R6", "notes") == "n6" and "quota" in (row[3] or "")
              and row[2] is not None and abs(syncer.backoff_until - (t0 + SS.BACKOFF_MIN_S)) < 30
              and row[0] == 1, [st.line(), row])
        conn.execute(f"update {RB.books_table()} set backup_next_at = now() - interval '1 second' where sheet_id = %s",
                     (SID,))
        fake.fail_on = {"values:batchGet": 429}
        st = syncer.cycle()
        check("refused again: the back-off doubles", st.refused and syncer.backoff_s == 4 * SS.BACKOFF_MIN_S
              and abs(syncer.backoff_until - (time.time() + 2 * SS.BACKOFF_MIN_S)) < 30,
              [syncer.backoff_s, syncer.backoff_until - time.time()])
        conn.execute(f"update {RB.books_table()} set backup_next_at = now() - interval '1 second' where sheet_id = %s",
                     (SID,))
        st = syncer.cycle()
        check("after the back-off the owed cell is written and the back-off starts over",
              not st.refused and gcell("R6", "notes") == "n6-pg" and syncer.backoff_s == SS.BACKOFF_MIN_S
              and book_row()[0] == 0, [st.line(), syncer.backoff_s, book_row()])
        gap = 60.0 / SS.WRITES_PER_MIN
        check(f"pacing: every request waits {gap:.0f}s after the one before", sleeps and
              all(abs(x - gap) < 0.01 for x in sleeps), sleeps[:12])

        # a row Postgres' own book change took off is never put back, whatever was owed to it
        edit("R6", "status", "closed", "open")
        conn.execute(f"insert into {SS.BO.table()} (write_id, action, subject, sheet_id, tab_name, op, spec, state,"
                     " done_at) values ('Wrec-delete', 'checkDelete', 'R6', %s, %s, 'delete', %s::jsonb, 'done', now())",
                     (SID, TAB, json.dumps({"match": "id", "key": "R6"})))
        g = fake.grid(SID, TAB)
        g[:] = [r for r in g if not r or r[0] != "R6"]
        st = cycle()
        check("the backup never writes back a row Postgres' own delete took off, though a change to it was owed",
              gcell("R6", "id") is None and states().get("R6.status", ("",))[0] == "missing"
              and not [x for x in conflicts() if x[0] == "R6"], [st.line(), states().get("R6.status")])
        got, stored = run_check()
        RB.compact(conn, -1.0)
        check("nor does the check keep it: the row stays gone and its kept edits go with it",
              "R6" not in read() and not conn.execute(f"select 1 from {W.EDITS_TABLE} where row_key = 'R6'").fetchall()
              and not [x for x in conflicts() if x[0] == "R6"], [sorted(read()), got])

        # the relay's recordTabs (the master JSON's source of a record book): what every read shows
        own = CW.Own([], book=hub.book, edits=[W._edit_row(r) for r in conn.execute(W.edits_sql()).fetchall()],
                     edits_at=time.time())
        tok = hubdb.OWN.set(own)
        try:
            hub._cat["at"] = 0.0
            hub._rows.clear()
            marks = STB.record_tabs(L.Session(L.Reads(hub), {"is_service": True}), {"marks": True})
            rows = STB.record_tabs(L.Session(L.Reads(hub), {"is_service": True}), {"sheet_id": SID, "tab": TAB})
            refused = STB.record_tabs(L.Session(L.Reads(hub), {"id": "someone", "role": "admin"}), {"marks": True})
        finally:
            hubdb.OWN.reset(tok)
        mine = (marks.get("data") or {}).get("books", {}).get(SID) or {}
        rec_tab = next((t for t in mine.get("tabs") or [] if t["tab"] == TAB), {})
        check("recordTabs: the record book's tabs and their marks, its rows as every read shows them, the relay's alone",
              {t["tab"] for t in mine.get("tabs") or []} == {TAB, BIG} and rec_tab.get("rows") == len(read())
              and {r[1]["id"]: r[1] for r in (rows.get("data") or {}).get("rows") or []} == read()
              and refused.get("status") == 403, [mine, rows.get("status"), refused])

        # a partial check, asked on demand (as a book change carried into the book asks one)
        RB.ask_check(conn, SID, [TAB])
        due = RB.checks_due(conn)
        got, stored = run_check(SID, [TAB])
        check("a check asked for one tab reads that tab alone, leaves the others, and the day's check stands",
              (SID, [TAB]) in due and got.get("partial") and stored == 1 and set(read(BIG)) == {f"B{i}" for i in
                                                                                         range(1, 10)}
              and book_row()[6] is None, [due, got, book_row()])

        # a book the copy never held is never read
        n2 = len(fake.calls)
        got = SCK.Check(db, sheets, None).book(OUT)
        check("a book the copy holds no copy of is never read", not got.get("ok") and len(fake.calls) == n2, got)
        facts["requests"] = len(fake.calls)
        raise psycopg.Rollback()
finally:
    conn.close()
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''


def main() -> int:
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
            "db": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "db").glob("*.py")},
            "rules": (ROOT / "server" / "redaction.py").read_text(encoding="utf-8")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print(got.stderr.decode()[-4000:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failed += 1
            print(f"       {detail}")
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
