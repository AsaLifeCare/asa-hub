"""hubdb.HubDb.tab handing every reader the table a book's tab is kept in: the read doors over the books moved on 10-27
answered twice, once off the frozen copies (hubdb.COPY) and once off the tables, as the master — the same status, and
the same data but for the moment each was read. Then every kept tab's rows as a reader gets them (the kept edits laid)
off the copy and off the table, compared cell for cell (blank cells aside).

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-kept-lever.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("KEPT_LEVER_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_kept_lever.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run_long.sh"), os.path.abspath("app"), here,
                          json.dumps({"KEPT_LEVER_INPROC": "1"})], capture_output=True, text=True, timeout=2500)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import re  # noqa: E402
import time  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import guardian  # noqa: E402
import houses  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import ssa  # noqa: E402
import staff  # noqa: E402
import system_logs  # noqa: E402
import writes as W  # noqa: E402

VOLATILE = re.compile(r"as_of|read_at|built_at|generated|now|_at$|^at$|age|took|elapsed|seconds", re.I)
results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


def steady(v: object) -> object:
    if isinstance(v, dict):
        return {k: steady(x) for k, x in v.items() if not VOLATILE.search(str(k))}
    if isinstance(v, (list, tuple)):
        return [steady(x) for x in v]
    return v


def plain(v: object) -> str:
    return json.dumps(steady(v), sort_keys=True, default=str)


db = hubdb.HubDb()
edits = W.Store(dsn=hubdb._dsn()).edits()
users = L.Reads(db, None).users()
master = next(u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT)


def answer(door, payload: dict, on_copy: bool) -> object:
    hubdb.OWN.set(client_writes.Own([], book=db.book, edits=edits, edits_at=time.time()))
    token = hubdb.COPY.set(on_copy)
    try:
        got = door(L.Session(L.Reads(db, None), master), payload)
        got = getattr(got, "answer", got)
        return got
    except Exception as exc:  # noqa: BLE001
        return {"raised": f"{type(exc).__name__}: {str(exc)[:160]}"}
    finally:
        hubdb.COPY.reset(token)


DOORS = {"houses": (houses.ACTIONS["housesSlice"], {}),
         "system logs": (system_logs.ACTIONS["logsList"], {}),
         "events": (system_logs.ACTIONS["eventsList"], {}),
         "guardian": (guardian.ACTIONS["guardianStatus"], {}),
         "staff roster": (staff.ACTIONS["staffProfileRoster"], {}),
         "ssa roster": (ssa.ACTIONS["ssaProfileRoster"], {})}
for name, (door, payload) in DOORS.items():
    a, b = answer(door, payload, True), answer(door, payload, False)
    sa, sb = (x.get("status") if isinstance(x, dict) else None for x in (a, b))
    facts[name] = [sa, sb]
    check(f"{name}: the same answer off the tables as off the copies", sa == sb and plain(a) == plain(b),
          (sa, sb, plain(a)[:120], plain(b)[:120]))
# every kept tab of the books moved today: what a reader gets, off the copy and off the table
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=edits, edits_at=time.time()))
# the big ones were proved row for row by their upload, in SQL (resource_rows.unlike_copy); a reader's view is asked of
# every other, the rows held let go after each
kept = db.query("select c.resource, c.sheet_id, c.tab_name from app.resource_columns c join catalog.tabs t"
                " on t.sheet_id = c.sheet_id and t.tab_name = c.tab_name and t.gone_at is null"
                " where c.resource like 'bk%%' and t.row_count <= 3000"
                " and c.uploaded_at is not null order by c.resource")
unlike = []
for res, sid, tab in kept:
    token = hubdb.COPY.set(True)
    try:
        copy_ref = db.tab(sid, tab)
        copy_rows = db.rows(copy_ref) if copy_ref is not None else []
    finally:
        hubdb.COPY.reset(token)
    ref = db.tab(sid, tab)
    if not str(getattr(ref, "table", "")).startswith(hubdb.KEPT_TABLE):
        unlike.append(f"{res}: no table handed")
        continue
    got = db.rows(ref)
    norm = lambda rows: sorted(d for d in (json.dumps({k: str(v) for k, v in r.items() if v not in (None, "")},  # noqa
                                                       sort_keys=True)
                                           for _rn, r in rows) if d != "{}")
    same = norm(copy_rows) == norm(got)
    db._rows.clear()
    if not same:
        unlike.append(f"{res} ({tab}): {len(copy_rows)} copy rows, {len(got)} table rows")
facts["kept tabs compared"] = len(kept)
check("every kept tab reads as its copy with the kept edits laid", not unlike, unlike[:6])
print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
