#!/usr/bin/env python3
"""Support Requests decided by the streamed modules on the real board in asa-hub-db-sync: the board read for the
master, a person nobody listed and a person support.requests lists, a verdict kept final with the texts it owes held
in Smart Comms' outbox, and the refusals. Nothing real is written and nothing is sent: the edit store, the outbox and
the arm live in temp tables inside one transaction rolled back at the end, and the transport answers without a
socket. Prints shapes and counts only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, time, types, uuid
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, smart_comms as SC
import support_desk as SD
import support_desk_writes as SDW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_sdk"
W.LOCK_KEY = 0x5344434B
SC.OUTBOX, SC.ARM = "pg_temp.sdk_outbox", "pg_temp.sdk_arm"
SC.DRAIN_LOCK = 0x5344445241
SENT = []
SC.TRANSPORT = lambda *a, **kw: SENT.append(1) or {"ok": False, "error": "the check sends nothing"}


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()

    @property
    def rowcount(self):
        return self.c.rowcount

    @property
    def description(self):
        return self.c.description


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="support-desk-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
if not any(a == "support-desk" for _e, a in sc.EDITIONS):
    sc.EDITIONS = tuple(sc.EDITIONS) + (("support.requests", "support-desk"), ("support.settings", "support-desk"))
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
HOLDER = {"id": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    if user and HOLDER["id"] and gsjs.str_(user.get("id")) == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.stores = lambda: {"support-desk": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    res = M._run(SD, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-sdk-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(SDW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, row_key, field, edition from pg_temp.hub_edits_sdk"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def owed(wid):
    with real.cursor() as c:
        c.execute(f"select state, coalesce(held_by, '') from {SC.OUTBOX} where write_id = %s", (wid,))
        return c.fetchall()


def final(env):
    return (env.get("_write") or {}).get("final") is True


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
directors = {d["uid"] for d in SD.directors_(reads0)["list"]}
staff = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("userid")) not in directors
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
facts["directors on the copy"] = str(len(directors))
check("a staff account who is not a director is read from the users tab", bool(staff))


def board(who, **payload):
    code, env = read("supportDeskList", who, payload)
    d = env.get("data") or {}
    return code, env, d.get("rows") or [], d.get("viewer") or {}


def reads_doors():
    code, env, rows, viewer = board(MASTER)
    facts["the master's open board"] = f"{len(rows)} rows ({sum(1 for r in rows if r.get('source') == 'scheduling')} "\
                                       "from Scheduling)"
    check("the master reads the board: 200, and decides", code == 200 and env.get("status") == 200 and
          viewer.get("can_decide") is True, env.get("message"))
    code, env, srows, sviewer = board(STAFF)
    check("a staff member nobody listed decides nothing", not sviewer.get("can_decide") and
          not any((r.get("may") or {}).get("approve") for r in srows), (env.get("status"), sviewer))
    HOLDER["id"] = STAFF["uid"]
    EDITIONS["value"] = json.dumps([{"id": "support.requests", "on": True, "people": [STAFF["uid"]]}])
    code, env, erows, eviewer = board(STAFF)
    check("a staff member support.requests lists decides as the directors do, on the rows they see",
          eviewer.get("can_decide") is True and len(erows) == len(rows), (len(erows), len(rows), eviewer))
    check("and is offered the same answers on the requests (Scheduling's stay Scheduling's)",
          [bool((r.get("may") or {}).get("approve")) for r in erows if r.get("source") != "scheduling"] ==
          [bool((r.get("may") or {}).get("approve")) for r in rows if r.get("source") != "scheduling"])
    EDITIONS["value"], HOLDER["id"] = "[]", ""
    code, env = read("supportDeskSeat", MASTER, {"ref": "not-a-ref"})
    check("a seat read with a ref that is none answers in its own words", env.get("status") in (400, 403, 404), env)
    return rows


def write_doors(rows):
    pick = next((r for r in rows if r.get("source") != "scheduling" and (r.get("may") or {}).get("approve")), None)
    facts["a request the master may approve"] = "found" if pick else "none open"
    code, env, _ = write("supportDeskDecide", STAFF, {"ref": (pick or {}).get("ref", "SQ0000000000"),
                                                       "verdict": "approve"})
    check("a staff member nobody listed is refused a verdict", env.get("status") in (403, 404), env)
    code, env, _ = write("supportDeskDecide", MASTER, {"ref": "", "verdict": "approve"})
    check("no ref is refused", env == {"status": 400, "message": "Which request? The ref is missing."}, env)
    code, env, _ = write("supportDeskDecide", MASTER, {"ref": "SQ0000000000", "verdict": "maybe"})
    check("a word that is no verdict is refused",
          env == {"status": 400, "message": "Answer with approve, deny, resolve, redirect or aware."}, env)
    code, env, _ = write("supportDeskSettingsSet", MASTER, {"values": {}})
    check("a settings save naming nothing is refused", env.get("status") == 400, env)
    if pick:
        code, env, wid = write("supportDeskDecide", MASTER, {"ref": pick["ref"], "verdict": "approve",
                                                              "note": "Check — approved"})
        got, texts = kept(wid), owed(wid)
        facts["the verdict's kept cells / texts it raised"] = f"{len(got)} / {len(texts)}"
        check("the master approves a request: 200, final, kept in app.edits",
              env.get("status") == 200 and final(env) and bool(got), env)
        check("every text it raised waits in the outbox, held, and nothing was sent",
              all(state != "sent" for state, _h in texts) and not SENT, (texts, len(SENT)))
        code, env, _ = write("supportDeskDecide", MASTER, {"ref": pick["ref"], "verdict": "deny"})
        check("another verdict on the decided request meets the one-verdict law (409)", env.get("status") == 409, env)


try:
    with real.transaction():
        store.ensure()
        why = SC.ensure(proxy)
        M.SMART_COMMS_READY[0] = not why
        check("the edit store and Smart Comms' outbox are made in temp tables", store.ready() and not why,
              store.why or why)
        rows = []
        if staff:
            try:
                with real.transaction():
                    rows = reads_doors()
            except Exception as exc:  # noqa: BLE001 - said as a failed check
                check("reads: ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
            try:
                with real.transaction():
                    write_doors(rows)
            except Exception as exc:  # noqa: BLE001 - said as a failed check
                check("writes: ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("support_desk.py", "support_desk_writes.py", "main.py", "editions.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "edit_overlay.py"), doraise=True)
    print("ok   the Support Requests modules, main, the catalogue and the relay compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"{len(res['checks']) + 1 - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
