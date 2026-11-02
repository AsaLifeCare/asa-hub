#!/usr/bin/env python3
"""asa-hub-app's write stores on one connection per thread: every store on the same DSN shares the thread's writer
connection (one per store and thread outgrew asa-hub-db's 100 slots), another thread has its own, a store nested in
another's locked transaction joins it as a savepoint, a dropped connection is made again for every store, and a
store given its own connect (the checks') keeps it. Runs in asa-hub-db-sync on a temporary table and a check lock
key: nothing in app.* is written."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-db-sync"

CHECK = r'''
import base64, importlib.abc, importlib.util, json, sys, threading
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
import psycopg
import hubdb, writes as W

out = []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


DSN = hubdb._dsn()
W.LOCK_KEY = 0x5743484B
a, b = W.Store(dsn=DSN, kind="check_a"), W.Store(dsn=DSN, kind="check_b")
pid = lambda c: c.execute("select pg_backend_pid()").fetchone()[0]

check("two stores on one DSN share the thread's connection", a.conn() is b.conn() and pid(a.conn()) == pid(b.conn()))
seen = {}


def other():
    seen["same"] = a.conn() is b.conn()
    seen["pid"] = pid(a.conn())
    a._drop()


t = threading.Thread(target=other)
t.start()
t.join()
check("another thread has its own, shared by its stores", seen.get("same") is True and seen.get("pid") != pid(a.conn()),
      seen)

c = a.conn()
c.execute("create temp table wc_check (x int)")
try:
    with a.locked() as tx:
        tx.cur.execute("insert into wc_check values (1)")
        try:
            with b.locked() as tx2:
                tx2.cur.execute("insert into wc_check values (2)")
                raise RuntimeError("the inner write gives up")
        except RuntimeError:
            pass
        with b.locked() as tx3:
            tx3.cur.execute("insert into wc_check values (3)")
except Exception as exc:  # noqa: BLE001
    check("a store nested in another's transaction runs as a savepoint", False, repr(exc))
got = sorted(r[0] for r in c.execute("select x from wc_check").fetchall())
check("a store nested in another's locked write joins it: its give-up rolls back alone, the rest commits together",
      got == [1, 3], got)
try:
    with a.locked() as tx:
        with b.locked() as tx2:
            tx2.cur.execute("insert into wc_check values (4)")
        raise RuntimeError("the outer write gives up")
except RuntimeError:
    pass
got = sorted(r[0] for r in c.execute("select x from wc_check").fetchall())
check("the outer write giving up takes the nested store's rows with it", got == [1, 3], got)

before = pid(a.conn())
a._drop()
fresh = b.conn()
check("a dropped connection is made again for every store of the thread, on a new backend, the old one closed",
      c.closed and pid(fresh) != before and a.conn() is fresh, (c.closed, before))

own = W.Store(connect=lambda: psycopg.connect(DSN, autocommit=True), kind="check_own")
check("a store given its own connect keeps its own connection", own.conn() is not a.conn() and own.conn() is own.conn())
own._drop()
check("…and dropping it leaves the shared one alone", not a.conn().closed)
a._drop()
print(json.dumps({"checks": out}))
'''


def main() -> int:
    src = {p.stem: p.read_text() for p in (ROOT / "app").glob("*.py")}
    payload = base64.b64encode(json.dumps(src).encode()).decode()
    got = subprocess.run(["docker", "exec", "-i", RUNNER, "python3", "-c", CHECK], input=payload + "\n",
                         capture_output=True, text=True, timeout=300)
    if got.returncode != 0 or not got.stdout.strip():
        print(got.stderr[-3000:])
        return 1
    failed = 0
    for name, ok, detail in json.loads(got.stdout.strip().splitlines()[-1])["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    print("all ok" if not failed else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
