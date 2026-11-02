"""asa-hub-app's front door (app/front_door.py) run in-process with the app's own modules and asa-hub-db read live,
every write on stand-ins of this session alone (pg_temp): the sign-in answered at the door, its session gate on
Python's own verdict (a staff member, the master, a session minted from the master's own), the identity and place
each door is told and the account it settles to, a real read and a real write dispatched with their receipts, replays
and voids, who-reads-what's settling, the slice gate, the relay as the fallback (its /gas and its finish stood in
for), and uploads read whole. Nothing is written to a live table and nothing reaches the relay.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    python3 -c 'import sys; open(sys.argv[1], "w").write("import os\nos.environ[\"OL_TABLES\"] = %r\n"
        "os.environ[\"HUB_IST_CONFIG_DECLARATION_JSON\"] = %r\n" % (open("app/other_lanes.json").read(),
        open("app/ist_config_defaults.json").read()) + open("tools/test-front-door-app.py").read())' \
        "$RUNNER/test_front_door_app.py"
    E=$(python3 -c 'import json;print(json.dumps({"FD_AUTH_SQL":open("db/auth.sql").read(),
        "FD_ROUTES":open("app/front_door_routes.json").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_front_door_app.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import contextlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import urllib.parse  # noqa: E402


class _App:
    """FastAPI's surface main.py touches at import: every decorator hands the function back."""

    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        def deco(*a, **k):
            return lambda f: f
        return deco


class _Resp:
    """Starlette's Response and JSONResponse as main.py builds them: the body rendered to bytes."""

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
# the routes beside the door as the app container holds them; the relay's files in a folder of this run alone
WORK = f"/tmp/fd-test-{os.getpid()}"
os.makedirs(WORK + "/packs", exist_ok=True)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
with open(WORK + "/other_lanes.json", "w") as fh:
    fh.write(os.environ["OL_TABLES"])
with open(WORK + "/manifest.json", "w") as fh:
    json.dump({"resources": [{"resource": "clients", "roles": ["admin", "manager"]},
                             {"resource": "notices", "roles": ["staff", "admin"]}]}, fh)
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK + "/packs",
                  HUB_SNAPSHOT_MANIFEST=WORK + "/manifest.json", HUB_OTHER_LANES=WORK + "/other_lanes.json")

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


class Req:
    def __init__(self, raw=b"", headers=None):
        self._raw, self.headers = raw, {k.lower(): v for k, v in (headers or {}).items()}

    async def body(self):
        return self._raw


def form(action, payload, token="", **extra):
    return urllib.parse.urlencode({"body": json.dumps({"token": token, "action": action, "payload": payload,
                                                       **extra})}).encode()


