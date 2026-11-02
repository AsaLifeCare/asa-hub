#!/usr/bin/env python3
"""The Decoder lab decided by the streamed modules on the real words book and ledgers in asa-hub-db-sync: the
proposals and the shelf read off the copy, a scan (timed), a proposal approved and one rejected, a paper taught, the
digest keeper's own cells kept on a ledger row (digestKeep), and the refusals. Nothing real is written: the edit store lives in temp tables inside one transaction rolled back at the
end. Prints shapes, counts and seconds only."""
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
import atexit, base64, importlib.abc, importlib.util, json, os, shutil, sys, tempfile, time, types, uuid
BLOB = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = BLOB["src"]
# the tables the modules read beside themselves (front_door_routes.json and the rest), in a folder of this run alone
WORK = tempfile.mkdtemp(prefix="digest-lab-check-")
atexit.register(shutil.rmtree, WORK, True)
for _name, _text in BLOB["files"].items():
    with open(os.path.join(WORK, _name), "w", encoding="utf-8") as _fh:
        _fh.write(_text)
os.makedirs(os.path.join(WORK, "packs"), exist_ok=True)
os.environ.update(HUB_APP_PACK_DIR=os.path.join(WORK, "packs"), HUB_IST_CONFIG_DECLARATION_JSON=BLOB["files"].get(
    "ist_config_defaults.json", ""))


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = os.path.join(WORK, module.__name__ + ".py")
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
    get = post = api_route = middleware = on_event = _route

    def add_middleware(self, *_a, **_kw):
        pass


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
import gsjs, hubdb, scope as sc, locations as L, writes as W
import digest_lab as D
import digest_lab_writes as DW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_dlb"
W.LOCK_KEY = 0x444C42434B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="digest-lab-check")
store = W.Store(connect=lambda: Conn(real), kind="check", label="Check")
db.stale = lambda books: False
M.DB = db
M.stores = lambda: {"digestlab": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    t = time.monotonic()
    res = M._run(D, action, who, payload)
    return res.status_code, json.loads(res.body), round(time.monotonic() - t, 2)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-dlb-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t = time.monotonic()
    res = M._run_write(DW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid, round(time.monotonic() - t, 2)


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, match_by, row_key, field from pg_temp.hub_edits_dlb"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def final(env):
    return (env.get("_write") or {}).get("final") is True


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).lower() != "false"
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
SERVICE = {"is_service": True}
props0 = D.existing(reads0)
facts["copy"] = (f"{len(props0)} proposals, {len(D.known_kinds(reads0))} kinds, "
                 + ", ".join(f"{k} {len(D.ledger_rows(reads0, k))} rows" for k in D.LEDGERS))
check("a staff account and the words book are read from the copy", bool(staff and D.known_kinds(reads0)))


def reads_doors():
    code, env, s = read("digestProposals", MASTER, {})
    check("the master lists the proposals: 200, with the kinds and the categories",
          env.get("status") == 200 and len(env.get("proposals") or []) == min(200, len(props0)) and env.get("kinds")
          and isinstance(env.get("categories"), list), env.get("message"))
    facts["proposals list seconds"] = str(s)
    code, env, s = read("digestShelf", MASTER, {"folder": "· read by the decoder", "limit": 5})
    check("the shelf: 200, its folders, the three special drawers and up to the limit of files",
          env.get("status") == 200 and env.get("folders") and len(env.get("special") or []) == 3 and
          len(env.get("files") or []) <= 5 and env.get("total"), env.get("message"))
    facts["shelf seconds / total filed"] = f"{s} / {env.get('total')}"
    code, env, s = read("digestProposals", STAFF, {})
    lab = D.lab_open(L.Session(L.Reads(db, None), sc.user_from_row(staff)))
    check("a staff member the lab is not open to is refused", lab or env == D.REFUSED, env)


def write_doors():
    code, env, wid, s = write("digestScan", MASTER, {})
    facts["scan seconds / proposed / new"] = f"{s} / {(env.get('scan') or {}).get('proposed')} / " \
                                             f"{(env.get('scan') or {}).get('written')}"
    got = kept(wid)
    check("the master scans: 200, the summary, each new proposal appended in Digest Proposals",
          env.get("status") == 200 and isinstance(env.get("scan"), dict) and
          len({r[4] for r in got}) == (env.get("scan") or {}).get("written") and
          all(r[1] == D.TAB and r[2] == "append" for r in got), env.get("message"))
    check("the scan fits the relay's budget for a final write (7 s)", s < 7.0, s)
    open_ = [p for p in D.existing(L.Reads(db, None)).values() if p.get("status") == "proposed"]
    if open_:
        pid = open_[0]["id"]
        code, env, wid, s = write("digestDecide", MASTER, {"id": pid, "action": "approve"})
        got = kept(wid)
        tabs = {(r[1], r[2]) for r in got}
        check("approving a proposal: 200, final, its kind written in Digest Kinds and the proposal marked",
              env.get("status") == 200 and final(env) and (D.TAB, "edit") in tabs and
              any(t == D.KINDS_TAB for t, _k in tabs) and (env.get("proposal") or {}).get("status") == "approved",
              (env, sorted(tabs)))
        code, env, wid, s = write("digestDecide", MASTER, {"id": pid, "action": "reject"})
        check("deciding it again answers it was already decided, and writes nothing",
              env.get("status") == 200 and env.get("message") == "already approved" and not kept(wid), env)
    code, env, wid, s = write("digestDecide", MASTER, {"id": "no-such", "action": "approve"})
    check("an unknown proposal is 404", env == {"status": 404, "message": "no such proposal"}, env)
    code, env, wid, s = write("digestDecide", MASTER, {"id": "x", "action": "maybe"})
    check("an action that is none is refused",
          env == {"status": 400, "message": "id and action (approve|reject) are required"}, env)
    row = next((r for r in D.ledger_rows(L.Reads(db, None), "client_files") if len(r.get("text") or "") > 200), None)
    if row:
        code, env, wid, s = write("digestTeach", MASTER, {"ledger": "client_files", "row_id": row["id"],
                                                          "kind": "Check Kind"})
        got = kept(wid)
        check("teaching a paper: 200, final, its row sealed (doc_kind + digest_json) in client_files",
              env.get("status") == 200 and final(env) and env.get("filed") == "check_kind" and
              {r[5] for r in got if r[1] == "client_files"} == {"doc_kind", "digest_json"}, (env, got))
        facts["teach seconds"] = str(s)
    code, env, wid, s = write("digestTeach", MASTER, {"ledger": "nope", "row_id": "x", "kind": "k"})
    check("an unknown ledger is refused", env == {"status": 400, "message": "unknown ledger"}, env)

    # the digest keeper's own cells (server/form_digest.py through digestKeep)
    lsid = D.LEDGERS["client_files"][0]
    first = next(((rn, r) for rn, r in D.ledger_raw(L.Reads(db, None), "client_files") if D._text(r.get("id"))), None)
    if first:
        rid, was = D._text(first[1].get("id")), first[1]
        flip = "pending" if D._text(was.get("digest_state")) == "working" else "working"
        code, env, wid, s = write("digestKeep", SERVICE, {"ledger": "client_files", "house": lsid, "rows": [
            {"id": rid, "cells": {"digest_state": flip, "digest_kind": D._text(was.get("digest_kind"))}},
            {"id": "no-such-row", "cells": {"digest_state": "working"}}]})
        got = kept(wid)
        check("the digest keeper's cells: 200, final, only the changed cell kept as an edit on its row in "
              "client_files, a row the record does not hold said missing",
              env.get("status") == 200 and final(env) and [(r[0], r[1], r[4], r[5]) for r in got] ==
              [(lsid, "client_files", rid, "digest_state")]
              and env.get("data") == {"kept": 1, "same": 0, "missing": ["no-such-row"]}, (env, got))
        code, env, wid, s = write("digestKeep", SERVICE, {"ledger": "client_files", "rows": [
            {"id": rid, "cells": {"digest_state": flip}}]})
        check("a cell already holding its value (the kept edit laid) is not kept again",
              env.get("data") == {"kept": 0, "same": 1, "missing": []} and not kept(wid), env)
    code, env, wid, s = write("digestKeep", MASTER, {"ledger": "client_files", "rows": [
        {"id": "x", "cells": {"digest_state": "working"}}]})
    check("digestKeep is the keeper's alone: a person's session is refused, nothing kept",
          env == {"status": 403, "message": "This is the digest keeper's own write."} and not kept(wid), env)
    code, env, wid, s = write("digestKeep", SERVICE, {"ledger": "client_files", "rows": [
        {"id": "x", "cells": {"title": "y"}}]})
    check("a cell the keeper does not write is refused",
          env == {"status": 400, "message": "title is not a cell the keeper writes"}, env)
    code, env, wid, s = write("digestKeep", SERVICE, {"ledger": "client_files", "house": "another-book", "rows": [
        {"id": "x", "cells": {"digest_state": "working"}}]})
    check("a house that is not the ledger's is refused", env.get("status") == 409 and not kept(wid), env)


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        for name, fn in (("reads", reads_doors), ("writes", write_doors)):
            if staff:
                try:
                    with real.transaction():
                        fn()
                except Exception as exc:  # noqa: BLE001 - said as a failed check
                    check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("digest_lab.py", "digest_lab_writes.py", "main.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    print("ok   the Decoder lab modules, main and the relay compile")
    app = {"src": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
           "files": {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.json")}}
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
