#!/usr/bin/env python3
"""asa-hub-sheet-sync's backup (app/sheet_sync.py) in asa-hub-db-sync, the modules streamed in: an owed cell written,
one Google already holds acknowledged, a cell both sides changed going to the newer side with its log row (the copy's
read proving either side, Python's own reads, the book's modifiedTime capping the copy and deciding an open race, a
tie Postgres', an emptied cell too), the withheld rule, an append, a sheet-side change of a cell Postgres does not owe
left to the daily check, pacing and the doubling back-off on a 429, the read budget, idempotence, and Own.lay_edits no
longer laying a superseded edit. The daily
check itself is tools/test-postgres-record.py's. Postgres: temp tables inside one transaction
rolled back at the end. Google: a stand-in speaking the Sheets REST shapes (the default), or with --live-folder a
throwaway spreadsheet living-brain makes in that shared-drive folder and trashes at the end; --probe SHEET_ID TAB reads
one real tab once (read-only) and compares it with its copy in asa-hub-db, cell by cell, printing counts only."""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
SA_KEY = ROOT / "app" / ".sa-living-brain.json"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, sys, time, urllib.parse, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = dict(blob["app"])
SRC["redaction"] = blob["rules"]
ARGS = blob["args"]


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
import hubdb, writes as W, client_writes as CW
import sheet_sync as SS

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:700]])


def token_of(key_b64, scopes):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    cred = service_account.Credentials.from_service_account_info(json.loads(base64.b64decode(key_b64)), scopes=scopes)

    def tok():
        if not cred.valid:
            cred.refresh(Request())
        return cred.token
    return tok


# ---- the probe: one real tab read once, compared with its copy (counts only) ----
if ARGS.get("probe"):
    sid, tab = ARGS["probe"]
    import requests
    sheets = SS.Sheets(http=requests.Session(), token=token_of(blob["key"], SS.SCOPES))
    live = SS.live_tab(sheets.batch_get(sid, [SS.quote(tab)])[0])
    db = SS.Db(ro=lambda: psycopg.connect(hubdb._dsn(), autocommit=True))
    heads, rows = db.copy(sid, tab) or ((), [])
    mine = {rn: SS.R.redact_row(dict(raw))[0] for rn, raw in live.rows}
    rows_same = cells = cells_same = 0
    for rn, raw, _at in rows:
        got = mine.get(rn)
        if got is None:
            continue
        keys = [k for k in raw if k in got]
        cells += len(keys)
        eq = sum(1 for k in keys if str(raw[k]) == str(got[k]))
        cells_same += eq
        rows_same += 1 if eq == len(keys) else 0
    print(json.dumps({"probe": {"reads": sheets.reads, "live_rows": len(live.rows), "copy_rows": len(rows),
                                "rows_identical": rows_same, "cells_compared": cells, "cells_identical": cells_same,
                                "header_row": live.header_row}}))
    sys.exit(0)


# ---- Google: the stand-in (Sheets REST shapes, USER_ENTERED as a person typing) or a real throwaway book ----
class Resp:
    def __init__(self, code, body):
        self.status_code, self._b, self.text = code, body, json.dumps(body)

    def json(self):
        return self._b


CURRENCY, DATES = {"amount"}, {"start"}
A1 = re.compile(r"^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$")


def col_n(s):
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


