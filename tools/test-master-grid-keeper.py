#!/usr/bin/env python3
"""The sheet keeper's grids (server/hub_sheet_sync.py keep_grids) with the Calendar Builder's master grid among them,
run inside asa-hub-snapshot (the keeper's own image) on this checkout's source, against stand-ins for Sheets, the
mirror's store and app.sheet_grids: the master's New Calendar (A..AE, 500 rows) is kept as `master` before the index,
even when the index pointer cannot be read; it is read again only once its book moved; the table keeps it beside the
index and the houses; asa-hub-app is told what a grid kept moves (the master grid: the master record's sync, which
folds it in; a house grid: the shift board's four slices), and nothing is told when nothing was read.

With LIVE=1 the master's grid is also read once from Google, read-only, on the keeper's own account, and compared
with what the relay's Calendar Builder reads through the values API: the same cells.

    python3 tools/test-master-grid-keeper.py
    LIVE=1 python3 tools/test-master-grid-keeper.py
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DRIVER = r'''
import base64, json, sys, types
blob = json.loads(sys.stdin.read())
sys.path.insert(0, "/srv/app")
mod = types.ModuleType("hub_sheet_sync_under_test")
mod.__file__ = "/srv/app/hub_sheet_sync.py"
sys.modules[mod.__name__] = mod
exec(compile(base64.b64decode(blob["src"]).decode(), mod.__file__, "exec"), mod.__dict__)
K = mod
ok = failed = 0


def check(label, cond, detail=""):
    global ok, failed
    if cond:
        ok += 1
        print("  ok  ", label)
    else:
        failed += 1
        print("  FAIL", label, detail)


MASTER, INDEX, HOUSE = K.MASTER_GRID_ID, "index-book-0000000000000", "house-book-0000000000000"
asked = []


def cell(text, day=None):
    c = {"formattedValue": text}
    if day is not None:
        c.update(effectiveValue={"numberValue": day}, effectiveFormat={"numberFormat": {"type": "DATE"}})
    return c


class Sheets:
    def spreadsheets(self):
        return self

    def get(self, spreadsheetId, includeGridData, fields, ranges=None):
        asked.append((spreadsheetId, tuple(ranges or ())))
        if spreadsheetId == INDEX:
            rows = [{"values": [{"formattedValue": "CAN - HB - HB1", "hyperlink":
                                 f"https://docs.google.com/spreadsheets/d/{HOUSE}/edit"}]}]
            title = "Index"
        elif spreadsheetId == MASTER:
            rows = [{"values": [cell(""), cell(""), cell(""), cell("SAT"), cell("SUN")]},
                    {"values": [cell(""), cell(""), cell(""), cell("10/24"), cell("10/25")]},
                    {"values": [cell("notes")]},
                    {"values": [cell("HB1"), cell("*"), cell("Ann Lee"), cell("8A-8P"), cell("OFF")]}]
            title = "New Calendar"
        else:
            rows = [{"values": [cell(""), cell("STAFF"), cell("Cell #"), cell("10/24", 46319.0)]},
                    {"values": [cell(""), cell("Ann Lee"), cell("555"), cell("8A-8P")]}]
            title = "CALENDAR"
        return self._answer({"sheets": [{"properties": {"title": title}, "data": [{"rowData": rows}]}]})

    def _answer(self, body):
        return types.SimpleNamespace(execute=lambda: body)


class Store:
    def __init__(self):
        self.modified = {MASTER: "2026-10-25T10:00:00.000Z", INDEX: "2026-10-20T10:00:00.000Z",
                         HOUSE: "2026-10-25T09:00:00.000Z"}
        self.pointer = {INDEX}

    def pointer_ids(self, _names):
        if self.pointer is None:
            raise RuntimeError("pointer unreadable")
        return set(self.pointer)

    def books(self, ids):
        return {i: {"id": i, "name": i, "modifiedTime": self.modified[i]} for i in ids if i in self.modified}

    def titles(self, sid):
        return (["CALENDAR"],)


class Grids:
    def __init__(self):
        self.rows, self.kept = {}, None

    def held(self):
        return {sid: {"tab": r["tab"], "kind": r["kind"], "modified": K._ts(r["modified"]),
                      "cells": r["cells"] if r["kind"] == "links" else None} for sid, r in self.rows.items()}

    def put(self, sid, tab, kind, cells, modified):
        self.rows[sid] = {"tab": tab, "kind": kind, "cells": cells, "modified": modified}

    def keep_only(self, ids):
        self.kept = list(ids)
        gone = [s for s in self.rows if s not in ids]
        for s in gone:
            self.rows.pop(s)
        return len(gone)


told = []
store, grids, pace = Store(), Grids(), K.Pace()
out = K.keep_grids(Sheets(), store, grids, pace, frozenset(), tell=told.append)
check("the master is read first, its New Calendar as the builder reads it",
      asked and asked[0] == (MASTER, ("'New Calendar'!A1:AE500",)), asked[:1])
m = grids.rows.get(MASTER) or {}
check("it is kept as master, its tab and its book's modifiedTime with it",
      m.get("kind") == "master" and m.get("tab") == "New Calendar" and m.get("modified") == store.modified[MASTER], m)
check("its cells are kept as shown, the day-columns apart",
      (m.get("cells") or {}).get("shown") == [["", "", "", "SAT", "SUN"], ["", "", "", "10/24", "10/25"], ["notes"],
                                              ["HB1", "*", "Ann Lee", "8A-8P", "OFF"]], (m.get("cells") or {}).get("shown"))
check("the index and the house are kept beside it", grids.rows.get(INDEX, {}).get("kind") == "links"
      and grids.rows.get(HOUSE, {}).get("kind") == "calendar", sorted((s, r["kind"]) for s, r in grids.rows.items()))
check("the table keeps the master with the index and the houses", grids.kept == [MASTER, INDEX, HOUSE], grids.kept)
check("the app is told the master record's sync and the slices read off the house grids", told == [[
    K.MASTER_SYNC, "shifts", "shiftCards", "shiftMatrix", "shiftTimeline"]], told)
check("the pass counts what it read", out["master_grids"] == 1 and out["calendar_grids"] == 1 and out["grids"] == 3,
      out)

asked.clear(); told.clear()
out = K.keep_grids(Sheets(), store, grids, pace, frozenset(), tell=told.append)
check("a book that did not move is not read again", asked == [] and out["grids"] == 0, asked)
check("nothing read, nothing told", told == [], told)

store.modified[MASTER] = "2026-10-25T11:00:00.000Z"
asked.clear(); told.clear()
out = K.keep_grids(Sheets(), store, grids, pace, frozenset(), tell=told.append)
check("the master moved: it alone is read again", [a[0] for a in asked] == [MASTER], asked)
check("and only the master record's sync is told", told == [[K.MASTER_SYNC]], told)

store.modified[MASTER] = "2026-10-25T12:00:00.000Z"
store.pointer = None
asked.clear(); told.clear()
out = K.keep_grids(Sheets(), store, grids, pace, frozenset(), tell=told.append)
check("an unreadable index pointer still keeps the master and tells its record's sync",
      [a[0] for a in asked] == [MASTER] and told == [[K.MASTER_SYNC]], (asked, told))

said = []


class _Res:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(req, timeout=0):
    said.append((req.full_url, req.headers.get("X-hub-token") is not None, json.loads(req.data or b"{}")))
    return _Res()


import urllib.request  # noqa: E402

real_urlopen, urllib.request.urlopen = urllib.request.urlopen, _urlopen
K.tell_app([K.MASTER_SYNC, "shifts"])
urllib.request.urlopen = real_urlopen
check("the master record's sync is asked with the service token, the house slices at /notify",
      said == [(K.HUB_APP_URL + "/calendar-builder/master-sync", True, {}),
               (K.HUB_APP_URL + "/notify", False, {"resources": ["shifts"]})], said)

asked.clear(); told.clear()
store.pointer = {INDEX}
store.modified[MASTER] = "2026-10-25T13:00:00.000Z"
out = K.keep_grids(Sheets(), store, grids, pace, frozenset({MASTER}), tell=told.append)
check("a master the keeper keeps out is neither read nor kept", asked == [] and MASTER not in (grids.kept or []),
      (asked, grids.kept))

if blob.get("live"):
    import calendar_builder_slices as CB
    _drive, sheets = K._clients()
    _tab, live = K.read_grid(sheets, None, K.Pace(), MASTER, "master")
    relay = CB._fetch_grid_matrix()
    trim = lambda m: [[str(v) for v in r] for r in m]
    shown = trim(live["shown"])
    want = trim(relay)
    while want and not any(v.strip() for v in want[-1]):
        want.pop()
    differ = [i for i in range(max(len(shown), len(want))) if (shown[i] if i < len(shown) else [])
              != (want[i] if i < len(want) else [])]
    check("live: the kept read holds the cells the builder reads through the values API", not differ,
          [(i, shown[i][:6] if i < len(shown) else None, want[i][:6] if i < len(want) else None) for i in differ[:3]])
    print(f"  live: {len(shown)} rows, {live['cols']} columns, {len(live['dates'])} dates, {len(live['colors'])} colours")
print(f"{ok} ok, {failed} failed")
'''


def main() -> int:
    src = (ROOT / "server" / "hub_sheet_sync.py").read_bytes()
    blob = json.dumps({"src": base64.b64encode(src).decode(), "live": bool(os.environ.get("LIVE"))})
    got = subprocess.run(["docker", "exec", "-i", "asa-hub-snapshot", "python3", "-c", DRIVER], input=blob,
                         text=True, capture_output=True, timeout=300)
    sys.stdout.write(got.stdout)
    if got.returncode:
        sys.stdout.write(got.stderr[-3000:])
    return 1 if got.returncode or " FAIL " in got.stdout or "\n  FAIL" in got.stdout else 0


if __name__ == "__main__":
    sys.exit(main())