try:
    import psycopg

    import auth as A
    import auth_store as AS
    import book_ops as BO
    import client_writes as CW
    import hubdb
    import locations as L
    import scope as sc
    import smart_comms as SC
    import staff_views
    import sys_log as SL
    import writes as W
    import main as M
    import front_door as FD

    conn = psycopg.connect(hubdb._dsn())
    cur = conn.cursor()
    cur.execute("set role asa_hub_app_rw")
    # stand-ins, this session alone: app.edits and the book ops beside it, the outbox, db/auth.sql's tables, receipts
    W.EDITS_TABLE = "pg_temp.fdedits"
    BO.CHANNEL = "fd_test_book_ops"
    for stmt in W.edits_ddl() + BO.ddl():
        cur.execute(stmt.replace("create index if not exists ", "create index if not exists fd_"))
    cur.execute("create temp sequence fd_outbox_seq")
    cur.execute("create temp table fd_outbox (like app.smart_comms_outbox including all excluding defaults)")
    cur.execute("select column_name, column_default from information_schema.columns where table_schema = 'app'"
                " and table_name = 'smart_comms_outbox' and column_default is not null")
    for col, default in cur.fetchall():
        cur.execute(f"alter table fd_outbox alter column {col} set default "
                    + ("nextval('fd_outbox_seq')" if "nextval" in default else default))
    SC.OUTBOX = "pg_temp.fd_outbox"
    for stmt in re.findall(r"(create (?:table|index) if not exists [^;]+;)", os.environ["FD_AUTH_SQL"]):
        cur.execute(stmt.replace("app.", "pg_temp."))
    for name in ("CREDENTIALS", "SESSIONS", "COUNTS", "TEMPS", "RESET_SPENT", "STATE"):
        setattr(AS, name, getattr(AS, name).replace("app.", "pg_temp."))
    cur.execute("create temp table fd_receipts (write_id text primary key, action text, answer jsonb)")
    W.LOCK_KEY = 0x7E57FD0
    # no line of any kind is kept by this run
    staff_views.record = lambda *a, **k: None
    SL.keep = lambda *a, **k: None
    voided_lines: list = []
    SL.void = lambda store, wid: voided_lines.append(wid)
    MASTER = "fd-master@example.org"
    sc.MASTER_ACCOUNT = MASTER
    FD.MASTER_ACCOUNT = MASTER
    M.AUTH_STORE = AS.Store(connect=lambda: conn)
    M.TOKEN = "fd-test-token"
    # the door's own finish, asked of the relay; the live plane's in-process one is tools/test-live-plane.py's
    FD.FINISH = None

    def own():
        return CW.Own([], book=M.DB.book, edits=W.Tx(cur).edits(), edits_at=time.time())

    M._own = own
    M._own_locked = lambda tx: CW.Own([], book=M.DB.book, edits=tx.edits(), edits_at=time.time())

    class TempTx(W.Tx):
        """W.Tx with its receipts in this run's stand-in."""

        def receipt(self, write_id):
            self.cur.execute("select answer from pg_temp.fd_receipts where write_id = %s", (write_id,))
            got = self.cur.fetchone()
            return got[0] if got else None

        def live(self):
            return []

        def record(self, write_id, action, env, decision, author):
            self.cur.execute("insert into pg_temp.fd_receipts values (%s, %s, %s::jsonb) on conflict do nothing",
                             (write_id, action, json.dumps(env)))
            if decision.edits:
                self.cur.executemany(
                    f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                    " keyed_by, row_key, field, value, before, author, edition)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    W.edit_rows(write_id, self.app, action, decision, author))

    class TempStore:
        """The prefs store on this run's stand-ins, under the platform's write lock (a key of this run's own)."""
        available, why, kind = True, "", "prefs"

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
                    yield TempTx(c, "prefs")
                finally:
                    W.HELD.reset(token)

        def settle(self, write_id, state, why="", fields=None):
            with conn.transaction():
                cur.execute("delete from pg_temp.fd_receipts where write_id = %s", (write_id,))
                gone = cur.rowcount
                cur.execute(f"delete from {W.EDITS_TABLE} where write_id = %s", (write_id,))
            return bool(gone)

    M.PREFS_STORE = TempStore()
    check("the stand-in store is the one prefs writes through", M.stores()["prefs"] is M.PREFS_STORE)

    # the relay stood in for: its /gas and its finish recorded, never asked
    relayed: list = []

    class RelayRes:
        def __init__(self, status, content, headers):
            self.status_code, self.content = status, content
            self.headers = {k.lower(): v for k, v in headers.items()}

    def post_relay(path, body, headers, timeout):
        relayed.append((path, body, headers))
        if path == FD.FINISH_PATH:
            return RelayRes(204, b"", {"X-Hub-Phase": "ready"})
        return RelayRes(200, b'{"status":200,"data":{"by":"relay"}}', {"Content-Type": "application/json",
                                                                       "X-Hub-Phase": "ready"})

    FD.post_relay = post_relay

    def gas(raw, headers=None):
        async def go():
            r = await FD.gas(Req(raw, headers))
            pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            if pending:
                await asyncio.gather(*pending)
            return r
        return asyncio.run(go())

    def body(r):
        return json.loads(r.body)

    def finished():
        return [json.loads(b[16:16 + int.from_bytes(b[:8], "big")]) for p, b, _h in relayed if p == FD.FINISH_PATH]

    # every door the door answers here is one main.py answers
    missing = [(d, a) for d, a in FD.READS.items() if d in FD.HERE_READS
               and not (a in M.APPS and (d in M.APPS[a].ACTIONS or (a in M.WRITES and d in M.WRITES[a].ACTIONS)))]
    missing += [(d, a) for d, a in FD.WRITES.items() if d in FD.HERE_WRITES
                and not (a in M.APPS and ((a in M.WRITES and d in M.WRITES[a].ACTIONS) or d in M.APPS[a].ACTIONS))]
    check("every read and write answered here is a door of main.py's own", not missing, missing)
    out["answered_here"] = {"reads": len(FD.HERE_READS), "writes": len(FD.HERE_WRITES), "auth": len(FD.HERE_AUTH)}

    # the accounts, laid as kept edits on the stand-in
    reads = L.Reads(M.DB)
    res = W.tab_of(reads, "users")
    usid, utab = W.where_of(res)
    heads = {hubdb.norm_key(h): h for h in res.ref.headers}
    U = {k: f"USR_FDT{k.upper()}0001" for k in ("alice", "anna", "master", "fred")}

    def add_user(uid, email, name, role="staff"):
        cells = {heads["userid"]: uid, heads["email"]: email, heads["displayname"]: name, heads["role"]: role,
                 heads["active"]: "true", heads["lastlogin"]: "2026-01-01T00:00:00.000Z", heads["mustchange"]: ""}
        rec = W.kept_record(usid, utab, "append", W.COLS + heads["userid"], uid, "test", cells)
        cur.executemany(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                        " keyed_by, row_key, field, value, before, author, edition)"
                        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        W.edit_rows("Wfdtestusers001", "test", "test", W.final({"status": 200}, [rec], "test"),
                                    "test"))

    add_user(U["alice"], "fd-alice@example.org", "FD Alice")
    add_user(U["anna"], "fd-anna@example.org", "FD Anna")
    add_user(U["master"], MASTER, "FD Master", role="admin")
    add_user(U["fred"], "fd-fred@example.org", "FD Fred", role="admin")
    for k in ("alice", "anna", "fred"):
        AS.password_set(cur, U[k], f"pw-{k}-123", "Wfdseed00001")
    salt = A.random_hex(32)
    cur.execute(f"insert into {AS.CREDENTIALS} (user_id, salt, pass_hash, origin) values (%s, %s, %s, 'sheet')",
                (U["master"], salt, A.hash_password("pw-master-123", salt)))
    real_ids = FD.master_account_ids

    def master_ids():
        token = hubdb.OWN.set(own())
        try:
            return real_ids()
        finally:
            hubdb.OWN.reset(token)

    FD.master_account_ids = master_ids

    # ---- the sign-in at the door ----
    r = gas(form("authLogin", {"identifier": " FD-Alice@Example.org ", "password": "pw-alice-123"}),
            {"X-Real-IP": "192.0.2.10"})
    alice = body(r)["data"]["token"]
    check("a sign-in is answered at the door, its session Python's", r.status_code == 200 and alice.startswith("py."))
    fin = finished()[-1]
    check("the relay is told the sign-in's answer to learn from", fin["kind"] == "auth" and fin["action"] == "authLogin"
          and "_slid" not in body(r) and r.headers.get("X-Hub-Phase") == "ready", fin)
    r = gas(form("authLogin", {"identifier": MASTER, "password": "nope"}), {"X-Real-IP": "198.51.100.7"})
    check("a wrong password for the master is the backend's own words", body(r)["status"] == 401, body(r))
    r = gas(form("authLogin", {"identifier": MASTER, "password": "pw-master-123"}), {"X-Real-IP": "192.0.2.10"})
    master = body(r)["data"]["token"]
    check("the master signs in at the door, the master's controls drawn",
          body(r)["data"]["user"].get("is_master") is True and "be_another" in body(r)["data"])
    known = json.load(open(WORK + "/packs/master-sign-in.json"))["known"]
    check("the place the master signed in from is known, keyed, never written down",
          len(known) == 1 and "192.0.2.10" not in json.dumps(known))
    fred = body(gas(form("authLogin", {"identifier": "fd-fred@example.org",
                                       "password": "pw-fred-123"})))["data"]["token"]

    # ---- the session gate ----
    sa, sm, sf = (asyncio.run(FD.session(t)) for t in (alice, master, fred))
    check("Python's verdict: a staff member", sa.ok and sa.uid == U["alice"] and sa.role == "staff" and not sa.master)
    check("Python's verdict: the master", sm.ok and sm.master and sm.uid == U["master"])
    check("Python's verdict: another admin is not the master", sf.ok and sf.role == "admin" and not sf.master)
    check("an unknown token is no session", asyncio.run(FD.session("py." + "0" * 64)).ok is False)
    r = gas(form("beAnotherStart", {"id": U["anna"]}, master))
    child = body(r)["data"]["token"]
    sc_ = asyncio.run(FD.session(child))
    check("a session minted from the master's own: acting, the worn account's name, never the master, held no longer "
          "than it lives", sc_.ok and sc_.acting and sc_.worn == "FD Anna" and sc_.uid == U["anna"] and not sc_.master
          and FD._SESSIONS[child][0] <= sc_.until, sc_)
    r = gas(form("prefsSet", {"x": 1}, child))
    check("its refusals in Apps Script's words, at the door",
          body(r) == {"status": 409, "code": "be_another_refused",
                      "message": "Not while acting as FD Anna: saving their preferences. Press Be Back to do this as "
                                 "yourself."}, body(r))
    r = gas(form("userDelete", {"user_id": U["master"]}, fred))
    check("the master's account is no other admin's to change",
          body(r) == {"status": 404, "message": f'No user "{U["master"]}".'}, body(r))
    r = gas(form("platformMemberAsk", {"email": MASTER.upper()}, fred))
    check("nor to ask onto a platform", body(r)["status"] == 409, body(r))

    # ---- identity and place, and the account each door settles to ----
    seen: list = []
    real_run, real_write = M._run, M._run_write

    def spy_run(module, action, said, payload, people_at=0.0):
        seen.append(("read", action, said, payload, people_at))
        return real_run(module, action, said, payload, people_at)

    def spy_write(deciding, action, said, payload, write_id, people_at=0.0):
        seen.append(("write", action, said, payload, people_at, write_id))
        return real_write(deciding, action, said, payload, write_id, people_at)

    M._run, M._run_write = spy_run, spy_write
    r = gas(form("collectionsList", {}, alice, tenant=" "))
    check("a real read answered here", body(r)["status"] == 200 and isinstance(body(r)["data"]["collections"], list),
          body(r))
    said = seen[-1][2]
    check("the read is told the relay's identity", said == {
        "uid": U["alice"], "role": "staff", "is_master": False,
        "place": {"tenant": "", "member": "", "world": "", "resource": ""}, "asked": "collectionsList"}, said)
    token = hubdb.OWN.set(own())
    try:
        settled = M.caller(said, L.Reads(M.DB, M.DRIVE), "collectionsList", M.APPS["prefs"])
        acted = M.caller(FD.said(sc_, {"action": "collectionsList"}, "collectionsList"), L.Reads(M.DB, M.DRIVE),
                         "collectionsList", M.APPS["prefs"])
    finally:
        hubdb.OWN.reset(token)
    check("which settles to the account signed in", settled["id"] == U["alice"] and not settled.get("acting"))
    check("a switched session settles to the worn account, acting and leaving no line",
          acted["id"] == U["anna"] and acted.get("acting") is True and acted.get("unlogged") is True)
    fin = finished()[-1]
    check("the read is finished by the relay with its copy's age", fin["kind"] == "read" and fin["door"] ==
          "collectionsList" and fin["as_of"] > 0 and "held" in fin, fin)
    r = gas(form("collectionsList", {}, child))
    check("a switched session reads as the worn account", body(r)["status"] == 200 and seen[-1][2]["acting"] is True
          and seen[-1][2]["is_master"] is False)

    # ---- a real write: receipt, replay, void ----
    label = f"FD Test {os.getpid()}"
    raw = form("collectionCreate", {"label": label}, master, write_id="Wfdcollection01")
    relayed.clear()
    r = gas(raw)
    check("a real write answered here, kept on the stand-in", body(r)["status"] == 200
          and body(r)["data"]["collection"]["label"] == label and "_write" not in body(r), body(r))
    cur.execute("select count(*) from pg_temp.fd_receipts where write_id = 'Wfdcollection01'")
    check("its receipt kept under the write id the browser sent", cur.fetchone()[0] == 1)
    cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = 'Wfdcollection01'")
    check("its row kept as the truth (app.edits' stand-in)", cur.fetchone()[0] > 0)
    fin = finished()[-1]
    check("the relay finishes it as _backend_final, its plan and receipt facts with it",
          fin["kind"] == "write" and fin["write_id"] == "Wfdcollection01" and fin["plan"].get("final") is True
          and fin["app_id"] == "prefs" and fin["edits_at"] > 0, fin)
    check("the master's final write is not held by who-reads-what", seen[-1][4] == 0.0)
    relayed.clear()
    again = gas(raw)
    check("sent again, it is answered from its receipt and never finished twice",
          body(again) == body(r) and not finished())
    r = gas(form("collectionCreate", {"label": label + " B"}, master))
    wid = seen[-1][5]
    check("a write id is stamped when the browser sent none", re.fullmatch(r"W[0-9a-f]{24}", wid) is not None, wid)
    FD.settle_void("prefs", wid)
    cur.execute("select count(*) from pg_temp.fd_receipts where write_id = %s", (wid,))
    gone = cur.fetchone()[0] == 0
    cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
    check("a void takes the receipt, the kept row and the log lines back", gone and cur.fetchone()[0] == 0
          and voided_lines == [wid])
    with open(WORK + "/packs/who-reads-what.json", "w") as fh:
        json.dump({"v": 1, "at": time.time()}, fh)
    r = gas(form("collectionCreate", {"label": label + " C"}, fred))
    check("while who reads what settles, another admin's write is Python's own 503",
          seen[-1][4] > 0 and body(r) == M.UNSETTLED_WRITE, body(r))
    r = gas(form("collectionCreate", {"label": label + " D"}, master))
    check("the master's is not", body(r)["status"] == 200, body(r))
    os.unlink(WORK + "/packs/who-reads-what.json")
    r = gas(form("collectionCreate", {"label": label + " E"}, alice))
    check("a staff member is refused by the door in its own words", body(r)["status"] == 403, body(r))
    r = gas(form("collectionCreate", {"label": "x"}, "py." + "1" * 64))
    check("a write on no live session: 503, nothing written", body(r) == FD.UNWRITTEN)

    # ---- the slice gate ----
    def slice_gate(tok, uri):
        return asyncio.run(FD.gate(Req(b"", {"Authorization": f"Bearer {tok}", "X-Original-URI": uri}))).status_code

    check("/auth: a staff member's slice is 200, a manager's is 403", slice_gate(alice, "/snapshot/notices.json") == 200
          and slice_gate(alice, "/snapshot/clients.json") == 403)
    check("/auth: the master reads the manager's slice", slice_gate(master, "/snapshot/clients.json") == 200)
    check("/auth: an unknown session is 401", slice_gate("py." + "2" * 64, "/snapshot/notices.json") == 401)

    # ---- the relay as the fallback ----
    relayed.clear()
    # a relay-first door no rung answers (chat_doors, clocks and gas_rungs answer theirs), else one nobody names
    kept = next((a for a in sorted(FD.RELAY_FIRST) if a not in FD.RUNGS), "noDoorOfAnybody")
    raw = form(kept, {"text": "hi"}, alice)
    r = gas(raw, {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Real-IP": "192.0.2.10"})
    check("a door the relay keeps goes to its /gas unchanged, its answer handed back",
          relayed and relayed[-1][0] == "/gas" and relayed[-1][1] == raw and relayed[-1][2]["X-Real-IP"] == "192.0.2.10"
          and body(r)["data"] == {"by": "relay"})
    relayed.clear()
    gas(form("authLogout", {}, alice))
    check("a sign-out goes to the relay, and every held verdict with it", relayed[-1][0] == "/gas" and not FD._SESSIONS)

    # ---- uploads ----
    relayed.clear()
    big = form("collectionCreate", {"label": label + " F", "pad": "x" * (12 * 1024 * 1024)}, master)
    r = gas(big)
    check(f"a {len(big) // (1024 * 1024)} MB body is read whole and its door answers it here",
          body(r)["status"] == 200 and len(seen[-1][3]["pad"]) == 12 * 1024 * 1024
          and not [p for p, *_ in relayed if p == "/gas"], body(r))
    over = form("collectionCreate", {"label": "x", "pad": "x" * (33 * 1024 * 1024)}, master)
    relayed.clear()
    gas(over)
    check("past doPost's own cap the body goes to the relay unchanged", relayed and relayed[-1][1] == over)
except Exception:  # noqa: BLE001 - said below with the checks made so far
    import traceback

    out["error"] = traceback.format_exc()[-3000:]
    fails.append("error")
finally:
    try:
        conn.rollback()
        conn.close()
    except Exception:  # noqa: BLE001
        pass
    for name in ("routes.json", "other_lanes.json", "manifest.json", "packs/master-sign-in.json",
                 "packs/who-reads-what.json"):
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