class FakeGoogle:
    def __init__(self, books):
        self.books = books
        self.calls, self.fail_on = [], {}

    def shown(self, head, v):
        v = "" if v is None else str(v)
        if v.startswith("'"):
            return v[1:]
        if not v:
            return ""
        if head in CURRENCY and re.fullmatch(r"-?\$?[\d,]+(\.\d+)?", v):
            return "${:,.2f}".format(float(v.replace("$", "").replace(",", "")))
        if head in DATES:
            m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
            if m:
                return f"{int(m.group(1))}/{int(m.group(2))}/{m.group(3)}"
        if re.fullmatch(r"-?\d+(\.\d+)?", v):
            f = float(v)
            return str(int(f)) if f == int(f) else str(f)
        if v.upper() in ("TRUE", "FALSE"):
            return v.upper()
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
        code = self.fail_on.pop(rest, None)
        if code:
            return Resp(code, {"error": {"code": code, "status": "RESOURCE_EXHAUSTED",
                                         "message": "Quota exceeded for quota metric 'Requests'"}})
        if sid not in self.books:
            return Resp(404, {"error": {"code": 404}})
        if rest == "":
            return Resp(200, {"sheets": [{"properties": {"title": t}} for t in self.books[sid]]})
        if rest == "values:batchGet":
            vrs = []
            for r in params["ranges"]:
                m = A1.match(r)
                tab = m.group(1).replace("''", "'") if m else ""
                if tab not in self.books[sid]:
                    return Resp(400, {"error": {"code": 400, "message": f"Unable to parse range: {r}"}})
                vrs.append({"range": r, "values": self.values(sid, tab)})
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
            shown = []
            for i, line in enumerate(json["values"]):
                shown.append([self.put(sid, tab, row + i, j + 1, v) for j, v in enumerate(line)])
            return Resp(200, {"updates": {"updatedRange": f"'{tab}'!A{row}:{SS.col_letter(len(json['values'][0]))}"
                                                          f"{row + len(shown) - 1}", "updatedData": {"values": shown}}})
        return Resp(400, {"error": {"code": 400, "message": "not a call the stand-in knows"}})


SID, SID2, TAB, OTHER = "CHECK_A" + uuid.uuid4().hex[:10], "CHECK_B" + uuid.uuid4().hex[:10], "check_tab", "other_tab"
HEAD = ["id", "name", "phone", "amount", "start", "notes", "password"]
SEED = [HEAD,
        ["C1", "Ann Lee", "(330) 555-0000", "$1,200.00", "10/1/2026", "n1", "pw1"],
        ["C2", "Bob Ray", "(330) 555-0001", "$50.00", "10/2/2026", "n2", "pw2"],
        ["C3", "Cy Dow", "", "$0.00", "", "n3-updated", ""],
        ["C4", "Dee Fox", "555-2222", "$10.00", "", "n4", ""],
        ["C5", "Eve Gold", "555-4444", "$20.00", "", "n5", ""],
        ["C6", "Fay Hill", "555-0006", "$30.00", "", "n6-changed", ""]]
live_mode = bool(ARGS.get("live_folder"))
vt, sleeps = [0.0], []


def vsleep(s):
    sleeps.append(round(s, 3))
    vt[0] += s


if live_mode:
    import requests
    drive_tok = token_of(blob["key"], ["https://www.googleapis.com/auth/drive"])
    H = lambda: {"Authorization": "Bearer " + drive_tok()}
    made = requests.post("https://www.googleapis.com/drive/v3/files", headers=H(), params={"supportsAllDrives": "true"},
                         json={"name": "two-way-sync check (throwaway)", "mimeType": "application/vnd.google-apps.spreadsheet",
                               "parents": [ARGS["live_folder"]]}, timeout=30).json()
    SID = made["id"]
    http = requests.Session()
    sheets = SS.Sheets(http=http, token=token_of(blob["key"], SS.SCOPES), clock=lambda: vt[0], sleep=vsleep)
    meta = sheets._call("GET", f"/{SID}", False, {"fields": "sheets.properties"})
    first = meta["sheets"][0]["properties"]
    sheets._call("POST", f"/{SID}:batchUpdate", True, None, {"requests": [
        {"updateSheetProperties": {"properties": {"sheetId": first["sheetId"], "title": TAB}, "fields": "title"}},
        {"addSheet": {"properties": {"title": OTHER}}},
        {"repeatCell": {"range": {"sheetId": first["sheetId"], "startColumnIndex": 3, "endColumnIndex": 4},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "CURRENCY", "pattern": "$#,##0.00"}}},
                        "fields": "userEnteredFormat.numberFormat"}},
        {"repeatCell": {"range": {"sheetId": first["sheetId"], "startColumnIndex": 4, "endColumnIndex": 5},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "M/d/yyyy"}}},
                        "fields": "userEnteredFormat.numberFormat"}}]})
    sheets._call("POST", f"/{SID}/values:batchUpdate", True, None, {"valueInputOption": "USER_ENTERED", "data": [
        {"range": f"'{TAB}'!A1", "values": SEED}]})
    fake = None
