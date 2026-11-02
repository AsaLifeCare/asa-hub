"""My World on Postgres (app/world*.py, db/world_rows.sql) run in-process with the app's own modules and asa-hub-db read
live, every world row on stand-ins of this session alone (pg_temp, rolled back at the end): the import copies the real
worlds as My World served them off the sheets (each compared door by door with the doors that read the sheets), a
second run adds nothing; then a world made, its apps published, removed and furnished, the generic verbs inside it,
the refusals, a replay and a void — and never a Drive call, a book op or a read of a world's sheet.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py), the doors
that read the sheets taken from the commit before the move:

    cp tools/test-my-world.py "$RUNNER/test_my_world.py"
    E=$(python3 -c 'import json,subprocess as s;g=lambda p:s.check_output(["git","show","3b2cf806:"+p]).decode()
    print(json.dumps({"MW_SQL":open("db/world_rows.sql").read(),"MW_ROUTES":open("app/front_door_routes.json").read(),
        "MW_OLD_WORLD":g("app/world.py"),"MW_OLD_OPS":g("app/world_ops.py")}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_my_world.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import contextlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402


class _App:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        def deco(*a, **k):
            return lambda f: f
        return deco


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode()
        elif isinstance(content, str):
            content = content.encode()
        self.body, self.status_code, self.media_type = content or b"", status_code, media_type
        self.headers = dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.FastAPI, _fa.Request = _App, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
WORK = f"/tmp/mw-test-{os.getpid()}"
os.makedirs(WORK + "/packs", exist_ok=True)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["MW_ROUTES"])
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK + "/packs")

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


def load_old(name, src):
    mod = types.ModuleType(name)
    mod.__file__ = "/app/" + name + ".py"
    sys.modules[name] = mod
    exec(compile(src, mod.__file__, "exec"), mod.__dict__)  # noqa: S102 - the doors as they read the sheets
    return mod


conn = None
try:
    import psycopg

    import app_builder as AB
    import book_ops as BO
    import bundles as BU
    import client_writes as CW
    import drive as DR
    import envelope as EV
    import hubdb
    import locations as L
    import members as MB
    import staff_views
    import sys_log as SL
    import world as WL
    import world_defaults as WD
    import world_import as WI
    import world_store as WS
    import writes as W
    import main as M

    OWO = load_old("world_ops_old", os.environ["MW_OLD_OPS"])
    OWL = load_old("world_old", os.environ["MW_OLD_WORLD"].replace("import world_ops as WO",
                                                                   "import world_ops_old as WO"))

    conn = psycopg.connect(hubdb._dsn())
    cur = conn.cursor()
    cur.execute("set role asa_hub_app_rw")
    # stand-ins, this session alone: My World's tables, app.edits, the receipts
    sql = re.sub(r"--[^\n]*", "", os.environ["MW_SQL"])
    made = re.findall(r"(create (?:table|index) if not exists [^;]+;)", sql)
    for stmt in made:
        cur.execute(stmt.replace("app.", "pg_temp."))
    check("db/world_rows.sql makes five tables", sum(1 for s in made if s.startswith("create table")) == 5)
    for name in ("WORLDS", "TABS", "ROWS", "CHANGES", "IMPORTS"):
        setattr(WS, name, getattr(WS, name).replace("app.", "pg_temp."))
    WS._READY[0] = False
    W.EDITS_TABLE = "pg_temp.mwedits"
    for stmt in W.edits_ddl():
        cur.execute(stmt.replace("create index if not exists ", "create index if not exists mw_"))
    # the book ops beside the stand-in edits: a copy of the live ones, which the sheets' readers lay
    cur.execute(f"create temp table {BO.table().split('.')[-1]} as select * from app.book_ops")
    cur.execute("create temp table mw_receipts (write_id text primary key, action text, answer jsonb)")
    W.LOCK_KEY = 0x7E57AA1
    staff_views.record = lambda *a, **k: None
    SL.keep = lambda *a, **k: None
    SL.void = lambda *a, **k: None

    # what My World must never touch once the tables answer
    touched: list = []

    def refuse(what):
        def no(*a, **k):
            touched.append(what)
            raise RuntimeError(what + " is not My World's any more")
        return no

    BO.queue = refuse("book_ops.queue")
    BO.rows = refuse("book_ops.rows")
    L.Reads.need_drive = refuse("Reads.need_drive")
    for name in ("_send", "_owner_write", "trash"):
        if hasattr(DR.Drive, name):
            setattr(DR.Drive, name, refuse("Drive." + name))
    real_rows, real_ops = hubdb.HubDb.rows, AB._ops
    world_books: set = set()
    REG_BOOK = M.DB.resolve("user_worlds").sheet_id
    sheet_reads: list = []

    def rows_spy(self, ref):
        if ref.sheet_id in world_books or (ref.sheet_id == REG_BOOK and ref.tab == "user_worlds"):
            sheet_reads.append((ref.sheet_id, ref.tab))
        return real_rows(self, ref)

    def ops_spy(reads):
        sheet_reads.append(("book_ops", ""))
        return real_ops(reads)

    hubdb.HubDb.rows = rows_spy

    def own():
        return CW.Own([], book=M.DB.book, edits=W.Tx(cur).edits(), edits_at=time.time())

    M._own = own
    M._own_locked = lambda tx: CW.Own([], book=M.DB.book, edits=tx.edits(), edits_at=time.time())

    class TempTx(W.Tx):
        def receipt(self, write_id):
            self.cur.execute("select answer from pg_temp.mw_receipts where write_id = %s", (write_id,))
            got = self.cur.fetchone()
            return got[0] if got else None

        def live(self):
            return []

        def record(self, write_id, action, env, decision, author):
            self.cur.execute("insert into pg_temp.mw_receipts values (%s, %s, %s::jsonb) on conflict do nothing",
                             (write_id, action, json.dumps(env)))

    class TempStore:
        available, why, kind = True, "", "my_world"

        def ready(self):
            return True

        def conn(self):
            return conn

        def finish(self, done):
            pass

        def live(self):
            return []

        def edits(self):
            return W.Tx(cur).edits()

        @contextlib.contextmanager
        def locked(self):
            with conn.transaction():
                c = conn.cursor()
                c.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
                token = W.HELD.set(c)
                try:
                    yield TempTx(c, "my_world")
                finally:
                    W.HELD.reset(token)

        def settle(self, write_id, state, why="", fields=None):
            # world_writes.Store.settle's own tail on the stand-ins
            with conn.transaction():
                cur.execute("delete from pg_temp.mw_receipts where write_id = %s", (write_id,))
                WS.void(conn, write_id)
            return True

    M.WORLD_STORE = TempStore()
    check("the stand-in store is the one My World writes through", M.stores()["my-world"] is M.WORLD_STORE)

    def body(r):
        return json.loads(r.body)

    @contextlib.contextmanager
    def on_stand_ins():
        """A read outside a write, through this session (its stand-ins)."""
        token = W.HELD.set(conn.cursor())
        try:
            yield
        finally:
            W.HELD.reset(token)

    def said(uid, role="staff", world="", resource="", asked=""):
        return {"uid": uid, "role": role, "is_master": False,
                "place": {"tenant": "", "member": "", "world": world, "resource": resource}, "asked": asked}

    def read(action, uid, payload=None, **kw):
        with on_stand_ins():
            return body(M._run(M.APPS["my-world"], action, said(uid, **kw), payload or {}))

    n_write = [0]

    def write(action, uid, payload=None, wid="", **kw):
        n_write[0] += 1
        wid = wid or f"Wmwtest{os.getpid()}{n_write[0]:05d}"
        return body(M._run_write(M.WRITES["my-world"], action, said(uid, **kw), payload or {}, wid)), wid

    def service_write(action, payload, wid):
        return body(M._run_write(M.WRITES["my-world"], action, {"is_service": True}, payload, wid))

    # ---- the accounts, laid as kept edits on the stand-in ----
    reads0 = L.Reads(M.DB)
    res = W.tab_of(reads0, "users")
    usid, utab = W.where_of(res)
    heads = {hubdb.norm_key(h): h for h in res.ref.headers}
    U = {k: f"USR_MWT{k.upper()}0001" for k in ("alice", "bob", "carol")}

    def add_user(uid, email, name, role):
        cells = {heads["userid"]: uid, heads["email"]: email, heads["displayname"]: name, heads["role"]: role,
                 heads["active"]: "true", heads["lastlogin"]: "2026-01-01T00:00:00.000Z", heads["mustchange"]: ""}
        rec = W.kept_record(usid, utab, "append", W.COLS + heads["userid"], uid, "test", cells)
        cur.executemany(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                        " keyed_by, row_key, field, value, before, author, edition)"
                        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        W.edit_rows("Wmwtestusers01", "test", "test", W.final({"status": 200}, [rec], "test"), "test"))

    add_user(U["alice"], "mw-alice@example.org", "MW Alice", "staff")
    add_user(U["bob"], "mw-bob@example.org", "MW Bob", "onboarding")
    add_user(U["carol"], "mw-carol@example.org", "MW Carol", "client")
    EV.world_withheld = lambda reads, caller: False

    # ---- before the import: no door answers ----
    r = read("worldGet", U["alice"])
    check("before the import the registry is not Postgres's yet: no world door answers, none is made",
          "defer" in r and WS.NOT_YET in r["defer"], r)

    # ---- the import: one world, then the rest, then nothing ----
    registry = M.DB.sheetdb_rows(M.DB.resolve("user_worlds").ref)
    worlds = [(str(w["world_id"]), str(w["spreadsheet_id"]), str(w["owner_user_id"]), str(w["owner_email"]))
              for w in registry]
    world_books |= {sid for _w, sid, _o, _e in worlds}
    # the copy of one real world first: a test account's, furnished with the defaults alone
    one = next((w for w, r in zip(worlds, registry) if "test user" in str(r.get("name")).lower()), worlds[0])
    r = service_write(WI.ACTION, {"world": one[0]}, "Wmwimport0001")
    if r.get("status") != 200:
        raise RuntimeError(f"the import did not answer: {r}")
    check("the import of one world copies it alone and leaves the registry unmarked",
          r["status"] == 200 and r["data"]["copied"] == [one[0]] and r["data"]["ready"] is False
          and r["data"]["tabs"] > 0 and r["data"]["rows"] > 0, r)
    r = write("worldEnsure", U["alice"])[0]
    check("still no door answers while the registry is unmarked", "defer" in r and WS.NOT_YET in r["defer"], r)
    started = time.time()
    r = service_write(WI.ACTION, {}, "Wmwimport0002")
    took = time.time() - started
    out["import_took_s"] = round(took, 2)
    out["import_counts"] = {k: (len(v) if isinstance(v, list) else v) for k, v in r.get("data", {}).items()}
    check("the full import copies every other world, keeps the one already here, and marks the registry",
          r["status"] == 200 and sorted(r["data"]["copied"] + r["data"]["kept"]) == sorted(w[0] for w in worlds)
          and r["data"]["kept"] == [one[0]] and not r["data"]["skipped"] and r["data"]["ready"] is True, r)
    check("inside a write's budget", took < M.WRITE_BUDGET_S, took)
    cur.execute(f"select count(*) from {WS.WORLDS}")
    n_worlds = cur.fetchone()[0]
    cur.execute(f"select count(*) from {WS.ROWS}")
    n_rows = cur.fetchone()[0]
    r = service_write(WI.ACTION, {}, "Wmwimport0003")
    cur.execute(f"select count(*) from {WS.WORLDS}")
    again_worlds = cur.fetchone()[0]
    cur.execute(f"select count(*) from {WS.ROWS}")
    check("a second run adds nothing", r["data"]["copied"] == [] and again_worlds == n_worlds == len(worlds)
          and cur.fetchone()[0] == n_rows and r["data"]["ready"] is True, r)
    r = body(M._run_write(M.WRITES["my-world"], WI.ACTION, said(U["alice"]), {}, "Wmwimport0004"))
    check("the import is the relay's alone", r == {"status": 403, "message": "The import is the relay's alone."}, r)

    # ---- every world as the sheets served it, door by door ----
    def owner(uid, email, world="", book="", resource=""):
        place = {"tenant_id": "", "member_id": "", "world_id": world, "resource": resource}
        if book:
            place["world_book"] = book
        return {"id": uid, "role": "staff", "email": email, "display_name": "", "is_service": False, "place": place}

    differ: list = []
    compared = {"worlds": 0, "tabs": 0, "gets": 0}
    AB._ops = ops_spy
    with on_stand_ins():
        for wid, sid, uid, email in worlds:
            reads = L.Reads(M.DB)
            old = OWL.world_get(L.Session(reads, owner(uid, email)), {})
            new = WL.world_get(L.Session(reads, owner(uid, email)), {})
            if old["data"]["world"] is None or new != {**old, "data": {"world": {**old["data"]["world"],
                                                                                    "spreadsheet_id": ""}}}:
                differ.append(("worldGet", wid, old, new))
            old = OWL.apps_list(L.Session(reads, owner(uid, email)), {})
            new = WL.apps_list(L.Session(reads, owner(uid, email)), {})
            if old != new:
                differ.append(("worldAppsList", wid))
            book = OWL.Book(reads, sid)
            names = sorted({t for (s, t) in reads.db.catalog()["tabs"] if s == sid}
                           | {t for (s, t) in real_ops(reads) if s == sid})
            for tab in names:
                ov, nv = book.tab(tab), WS.view(reads, wid, tab)
                if (ov.exists, ov.header, ov.rows) != (nv.exists, nv.header, nv.rows):
                    differ.append(("view", wid, tab))
                for p in ({}, {"q": "a", "offset": "1", "limit": "3"}, {"limit": "0"}):
                    o = OWL.rows_list(L.Session(reads, owner(uid, email, wid, sid, tab)), p)
                    n = WL.rows_list(L.Session(reads, owner(uid, email, wid, "", tab)), p)
                    if o != n:
                        differ.append(("worldRowsList", wid, tab, p))
                ids = [AB.value(r.get("id")) for r in ov.rows if "id" in ov.header][:2] + ["no-such-id"]
                for rid in ids:
                    o = OWL.row_get(L.Session(reads, owner(uid, email, wid, sid, tab)), {"id": rid})
                    n = WL.row_get(L.Session(reads, owner(uid, email, wid, "", tab)), {"id": rid})
                    compared["gets"] += 1
                    if o != n:
                        differ.append(("worldRowGet", wid, tab, rid))
                compared["tabs"] += 1
            old_bundle = {t: AB.read_all(v) for t in names for v in [book.tab(t)] if v.exists}
            new_bundle = BU.read_world(reads, wid, {})
            if json.dumps(old_bundle, default=str) != json.dumps(new_bundle["resources"], default=str) \
                    or new_bundle["unreadable"]:
                differ.append(("bundle", wid))
            compared["worlds"] += 1
    AB._ops = real_ops
    out["compared"] = compared
    check("every world, every tab, every list, get, app list and bundle answers as the sheets answered (the world "
          "names no spreadsheet)", not differ and compared["worlds"] == len(worlds), differ[:6])

    # ---- from here on, nothing of the sheets ----
    touched.clear()
    sheet_reads.clear()
    AB._ops = ops_spy
    # every change a door lays, beside the sheets' readers' twin of it (book_ops.rows_lay)
    laid: list = []
    real_lay = WS.lay

    def lay_spy(st, spec):
        got = real_lay(st, spec)
        laid.append((st.view, spec, got.view, st.keys, got.keys))
        return got

    WS.lay = lay_spy

    # ---- worldEnsure: refused, made, there already ----
    r = write("worldEnsure", U["bob"], role="onboarding")[0]
    check("an account worlds are not for is refused in World.gs's words",
          r == {"status": 403, "message": "This action is for admin or manager or staff or client."}, r)
    r = read("worldGet", U["alice"])
    check("worldGet before the world is made: none", r == {"status": 200, "data": {"world": None}}, r)
    r, ensure_wid = write("worldEnsure", U["alice"])
    w = (r.get("data") or {}).get("world") or {}
    check("worldEnsure makes the world in Postgres: its registry row and its defaults, final",
          r["status"] == 200 and r["data"]["created"] is True and r["_write"]["final"] is True
          and set(w) == {"world_id", "name", "spreadsheet_id", "created_at"} and w["spreadsheet_id"] == ""
          and w["name"] == "ASA World — MW Alice" and re.fullmatch(r"wld_[0-9a-f]{12}", w["world_id"]), r)
    alice_wid = w.get("world_id", "")
    cur.execute(f"select tab, count(*) from {WS.ROWS} where world_id = %s group by tab", (alice_wid,))
    alice_tabs = dict(cur.fetchall())
    cur.execute(f"select defaults_version, owner_user_id from {WS.WORLDS} where world_id = %s", (alice_wid,))
    check("its defaults seeded in the same write, the registry stamped with this version",
          cur.fetchone() == (WD.VERSION, U["alice"]) and alice_tabs.get(WL.APPS_TAB, 0) > 0
          and alice_tabs.get(WD.MARKER_TAB, 0) == len(WD.WORLD_DEFAULT_APPS), alice_tabs)
    r2 = write("worldEnsure", U["alice"])[0]
    check("worldEnsure again: the same world, not made twice",
          r2["status"] == 200 and r2["data"] == {"world": w, "created": False} and "_write" not in r2, r2)
    check("worldGet names it", read("worldGet", U["alice"]) == {"status": 200, "data": {"world": w}})
    seeded_apps = read("worldAppsList", U["alice"])
    ref_uid = next((uid for wid, sid, uid, email in worlds if wid == one[0]), "")
    with on_stand_ins():
        ref_apps = WL.apps_list(L.Session(L.Reads(M.DB), owner(ref_uid, "")), {})
    check("a world made here lists its apps as a world the sheets furnished with the same defaults lists them",
          seeded_apps["status"] == 200 and {**seeded_apps["data"], "world": ""} == {**ref_apps["data"], "world": ""},
          (seeded_apps.get("data", {}).get("defaults"), ref_apps.get("data", {}).get("defaults")))

    # ---- apps: publish, remove, furnish, install by hand ----
    app = {"id": "mw-tracker", "name": "MW Tracker", "audience": ["staff", "nobody"],
           "pages": [{"id": "main", "type": "sheet", "resource": "mwTracker", "columns": "day:Day|what:What",
                      "rows": [{"day": "2026-01-02", "what": "walk"}, {"id": "x9", "what": "run"}]}]}
    r = write("worldAppUpsert", U["alice"], {"app": app})[0]
    check("worldAppUpsert publishes the app and makes its tab, seeded on birth",
          r["status"] == 200 and r["data"] == {"id": "mw-tracker", "pages": 1, "warnings": [],
                                               "tabs": [{"resource": "mwTracker", "state": "created", "seeded": 2}]}
          and r["_write"]["final"] is True, r)
    apps = read("worldAppsList", U["alice"])["data"]["apps"]
    mine = next((a for a in apps if a["id"] == "mw-tracker"), None)
    check("the world lists it", mine is not None and mine["audience"] == ["staff"]
          and mine["pages"][0]["dataSource"] == {"resource": "mwTracker"}, mine)
    rows = read("worldRowsList", U["alice"], world=alice_wid, resource="mwTracker", asked="list")
    check("its seed rows are the tab's", rows["status"] == 200 and [x["id"] for x in rows["data"]] == ["row-1", "x9"]
          and rows["data"][0]["day"] == "2026-01-02", rows)
    r = write("worldAppUpsert", U["alice"], {"app": {**app, "name": "MW Tracker 2"}})[0]
    check("published again: its rows swapped, its tab left as it is",
          r["data"]["tabs"] == [{"resource": "mwTracker", "state": "exists", "seeded": 0}]
          and [a["name"] for a in read("worldAppsList", U["alice"])["data"]["apps"] if a["id"] == "mw-tracker"]
          == ["MW Tracker 2"], r)
    r = write("worldAppUpsert", U["alice"], {"app": {**app, "pages": [{"id": "main", "resource": "user_worlds"}]}})[0]
    check("a reserved resource is refused", r == {"status": 400, "message": 'page resource "user_worlds" is reserved.'},
          r)
    r = write("worldAppUpsert", U["alice"], {})[0]
    check("worldAppUpsert's declaration", r == {"status": 400, "message": "Missing required parameter: app."}, r)
    r = write("worldAppDelete", U["alice"], {"app_id": "mw-tracker"})[0]
    check("worldAppDelete takes its rows off world_apps, its tab stays",
          r == {"status": 200, "data": {"id": "mw-tracker", "removed": 1}, "_write": r.get("_write")}
          and read("worldRowsList", U["alice"], world=alice_wid, resource="mwTracker", asked="list")["data"], r)
    first_default = WD.WORLD_DEFAULT_APPS[0]["id"]
    r = write("worldAppDelete", U["alice"], {"app_id": first_default})[0]
    gone = r["data"]["removed"]
    r = write("worldAppsSeedDefaults", U["alice"])[0]
    check("worldAppsSeedDefaults: a default the owner removed stays removed",
          r["status"] == 200 and first_default in r["data"]["skipped"] and first_default not in r["data"]["seeded"]
          and gone > 0, r)
    r = write("worldAppInstallDefault", U["alice"], {"app_id": first_default})[0]
    check("worldAppInstallDefault brings it back by hand",
          r["status"] == 200 and r["data"] == {"id": first_default, "installed": True, "pages": gone}, r)
    r = write("worldAppInstallDefault", U["alice"], {"app_id": first_default})[0]
    check("installed again: already there",
          r["data"] == {"id": first_default, "installed": True, "already": True}, r)
    r = write("worldAppInstallDefault", U["alice"], {"app_id": "no-such"})[0]
    check("a default that does not exist", r == {"status": 404, "message": 'No default app "no-such".'}, r)

    # ---- the generic verbs inside the world ----
    def verb(action, uid, payload, resource="mwNotes", world=None, asked="", role="staff"):
        world = alice_wid if world is None else world
        if action in ("worldRowsList", "worldRowGet"):
            return read(action, uid, payload, world=world, resource=resource, asked=asked, role=role)
        return write(action, uid, payload, world=world, resource=resource, asked=asked, role=role)

    check("a tab the world does not have lists nothing",
          verb("worldRowsList", U["alice"], {}, asked="list") == {"status": 200, "data": []})
    r, made_wid = verb("worldRowCreate", U["alice"], {"title": "first", "n": 3, "tags": ["a", "b"]}, asked="create")
    rid = (r.get("data") or {}).get("id", "")
    check("create makes the tab from the record's keys and stamps it",
          r["status"] == 200 and re.fullmatch(r"[0-9a-f-]{36}", rid) and r["data"]["title"] == "first"
          and r["data"]["createdAt"] == r["data"]["updatedAt"] and r["_write"]["final"] is True, r)
    cur.execute(f"select header from {WS.TABS} where world_id = %s and tab = 'mwNotes'", (alice_wid,))
    check("its header: id, the record's keys, then the stamps",
          cur.fetchone()[0] == ["id", "title", "n", "tags", "createdAt", "updatedAt"])
    r2 = write("worldRowCreate", U["alice"], {"title": "first", "n": 3, "tags": ["a", "b"]}, made_wid,
               world=alice_wid, resource="mwNotes", asked="create")[0]
    cur.execute(f"select count(*) from {WS.ROWS} where world_id = %s and tab = 'mwNotes'", (alice_wid,))
    check("the same write sent again is answered from its receipt, nothing added",
          {**r2, "_write": {**r2["_write"], "replay": False}} == {**r, "_write": {**r["_write"], "replay": False}}
          and r2["_write"].get("replay") is True and cur.fetchone()[0] == 1, r2)
    got = verb("worldRowGet", U["alice"], {"id": rid}, asked="get")
    check("get reads it back as readAll_ does (JSON text parsed, a number a number)",
          got["status"] == 200 and got["data"]["tags"] == ["a", "b"] and got["data"]["n"] == 3, got)
    r = verb("worldRowUpdate", U["alice"], {"id": rid, "title": "second", "createdAt": "x", "extra": True},
             asked="update")[0]
    check("update merges the patch, never createdAt, widens the header",
          r["status"] == 200 and r["data"]["title"] == "second" and r["data"]["extra"] is True
          and r["data"]["createdAt"] == got["data"]["createdAt"], r)
    r = verb("worldRowsList", U["alice"], {"q": "SECOND"}, asked="list")
    check("list filters as listRows_", r["status"] == 200 and [x["id"] for x in r["data"]] == [rid], r)
    r = verb("worldRowUpdate", U["alice"], {"id": "nope", "title": "x"}, asked="update")[0]
    check("update of a row that is not there", r == {"status": 404, "message": 'No "mwNotes" record with id "nope".'}, r)
    r = verb("worldRowDelete", U["alice"], {"id": rid}, asked="delete")[0]
    check("delete takes the row", r == {"status": 200, "data": {"id": rid, "deleted": True}, "_write": r.get("_write")}
          and verb("worldRowGet", U["alice"], {"id": rid}, asked="get")
          == {"status": 404, "message": f'No "mwNotes" record with id "{rid}".'}, r)
    r = verb("worldRowDelete", U["alice"], {}, asked="delete")[0]
    check("delete with no id", r == {"status": 400, "message": 'Missing required "id" in payload.'}, r)
    r = verb("worldRowsList", U["carol"], {}, world=alice_wid, asked="list", role="client")
    check("another account standing in a world not theirs is told it does not exist",
          r == {"status": 404, "message": f'No world "{alice_wid}".'}, r)
    r = verb("worldRowsList", U["alice"], {}, resource="bad-name!", asked="list")
    check("a tab name the world never takes", r == {"status": 404, "message": 'Unknown resource: "bad-name!".'}, r)

    # ---- who has a world, and its bundle ----
    with on_stand_ins():
        reads = L.Reads(M.DB)
        ids = MB.world_ids(reads)
        places = BU.places_door(L.Session(reads, {"is_service": True, "role": "admin", "id": "", "email": ""}), {})
        bundle = BU.read_world(reads, alice_wid, {})
    check("Settings › Platform users reads each owner's world off Postgres", ids.get(U["alice"]) == alice_wid
          and all(ids.get(uid) for _w, _s, uid, _e in worlds), ids)
    check("the bundle lane lists every world with its owner",
          places["data"]["owners"].get(alice_wid) == U["alice"] and alice_wid in places["data"]["worlds"]
          and len(places["data"]["worlds"]) == len(worlds) + 1, places.get("data", {}).get("worlds"))
    check("and reads a world whole off Postgres", "mwNotes" in bundle["resources"] and WL.APPS_TAB in bundle["resources"]
          and list(bundle["resources"]) == sorted(bundle["resources"]) and not bundle["unreadable"])

    # ---- kept from the account ----
    EV.world_withheld = lambda reads, caller: True
    hidden = (read("worldGet", U["alice"]), read("worldAppsList", U["alice"]),
              verb("worldRowsList", U["alice"], {}, asked="list"))
    EV.world_withheld = lambda reads, caller: False
    check("while My World is kept from the account: no world, no apps, its rows a world that does not exist",
          hidden == ({"status": 200, "data": {"world": None}}, WL.DENIED,
                     {"status": 404, "message": f'No world "{alice_wid}".'}), hidden)

    # ---- a void takes a write back ----
    r, vwid = verb("worldRowCreate", U["alice"], {"title": "to void"}, asked="create")
    M.WORLD_STORE.settle(vwid, "void")
    r = verb("worldRowsList", U["alice"], {"q": "to void"}, asked="list")
    check("a voided create leaves no row", r == {"status": 200, "data": []}, r)
    before = read("worldAppsList", U["alice"])
    r, vwid = write("worldAppDelete", U["alice"], {"app_id": first_default})
    between = read("worldAppsList", U["alice"])
    M.WORLD_STORE.settle(vwid, "void")
    after = read("worldAppsList", U["alice"])
    check("a voided delete puts the rows back where they were",
          after == before and first_default in [a["id"] for a in before["data"]["apps"]]
          and first_default not in [a["id"] for a in between["data"]["apps"]],
          ([a["id"] for a in before["data"]["apps"]], [a["id"] for a in after["data"]["apps"]]))
    r, vwid = verb("worldRowUpdate", U["alice"], {"id": "x9", "what": "swim"}, resource="mwTracker", asked="update")
    M.WORLD_STORE.settle(vwid, "void")
    r = verb("worldRowGet", U["alice"], {"id": "x9"}, resource="mwTracker", asked="get")
    check("a voided update puts the cells back", r["status"] == 200 and r["data"]["what"] == "run", r)
    M.WORLD_STORE.settle(ensure_wid, "void")
    cur.execute(f"select count(*) from {WS.WORLDS} where world_id = %s", (alice_wid,))
    left = cur.fetchone()[0]
    cur.execute(f"select count(*) from {WS.ROWS} where world_id = %s", (alice_wid,))
    check("a voided worldEnsure takes the world back with everything in it",
          left == 0 and cur.fetchone()[0] == 0 and read("worldGet", U["alice"]) == {"status": 200,
                                                                                     "data": {"world": None}})

    WS.lay = real_lay
    unlike = [(b.tab, s) for b, s, a, bk, ak in laid
              if (lambda t: (t.exists, t.header, t.rows) != (a.exists, a.header, a.rows))(AB.lay(b, s))
              or len(ak) != len(a.rows) or not set(k for k in ak if k is not None) <= set(bk)]
    kinds = sorted({k for _b, s, _a, _bk, _ak in laid for k in s})
    out["laid"] = {"changes": len(laid), "kinds": kinds}
    check("every change laid as the sheets' readers lay it, each row keeping its id",
          laid and not unlike and {"header", "grow", "seed", "drop", "update", "append", "unique"} <= set(kinds),
          unlike[:3])
    check("no Drive call and no book op, ever", not touched, touched)
    check("no world's sheet, no registry sheet and no book op read by any door", not sheet_reads, sheet_reads[:5])
except Exception:  # noqa: BLE001 - said below with the checks made so far
    import traceback

    out["error"] = traceback.format_exc()[-3000:]
    fails.append("error")
finally:
    try:
        if conn is not None:
            conn.rollback()
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    for name in ("routes.json",):
        try:
            os.unlink(f"{WORK}/{name}")
        except OSError:
            pass
    for d in (WORK + "/packs", WORK):
        try:
            os.rmdir(d)
        except OSError:
            pass

print(json.dumps(out, indent=1, default=str))
print(f"{sum(1 for v in out.values() if v == 'ok')} ok, {len(fails)} failed: {fails}")
