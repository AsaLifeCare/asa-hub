"""The accounts (the Core book's users tab) on their own table, not on a spreadsheet: every reader (Reads.users and all
on it, My Work's and My Profile's account reads, the lanes' and the tab door's by id) answers what it answered off the
copy, the old sheet password cells kept as the copy showed them (their marker, never a value); the sign-in's cells, an
invitation's register and an account's removal land in the table alone, with no book op to Google and nothing in
app.edits; and a void takes it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-users-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("USERS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_users_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"USERS_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import auth_doors as AD  # noqa: E402
import auth_invites as AINV  # noqa: E402
import book_ops as BO  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hub_rows  # noqa: E402
import hubdb  # noqa: E402
import lanes_sheets  # noqa: E402
import locations as L  # noqa: E402
import my_profile as MP  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import users_writes as UW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
RES = "usersHouse"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users0 = L.Reads(db, None).users()
boss = next((u for u in users0 if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
me = gsjs.str_(master.get("id"))
core = db.resolve("users").sheet_id


class Through:
    def __init__(self, real: hubdb.HubDb, cur) -> None:
        self._real, self._cur = real, cur

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        self._cur.execute(sql, params)
        return list(self._cur.fetchall())

    def __getattr__(self, name: str):
        return getattr(self._real, name)


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


def filled(rows: list) -> list:
    return [{k: gsjs.js_str(v) for k, v in r.items() if gsjs.or_blank(v) != "" and k != "_row"} for r in rows]


sample = [u for u in users0 if gsjs.str_(u.get("userid")) and not sc.is_master_email(u.get("email"))][:6]
uids = [gsjs.str_(u.get("userid")) for u in sample]
names = [MW.fold(u.get("displayname")) for u in sample if gsjs.str_(u.get("displayname"))]
emails = [gsjs.str_(u.get("email")).lower() for u in sample if gsjs.str_(u.get("email"))]


def accounts(r: L.Reads) -> dict:
    hb = MP.Books(r)
    return {"rows": [filled([hb.users_row(core, u) or {}]) for u in uids],
            "named": [filled(hb.users_named(core, k)) for k in names],
            "elsewhere": sorted(hb.emails_elsewhere(core, uids[0], emails)),
            "tied": filled(hb.accounts_for(core, "", emails))}


READERS = {
    "Reads.users and every reader on it": lambda r: r.users(),
    "the lanes' read by id": lambda r: filled(lanes_sheets.data(core, "users")),
    "the tab door's read": lambda r: filled(hub_rows.rows(core, "users", db=r.db)),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_accounts = accounts(L.Reads(db, None))
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, "users", SR.DERIVE.get(RES))
        cur.execute(f"select count(*) from {RR.ROWS} where resource = %s and (length(cells->>'pass_hash') > 30"
                    " or length(cells->>'salt') > 30)", (RES,))
        check("no password value is in the table", cur.fetchone()[0] == 0)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        seen = accounts(L.Reads(Through(db, cur), None))
        check("My Work's and My Profile's account reads answer the copy's", plain(seen) == plain(copy_accounts),
              first_diff(seen, copy_accounts))
        check("the accounts' copy has no age once kept", MP.Books(L.Reads(Through(db, cur), None)).users_copy(core)
              == (0.0, True))

        def ops() -> int:
            cur.execute(f"select count(*) from {BO.table()}")
            return int(cur.fetchone()[0])

        def in_edits(wid: str) -> int:
            cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return int(cur.fetchone()[0])

        ops0 = ops()
        # the sign-in's own cells on the master's row
        wid = "Wzzuserscheck0000001"
        tok = SC._WRITE.set({"write_id": wid})
        n = AD.row_cells(cur, L.Reads(db, None), me, {"lastlogin": "2099-01-01T00:00:00.000Z"}, "check", "check", wid)
        row = next(u for u in L.Reads(db, None).users() if gsjs.str_(u.get("userid")) == me)
        check("the sign-in's cells land on the account's row", n == 1 and "2099" in gsjs.str_(row.get("lastlogin")),
              (n, row.get("lastlogin")))
        check("app.edits keeps none of the sign-in", in_edits(wid) == 0, in_edits(wid))
        SC._WRITE.reset(tok)
        # an invitation's register: a new account row
        wid2 = "Wzzuserscheck0000002"
        tok = SC._WRITE.set({"write_id": wid2})
        sid, tab, cells = AINV._users_row(L.Reads(db, None), {"user_id": "USR_ZZCHECK", "email": "zz@check.invalid",
                                                              "role": "staff"})
        AINV._keep(cur, wid2, "check", [W.kept_record(sid, tab, "append", W.COLS + next(
            h for h in cells if h.replace("_", "").lower() == "userid"), "USR_ZZCHECK", "check", cells)])
        check("the invitation's account lands in the table",
              any(gsjs.str_(u.get("userid")) == "USR_ZZCHECK" for u in L.Reads(db, None).users()))
        check("app.edits keeps none of the register", in_edits(wid2) == 0, in_edits(wid2))
        SC._WRITE.reset(tok)
        # an account taken off
        wid3 = "Wzzuserscheck0000003"
        tok = SC._WRITE.set({"write_id": wid3})
        acc = UW.Accounts(L.Reads(db, None))
        at = acc.first(uids[0])
        UW.taken_off(L.Session(L.Reads(db, None), master), acc, at, "check")
        check("the removal takes the row out of the table",
              not any(gsjs.str_(u.get("userid")) == uids[0] for u in L.Reads(db, None).users()))
        SC._WRITE.reset(tok)
        check("no book op was queued", ops() == ops0, ops() - ops0)
        for w in (wid3, wid2, wid):
            RR.void(cur, w)
        back = L.Reads(db, None).users()
        check("a void takes it all back", plain(back) == plain(copies["Reads.users and every reader on it"]),
              first_diff(back, copies["Reads.users and every reader on it"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
