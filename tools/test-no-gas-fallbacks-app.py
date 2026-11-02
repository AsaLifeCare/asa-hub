"""The last paths that handed work to Apps Script, closed in asa-hub-app: run in-process with the app's own modules and
asa-hub-db read live, every write on stand-ins of this session alone (pg_temp), rolled back at the end. A client's and
a guardian's login made by Python at the front door (its row, its default password, its words); a finance receipt past
100 KB kept by its preread at the front door before its write, and a preread's refusal said; My Family for an account
homed at headquarters read by Python, one standing elsewhere refused with doPost's own 404; a place's profile on two
alike rows written to the first; a sign-in queuing nothing for the Sessions tab, its endings and slides asking nothing
of Apps Script, a session carried over from the sheet judged by Python alone; the platform's own checks on Python's
health door. Nothing is written to a live table and nothing reaches the relay.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-no-gas-fallbacks-app.py "$RUNNER/test_no_gas_fallbacks_app.py"
    E=$(python3 -c 'import json;print(json.dumps({"FD_AUTH_SQL":open("db/auth.sql").read(),
        "FD_ROUTES":open("app/front_door_routes.json").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_no_gas_fallbacks_app.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import base64  # noqa: E402
import contextlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import urllib.parse  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from pathlib import Path  # noqa: E402


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
WORK = f"/tmp/ngf-test-{os.getpid()}"
os.makedirs(WORK + "/packs", exist_ok=True)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
with open(WORK + "/manifest.json", "w") as fh:
    json.dump({"resources": []}, fh)
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK + "/packs",
                  HUB_SNAPSHOT_MANIFEST=WORK + "/manifest.json", HUB_FIRST_USER_PASSWORD="ngf-default-pw-1")

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

    import account_profile as AP
    import account_profile_writes as APW
    import auth as A
    import auth_doors as AD
    import auth_store as AS
    import book_ops as BO
    import client_writes as CW
    import clients as C
    import finance as FIN
    import hubdb
    import locations as L
    import resolver_doors as RD
    import smart_comms as SC
    import staff_views
    import sys_log as SL
    import writes as W
    import main as M
    import front_door as FD

    conn = psycopg.connect(hubdb._dsn())
    cur = conn.cursor()
    cur.execute("set role asa_hub_app_rw")
    W.EDITS_TABLE = "pg_temp.ngfedits"
    BO.CHANNEL = "ngf_test_book_ops"
    for stmt in W.edits_ddl() + BO.ddl():
        cur.execute(stmt.replace("create index if not exists ", "create index if not exists ngf_"))
    cur.execute("create temp sequence ngf_outbox_seq")
    cur.execute("create temp table ngf_outbox (like app.smart_comms_outbox including all excluding defaults)")
    cur.execute("select column_name, column_default from information_schema.columns where table_schema = 'app'"
                " and table_name = 'smart_comms_outbox' and column_default is not null")
    for col, default in cur.fetchall():
        cur.execute(f"alter table ngf_outbox alter column {col} set default "
                    + ("nextval('ngf_outbox_seq')" if "nextval" in default else default))
    SC.OUTBOX = "pg_temp.ngf_outbox"
    for stmt in re.findall(r"(create (?:table|index) if not exists [^;]+;)", os.environ["FD_AUTH_SQL"]):
        cur.execute(stmt.replace("app.", "pg_temp."))
    for name in ("CREDENTIALS", "SESSIONS", "COUNTS", "TEMPS", "RESET_SPENT", "STATE"):
        setattr(AS, name, getattr(AS, name).replace("app.", "pg_temp."))
    cur.execute("create temp table ngf_receipts (write_id text primary key, action text, answer jsonb)")
    W.LOCK_KEY = 0x7E57AB1
    staff_views.record = lambda *a, **k: None
    SL.keep = lambda *a, **k: None
    SL.void = lambda store, wid: None
    M.AUTH_STORE = AS.Store(connect=lambda: conn)
    M.TOKEN = "ngf-test-token"

    def own():
        return CW.Own([], book=M.DB.book, edits=W.Tx(cur).edits(), edits_at=time.time())

    M._own = own
    M._own_locked = lambda tx: CW.Own([], book=M.DB.book, edits=tx.edits(), edits_at=time.time())

    class TempTx(W.Tx):
        def receipt(self, write_id):
            self.cur.execute("select answer from pg_temp.ngf_receipts where write_id = %s", (write_id,))
            got = self.cur.fetchone()
            return got[0] if got else None

        def live(self):
            return []

        def record(self, write_id, action, env, decision, author):
            self.cur.execute("insert into pg_temp.ngf_receipts values (%s, %s, %s::jsonb) on conflict do nothing",
                             (write_id, action, json.dumps(env)))
            if decision.edits:
                self.cur.executemany(
                    f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                    " keyed_by, row_key, field, value, before, author, edition)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    W.edit_rows(write_id, self.app, action, decision, author))

    class TempStore:
        """One app's store on this run's stand-ins, under the platform's write lock (a key of this run's own)."""
        available, why = True, ""

        def __init__(self, app):
            self.app = self.kind = app

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
                    yield TempTx(c, self.app)
                finally:
                    W.HELD.reset(token)

        def settle(self, write_id, state, why="", fields=None):
            with conn.transaction():
                cur.execute("delete from pg_temp.ngf_receipts where write_id = %s", (write_id,))
                gone = cur.rowcount
                cur.execute(f"delete from {W.EDITS_TABLE} where write_id = %s", (write_id,))
            return bool(gone)

    M.USERS_WRITES_STORE = TempStore("users-writes")
    M.FINANCE_STORE = TempStore("finance")
    M.ACCOUNT_PROFILE_STORE = TempStore("account-profile")
    check("the stand-in stores are the ones the three apps write through",
          M.stores()["users-writes"] is M.USERS_WRITES_STORE and M.stores()["finance"] is M.FINANCE_STORE
          and M.stores()["account-profile"] is M.ACCOUNT_PROFILE_STORE)

    relayed: list = []

    class RelayRes:
        def __init__(self, status, content, headers):
            self.status_code, self.content = status, content
            self.headers = {k.lower(): v for k, v in headers.items()}

    def post_relay(path, body, headers, timeout):
        relayed.append((path, body, headers))
        if path == FD.FINISH_PATH:
            return RelayRes(204, b"", {"X-Hub-Phase": "ready"})
        return RelayRes(200, b'{"status":200,"data":{"by":"relay"}}', {"Content-Type": "application/json"})

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

    def to_relay():
        return [p for p, _b, _h in relayed if p == "/gas"]

    reads = L.Reads(M.DB)
    res = W.tab_of(reads, "users")
    usid, utab = W.where_of(res)
    heads = {hubdb.norm_key(h): h for h in res.ref.headers}
    U = {k: f"USR_NGF{k.upper()}0001" for k in ("fred", "alice", "kin", "away")}

    def add_user(uid, email, name, role="staff", **extra):
        cells = {heads["userid"]: uid, heads["email"]: email, heads["displayname"]: name, heads["role"]: role,
                 heads["active"]: "true", heads["lastlogin"]: "2026-01-01T00:00:00.000Z", heads["mustchange"]: ""}
        cells.update({heads[k]: v for k, v in extra.items()})
        rec = W.kept_record(usid, utab, "append", W.COLS + heads["userid"], uid, "test", cells)
        cur.executemany(f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                        " keyed_by, row_key, field, value, before, author, edition)"
                        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        W.edit_rows("Wngftestusers01", "test", "test", W.final({"status": 200}, [rec], "test"),
                                    "test"))

    add_user(U["fred"], "ngf-fred@example.org", "NGF Fred", role="admin")
    add_user(U["alice"], "ngf-alice@example.org", "NGF Alice")
    for k in ("fred", "alice"):
        AS.password_set(cur, U[k], f"pw-{k}-123", "Wngfseed0001")

    # ---- 6. a sign-in queues nothing for the Sessions tab ----
    r = gas(form("authLogin", {"identifier": "ngf-fred@example.org", "password": "pw-fred-123"}))
    fred = body(r)["data"]["token"]
    alice = body(gas(form("authLogin", {"identifier": "ngf-alice@example.org",
                                        "password": "pw-alice-123"})))["data"]["token"]
    cur.execute(f"select count(*) from {BO.table()} where op = 'rows'")
    rows_ops = cur.fetchone()[0]
    cur.execute(f"select count(*) from {AS.SESSIONS} where twin <> ''")
    twins = cur.fetchone()[0]
    check("6: a sign-in opens its session at the door and queues no row for the Sessions tab",
          fred.startswith("py.") and alice.startswith("py.") and rows_ops == 0 and twins == 0, [rows_ops, twins])
    check("6: the twin's question is no door of the sign-in any more", "_twin" not in AD.DOORS)

    # ---- 1. a client's and a guardian's login, made by Python ----
    route = FD.route({"action": "clientUserCreate", "token": fred}, b"")
    check("1: clientUserCreate is a write answered at the front door, by Users' account doors",
          route == ("write", "clientUserCreate", "users-writes") and "clientUserCreate" not in CW.ACTIONS, route)
    token = hubdb.OWN.set(own())
    try:
        users_now = L.Reads(M.DB).users()
        rows = C.derived(L.Reads(M.DB))
    finally:
        hubdb.OWN.reset(token)

    def login_of(rec, kind):
        s = lambda v: str(v or "").strip()  # noqa: E731
        if kind == "client":
            return s(rec.get("client_email")).lower() or re.sub(r"\D+", "", s(rec.get("client_phone")))
        g = s(rec.get("guardianName")) or s(rec.get("guardian_name"))
        if not g or g.lower() == "self":
            return ""
        return s(rec.get("guardian_email")).lower() or re.sub(r"\D+", "", s(rec.get("guardian_phone")))

    def fresh(kind, made):
        for rec in rows:
            login = login_of(rec, kind)
            known = A.user_by_email(users_now, login) is not None if login else True
            if login and not C._marked(json.dumps(rec, default=str)) and known == made:
                return rec, login
        return None, ""

    def masked(env):
        """An answer as this run prints it: never a person's login."""
        return {"status": env.get("status"), "data": {k: ("<login>" if k == "login" else v)
                                                      for k, v in (env.get("data") or {}).items()},
                "message": re.sub(r'"[^"]*"', '"<login>"', str(env.get("message") or ""))}

    for kind in ("client", "guardian"):
        rec, login = fresh(kind, False)
        if rec is None:
            # every such login made already: the door's own answer for one, by Python
            rec, login = fresh(kind, True)
            if rec is None:
                check(f"1: a {kind} with a login is on the plans", False, "none found")
                continue
            relayed.clear()
            got = body(gas(form("clientUserCreate", {"client_id": str(rec["id"]), "kind": kind}, fred)))
            check(f"1: a {kind} whose login exists is answered by Python (already, or another account's 409)",
                  ((got.get("status") == 200 and (got.get("data") or {}).get("already") is True)
                   or (got.get("status") == 409 and "already belongs to another account" in got.get("message", "")))
                  and not to_relay(), got.get("status"))
            continue
        relayed.clear()
        raw = form("clientUserCreate", {"client_id": str(rec["id"]), "kind": kind}, fred, write_id=f"Wngf{kind}000001")
        r = gas(raw)
        got = body(r)
        uid = (got.get("data") or {}).get("id", "")
        check(f"1: a new {kind} login is made by Python, answered in Apps Script's words",
              got.get("status") == 200 and got["data"].get("login") == login and got["data"].get("kind") == kind
              and got["data"].get("defaulted") is True and re.fullmatch(r"USR_[0-9A-F]{12}", uid)
              and not to_relay(), masked(got))
        cur.execute(f"select field, value from {W.EDITS_TABLE} where write_id = %s", (f"Wngf{kind}000001",))
        cells = dict(cur.fetchall())
        check(f"1: its users row kept as the truth: the login, role client, must change, its client and badge",
              cells.get(heads["email"]) == login and cells.get(heads["role"]) == "client"
              and cells.get(heads["mustchange"]) == "true" and cells.get(heads["clientkey"]) == str(rec["client_key"])
              and cells.get(heads["types"]) == ("GUARDIAN" if kind == "guardian" else "CLIENT"),
              {k: v for k, v in cells.items() if k not in (heads.get("salt"), heads.get("passhash"))})
        cur.execute(f"select salt, pass_hash from {AS.CREDENTIALS} where user_id = %s", (uid,))
        cred = cur.fetchone()
        check(f"1: its default password kept by the sign-in's store, never on the sheet",
              cred is not None and A.hash_password("ngf-default-pw-1", cred[0]) == cred[1]
              and heads.get("passhash") not in cells)
        again = body(gas(form("clientUserCreate", {"client_id": str(rec["id"]), "kind": kind}, fred)))
        check(f"1: the same {kind} twice answers already, as Apps Script did",
              again == {"status": 200, "data": {"already": True, "id": uid, "login": login}}, masked(again))
    r = body(gas(form("clientUserCreate", {"client_id": "CLI_ngf_nobody", "kind": "client"}, fred)))
    check("1: a client no plan holds is its 404", r == {"status": 404, "message": 'No client "CLI_ngf_nobody".'}, r)
    r = body(gas(form("clientUserCreate", {"client_id": "CLI_x", "kind": "client"}, alice)))
    check("1: a staff member is refused in the door's words", r["status"] == 403 and not to_relay(), r)

    # ---- 2. a finance receipt past 100 KB, kept by its preread at the front door ----
    FIN.base = lambda: Path(WORK) / "finance"
    seen: list = []
    real_run, real_write = M._run, M._run_write

    def spy_run(module, action, said, payload, people_at=0.0):
        seen.append(("read", action, payload))
        return real_run(module, action, said, payload, people_at)

    def spy_write(deciding, action, said, payload, write_id, people_at=0.0):
        seen.append(("write", action, payload))
        return real_write(deciding, action, said, payload, write_id, people_at)

    M._run, M._run_write = spy_run, spy_write
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + os.urandom(120_000)).decode()

    def short(trace):
        return [(k, a, {f: (v if f != "receiptBase64" or v == "kept" else f"<{len(v)} chars>") for f, v in p.items()})
                for k, a, p in trace]

    raw = form("finSubmitTransaction", {"client": "NGF Client", "date": "2026-10-01", "type": "ngf-no-such-type",
                                        "amount": 5, "receiptBase64": png, "receiptMime": "image/png",
                                        "receiptFileName": "r.png"}, fred, write_id="Wngfreceipt0001")
    relayed.clear()
    r = gas(raw)
    reads_seen = [s for s in seen if s[0] == "read"]
    writes_seen = [s for s in seen if s[0] == "write"]
    kept = writes_seen[-1][2].get("receiptKept") if writes_seen else None
    check("2: a 160 KB receipt is answered at the front door, never carried to the relay",
          len(raw) > 100_000 and FD.route(FD.read_envelope(raw)[0], raw) == ("write", "finSubmitTransaction",
                                                                             "finance")
          and not to_relay(), [len(raw), to_relay()])
    check("2: its preread keeps the receipt on the server first, the write handed what was kept, not the bytes",
          [s[1] for s in reads_seen] == ["finReceiptRead"] and isinstance(kept, dict)
          and writes_seen[-1][2].get("receiptBase64") == "kept"
          and (Path(WORK) / "finance" / kept["path"]).is_file(), [short(seen), kept])
    check("2: the write's own answer is the person's", body(r)["status"] == 400
          and body(r)["message"].startswith("Type must be one of:"), body(r))
    seen.clear()
    raw = form("finAttachReceipt", {"id": "ngf-no-such-row", "receiptBase64": png, "receiptMime": "image/png"}, fred)
    r = gas(raw)
    check("2: a preread's refusal (no such row) is the person's answer, no write asked, nothing carried",
          body(r)["status"] == 404 and not [s for s in seen if s[0] == "write"] and not to_relay(),
          [body(r), short(seen)])
    seen.clear()
    r = gas(form("finSubmitTransaction", {"client": "x", "date": "2026-10-01", "receiptBase64": "QUJD"}, fred))
    check("2: a receipt sent without its type is its 400, no write asked",
          body(r) == {"status": 400, "message": "No file was sent."} and not [s for s in seen if s[0] == "write"],
          [body(r), short(seen)])
    M._run, M._run_write = real_run, real_write

    # ---- 4. My Family for an account homed at headquarters, and one standing elsewhere ----
    token = hubdb.OWN.set(own())
    try:
        tenants = __import__("envelope").tenants_rows(L.Reads(M.DB))
    finally:
        hubdb.OWN.reset(token)
    hq = next((str(t.get("tenantid")) for t in tenants if t.get("type") == "hq" and t.get("status") != "archived"), "")
    other = next((str(t.get("tenantid")) for t in tenants if str(t.get("tenantid")) != hq), "ten_ngf_elsewhere")
    ward = next((r for r in rows if r.get("client_key")), {})
    add_user(U["kin"], "ngf-kin@example.org", "NGF Kin", role="client", hometenant=hq,
             clientkey=str(ward.get("client_key") or ""), types="GUARDIAN")
    add_user(U["away"], "ngf-away@example.org", "NGF Away", role="client", hometenant=other,
             clientkey=str(ward.get("client_key") or ""))

    def family(uid):
        said = {"uid": uid, "role": "client", "is_master": False,
                "place": {"tenant": "", "member": "", "world": "", "resource": ""}, "asked": "myFamily"}
        resp = M._run(M.APPS["my-family"], "myFamily", said, {"part": "work"})
        return resp.status_code, json.loads(resp.body)

    code, got = family(U["kin"])
    check("4: an account homed at headquarters is read by Python, never deferred",
          bool(hq) and code == 200 and got.get("status") == 200 and got["data"].get("family") is True
          and got["data"].get("part") == "work", [hq, code, str(got)[:300]])
    code, got = family(U["away"])
    check("4: an account standing elsewhere gets doPost's own 404 (myFamily is no place's door), never deferred",
          code == 200 and got == {"status": 404, "message": "Unknown action."}, [code, got])

    # ---- 5. a place's profile on two alike rows: the first, as Apps Script wrote it ----
    ref = hubdb.TabRef("ngf-sheet", AP.PLACE_TAB, "", AP.PLACE_HEADERS, None, 2)
    alike = {"user_id": U["alice"], "place": "ten_x", "display_name": "Old", "title": "T", "avatar": "",
             "updated_at": "2026-01-01T00:00:00.000Z"}
    two = [(2, dict(alike)), (3, dict(alike))]
    real_tab, real_rows = AP.place_tab, M.DB.rows
    AP.place_tab = lambda reads: hubdb.Resolved("ngf-sheet", (AP.PLACE_TAB,), ref, False, True)
    M.DB.rows = lambda r: two if r is ref else real_rows(r)
    try:
        token = hubdb.OWN.set(own())
        try:
            d = APW.keep_place(L.Session(L.Reads(M.DB), {"id": U["alice"]}), U["alice"], "ten_x",
                               {"display_name": "New"})
        finally:
            hubdb.OWN.reset(token)
    finally:
        AP.place_tab, M.DB.rows = real_tab, real_rows
    edit = (d.edits or [{}])[0]
    check("5: two alike rows are decided in Python, never handed on",
          not d.engine and d.answer and d.answer.get("status") == 200 and edit.get("kind") == "edit"
          and edit.get("match") == "cols:user_id|place" and edit.get("row_key") == U["alice"] + "\x1ften_x"
          and edit.get("cells", {}).get("display_name") == "New", [d.engine, d.answer, edit])
    laid = CW.Own([], book=lambda sid: None, edits=W.Tx(cur).edits(), edits_at=time.time())
    laid.edits = {("ngf-sheet", AP.PLACE_TAB): [{"match": edit["match"], "row_key": edit["row_key"],
                                                  "keyed": "header", "appended": False,
                                                  "cells": {"display_name": (1, "New", 1)}}]}
    after = laid.lay_edits(ref, two)
    check("5: the kept edit lays on the first of them, as Apps Script wrote the first",
          after[0][1]["display_name"] == "New" and after[1][1]["display_name"] == "Old", after)
    kinds = {a: FD.route({"action": a, "token": alice}, b"")[:1] for a in ("profileUpdate", "userUpdate", "releaseUser")}
    check("5: the account writes once handed on are answered at the front door now",
          set(kinds.values()) == {("write",)}, kinds)
    relayed.clear()
    r = gas(form("profileUpdate", {"title": "NGF Title"}, alice, write_id="Wngfprofile0001"))
    cur.execute(f"select field, value from {W.EDITS_TABLE} where write_id = 'Wngfprofile0001'")
    kept_cells = dict(cur.fetchall())
    check("5: profileUpdate on the account's own row is kept by Python at the door, never carried",
          body(r)["status"] == 200 and (body(r)["data"]["user"] or {}).get("title") == "NGF Title"
          and kept_cells.get(heads["title"]) == "NGF Title" and not to_relay(), [body(r), kept_cells])

    # ---- 6. a session carried over from the sheet, judged by Python alone; endings and slides ask nothing ----
    sheet_token = "ab" * 24
    stale = datetime.now(timezone.utc) - timedelta(days=2)
    cur.execute(f"insert into {AS.SESSIONS} (token_hash, user_id, created_at, expires_at, last_seen, origin)"
                " values (%s, %s, %s, %s, %s, 'sheet')",
                (A.token_hash(sheet_token), U["alice"], stale, stale + timedelta(days=30), stale))
    FD._SESSIONS.clear()
    s = asyncio.run(FD.session(sheet_token))
    check("6: a session carried over from the sheet is judged by Python", s is not None and s.ok
          and s.uid == U["alice"], s)
    relayed.clear()
    r = gas(form("collectionsList", {}, sheet_token))
    check("6: and reads at the door on it", body(r)["status"] == 200 and not to_relay(), body(r))
    me = json.loads(M._run_auth("authMe", {"token": sheet_token, "payload": {}}).body)
    cur.execute(f"select last_seen from {AS.SESSIONS} where token_hash = %s", (A.token_hash(sheet_token),))
    slid = cur.fetchone()[0] > stale + timedelta(hours=1)
    check("6: authMe slides it in Python and carries no mark for Apps Script", me.get("status") == 200
          and slid and "_slid" not in me and "_also_apps_script" not in me, me)
    bye = json.loads(M._run_auth("authLogout", {"token": sheet_token, "payload": {}}).body)
    check("6: its sign-out ends it in Python and carries no mark for Apps Script",
          bye == {"status": 200, "data": {"ok": True}}, bye)
    FD._SESSIONS.clear()
    relayed.clear()
    r = gas(form("collectionsList", {}, sheet_token))
    check("6: once ended, a read on it is Python's 401 at the door, never carried", body(r) == FD.AUTH_ENDED
          and not to_relay(), body(r))
    r = gas(form("collectionsList", {}, "cd" * 24))
    check("6: a sheet token Python never held is its 401 too", body(r) == FD.AUTH_ENDED and not to_relay(), body(r))
    r = gas(form("collectionsList", {}, ""))
    check("6: no session at all is its 401", body(r) == FD.AUTH_ENDED and not to_relay(), body(r))

    # ---- 7. the platform's own checks on Python's health door ----
    routes = json.loads(os.environ["FD_ROUTES"])
    said = {"uid": U["fred"], "role": "admin", "is_master": False,
            "place": {"tenant": "", "member": "", "world": "", "resource": ""}, "asked": "resolverHealth"}
    relay_maps = {"reads": routes["reads"], "writes": routes["writes"], "switch": {"ngf-left": "apps_script"},
                  "traffic": {"window_s": 60}}
    resp = M._run(M.APPS["resolver"], "resolverHealth", said, {"relay": relay_maps})
    got = json.loads(resp.body)
    ch = (got.get("data") or {}).get("checks") or {}
    check("7: resolverHealth carries the checks the self-test screens draw (ran, failures, failed, live)",
          got.get("status") == 200 and isinstance(ch.get("ran"), int) and ch["ran"] > 1000
          and ch.get("failures") == len(ch.get("failed") or []) and set(ch.get("live") or {}) == {"apps", "doors",
                                                                                                    "routes"},
          {k: (v if k != "failed" else v[:5]) for k, v in ch.items()})
    check("7: an app not on Python is a failed check, in words",
          {"check": "ngf-left is not on Python",
           "detail": "Settings › Back-end does not name Python for it, and nothing else answers it."}
          in (ch.get("failed") or []))
    out["7: (said, not checked) what failed on this run's stand-in maps"] = [f["check"] for f in
                                                                             ch.get("failed") or []][:12]
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
    import shutil

    shutil.rmtree(WORK, ignore_errors=True)

print(json.dumps(out, indent=1, default=str))
print(f"{sum(1 for v in out.values() if v == 'ok')} ok, {len(fails)} failed: {fails}")
