"""App Control's access matrices (app_badge_access, app_tenant_access, config_badge_access) and the App Builder's
registries (apps, app_builder, hub_resources) on tables of their own, not on the Core book: every reader (the rules
every request is gated by, the lane gate's last rule, the board's own rule, the release's matrix, the lanes' read by
id, My Inbox's store, the builder's views) answers what it answered off the copy; App Control's save lays its row on
its table and queues no book op to Google, a builder row op is laid on its table at once; and a void takes it all
back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-core-access-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CORE_ACCESS_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_core_access_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CORE_ACCESS_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import app_builder as AB  # noqa: E402
import app_builder_writes as ABW  # noqa: E402
import app_control_writes as ACW  # noqa: E402
import app_release  # noqa: E402
import book_ops as BO  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import lanes_sheets  # noqa: E402
import locations as L  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_board  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"app_badge_access": "appBadgeAccess", "app_tenant_access": "appTenantAccess",
          "config_badge_access": "configBadgeAccess", "apps": "hubApps", "app_builder": "hubAppBuilder",
          "hub_resources": "hubResources"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
core = db.resolve("app_badge_access").sheet_id


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
    return [{k: gsjs.js_str(v) for k, v in r.items() if gsjs.or_blank(v) != ""} for r in rows]


apps = sorted({gsjs.str_(r.get("appid")) for r in db.normalized_rows(db.resolve("app_badge_access").ref)} - {""})[:8]


def view(r: L.Reads, tab: str) -> list:
    v = AB.view(r, master, tab)
    return [v.exists, list(v.header), filled(list(v.rows))]


READERS = {
    "the rules every request is gated by": lambda r: r.app_rules(),
    "the board's own rule": lambda r: sheet_board.may_add_more(r, master),
    "the release's matrix": lambda r: app_release.access(r),
    "the lanes' read by id": lambda r: {t: filled(lanes_sheets.data(core, t)) for t in HOUSES},
    **{f"{t}: the builder's view": (lambda r, t=t: view(r, t)) for t in ("apps", "app_builder", "hub_resources")},
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_inbox = {t: filled(MW.HubBooks(L.Reads(db, None)).tab(core, t)[0]) for t in ("app_badge_access",
                                                                                 "app_tenant_access")}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select resource, sheet_id from {RR.COLUMNS} where resource = any(%s)", (list(HOUSES.values()),))
        check("each table names the Core book", all(s == core for _r, s in cur.fetchall()))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        seen = {t: filled(MW.HubBooks(L.Reads(Through(db, cur), None)).tab(core, t)[0]) for t in copy_inbox}
        check("My Inbox's store reads the tables as it read the copies", plain(seen) == plain(copy_inbox),
              first_diff(seen, copy_inbox))

        def ops() -> int:
            cur.execute(f"select count(*) from {BO.table()}")
            return int(cur.fetchone()[0])

        ops0 = ops()
        wid = "Wzzcoreaccesscheck01"
        tok = SC._WRITE.set({"write_id": wid})
        app_id = apps[0]
        rules0 = L.Reads(db, None).app_rules()
        d = ACW.badge_set(L.Session(L.Reads(db, None), master), {"app_id": app_id, "badges": ["ADMIN"]})
        check("App Control's save answers", (d.answer or {}).get("status") == 200, d.answer)
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, d, "check")
        got = [gsjs.str_(r.get("badges")) for r in HT.normalized(L.Reads(db, None), HT.where(L.Reads(db, None),
                                                                                             "app_badge_access").ref)
               if gsjs.str_(r.get("appid")) == app_id]
        check("the save lands on the app's row in its table", got and got[-1].upper() == "ADMIN", got)
        v = AB.view(L.Reads(db, None), master, "hub_resources")
        some = next((r for r in v.rows if gsjs.trim(gsjs.or_blank(r.get("resource_id")))), {})
        ABW._queue([AB.op_of(v, {"grow": ["zz_check"]})], "check", master, "check")
        check("a builder row op is laid on its table at once", "zz_check" in AB.view(L.Reads(db, None), master,
                                                                                    "hub_resources").header)
        check("no book op was queued", ops() == ops0, ops() - ops0)
        cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
        check("app.edits keeps none of it", cur.fetchone()[0] == 0)
        facts["a resource row"] = bool(some)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes the rules back", plain(L.Reads(db, None).app_rules()) == plain(rules0))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
