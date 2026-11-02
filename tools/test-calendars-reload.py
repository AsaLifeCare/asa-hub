#!/usr/bin/env python3
"""Scheduling › House calendars' reload, the worker's half (server/hub_sheet_sync.py read_live_now) on the real
workbook, inside asa-hub-worker (its Google service account and the lane role's door into asa-hub-db), on this
checkout's module streamed in. Every write goes through one transaction that is rolled back: nothing is kept, and
asa-hub-app is told nothing (the slices' tell is stood in for).

- the copy as new as the sheet: nothing is read from Google, nothing is written, nobody is told;
- the sheet newer than the copy (the copy's stamp set back inside the transaction): every house of the workbook read
  again into the copy, the stamp moved, the keeper's live_read_at moved, the shift slices told once;
- another reader holding the calendars (the clock's pass): the reload answers Reading at once;
- after the rollback the copy stands exactly as it was.

    python3 tools/test-calendars-reload.py
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-worker"

DRIVER = r'''
import base64, fcntl, functools, json, os, sys, types
src = base64.b64decode(sys.stdin.readline()).decode()
sys.path.insert(0, "/srv/app")
m = types.ModuleType("hub_sheet_sync_new"); m.__file__ = "/srv/app/hub_sheet_sync_new.py"
sys.modules[m.__name__] = m
exec(compile(src, m.__file__, "exec"), m.__dict__)
import psycopg2
out = {}
conn = psycopg2.connect(m.GRID_DSN)
conn.autocommit = False
def q(sql, args=()):
    with conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else []
before = q("select location, md5(grid::text), updated_at from app.asa_house_calendar_live order by 1")
state_before = q("select live_read_at from app.sheet_keeper_state where id = 1")
m._GRIDS["store"] = m.GridStore(connect=lambda: conn)
told = []
m.keep_live = functools.partial(m.keep_live, tell=lambda names: told.append(list(names)))
drive, sheets = m._clients()

# the copy as new as the sheet
q("update app.asa_house_calendar_live set updated_at = now() + interval '1 minute'")
got = m.read_live_now(drive, sheets)
out["current"] = {**got, "told": list(told)}

# the sheet newer than the copy
q("update app.asa_house_calendar_live set updated_at = timestamptz '2026-01-01 00:00:00+00'")
got = m.read_live_now(drive, sheets)
after = q("select location, md5(grid::text), updated_at from app.asa_house_calendar_live order by 1")
out["ahead"] = {**got, "told": list(told), "houses_after": len(after),
                "grids_differ": sorted(l for (l, h, _u), (l2, h2, _u2) in zip(before, after) if l == l2 and h != h2),
                "stamped_now": all(u.year == 2026 and u.month > 1 for _l, _h, u in after),
                "state_moved": q("select live_read_at > %s from app.sheet_keeper_state where id = 1",
                                 (state_before[0][0],))[0][0] if state_before and state_before[0][0] else None}

# another reader holding the calendars
with open(m.READ_LOCK, "a") as fh:
    fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        m.read_live_now(drive, sheets)
        out["busy"] = "read anyway"
    except m.Reading as exc:
        out["busy"] = "Reading: " + str(exc)
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN)

conn.rollback()
conn.close()
check = psycopg2.connect(m.GRID_DSN)
with check.cursor() as cur:
    cur.execute("select location, md5(grid::text), updated_at from app.asa_house_calendar_live order by 1")
    out["kept_as_was"] = cur.fetchall() == before
    cur.execute("select live_read_at from app.sheet_keeper_state where id = 1")
    out["state_as_was"] = cur.fetchall() == state_before
check.close()
out["houses_before"] = len(before)
print(json.dumps(out, default=str))
'''

results: dict[str, list] = {"ok": [], "failed": []}


def check(name: str, ok: bool, detail: object = None) -> None:
    results["ok" if ok else "failed"].append(name)
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))


def main() -> int:
    src = (ROOT / "server" / "hub_sheet_sync.py").read_text(encoding="utf-8")
    print(f"House calendars' reload (read_live_now) in {RUNNER}, one transaction rolled back")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(src.encode()) + b"\n", capture_output=True, timeout=300)
    if got.returncode != 0:
        check("the reload ran in the worker", False, got.stderr.decode()[-2000:])
        return 1
    out = json.loads(got.stdout.decode().strip().splitlines()[-1])
    cur, ahead, n = out["current"], out["ahead"], out["houses_before"]
    print(f"  the copy holds {n} houses; the sheet last changed {ahead['sheet_at']}")
    check("copy as new as the sheet: not ahead, nothing read from Google", not cur["ahead"] and cur["requests"] == 0
          and cur["live_houses"] == 0, cur)
    check("copy as new as the sheet: nobody told", cur["told"] == [], cur["told"])
    check("sheet newer than the copy: ahead, every house read again", ahead["ahead"] and ahead["live_houses"] >= 1
          and ahead["houses_after"] == ahead["live_houses"] and not ahead["live_errors"], ahead)
    check("sheet newer than the copy: every house stamped by this read", ahead["stamped_now"], ahead)
    check("sheet newer than the copy: the keeper's live_read_at moved", ahead["state_moved"] in (True, None), ahead)
    check("sheet newer than the copy: the shift slices told once",
          ahead["told"] == [["shifts", "shiftCards", "shiftMatrix", "shiftTimeline"]], ahead["told"])
    print(f"  {len(ahead['grids_differ'])} house(s) of the copy differ from the sheet now: {ahead['grids_differ']}")
    check("another reader holding the calendars: Reading at once", str(out["busy"]).startswith("Reading:"), out["busy"])
    check("after the rollback the copy stands exactly as it was", out["kept_as_was"] and out["state_as_was"], out)
    print(f"\ntest-calendars-reload: {len(results['ok'])} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
