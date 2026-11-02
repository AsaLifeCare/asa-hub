#!/usr/bin/env python3
"""The Smart Comms test-mode logs in their own tables (app/comm_logs.py, db/comm_logs.sql), run in asa-hub-db-sync with
the app's modules streamed in and the live copy read: every writer keeps the same row it kept as a sheet's appended
edit (smart_comms' mock and rehearsal rows, the lanes' Held, the relay's web rows, once each), the Client Candidates
alerts answer the same from the table as from the old sheet-backed house, a void takes a write's rows back, and the
one-off import keeps every row a read saw (the house's copy with the kept edits laid), runs twice without doubling,
and retires only the edits whose row the table holds. Every write goes to stand-in tables (pg_temp) inside one
transaction rolled back; the live copy is only read."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
BASE = "9ecf9e8a"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, sys, time, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = dict(blob["app"])
SRC["redaction"] = blob["rules"]
SRC.update({k + "_old": v for k, v in blob["old"].items()})


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
import smart_comms as SC, comm_logs as CL, comm_rehearsal as CRH, comm_mock_writes as CMW, client_candidates as CC
import comm_mock as CM
import comm_rehearsal_old as CRH_OLD, comm_mock_writes_old as CMW_OLD, client_candidates_old as CC_OLD

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:900]])


W.EDITS_TABLE = "pg_temp.cl_edits"
CL.TABLES = {CL.MOCK: "pg_temp.cl_comm_mock", CL.REHEARSAL: "pg_temp.cl_comm_rehearsal"}
CL.SEQ = "pg_temp.cl_comm_test_seq"
conn = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="comm-logs-check")
conn.execute("set statement_timeout = '120s'")
db = hubdb.HubDb(connect=lambda: conn)
VOLATILE = {"createdAt", "updatedAt", "at", "day", "hour", "pass_at", "pass_id", "id", "seq"}


def edits_rows():
    return [W._edit_row(r) for r in conn.execute(W.edits_sql()).fetchall()]


def laid(sid, tab):
    """What a read showed of a sheet-backed log: the house's copy with the stand-in kept edits laid."""
    own = CW.Own([], edits=edits_rows(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        db._rows.clear()
        ref = db.tab(sid, tab) or own.virtual(sid, tab)
        return [dict(raw) for _rn, raw in db.rows(ref)] if ref is not None else []
    finally:
        hubdb.OWN.reset(tok)


def table_rows(name):
    return [r for r in CL.rows(conn.cursor(), name)]


def bare(row):
    return {k: v for k, v in row.items() if k not in VOLATILE and k != "_seq" and v != ""}


class Held:
    """A write being decided: the lock's cursor (writes.HELD) and Smart Comms' write (deciding)."""

    def __init__(self, write_id, door):
        self.write_id, self.door = write_id, door

    def __enter__(self):
        self.cur = conn.cursor()
        self.t1 = W.HELD.set(self.cur)
        self.ctx = SC.deciding(self, self.write_id, self.door)
        self.ctx.__enter__()
        return self.cur

    def __exit__(self, *a):
        self.ctx.__exit__(*a)
        W.HELD.reset(self.t1)


try:
    with conn.transaction():
        for stmt in W.edits_ddl() + CL.ddl():
            conn.execute(stmt)
        check("the void hook is registered with the write store", CL.void in W.VOID_HOOKS)

        # ---- smart_comms' own rows: the table row is the row the sheet-backed house laid ----
        run = SC._Run(time.time())
        b = {"dial": "record", "mock_test_mode": "sheet", "sending": False, "rpc_send": True, "paused": True,
             "testers": [], "hold": True}
        c = {"sid": "sched_check", "key": "cl-1", "lane": "scheduling", "person": "Pat", "person_key": "p1",
             "to": "+15550100000", "body": "Hi Pat, your shift is covered.", "sender": "the admin team",
             "subject": "", "channel": "sms", "rows": [], "write_id": "Wcl-sc", "door": "check", "ask": {}}
        m = SC.mock_row(run, c, b, "rehearsed", "test_mode", SC.REHEARSED_DETAIL)
        r = SC.rehearsal_row(run, c, b)
        cur = conn.cursor()
        kept = SC.keep_test_row(cur, c, CL.MOCK, m) and SC.keep_test_row(cur, c, CL.REHEARSAL, r)
        SC._append(cur, c, ("OLD_MOCK", "comm_mock"), SC.MOCK_HEADER, m, "id", m["id"])
        SC._append(cur, c, ("OLD_RH", "comm_rehearsal"), SC.REHEARSAL_HEADER, r, "id", r["id"])
        new_m, new_r = table_rows(CL.MOCK)[-1], table_rows(CL.REHEARSAL)[-1]
        old_m, old_r = laid("OLD_MOCK", "comm_mock")[-1], laid("OLD_RH", "comm_rehearsal")[-1]
        new_m.pop("_seq"), new_r.pop("_seq")
        check("smart_comms' mock and rehearsal rows: the table keeps exactly the row the house's appended edit laid",
              kept and new_m == old_m and new_r == old_r, [new_m, old_m])
        check("each row names the write and the door that kept it", conn.execute(
            f"select write_id, door from {CL.table(CL.MOCK)} where id = %s", (m["id"],)).fetchone() == ("Wcl-sc", "check"))

        # ---- the lanes' Held (recruitTell, openShiftCovered): the same row, and no kept edit ----
        reads = L.Reads(db)
        w = {"to": "+15550100000", "subject": "", "body": "Shift open at the house, reply YES", "channel": "sms",
             "reason": "comms: open_shift · OS|cl-row", "purpose": "hiring book · from the line", "person_name": "Pat",
             "to_name": "Pat", "intent_key": "RB|cl-row", "pass_by": "asa-hub:recruit-book", "verdict": "recorded"}
        n_m, n_r = len(table_rows(CL.MOCK)), len(table_rows(CL.REHEARSAL))
        edits_new: list = []
        with Held("Wcl-held", "recruitTell"):
            held = CRH.Held(reads, edits_new)
            rid = held.held(dict(w))
            first = conn.execute(f"select cells ->> 'createdAt' from {CL.table(CL.REHEARSAL)} where id = %s",
                                 (rid,)).fetchone()
            again = held.held(dict(w, body="Shift open at the house, reply YES now"))
        rows_r = {x["id"]: x for x in table_rows(CL.REHEARSAL)}
        edits_old: list = []
        with Held("Wcl-held-old", "recruitTell"):
            old = CRH_OLD.Held(reads, edits_old)
            old.held(dict(w))
        old_r = next((e["cells"] for e in edits_old if e["tab_name"] == "comm_rehearsal"), {})
        old_m = next((e["cells"] for e in edits_old if e["tab_name"] == "comm_mock"), {})
        new_m = table_rows(CL.MOCK)[n_m] if len(table_rows(CL.MOCK)) > n_m else {}
        check("Held keeps the rehearsal row and the mock row in their tables, under the write, and no kept edit",
              rid and rid == again and not edits_new and len(table_rows(CL.REHEARSAL)) == n_r + 1
              and len(table_rows(CL.MOCK)) == n_m + 2 and rows_r[rid].get("body", "").endswith("now"), edits_new)
        check("a second text under the same rehearsal id updates its row, its createdAt as first kept",
              first and rows_r[rid].get("createdAt") == first[0], [first, rows_r.get(rid)])
        check("Held's rows say what the sheet-backed Held's kept edits said (every cell but the times and ids)",
              bare(old_r) == bare({**rows_r[rid], "body": w["body"], "body_chars": old_r.get("body_chars")})
              and bare(old_m) == bare(new_m), [bare(old_r), bare(rows_r[rid]), bare(old_m), bare(new_m)])

        # ---- the relay's web rows (commMockWebIngest, the call-off tracker): each id kept once ----
        web = CL.MOCK
        picked = CM.web_rows([
            {"id": "web_" + uuid.uuid4().hex[:20], "channel": "web_notice", "body": "a notice", "result": "held"},
            {"id": "web_" + uuid.uuid4().hex[:20], "channel": "web_push", "body": "a push", "result": "held"}])
        with Held("Wcl-web", "commMockWebIngest"):
            got1, e1 = CMW.web_write(reads, picked["rows"])
            got2, e2 = CMW.web_write(reads, picked["rows"])
        with Held("Wcl-web-old", "commMockWebIngest"):
            _o, old_e = CMW_OLD.web_write(reads, picked["rows"][:1])
        ids = [x["id"] for x in picked["rows"]]
        held_rows = {x["id"]: x for x in table_rows(web) if x["id"] in ids}
        check("web rows: kept once each, named written both times, no kept edit left for the write",
              got1["appended"] == 2 and got2["appended"] == 0 and got2["written"] == ids and not e1 and not e2
              and len(held_rows) == 2, [got1, got2])
        check("a web row's cells are the ones the sheet-backed ingest kept",
              old_e and {k: v for k, v in old_e[0]["cells"].items() if k not in ("createdAt", "updatedAt")}
              == {k: v for k, v in held_rows[ids[0]].items() if k not in ("createdAt", "updatedAt", "_seq")},
              [old_e[0]["cells"] if old_e else None, held_rows.get(ids[0])])

        # ---- the void takes a write's rows back, and only them ----
        before = {x["id"] for x in table_rows(CL.MOCK)}
        CL.void(conn, "Wcl-web")
        after = {x["id"] for x in table_rows(CL.MOCK)}
        check("a void takes back the rows its write kept, and only them", before - after == set(ids)
              and m["id"] in after, sorted(before - after))

        # ---- the Client Candidates alerts: the same answer from the table as from the sheet-backed house ----
        lead = "CHECKLEAD" + uuid.uuid4().hex[:8]
        house = db.resolve("comm_mock")
        sid, tab = W.where_of(house)
        alerts = [{"id": "mock_cl_1#1", "at": "2026-10-20T14:00:00.000Z", "pass_id": "mock_cl_1", "result": "rehearsed",
                   "ledger_key": CC.alert_key(lead, "+15550100001"), "to_masked": "•••0001", "body": "lead alert one",
                   "held_by": "test_mode"},
                  {"id": "mock_cl_2#1", "at": "2026-10-21T15:30:00.000Z", "pass_id": "mock_cl_2", "result": "Sent",
                   "ledger_key": CC.alert_key(lead, "+15550100002"), "to_masked": "•••0002", "body": "lead alert two",
                   "held_by": ""},
                  {"id": "mock_cl_3#1", "at": "2026-10-22T09:00:00.000Z", "pass_id": "mock_cl_3", "result": "held",
                   "ledger_key": CC.alert_key("OTHER" + lead, "+15550100003"), "to_masked": "•••0003",
                   "body": "another lead", "held_by": "quiet"}]
        cur = conn.cursor()
        for a in alerts:
            CL.keep(cur, CL.MOCK, a, "Wcl-alert", "check")
            for f, v in a.items():
                cur.execute(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                            " keyed_by, row_key, field, value) values ('Wcl-alert', 'check', 'check', %s, %s, 'append',"
                            " 'id', 'header', %s, %s, %s)", (sid, tab, a["id"], f, v))
        ctx = {"memo": {}, "key": lead, "row": {"sms_sent": "yes"}}
        new = CC.alerts(L.Reads(db), dict(ctx, memo={}))
        own = CW.Own([], edits=edits_rows(), edits_at=time.time())
        tok = hubdb.OWN.set(own)
        try:
            db._rows.clear()
            old = CC_OLD.alerts(L.Reads(db), dict(ctx, memo={}))
        finally:
            hubdb.OWN.reset(tok)
        facts["alerts"] = [(x["id"], x["result"], x["at"]) for x in new["items"]]
        check("Client Candidates' alerts: the same items from the table as from the sheet-backed house, newest first,"
              " another lead's left out", new == old and [x["id"] for x in new["items"]] == ["mock_cl_2#1", "mock_cl_1#1"]
              and CC.alert_items(new) == CC.alert_items(old), [new, old])

        # ---- the one-off import: every row a read saw, once, and the retired edits only the held ones ----
        CL.TABLES = {CL.MOCK: "pg_temp.cl_import_mock", CL.REHEARSAL: "pg_temp.cl_import_rehearsal"}
        for stmt in CL.ddl():
            conn.execute(stmt)
        own = CW.Own([], edits=edits_rows(), edits_at=time.time())
        got = CL.sheet_rows(db, own, W.EDITS_TABLE, CL.MOCK)
        seen = laid(got["sheet_id"], got["tab"])
        cur = conn.cursor()
        one = CL.import_rows(cur, CL.MOCK, got["rows"])
        two = CL.import_rows(cur, CL.MOCK, got["rows"])
        stored = {x["id"]: x for x in table_rows(CL.MOCK)}
        same = all({k: v for k, v in stored.get(str(x.get("id")), {}).items() if k != "_seq"} ==
                   {**{k: CL.text(v) for k, v in x.items()}, "id": str(x.get("id"))} for x in seen if x.get("id"))
        facts["import"] = {"laid": len(seen), "first": one, "second": two, "origins": dict(conn.execute(
            f"select origin, count(*) from {CL.table(CL.MOCK)} group by 1").fetchall())}
        check("the import keeps every row a read of the house saw, the copy's alone as 'sheet', each as it was read",
              one["kept"] == len([x for x in seen if x.get("id")]) == len(stored) and same
              and stored["mock_cl_2#1"]["body"] == "lead alert two"
              and conn.execute(f"select origin from {CL.table(CL.MOCK)} where id = 'mock_cl_1#1'").fetchone()[0]
              == "postgres", facts["import"])
        check("a second import keeps nothing twice", two["kept"] == 0 and two["held_before"] == len(got["rows"]), two)
        cur.execute(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                    " row_key, field, value) values ('Wcl-late', 'check', 'check', %s, %s, 'append', 'id', 'header',"
                    " 'mock_cl_late#1', 'id', 'mock_cl_late#1')", (sid, tab))
        n_before = conn.execute(f"select count(*) from {W.EDITS_TABLE} where sheet_id = %s and tab_name = %s",
                                (sid, tab)).fetchone()[0]
        gone = CL.retire(cur, CL.MOCK, W.EDITS_TABLE, W.beside("edit_sync"), got["sheet_id"], got["tab"])
        left = [r[0] for r in conn.execute(f"select distinct row_key from {W.EDITS_TABLE} where sheet_id = %s"
                                           " and tab_name = %s", (sid, tab)).fetchall()]
        check("retiring takes out the kept edits of every row the table holds, and leaves a row it does not hold yet",
              gone["edits"] == n_before - 1 and left == ["mock_cl_late#1"], [gone, left])
        raise psycopg.Rollback()
finally:
    conn.close()
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''


def main() -> int:
    old = {}
    for name in ("comm_rehearsal", "comm_mock_writes", "client_candidates"):
        old[name] = subprocess.run(["git", "-C", str(ROOT), "show", f"{BASE}:app/{name}.py"], capture_output=True,
                                   text=True, check=True).stdout
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
            "rules": (ROOT / "server" / "redaction.py").read_text(encoding="utf-8"), "old": old}
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