else:
    fake = FakeGoogle({SID: {TAB: [list(r) for r in SEED], OTHER: [["id", "x"], ["Z", "1"]]},
                       SID2: {TAB: [list(r) for r in SEED[:2]]}})
    sheets = SS.Sheets(http=fake, token=lambda: "stand-in", clock=lambda: vt[0], sleep=vsleep)


def sheet_cell(sid, rn, col):
    if fake is not None:
        g = fake.grid(sid, TAB)
        return g[rn - 1][col] if rn - 1 < len(g) and col < len(g[rn - 1]) else ""
    got = sheets.batch_get(sid, [f"'{TAB}'!{SS.col_letter(col + 1)}{rn}"])[0]
    return got[0][0] if got and got[0] else ""


def hand_edit(sid, rn, col, v):
    if fake is not None:
        fake.put(sid, TAB, rn, col + 1, v)
        return
    sheets._call("POST", f"/{sid}/values:batchUpdate", True, None, {"valueInputOption": "RAW", "data": [
        {"range": f"'{TAB}'!{SS.col_letter(col + 1)}{rn}", "values": [[v]]}]})


# ---- Postgres: app.edits, app.edit_sync, app.edit_conflicts, app.edit_sync_cycles as temp tables ----
W.EDITS_TABLE = "pg_temp.hub_edits_check"
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="two-way-sync-check")


MODIFIED = {}


class CheckDb(SS.Db):
    def copy(self, sid, tab):
        rows = self.rw().execute("select row_number, _raw, extract(epoch from _ingested_at) from pg_temp.check_copy"
                                 " where sheet_id = %s order by row_number", (sid,)).fetchall()
        return tuple(HEAD), [(int(rn), raw, float(at or 0)) for rn, raw, at in rows]

    def book_modified(self, sid):
        """The book's modifiedTime the catalog holds, as each case sets it (None: a record book's, not known)."""
        return MODIFIED.get(sid)


db = CheckDb(rw=lambda: real, ro=lambda: real)
now = time.time()
eid = [0]


def edit(row_key, field, value, before="", ago=60.0, kind="edit", sid=None):
    eid[0] += 1
    real.execute(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                 " row_key, field, value, before, author, at) values (%s, 'check', 'checkEdit', %s, %s, %s, 'id', 'header',"
                 " %s, %s, %s, %s, 'Sync Check', to_timestamp(%s))",
                 (f"Wsync-check-{eid[0]:04d}", sid or SID, TAB, kind, row_key, field, value, before, time.time() - ago))


def copy_rows(rows, ingested_ago):
    """The keeper's copy of the tab: what the sheet held, ingested that long ago."""
    real.execute("delete from pg_temp.check_copy")
    for rn, line in enumerate(rows[1:], start=2):
        real.execute("insert into pg_temp.check_copy (sheet_id, row_number, _raw, _ingested_at) values"
                     " (%s, %s, %s::jsonb, to_timestamp(%s))",
                     (SID, rn, json.dumps(SS.R.redact_row(dict(zip(HEAD, line + [""] * 7)))[0]), time.time() - ingested_ago))


def copy_set(rn, head, value, ingested_ago):
    real.execute("update pg_temp.check_copy set _raw = jsonb_set(_raw, %s, to_jsonb(%s::text)),"
                 " _ingested_at = to_timestamp(%s) where row_number = %s", ([head], value, time.time() - ingested_ago, rn))


def laid():
    """What every read shows for the tab: the copy with Own's edits laid (writes.edits_sql → Own.lay_edits)."""
    rows = [W._edit_row(r) for r in real.execute(W.edits_sql()).fetchall()]
    own = CW.Own([], edits=rows, edits_at=time.time())
    copy = [(int(rn), raw) for rn, raw in real.execute(
        "select row_number, _raw from pg_temp.check_copy where sheet_id = %s order by row_number", (SID,)).fetchall()]
    ref = hubdb.TabRef(SID, TAB, "check_copy", tuple(HEAD), "t", len(copy))
    return {raw.get("id"): raw for _rn, raw in own.lay_edits(ref, copy)}


