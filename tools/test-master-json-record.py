#!/usr/bin/env python3
"""The master JSON (server/master_json.py) with RecordSource: a book Postgres keeps the record of is written from that
record — asa-hub-app's recordTabs, its copy with the kept edits laid — and never from the mirror's rows of it; every
other book from the mirror as before; a record tab past PART_ROWS kept in parts; a round whose record did not move
writes nothing, one whose record moved rewrites that tab; a record that cannot be asked leaves the mirror alone for the
round, said once. Offline: the mirror and the app's door are stand-ins, every file in a temporary directory.

    python3 tools/test-master-json-record.py
"""
import json
import logging
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

sys.dont_write_bytecode = True
ROOT_DIR = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="master-json-record-"))
os.environ["HUB_SNAPSHOT_OUT"] = str(TMP / "snapshot")
sys.path.insert(0, str(ROOT_DIR / "server"))

import master_json as mj  # noqa: E402

logging.disable(logging.CRITICAL)
results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


class Mirror:
    """The mirror's five questions over rows held here."""

    def __init__(self):
        self.data = {("BOOK_M", "tab"): {2: (1, 10.0, {"id": "M1", "v": "mirror"})},
                     ("BOOK_R", "rec"): {2: (2, 10.0, {"id": "R1", "v": "stale in the mirror"})}}
        self.meta = {"BOOK_M": {"name": "Mirror book", "modified_time": 1.0, "synced_at": 2.0, "status": "ok"},
                     "BOOK_R": {"name": "Record book", "modified_time": 1.0, "synced_at": 2.0, "status": "ok"}}

    @contextmanager
    def snapshot(self):
        yield self

    def signatures(self, part_rows):
        return [(s, t, max(rn - 1, 0) // part_rows, 1, rid, at) for (s, t), rows in self.data.items()
                for rn, (rid, at, _r) in rows.items()]

    def books(self):
        return {s: dict(m) for s, m in self.meta.items()}

    def titles(self):
        return {}

    def tabs(self):
        return {}

    def mirror(self):
        return {"listed_at": 1.0, "last_pass_at": 1.0, "watermark": 1.0, "pending": []}

    def rows(self, sid, tab, lo, hi):
        for rn in sorted(self.data.get((sid, tab), {})):
            if (lo is None or rn >= lo) and (hi is None or rn <= hi):
                yield rn, json.dumps(self.data[(sid, tab)][rn][2])


class Door:
    """asa-hub-app's recordTabs as app/sheet_tabs.py answers it."""

    def __init__(self):
        self.rows = {("BOOK_R", "rec"): [[2, {"id": "R1", "v": "laid by Postgres"}]] +
                     [[rn, {"id": f"R{rn - 1}", "v": str(rn)}] for rn in range(3, 9)]}
        self.sig = "t0|7|41|3"
        self.asked = []
        self.down = False

    def __call__(self, payload):
        self.asked.append(payload)
        if self.down:
            raise OSError("asa-hub-app is not answering")
        if payload.get("marks"):
            rows = self.rows[("BOOK_R", "rec")]
            return {"books": {"BOOK_R": {"name": "Record book", "synced_at": "2026-10-24T12:00:00+00:00", "tabs": [
                {"tab": "rec", "sig": self.sig, "last_row": max(r[0] for r in rows), "rows": len(rows),
                 "loaded_at": "2026-10-24T12:00:00+00:00", "headers": ["id", "v"]}]}}}
        return {"rows": self.rows[(payload["sheet_id"], payload["tab"])]}


def part_rows(root, sid, tab, k):
    p = root / mj.part_file(sid, tab, k)
    if not p.is_file():
        return None
    doc = json.loads(p.read_bytes())
    head = doc["header"]
    return [dict(zip(head, r[1:])) | {"_row": r[0]} for r in doc["rows"]]


mirror, door = Mirror(), Door()
root = TMP / "master"
keeper = mj.MasterKeeper(mj.RecordSource(mirror, token="", ask=door), root, part_rows=4, min_free_bytes=0)
got = keeper.round(now=1000.0)
rec = (part_rows(root, "BOOK_R", "rec", 0) or []) + (part_rows(root, "BOOK_R", "rec", 1) or [])
check("a record book is written from the record, the kept edit laid, never the mirror's stale row",
      got is not None and rec and rec[0]["v"] == "laid by Postgres" and rec[0]["_row"] == 2, rec[:2])
check("a record tab past PART_ROWS rows is kept in parts, every row once",
      part_rows(root, "BOOK_R", "rec", 1) is not None and [r["_row"] for r in rec] == list(range(2, 9)),
      [r["_row"] for r in rec])
mrows = part_rows(root, "BOOK_M", "tab", 0)
check("every other book comes from the mirror as before", mrows == [{"id": "M1", "v": "mirror", "_row": 2}], mrows)
man = json.loads((root / "manifest.json").read_bytes())
book = next((b for b in man.get("books") or [] if b.get("id") == "BOOK_R"), {})
check("the manifest names the record book with its record tab", book.get("name") == "Record book"
      and [t.get("tab") for t in book.get("tabs") or []] == ["rec"], book)
n = len(door.asked)
again = keeper.round(now=1001.0)
check("a round whose record did not move rewrites nothing and asks only the marks",
      again is None and door.asked[n:] == [{"marks": True}], [again, door.asked[n:]])
door.rows[("BOOK_R", "rec")][0][1]["v"] = "edited again"
door.sig = "t0|7|42|4"
moved = keeper.round(now=1002.0)
rec = part_rows(root, "BOOK_R", "rec", 0) or []
check("a round whose record moved rewrites that tab from the record", moved is not None and rec
      and rec[0]["v"] == "edited again", rec[:1])
door.down = True
mirror.data[("BOOK_M", "tab")][3] = (3, 11.0, {"id": "M2", "v": "new"})
down = keeper.round(now=1003.0)
mrows = part_rows(root, "BOOK_M", "tab", 0) or []
check("a record that cannot be asked: the round reads the mirror alone and is still written",
      down is not None and [r["id"] for r in mrows] == ["M1", "M2"], mrows)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