def states():
    return {("B:" if r[5] == SID2 else "") + r[0] + "." + r[1]: (r[2], r[3], int(r[4])) for r in real.execute(
        f"select row_key, field, state, base_value, edit_id, sheet_id from {W.beside('edit_sync')}").fetchall()}


def conflicts():
    return [(r[0], r[1], r[2], r[3]) for r in real.execute(
        f"select row_key, field, winner, why from {W.beside('edit_conflicts')} order by id").fetchall()]


def won(rid, field, winner, prefix, *said):
    """Whether the cell's last conflict row names this winner, its why starting with the prefix and saying each part."""
    got = [(w, y) for r, f, w, y in conflicts() if (r, f) == (rid, field)]
    return (bool(got) and got[-1][0] == winner and got[-1][1].startswith(prefix + ":")
            and all(p in got[-1][1] for p in said))


try:
    with real.transaction():
        db.ensure()
        real.execute("create temp table check_copy (sheet_id text, row_number int, _raw jsonb, _ingested_at timestamptz)")
        made = {r[0] for r in real.execute("select relname from pg_class where relpersistence = 't' and relkind = 'r'"
                                            " and pg_table_is_visible(oid)")}
        check("the tables are made beside app.edits (edit_sync, edit_conflicts, edit_sync_cycles) by the writer's ensure",
              {"hub_edits_check", "hub_edit_sync_check", "hub_edit_conflicts_check",
               "hub_edit_sync_cycles_check"} <= made, sorted(made))
        copy_rows(SEED, 900)
        # case 1: the sheet still holds what the editor saw → the edit is written (text, a number, a date)
        edit("C1", "phone", "(330) 555-0101", "(330) 555-0000")
        edit("C1", "amount", "1300", "$1,200.00")
        edit("C1", "start", "2026-10-15T04:00:00.000Z", "10/1/2026")
        edit("C1", "password", "pw-new", "[withheld: secret]")
        edit("C2", "name", "Bob Ray Jr", "Bob Ray")
        # case 3: the sheet already holds the edit → in sync, nothing written
        edit("C3", "notes", "n3-updated", "n3")
        # case 4, the edit newer: the copy showed the sheet's value before the edit was made
        edit("C4", "phone", "555-1111", "555-0004", ago=300)
        copy_set(5, "phone", "555-2222", 600)
        # case 4, the sheet newer: the copy still showed the old value after the edit was made
        edit("C5", "phone", "555-3333", "555-0005", ago=600)
        copy_set(6, "phone", "555-0005", 300)
        # an empty edit against a changed filled cell
        edit("C6", "notes", "", "n6", ago=100)
        # an appended row (one cell with no column on the sheet)
        for f, v in (("id", "N1"), ("name", "New Person"), ("phone", "(330) 555-0999"), ("amount", "75"),
                     ("nonexistent_col", "x")):
            edit("N1", f, v, kind="append")
        edit("C1", "name", "Ann Lee", "Ann Lee", sid=SID2)

        SS.READS_PER_CYCLE = 1
        SS.CHECKS_PER_ROUND = 0
        syncer = SS.Syncer(db, sheets)

        def due_again():
            """The time a refused book waits out, passed."""
            real.execute(f"update {SS.RB.books_table()} set backup_next_at = null")
        n0 = len(fake.calls) if fake else 0
        st1 = syncer.cycle()
        facts["cycle 1"] = st1.line()
        g = lambda rn, c: sheet_cell(SID, rn, HEAD.index(c))
        n1 = len(fake.calls) if fake else 0
        st1b = syncer.cycle()
        facts["cycle 1b"] = st1b.line()
        check("the read budget: one book read a cycle, the other waits for the next (least recently checked first)",
              st1.reads == 1 and st1.books == 1 and "read budget" in st1.why and st1b.reads == 1 and st1b.books == 1
              and "B:C1.name" in states() and (fake is None or SID2 not in str(fake.calls[n0:n1])),
              [st1.line(), st1b.line()])
        SS.READS_PER_CYCLE = 10
        check("S == B, P != B: the edit is written — text quoted, a number and a date typed as the sheet shows them",
              (g(2, "phone"), g(2, "amount"), g(2, "start"), g(3, "name"))
              == ("(330) 555-0101", "$1,300.00", "10/15/2026", "Bob Ray Jr"),
              [g(2, "phone"), g(2, "amount"), g(2, "start"), g(3, "name")])
        s = states()
        check("S == P: in sync, nothing written, the base is the sheet's value",
              s.get("C3.notes", ("",))[0] == "synced" and g(4, "notes") == "n3-updated", s.get("C3.notes"))
        k = conflicts()
        check("both changed, the sheet older (its copy, read before the edit, already held the sheet's value): Postgres"
              " is newer, written, logged", g(5, "phone") == "555-1111"
              and won("C4", "phone", "postgres", SS.WHY_PG_NEWER, "the copy read at")
              and s.get("C4.phone", ("",))[0] == "synced", [g(5, "phone"), k, s.get("C4.phone")])
        check("both changed, the sheet newer (its copy, read after the edit, still held the agreed value): the sheet's"
              " value stands, nothing written, the edit superseded, logged", g(6, "phone") == "555-4444"
              and won("C5", "phone", "sheet", SS.WHY_SHEET_NEWER, "still held the agreed value")
              and s.get("C5.phone", ("",))[:2] == ("superseded", "555-4444"), [g(6, "phone"), k, s.get("C5.phone")])
        check("an emptied cell is Postgres' change too: the copy proves it newer, the sheet's cell is cleared, logged",
              g(7, "notes") == "" and won("C6", "notes", "postgres", SS.WHY_PG_NEWER), [g(7, "notes"), k])
        check("a withheld column is never written nor compared, and nothing of it is stored",
              g(2, "password") == "pw1" and s.get("C1.password", ("",))[0] == "withheld"
              and s["C1.password"][1] in ("", "[withheld: secret]"), [g(2, "password"), s.get("C1.password")])
        check("an appended row lands after the last row, in header order, typed as the sheet shows it; a cell with no"
              " column is skipped", [g(8, h) for h in ("id", "name", "phone", "amount")]
              == ["N1", "New Person", "(330) 555-0999", "$75.00"] and s.get("N1.id", ("",))[0] == "synced"
              and s.get("N1.nonexistent_col", ("",))[0] == "missing", [[g(8, h) for h in HEAD], s.get("N1.id")])
        if fake:
            kinds = [c[1] for c in fake.calls[n0:n1]]
            facts["cycle 1 requests"] = kinds
            check("cycle 1's requests: one read of the book, one batchUpdate for every cell, one append — the tab with"
                  " no edit never named", len(kinds) == 3 and kinds[0] == "values:batchGet"
                  and kinds[1] == "values:batchUpdate" and kinds[2].endswith(":append")
                  and not any(OTHER in r for c in fake.calls for r in c[2]), fake.calls[n0:n1])
        check("cycle 1's counts (written 6, appended 1, accepted 1, conflicts 3 of which the sheet won 1, skipped 2 and"
              " the book left for the next cycle), the line counting the winners per side",
              (st1.written, st1.appended, st1.accepted, st1.conflicts, st1.sheet_won, st1.skipped)
              == (6, 1, 1, 3, 1, 2 + 1) and "conflicts 3 (won by Postgres 2, by the sheet 1)" in st1.line(), st1.line())
        snap, k1 = states(), conflicts()
        grid1 = [list(r) for r in fake.grid(SID, TAB)] if fake else None
        st2 = syncer.cycle()
        facts["cycle 2"] = st2.line()
        check("idempotence: a second cycle writes nothing, decides nothing new, logs no conflict",
              st2.writes == 0 and st2.written == st2.appended == st2.accepted == st2.conflicts == 0
              and states() == snap and conflicts() == k1 and (fake is None or fake.grid(SID, TAB) == grid1),
              [st2.line(), {x: (snap.get(x), states().get(x)) for x in snap if snap.get(x) != states().get(x)}])

        # case 2: the edit synced, then the sheet changed (Apps Script door, a hand edit) → the sheet's value accepted
        copy_rows([list(r) for r in (fake.values(SID, TAB) if fake else SEED)], 30)
        # the keeper still behind on C2: every read shows the kept edit laid over it
        copy_set(3, "name", "Bob Ray", 30)
        lay_before = laid()
        hand_edit(SID, 3, HEAD.index("name"), "Robert Ray")
        copy_set(3, "name", "Robert Ray", 10)
        st3 = syncer.cycle()
        facts["cycle 3"] = st3.line()
        check("P == B, S != B: a cell Postgres does not owe is not the backup's — nothing read, nothing written, the"
              " daily check brings the sheet's value in", st3.reads == 0 and st3.writes == 0
              and states().get("C2.name", ("",))[:2] == ("synced", "Bob Ray Jr"), [st3.line(), states().get("C2.name")])
        # the sheet's value handed over, as the backup does for an owed cell Postgres did not change
        real.execute(f"update {W.beside('edit_sync')} set state = 'superseded', base_value = 'Robert Ray'"
                     " where row_key = 'C2' and field = 'name'")
        lay_after = laid()
        check("Own.lay_edits lays a synced edit, and stops laying it once the sheet superseded it (a cell the newer"
              " sheet won shows the sheet's value)",
              lay_before.get("C2", {}).get("name") == "Bob Ray Jr" and lay_after.get("C2", {}).get("name") == "Robert Ray"
              and lay_after.get("C5", {}).get("phone") == "555-4444",
              [lay_before.get("C2", {}).get("name"), lay_after.get("C2", {}).get("name"),
               lay_after.get("C5", {}).get("phone")])
        edit("C2", "name", "Bobby", "Robert Ray", ago=5)
        st4 = syncer.cycle()
        check("a newer edit after the sheet's change wins again: written, laid again",
              st4.written == 1 and g(3, "name") == "Bobby" and laid().get("C2", {}).get("name") == "Bobby",
              [st4.line(), g(3, "name")])

        # newest wins: each race alone in its cycle, every time in seconds after the edit (negative: before it)
        ROW = {"C1": 2, "C2": 3, "C4": 5, "C5": 6, "C6": 7}

        def race(rid, field, base, sheet, pg, edit_ago, copy=None, modified=None, state=None):
            """One cell both sides changed: the sheet holding `sheet`, Postgres' edit made edit_ago seconds ago,
            copy=(the copy's value, when its row was read), modified=the book's modifiedTime in the catalog,
            state=(the kept state, the value Python saw there, its first sight, its last check)."""
            rn = ROW[rid]
            hand_edit(SID, rn, HEAD.index(field), sheet)
            edit(rid, field, pg, base, ago=edit_ago)
            wid = f"Wsync-check-{eid[0]:04d}"
            at = float(real.execute(f"select extract(epoch from at) from {W.EDITS_TABLE} where write_id = %s",
                                    (wid,)).fetchone()[0])
            if copy is not None:
                real.execute("update pg_temp.check_copy set _raw = jsonb_set(_raw, %s, to_jsonb(%s::text)),"
                             f" _ingested_at = (select at from {W.EDITS_TABLE} where write_id = %s)"
                             " + make_interval(secs => %s) where row_number = %s", ([field], copy[0], wid, copy[1], rn))
            if state is not None:
                real.execute(f"insert into {W.beside('edit_sync')} (sheet_id, tab_name, match_by, keyed_by, row_key,"
                             " field, edit_id, state, base_value, sheet_value, sheet_seen_at, checked_at)"
                             " values (%s, %s, 'id', 'header', %s, %s, 0, %s, %s, %s, to_timestamp(%s),"
                             " to_timestamp(%s))",
                             (SID, TAB, rid, field, state[0], base, state[1], at + state[2], at + state[3]))
            MODIFIED[SID] = None if modified is None else at + modified
            st = syncer.cycle()
            row = real.execute("select winner, why, extract(epoch from edit_at), extract(epoch from sheet_seen_at)"
                               f" from {W.beside('edit_conflicts')} where row_key = %s and field = %s"
                               " order by id desc limit 1", (rid, field)).fetchone()
            return {"line": st.line(), "st": st, "sheet": g(rn, field), "state": states().get(f"{rid}.{field}"),
                    "at": at, "row": row and [row[0], row[1], float(row[2] or 0), float(row[3] or 0)]}

        asked = []
        ask = SS.RB.ask_check
        SS.RB.ask_check = lambda conn, sid, tabs=None: (asked.append((sid, tabs)), ask(conn, sid, tabs))[1]
        real.execute(f"update {SS.RB.books_table()} set held_since = now() where sheet_id = %s", (SID,))
        # the write refused after Python read the agreed value there, after the edit; then a hand edit came
        r1 = race("C1", "notes", "n1", "n1-hand", "n1-pg", 120, copy=("n1", -600.0),
                  state=("pending", "n1", -600.0, 60.0))
        real.execute(f"update {SS.RB.books_table()} set held_since = null where sheet_id = %s", (SID,))
        SS.RB.ask_check = ask
        check("both changed, Python's own read after the edit still showing the agreed value: the sheet is newer, its"
              " value stands, nothing written, the edit superseded, logged, and the record book's tab checked at once",
              r1["sheet"] == "n1-hand" and r1["st"].writes == 0 and r1["st"].sheet_won == 1
              and (r1["state"] or ("",))[:2] == ("superseded", "n1-hand")
              and won("C1", "notes", "sheet", SS.WHY_SHEET_NEWER, "Python read another value")
              and asked == [(SID, [TAB])], [r1, asked])
        # Python first saw the sheet's value before the edit (an earlier write of the cell refused)
        r2 = race("C2", "notes", "n2", "n2-hand", "n2-pg", 60, copy=("n2", -900.0),
                  state=("pending", "n2-hand", -240.0, 30.0))
        check("both changed, Python first saw the sheet's value before the edit: Postgres is newer, written; the row"
              " keeps the edit's time and that first sight", r2["sheet"] == "n2-pg"
              and (r2["state"] or ("",))[0] == "synced" and r2["st"].sheet_won == 0
              and won("C2", "notes", "postgres", SS.WHY_PG_NEWER, "Python saw the sheet's value")
              and r2["row"] is not None and abs(r2["row"][2] - r2["at"]) < 0.01
              and abs(r2["row"][3] - (r2["at"] - 240)) < 0.01, r2)
        r3 = race("C4", "notes", "n4", "n4-hand", "n4-pg", 300, copy=("n4-hand", 200.0), modified=-200.0)
        check("both changed, the copy read after the edit holding the sheet's value, of the book as modified before the"
              " edit (the modifiedTime caps the copy's read): Postgres is newer, written", r3["sheet"] == "n4-pg"
              and won("C4", "notes", "postgres", SS.WHY_PG_NEWER, "already held the sheet's value",
                      "the book modified"), r3)
        # open races: the copy read before the edit, Python never saw the cell; the book's modifiedTime decides
        r4 = race("C5", "notes", "n5", "n5-hand", "n5-pg", 300, copy=("n5", -300.0), modified=200.0)
        check("ambiguous, the book modified after the edit: the sheet wins, its value stands, the row says so with both"
              " times", r4["sheet"] == "n5-hand" and (r4["state"] or ("",))[0] == "superseded"
              and won("C5", "notes", "sheet", SS.WHY_AMBIGUOUS, "the book modified at", "after the edit at"), r4)
        r5 = race("C6", "name", "Fay Hill", "Fay Hand", "Fay PG", 100, copy=("Fay Hill", -500.0), modified=-50.0)
        check("ambiguous, the book modified before the edit: Postgres wins, written", r5["sheet"] == "Fay PG"
              and won("C6", "name", "postgres", SS.WHY_AMBIGUOUS, "the book modified at", "by the edit at"), r5)
        r6 = race("C4", "name", "Dee Fox", "Dee Hand", "Dee PG", 100, copy=("Dee Fox", -500.0))
        check("ambiguous, the book's modifiedTime not known (a record book's): Postgres kept, written",
              r6["sheet"] == "Dee PG" and won("C4", "name", "postgres", SS.WHY_AMBIGUOUS, "not known"), r6)
        r7 = race("C5", "name", "Eve Gold", "Eve Hand", "Eve PG", 300, copy=("Eve Gold", 0.0), modified=0.0)
        check("a tie (the copy read, holding the agreed value, and the book modified at the edit's very time) goes to"
              " Postgres: written", r7["sheet"] == "Eve PG"
              and won("C5", "name", "postgres", SS.WHY_AMBIGUOUS, "by the edit at"), r7)
        MODIFIED.clear()
        facts["races"] = {k: (r["row"] or [None, None])[1] for k, r in
                          (("r1", r1), ("r2", r2), ("r3", r3), ("r4", r4), ("r5", r5), ("r6", r6), ("r7", r7))}

        if fake:
            # pacing and the back-off: a 429 on the write stops the cycle, the cell owed, a minute of quiet, doubling
            edit("C3", "phone", "(330) 555-0303", "", ago=5)
            fake.fail_on = {"values:batchUpdate": 429}
            t0 = time.time()
            st5 = syncer.cycle()
            facts["cycle 5 (429 on the write)"] = st5.line()
            cyc = real.execute(f"select refused, extract(epoch from backoff_until) from {W.beside('edit_sync_cycles')}"
                               " order by id desc limit 1").fetchone()
            check("a 429 on the write: the cycle stops, the cell is owed (pending), the service backs off a minute,"
                  " the cycle row says so", st5.refused and g(4, "phone") == "" and states().get("C3.phone", ("",))[0]
                  == "pending" and abs(syncer.backoff_until - (t0 + SS.BACKOFF_MIN_S)) < 30
                  and syncer.backoff_s == 2 * SS.BACKOFF_MIN_S
                  and cyc[0] is True and abs(float(cyc[1]) - syncer.backoff_until) < 2, [st5.line(), cyc])
            due_again()
            fake.fail_on = {"values:batchGet": 429}
            n6 = len(fake.calls)
            st6 = syncer.cycle()
            check("a 429 on the read: nothing else is asked that cycle, and the back-off doubles",
                  st6.refused and st6.reads == 1 and st6.writes == 0 and len(fake.calls) == n6 + 1
                  and syncer.backoff_s == 4 * SS.BACKOFF_MIN_S, st6.line())
            syncer.backoff_until = 0.0
            due_again()
            st7 = syncer.cycle()
            check("after the back-off the owed cell is written", st7.written == 1 and g(4, "phone") == "(330) 555-0303",
                  [st7.line(), g(4, "phone")])
            gap = 60.0 / SS.WRITES_PER_MIN
            check(f"pacing: every request waits {gap:.0f}s after the one before (≤ {SS.WRITES_PER_MIN}/min)",
                  sleeps and all(abs(x - gap) < 0.01 for x in sleeps) and len(sleeps) == len(fake.calls) - 1,
                  [sleeps[:8], len(sleeps), len(fake.calls)])
            facts["requests in the whole check"] = len(fake.calls)
        facts["conflict rows"] = len(conflicts())
        raise psycopg.Rollback()
finally:
    if live_mode:
        try:
            requests.patch(f"https://www.googleapis.com/drive/v3/files/{SID}", headers=H(),
                           params={"supportsAllDrives": "true"}, json={"trashed": True}, timeout=30)
        except Exception:
            pass
    real.close()
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--live-folder", help="a shared-drive folder living-brain may add to: the throwaway book goes there")
    ap.add_argument("--probe", nargs=2, metavar=("SHEET_ID", "TAB"), help="read one real tab once and compare its copy")
    ap.add_argument("--key", type=Path, default=SA_KEY, help="living-brain's key (default: app/.sa-living-brain.json)")
    args = ap.parse_args()
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
            "rules": (ROOT / "server" / "redaction.py").read_text(encoding="utf-8"),
            "args": {"live_folder": args.live_folder, "probe": args.probe}}
    if args.live_folder or args.probe:
        blob["key"] = base64.b64encode(args.key.read_bytes()).decode()
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print(got.stderr.decode()[-3000:])
        return 1
    res = json.loads(lines[-1])
    if "probe" in res:
        print(json.dumps(res["probe"], indent=1))
        return 0
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
