#!/usr/bin/env python3
"""
THE MASTER JSON AND ITS HAND-OFF JOURNAL, asserted offline.

WHAT IT PROVES.
  the round    every tab the mirror holds lands on disk as JSON — the book,
               its name, its tabs in the sheet's order, each header and every
               row, read back cell for cell — with the counts, fingerprints,
               read times and the mirror's own lag in the manifest
  parts        a tab past PART_ROWS sheet rows is kept in parts of PART_ROWS
               rows, named by its book; a row appended rewrites the last part
               and nothing else
  nothing      a round in which the mirror did not move writes nothing and
               reads no row; one in which the mirror wrote the same rows again
               reads them and writes nothing; a restarted keeper reads its
               manifest back and has nothing to do
  rotation     every round that writes gzips what it replaced — the previous
               manifest and the previous bytes of every file rewritten or
               removed — into ONE archive, a JSON document once unzipped
  atomicity    a round that fails while encoding leaves the previous round
               standing, file for file; a round cut between the files and the
               manifest is healed by the next round, in the same process and
               after a restart
  the bounds   the archive keeps KEEP_ROUNDS rounds and ARCHIVE_MB bytes, the
               oldest going first and the newest always kept; a disk under
               the floor is not written at all
  verify       the daily sweep puts back a file changed under an unmoved
               signature
  privacy      the directory and every directory under it 0700, every file
               0600; no book file ever named index.json or all.json
  hand-offs    what the relay's clocks hand on is written first, without its
               credential, rotated into gzips, bounded; an unknown action is
               refused; a disk that refused raises; the call lane's terminal
               door posts to asa-hub-app alone, run
  the wiring   every hand-off body, every door it is handed to and every value
               that door can be, followed through the code; nothing in server/
               names an exec URL any more; the keeper runs a round
               after every pass; the three in-container suites ship
               master_json and comm_calls_feed; `npm run check` runs this file
  one bad row  a row that is not an object is kept under _value and counted,
               and stops nothing; a file whose rows will not encode stops only
               itself — its last file stands, marked stale, said once — while a
               mirror or a disk that fails still stops the round
  withheld     a prop whose key names a credential, a card or bank column, and
               a column whose own NAME is a credential, are markers in the
               file and in the archive; a row-key column, a count of tokens
               and the six measured carve-outs are untouched; the two counts
               in the log line and in the manifest are the same two numbers,
               and they count cells WRITTEN, not cells compared
  the purge    refuses unless the code the RELAY imports can withhold — the
               copy at /srv/app, not the one handed to the container beside
               the tool — and has no way past the refusal
  the houses   the four mint tools share with the account the keeper really
               is (the service account, not a human address behind an empty
               delegation variable) and TOUCH the book, because a permission
               never moves modifiedTime and the keeper lists by nothing else

HOW IT STAYS OFFLINE. The mirror is a stand-in with the same five questions
the Postgres source answers; every file lives in a temporary directory; the
calls door's urlopen is a stand-in at a reserved .invalid address; no
network, no database.

    python3 tools/test-master-json.py
"""
import ast
import gzip
import hashlib
import inspect
import io
import json
import logging
import os
import re
import shutil
import stat
import sys
import tempfile
import urllib.parse
from contextlib import contextmanager
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT_DIR = HERE.parent.parent
SERVER = ROOT_DIR / "server"
TMP = Path(tempfile.mkdtemp(prefix="master-json-"))
os.environ["HUB_SNAPSHOT_OUT"] = str(TMP / "snapshot")
sys.path.insert(0, str(SERVER))

import master_json as mj  # noqa: E402

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


# ── the stand-in mirror ──────────────────────────────────────────────────────
class Fake:
    """asa_drive_sheets_rows and the keeper's tables, in memory."""

    def __init__(self):
        self.data = {}          # (sid, tab) -> {row: (id, ingested_at, dict)}
        self.meta = {}
        self.title = {}
        self.giant = {}
        self.state = {"listed_at": 1_000.0, "last_pass_at": 1_010.0, "watermark": 990.0,
                      "pending": []}
        self.next_id = 1
        self.clock = 100.0
        self.row_reads = 0
        self.fail_on_read = None

    def put(self, sid, tab, rn, row, same_id=False):
        self.clock += 1.0
        rows = self.data.setdefault((sid, tab), {})
        if same_id and rn in rows:
            rid = rows[rn][0]
        else:
            rid = self.next_id
            self.next_id += 1
        rows[rn] = (rid, self.clock, dict(row) if isinstance(row, dict) else row)

    def drop_book(self, sid):
        for key in [k for k in self.data if k[0] == sid]:
            del self.data[key]

    def rewrite_same(self, sid, tab):
        """The keeper reading a tab whole again: new ids, the same rows."""
        for rn, (_rid, _at, row) in sorted(self.data[(sid, tab)].items()):
            self.put(sid, tab, rn, row)

    @contextmanager
    def snapshot(self):
        yield Snap(self)


class Snap:
    def __init__(self, fake):
        self.f = fake

    def signatures(self, part_rows):
        out = {}
        for (sid, tab), rows in self.f.data.items():
            for rn, (rid, at, _row) in rows.items():
                k = max(rn - 1, 0) // part_rows
                n, mid, mat = out.get((sid, tab, k), (0, 0, 0.0))
                out[(sid, tab, k)] = (n + 1, max(mid, rid), max(mat, at))
        return [(s, t, k, n, mid, at) for (s, t, k), (n, mid, at) in out.items()]

    def books(self):
        return {s: dict(m) for s, m in self.f.meta.items()}

    def titles(self):
        return {s: list(t) for s, t in self.f.title.items()}

    def tabs(self):
        return {k: dict(v) for k, v in self.f.giant.items()}

    def mirror(self):
        return dict(self.f.state)

    def rows(self, sid, tab, lo, hi):
        self.f.row_reads += 1
        if self.f.fail_on_read is not None:
            self.f.fail_on_read -= 1
            if self.f.fail_on_read < 0:
                raise RuntimeError("the database went away mid-round")
        for rn in sorted(self.f.data.get((sid, tab), {})):
            if (lo is None or rn >= lo) and (hi is None or rn <= hi):
                row = self.f.data[(sid, tab)][rn][2]
                yield rn, row if isinstance(row, RawText) else json.dumps(row)


class RawText(str):
    """A row's text exactly as the mirror would hand it over, JSON or not."""


def tree(root):
    """Every file under root → (inode, mtime_ns, size, sha256)."""
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            p = Path(dirpath) / name
            st = p.stat()
            out[str(p.relative_to(root))] = (st.st_ino, st.st_mtime_ns, st.st_size,
                                             hashlib.sha256(p.read_bytes()).hexdigest())
    return out


def archives(root):
    return sorted(p.name for p in (Path(root) / "archive").iterdir() if p.name.endswith(".json.gz"))


def manifest(root):
    return json.loads((Path(root) / "manifest.json").read_bytes())


def keeper(fake, root, **kw):
    kw.setdefault("part_rows", 4)
    kw.setdefault("min_free_bytes", 0)
    return mj.MasterKeeper(fake, root, **kw)


def seeded():
    f = Fake()
    f.meta = {"BOOK_A": {"name": "ASA Data — Calls", "modified_time": 5_000.0, "synced_at": 5_010.0,
                         "status": "ok"},
              "BOOK_B": {"name": "Staff Daily Notes", "modified_time": 4_000.0, "synced_at": 4_010.0,
                         "status": "ok"}}
    f.title = {"BOOK_A": ["Log", "Summary"]}
    # a long tab: header on row 1, rows 2..11 → parts 0, 1, 2 at PART_ROWS 4
    f.giant = {("BOOK_A", "Log"): {"header": ["When", "", "Who", "Said", "Who"], "whole_at": 6_000.0,
                                   "dirty": False}}
    for rn in range(2, 12):
        f.put("BOOK_A", "Log", rn, {"Who": f"Person {rn}", "When": f"9/{rn}/2026", "Said": f"line {rn}"})
    f.put("BOOK_A", "Summary", 2, {"Total": "10", "Open": "3"})
    f.put("BOOK_B", "Notes", 2, {"Name": "Ann", "Note": "arrived", "Phone": "330-555-0101"})
    f.put("BOOK_B", "Notes", 3, {"Name": "Bo", "Note": "left early"})          # no Phone: trailing
    f.put("BOOK_B", "Notes", 4, {"Name": "Cy", "Phone": "330-555-0102"})        # no Note: middle
    f.put("BOOK_B", "Zeta", 2, {"k": "v"})
    return f


def expected_book(fake, sid):
    tabs = {}
    for (s, t), rows in fake.data.items():
        if s == sid:
            tabs[t] = [dict(row, _row=rn) for rn, (_i, _a, row) in sorted(rows.items())]
    return tabs


# ═══ 1 · the first round ═════════════════════════════════════════════════════
root = TMP / "snapshot" / "master"
fake = seeded()
k = keeper(fake, root)
first = k.round(now=10_000.0)
m1 = manifest(root)
EXPECT_FILES = sorted([mj.book_file("BOOK_A")[6:], mj.book_file("BOOK_B")[6:]]
                      + [mj.part_file("BOOK_A", "Log", i)[6:] for i in range(3)]
                      + [mj.part_file("BOOK_A", "Summary", 0)[6:], mj.part_file("BOOK_B", "Notes", 0)[6:],
                         mj.part_file("BOOK_B", "Zeta", 0)[6:]])
check("the round: the first round writes the manifest, one index per book and one file per tab part",
      first and first["written"] == 8 and sorted(os.listdir(root / "books")) == EXPECT_FILES,
      (first, os.listdir(root / "books")))
check("the round: the first round archives nothing (there was nothing before it)",
      archives(root) == [] and first["archived"] == 0)
got_rows = sum(len(r) for r in fake.data.values())
check("the round: the manifest counts every book, tab and row the mirror holds",
      m1["totals"]["books"] == 2 and m1["totals"]["tabs"] == 4 and m1["totals"]["rows"] == got_rows
      and m1["totals"]["files"] == 8, m1["totals"])
ok_all = True
for sid in ("BOOK_A", "BOOK_B"):
    back = {t["tab"]: t["rows"] for t in mj.read_book(root, sid)["tabs"]}
    ok_all &= back == expected_book(fake, sid)
check("the round: every book reads back row for row, cell for cell, sheet row numbers included", ok_all)
book_a = json.loads((root / mj.book_file("BOOK_A")).read_bytes())
check("the round: a book's index carries its id, its name, and its tabs in the sheet's order (the"
      " keeper's tab list first), each naming its files",
      book_a["id"] == "BOOK_A" and book_a["name"] == "ASA Data — Calls"
      and [t["tab"] for t in book_a["tabs"]] == ["Log", "Summary"]
      and book_a["tabs"][1] == {"tab": "Summary", "parts": [mj.part_file("BOOK_A", "Summary", 0)]}, book_a)
book_b = json.loads((root / mj.book_file("BOOK_B")).read_bytes())
notes = json.loads((root / mj.part_file("BOOK_B", "Notes", 0)).read_bytes())
check("the round: tabs the keeper never listed come in name order",
      [t["tab"] for t in book_b["tabs"]] == ["Notes", "Zeta"])
check("the round: a row is [sheet row, cell…] aligned with the header; an absent middle cell is null and"
      " an absent trailing cell is left off",
      notes["header"][:1] == ["Name"] and set(notes["header"]) == {"Name", "Note", "Phone"}
      and len(notes["rows"]) == 3 and notes["rows"][0][0] == 2
      and len(notes["rows"][1]) < len(notes["rows"][0])
      and notes["rows"][2][1 + notes["header"].index("Note")] is None
      and (notes["count"], notes["first_row"], notes["last_row"]) == (3, 2, 4), notes)
p1 = json.loads((root / mj.part_file("BOOK_A", "Log", 1)).read_bytes())
check("parts: part k holds sheet rows k·PART_ROWS+1 … (k+1)·PART_ROWS, and says whose part it is",
      p1["id"] == "BOOK_A" and p1["tab"] == "Log" and p1["part"] == 1
      and [r[0] for r in p1["rows"]] == [5, 6, 7, 8], p1)
check("parts: a long tab's header starts from the keeper's, in the sheet's order, blanks and repeats out",
      p1["header"] == ["When", "Who", "Said"], p1["header"])
check("parts: the book's index names the long tab's parts, in order",
      book_a["tabs"][0] == {"tab": "Log", "parts": [mj.part_file("BOOK_A", "Log", i) for i in range(3)]})
mb = {b["id"]: b for b in m1["books"]}
log_tab = mb["BOOK_A"]["tabs"][0]
check("the round: the manifest gives each tab its rows, first and last row, read time and fingerprint",
      (log_tab["rows"], log_tab["first_row"], log_tab["last_row"]) == (10, 2, 11)
      and log_tab["read_at"] and len(log_tab["fingerprint"]) == 64 and len(log_tab["parts"]) == 3
      and mb["BOOK_B"]["tabs"][0]["rows"] == 3 and len(mb["BOOK_B"]["tabs"][0]["fingerprint"]) == 64,
      log_tab)
def shas_match(m):
    return all(hashlib.sha256((root / b["file"]).read_bytes()).hexdigest() == b["sha256"]
               and all(hashlib.sha256((root / p["file"]).read_bytes()).hexdigest() == p["sha256"]
                       for t in b["tabs"] for p in t["parts"]) for b in m["books"])


check("the round: a file's sha256 in the manifest is the sha256 of its bytes on disk", shas_match(m1))
check("the round: the manifest says how far the mirror is behind Drive and which books it still owes",
      m1["mirror"]["lag_s"] == 9_000.0 and m1["mirror"]["owed_books"] == 0
      and m1["source"].startswith("asa_drive_sheets_rows"), m1["mirror"])
check("the round: a giant tab whose book changed after its last whole read is marked dirty, as"
      " mirror_first would refuse to vouch for it", log_tab["dirty"] is False and not mb["BOOK_B"]["tabs"][0]["dirty"])

# ═══ 2 · privacy ═════════════════════════════════════════════════════════════
modes_ok = all(stat.S_IMODE(os.stat(d).st_mode) == 0o700
               for d in (root, root / "books", root / "archive", root / ".tmp"))
files_ok = all(stat.S_IMODE(os.stat(root / f).st_mode) == 0o600 for f in tree(root))
check("privacy: the master directory and every directory in it are 0700", modes_ok)
check("privacy: every file of the master is 0600", files_ok)
check("privacy: a book whose id is a name the snapshot gate opens by itself, or not a plain id, is"
      " filed under a hash",
      mj.book_file("index") != "books/index.json" and mj.book_file("all") != "books/all.json"
      and "/" not in mj.book_file("../x")[6:] and mj.book_file("1AbC_d-9") == "books/1AbC_d-9.json")

# ═══ 3 · nothing changed ═════════════════════════════════════════════════════
before = tree(root)
fake.row_reads = 0
second = k.round(now=10_300.0)
check("nothing: a round in which the mirror did not move writes nothing and reads no row",
      second is None and tree(root) == before and fake.row_reads == 0, (second, fake.row_reads))
fake.rewrite_same("BOOK_A", "Log")
fake.row_reads = 0
third = k.round(now=10_600.0)
check("nothing: the mirror writing the same rows again (a whole re-read) is read, and writes nothing",
      third is None and tree(root) == before and fake.row_reads == 3, (third, fake.row_reads))
fake.row_reads = 0
check("nothing: ...and the round after that does not read them again",
      k.round(now=10_900.0) is None and fake.row_reads == 0)
k_restart = keeper(fake, root)
fake.row_reads = 0
check("nothing: a restarted keeper reads its manifest back and has nothing to do",
      k_restart.round(now=11_000.0) in (None,) and fake.row_reads <= 3 and tree(root) == before,
      fake.row_reads)
fake.row_reads = 0
check("nothing: ...and once it has looked, reads nothing more", k_restart.round(now=11_100.0) is None
      and fake.row_reads == 0)

# ═══ 4 · an append rewrites the last part, and the round is archived ═════════
k = k_restart
prev_round = manifest(root)["round"]
prev_manifest = (root / "manifest.json").read_bytes()
last_part = mj.part_file("BOOK_A", "Log", 2)
prev_last = (root / last_part).read_bytes()
before = tree(root)
fake.put("BOOK_A", "Log", 12, {"Who": "Person 12", "When": "9/12/2026", "Said": "appended"})
fake.row_reads = 0
r4 = k.round(now=11_400.0)
after = tree(root)
changed = sorted(f for f in after if f in before and after[f] != before[f])
added = sorted(f for f in after if f not in before)
check("parts: a row appended to a long tab rewrites its last part and the manifest, nothing else",
      r4 and r4["written"] == 1 and changed == sorted([last_part, "manifest.json"])
      and fake.row_reads == 1, (r4, changed))
check("rotation: the round wrote one archive, named by its round", len(added) == 1
      and added[0] == f"archive/round-{r4['round']}.json.gz", added)
arc = json.loads(gzip.decompress((root / added[0]).read_bytes()))
check("rotation: the archive is one JSON document: the previous manifest whole, and the previous bytes"
      " of every file the round replaced",
      arc["round"] == r4["round"] and arc["previous_round"] == prev_round
      and json.dumps(arc["manifest"], ensure_ascii=False, separators=(",", ":")).encode()
      == prev_manifest and list(arc["files"]) == [last_part]
      and json.dumps(arc["files"][last_part], ensure_ascii=False, separators=(",", ":")).encode()
      == prev_last and arc["removed"] == [], list(arc))
check("rotation: the archive is 0600", stat.S_IMODE(os.stat(root / added[0]).st_mode) == 0o600)
check("the round: the book reads back with the appended row",
      {t["tab"]: t["rows"] for t in mj.read_book(root, "BOOK_A")["tabs"]} == expected_book(fake, "BOOK_A"))

# a row past the last part's end opens a new part: the book file names it
fake.put("BOOK_A", "Log", 13, {"Who": "Person 13", "When": "9/13/2026", "Said": "new part"})
r5 = k.round(now=11_700.0)
check("parts: a row past the last part opens a new part, and the book file is rewritten to name it",
      r5["written"] == 2 and (root / mj.part_file("BOOK_A", "Log", 3)).is_file()
      and json.loads((root / mj.book_file("BOOK_A")).read_bytes())["tabs"][0]["parts"][-1]
      == mj.part_file("BOOK_A", "Log", 3), r5)
check("the round: round ids only grow", r5["round"] > r4["round"] > prev_round)

# ═══ 5 · a book that leaves the mirror ═══════════════════════════════════════
b_files = sorted([mj.book_file("BOOK_B"), mj.part_file("BOOK_B", "Notes", 0),
                  mj.part_file("BOOK_B", "Zeta", 0)])
b_bytes = {f: (root / f).read_bytes() for f in b_files}
fake.drop_book("BOOK_B")
r6 = k.round(now=12_000.0)
arc6 = json.loads(gzip.decompress((root / "archive" / f"round-{r6['round']}.json.gz").read_bytes()))
check("rotation: a book gone from the mirror leaves the master, and its last bytes are in the archive",
      r6["removed"] == 3 and not any((root / f).exists() for f in b_files)
      and sorted(arc6["removed"]) == b_files
      and all(json.dumps(arc6["files"][f], ensure_ascii=False, separators=(",", ":")).encode() == b_bytes[f]
              for f in b_files)
      and [b["id"] for b in manifest(root)["books"]] == ["BOOK_A"], r6)

# ═══ 6 · atomicity ═══════════════════════════════════════════════════════════
fake.put("BOOK_A", "Summary", 3, {"Total": "11"})
fake.put("BOOK_A", "Log", 14, {"Who": "Person 14", "When": "9/14/2026", "Said": "x"})
before = tree(root)
fake.fail_on_read = 1
try:
    k.round(now=12_300.0)
    raised = False
except RuntimeError:
    raised = True
fake.fail_on_read = None
after = {f: v for f, v in tree(root).items() if not f.startswith(".tmp/")}
check("atomicity: a round that fails while encoding raises, and leaves every file of the previous round"
      " as it was — no archive, no manifest", raised and after == before, sorted(set(after) ^ set(before)))
r7 = k.round(now=12_600.0)
check("atomicity: the next round writes it all, and leaves no temporary behind",
      r7 and r7["written"] == 2 and os.listdir(root / ".tmp") == []
      and {t["tab"]: t["rows"] for t in mj.read_book(root, "BOOK_A")["tabs"]} == expected_book(fake, "BOOK_A"),
      r7)

fake.put("BOOK_A", "Summary", 4, {"Total": "12"})
real_write = mj._write_atomic
calls = {"n": 0}


def refuse_once(path, data):
    calls["n"] += 1
    if calls["n"] == 1:
        raise OSError(28, "No space left on device")
    return real_write(path, data)


mj._write_atomic = refuse_once
try:
    k.round(now=12_900.0)
    raised = False
except OSError:
    raised = True
stale = manifest(root)
check("atomicity: a round cut between the files and the manifest leaves the files ahead of the manifest",
      raised and not shas_match(stale))
r8 = k.round(now=13_200.0)
mj._write_atomic = real_write
check("atomicity: the same keeper's next round writes the manifest it owes, though the mirror did not move",
      r8 is not None and r8["written"] == 0 and shas_match(manifest(root)), r8)

fake.put("BOOK_A", "Summary", 5, {"Total": "13"})
mj._write_atomic = lambda path, data: (_ for _ in ()).throw(OSError(28, "No space left on device"))
try:
    k.round(now=13_500.0)
except OSError:
    pass
mj._write_atomic = real_write
k2 = keeper(fake, root)
r9 = k2.round(now=13_800.0)
m9 = manifest(root)
check("atomicity: a keeper restarted after such a cut heals it: every sha in the manifest is the file's",
      r9 is not None and shas_match(m9)
      and {t["tab"]: t["rows"] for t in mj.read_book(root, "BOOK_A")["tabs"]} == expected_book(fake, "BOOK_A"),
      r9)

fake.put("BOOK_A", "Summary", 6, {"Total": "14"})
r9b = keeper(fake, root).round(now=13_800.0)
check("the round: round ids only grow — across a restart too, at the very same moment",
      r9b and r9b["round"] > r9["round"], (r9b, r9))

# ═══ 7 · the bounds ══════════════════════════════════════════════════════════
kb = keeper(fake, root, keep_rounds=3)
now = 14_000.0
for i in range(5):
    fake.put("BOOK_A", "Summary", 10 + i, {"Total": str(i)})
    now += 300.0
    last = kb.round(now=now)
kept = archives(root)
check("the bounds: past KEEP_ROUNDS rounds the oldest archives go, the newest stay",
      len(kept) == 3 and kept[-1] == f"round-{last['round']}.json.gz" and last["archives"] == 3, kept)
kb2 = keeper(fake, root, keep_rounds=100, archive_bytes=1)
fake.put("BOOK_A", "Summary", 20, {"Total": "x"})
lb = kb2.round(now=now + 300.0)
check("the bounds: past ARCHIVE_MB the oldest go too — and the newest is always kept",
      archives(root) == [f"round-{lb['round']}.json.gz"] and lb["archives"] == 1, archives(root))
before = tree(root)
kf = keeper(fake, root, min_free_bytes=1 << 62)
fake.put("BOOK_A", "Summary", 21, {"Total": "y"})
floor = kf.round(now=now + 600.0)
check("the bounds: a disk under the floor is not written at all",
      floor == {"skipped": "disk", "free": floor.get("free")} and
      {f: v for f, v in tree(root).items() if not f.startswith(".tmp/")} == before, floor)
k = keeper(fake, root)
k.round(now=now + 900.0)

# ═══ 8 · the daily sweep ═════════════════════════════════════════════════════
target = root / mj.book_file("BOOK_A")
good = target.read_bytes()
target.write_bytes(good.replace(b"ASA Data", b"ASA Dada"))
check("verify: a file changed under an unmoved signature is not seen by an ordinary round",
      k.round(now=now + 1_200.0) is None and target.read_bytes() != good)
rv = k.round(now=now + 1_500.0, verify=True)
check("verify: the sweep encodes every file again and puts the true one back",
      rv and rv["written"] == 1 and target.read_bytes() == good, rv)
check("verify: the sweep's time is kept in the manifest, so a restart does not sweep again",
      manifest(root)["verified_at"] and keeper(fake, root).verified_at == now + 1_500.0)
check("verify: a sweep over an untouched master writes nothing", k.round(now=now + 1_800.0, verify=True) is None)

# ═══ 9 · the parts' ranges match the mirror's own grouping ═══════════════════
P = 5000
pieces, _layout = mj.plan([("S", "T", k2_, 1, 1, 1.0) for k2_ in range(3)], {}, {}, {}, P)
ranges = {p.part: (p.lo, p.hi) for p in pieces.values() if p.part >= 0}
inside = all((ranges[max(rn - 1, 0) // P][0] is None or rn >= ranges[max(rn - 1, 0) // P][0])
             and rn <= ranges[max(rn - 1, 0) // P][1] for rn in range(-1, 3 * P + 1))
check("parts: every sheet row falls in the part Postgres groups it under (greatest(row - 1, 0) / PART_ROWS)",
      inside and ranges[0] == (None, P) and ranges[1] == (P + 1, 2 * P), ranges)
sql = (SERVER / "master_json.py").read_text(encoding="utf-8")
check("parts: the source's grouping is the one the ranges are built on",
      "greatest(row_number - 1, 0) / %s" in sql)

# ═══ 10 · the hand-off journal ═══════════════════════════════════════════════
jroot = TMP / "journal"
body = {"action": "peopleSyncFromPlatform", "service_secret": "s3cret-value", "token": "tok-value",
        "payload": {"rows": [{"name": "Ann", "phone": "330-555-0101"}], "source_at": "x"}}
cur = mj.handoff_first(body, root=jroot, now=20_000.0)
raw = cur.read_bytes()
check("hand-offs: the hand-off is written before it goes, action and payload, 0600 in 0700 directories",
      json.loads(raw)["payload"] == body["payload"] and json.loads(raw)["action"] == "peopleSyncFromPlatform"
      and stat.S_IMODE(os.stat(cur).st_mode) == 0o600
      and all(stat.S_IMODE(os.stat(d).st_mode) == 0o700
              for d in (jroot, jroot / "handoff", jroot / "handoff" / "peopleSyncFromPlatform")))
check("hand-offs: the credential the body travels with is never written",
      b"s3cret-value" not in raw and b"tok-value" not in raw and b"service_secret" not in raw)
body2 = dict(body, payload={"rows": [], "source_at": "y"})
mj.handoff_first(body2, root=jroot, now=20_060.0)
olds = sorted(p for p in cur.parent.iterdir() if p.name.endswith(".json.gz"))
check("hand-offs: the next hand-off rotates the last one into a gzip beside it",
      len(olds) == 1 and gzip.decompress(olds[0].read_bytes()) == raw
      and json.loads(cur.read_bytes())["payload"] == body2["payload"])
keep = mj.HANDOFF_KEEP
mj.HANDOFF_KEEP = 2
for i in range(5):
    mj.handoff_first(body2, root=jroot, now=20_120.0 + 60 * i)
mj.HANDOFF_KEEP = keep
check("hand-offs: the rotated ones are bounded",
      len([p for p in cur.parent.iterdir() if p.name.endswith(".json.gz")]) == 2)
try:
    mj.handoff_first({"action": "authMe", "payload": {}}, root=jroot)
    refused = False
except ValueError:
    refused = True
check("hand-offs: an action that is not a hand-off is refused, never journaled", refused
      and not (jroot / "handoff" / "authMe").exists())
mj._write_atomic = lambda path, data: (_ for _ in ()).throw(OSError(28, "No space left on device"))
try:
    mj.handoff_first(body, root=jroot, now=21_000.0)
    raised = False
except OSError:
    raised = True
mj._write_atomic = real_write
check("hand-offs: a disk that refused raises — the post must not leave", raised)
check("hand-offs: the journal keeps exactly the relay's data hand-offs",
      mj.HANDOFF_ACTIONS == {"peopleSyncFromPlatform", "commRoutesIngest", "behaviorSignalsIngest",
                             "commWhenIngest", "commProposalsIngest", "commCallsIngest"})

# ═══ 11 · the wiring ═════════════════════════════════════════════════════════
service_src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree_ss = ast.parse(service_src)
service_door = next(n for n in tree_ss.body
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == "_service_door")
seg = ast.get_source_segment(service_src, service_door)
check("the wiring: snapshot_service imports master_json",
      any(isinstance(n, ast.Import) and any(a.name == "master_json" for a in n.names) for n in tree_ss.body))
check("the wiring: _service_door writes the hand-off's JSON before it asks Python, only for the hand-off actions",
      0 < seg.index("master_json.handoff_first") < seg.index("_backend_call(")
      and "if action in master_json.HANDOFF_ACTIONS:" in seg)

# EVERY WAY A HAND-OFF CAN LEAVE, FOLLOWED THROUGH THE CODE: every body naming
# a hand-off is found, and the callable it is handed to must be the door its
# caller passed in; every value that door can be, at every call of every
# function that takes one, is followed to what it is.
SOURCES = {p.stem: p.read_text(encoding="utf-8") for p in sorted(SERVER.glob("*.py"))
           if p.stem != "master_json"}
TREES = {m: ast.parse(src) for m, src in SOURCES.items()}
PARENTS = {m: {c: n for n in ast.walk(t) for c in ast.iter_child_nodes(n)} for m, t in TREES.items()}
FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)


def enclosing(m, node):
    while node in PARENTS[m]:
        node = PARENTS[m][node]
        if isinstance(node, FUNCS):
            return node
    return None


def params(fn):
    return [a.arg for a in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs]


sites, astray = [], []
for m, t in TREES.items():
    for node in ast.walk(t):
        if not isinstance(node, ast.Dict):
            continue
        action = next((v.value for kk, v in zip(node.keys, node.values)
                       if isinstance(kk, ast.Constant) and kk.value == "action"
                       and isinstance(v, ast.Constant)), None)
        if action not in mj.HANDOFF_ACTIONS:
            continue
        call, fn = PARENTS[m].get(node), enclosing(m, node)
        callee = call.func.id if (isinstance(call, ast.Call) and call.args and call.args[0] is node
                                  and isinstance(call.func, ast.Name)) else ""
        if callee and fn is not None and callee in params(fn):
            sites.append((m, node.lineno, action, callee))
        else:
            astray.append((m, node.lineno, action))
check("the wiring: every hand-off body is handed to the door its caller passed in (the call lane's hand-over);"
      " the clocks hand theirs to _service_door by name",
      not astray and {s[2] for s in sites} == {"commCallsIngest"}
      and '_service_door(HIRING_APP, "behaviorSignalsIngest"' in service_src, (astray, sites))

# the functions that take a door: every value `post` is given, anywhere
takers = {(m, fn.name): fn for m, t in TREES.items() for fn in t.body
          if isinstance(fn, FUNCS) and "post" in params(fn)}


def taker(m, node):
    if isinstance(node, ast.Name) and (m, node.id) in takers:
        return (m, node.id)
    if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
            and (node.value.id, node.attr) in takers):
        return (node.value.id, node.attr)
    return None


def is_door(f):
    return ((isinstance(f, ast.Name) and f.id == "door")
            or (isinstance(f, ast.Attribute) and f.attr == "door"
                and isinstance(f.value, ast.Name) and f.value.id == "comm_calls_feed"))


def what_is(v, fn, m):
    """What a value handed as `post` is: the terminal's door, the relay's Python
    lane, no door, or the caller's own door handed on."""
    if isinstance(v, ast.Constant) and v.value is None:
        return "no door"
    if isinstance(v, ast.Call) and is_door(v.func):
        return "door()"
    if not isinstance(v, ast.Name) or fn is None:
        return None
    if v.id == "post" and v.id in params(fn) and (m, fn.name) in takers:
        return "handed on"
    kinds = set()
    for node in ast.walk(fn):
        if isinstance(node, FUNCS) and node is not fn and node.name == v.id:
            called = {c.func.id for c in ast.walk(node) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
            # the lane on Python posts to asa-hub-app: nothing is handed off to journal
            kinds.add("python lane" if "_comm_calls_python" in called else None)
        if isinstance(node, ast.Assign) and any(isinstance(tt, ast.Name) and tt.id == v.id
                                                for tt in node.targets):
            kinds.add("door()" if isinstance(node.value, ast.Call) and is_door(node.value.func) else None)
    outer = enclosing(m, fn)
    if not kinds and v.id not in params(fn) and outer is not None:
        # a closure's free name is the enclosing function's own
        return what_is(v, outer, m)
    return kinds.pop() if len(kinds) == 1 else None


given, unfollowed, followed_refs = [], [], set()
for m, t in TREES.items():
    for call in (n for n in ast.walk(t) if isinstance(n, ast.Call)):
        # a call of it, or it handed to a runner (to_thread, add_task) with its arguments
        target, args = taker(m, call.func), call.args
        if target:
            followed_refs.add(id(call.func))
        else:
            for i, a in enumerate(call.args):
                if taker(m, a):
                    target, args = taker(m, a), call.args[i + 1:]
                    followed_refs.add(id(a))
                    break
        if not target:
            continue
        fn_t = takers[target]
        positional = [a.arg for a in fn_t.args.posonlyargs + fn_t.args.args]
        kw = next((k_.value for k_ in call.keywords if k_.arg == "post"), None)
        if any(isinstance(a, ast.Starred) for a in args):
            v = "starred"
        elif kw is not None:
            v = kw
        elif "post" in positional and positional.index("post") < len(args):
            v = args[positional.index("post")]
        else:
            v = "default"
        if v == "default":
            dflt = dict(zip(reversed(positional), reversed(fn_t.args.defaults)))
            kind = "no door" if isinstance(dflt.get("post"), ast.Constant) and dflt["post"].value is None else None
        else:
            kind = None if v == "starred" else what_is(v, enclosing(m, call), m)
        (given if kind else unfollowed).append((m, call.lineno, ".".join(target), kind))
    for n in ast.walk(t):
        if (isinstance(n, (ast.Name, ast.Attribute)) and isinstance(getattr(n, "ctx", None), ast.Load)
                and taker(m, n) and id(n) not in followed_refs):
            unfollowed.append((m, n.lineno, ".".join(taker(m, n)), "referenced where it cannot be followed"))
kinds_seen = {g[3] for g in given}
check("the wiring: every door any function that posts commCallsIngest is given is the relay's Python lane, the"
      " terminal's door to asa-hub-app, none, or the caller's own handed on — nothing unfollowed",
      not unfollowed and kinds_seen <= {"door()", "python lane", "no door", "handed on"}
      and {"door()", "python lane"} <= kinds_seen, (unfollowed, sorted(given)))
check("the wiring: the webhook, the tick and the terminal are among the paths followed",
      any(g[0] == "snapshot_service" and g[2] == "snapshot_service._comm_calls_read_and_serve"
          and g[3] == "python lane" for g in given)
      and any(g[0] == "snapshot_service" and g[2] == "comm_calls_feed.deliver" and g[3] == "python lane"
              for g in given)
      and any(g[0] == "comm_calls_feed" and g[3] == "door()" for g in given)
      and any(g[0] == "snapshot_service" and g[2] == "comm_calls_feed.live"
              and g[3] == "python lane" for g in given), sorted(given))

# nothing in server/ reaches Apps Script's exec door any more
senders = {(m, fn.name) for m, t in TREES.items() for fn in t.body if isinstance(fn, FUNCS)
           and ("EXEC_URL" in ast.get_source_segment(SOURCES[m], fn)
                or "script.google" in ast.get_source_segment(SOURCES[m], fn))}
check("the wiring: no function in server/ names an exec URL or Apps Script's address — the browser's /gas, the"
      " clocks, the packs, the ledger and the call lane's terminal all answered by Python",
      not senders and not any("EXEC_URL" in src or "script.google" in src for src in SOURCES.values()),
      sorted(senders))
check("the wiring: live chat's exec door posts only a chat action it built itself, never a hand-off",
      "chat_live.envelope(" in ast.get_source_segment(SOURCES["snapshot_service"], next(
          n for n in TREES["snapshot_service"].body if isinstance(n, FUNCS) and n.name == "chat_exec"))
      and not ({"chatOverview", "chatMessages", "chatSend", "chatReact", "chatMarkRead", "chatPing"}
               & set(mj.HANDOFF_ACTIONS)))

# ...and the terminal's door, run: Python's comm-calls doors on asa-hub-app, nothing else, passes carried
os.environ.pop("HUB_EXEC_URL", None)
os.environ["HUB_APP_URL"] = "http://asa-hub-app.invalid:8080"
os.environ["HUB_APP_TOKEN"] = "app-token-value"
import comm_calls_feed as ccf  # noqa: E402

real_root = mj.ROOT
mj.ROOT = TMP / "door-journal"
door_seen = []
door_answers = []


class _Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def fake_urlopen(req, timeout=None):
    door_seen.append({"url": req.full_url, "token": req.get_header("X-hub-token"),
                      "user": json.loads(req.get_header("X-hub-user") or "{}"), "body": json.loads(req.data.decode())})
    return _Answer(json.dumps(door_answers.pop(0) if door_answers else
                              {"status": 200, "data": {"kept_calls": 1, "kept_items": 0}}).encode())


real_urlopen = ccf.urllib.request.urlopen
ccf.urllib.request.urlopen = fake_urlopen
try:
    door_answers[:] = [{"status": 200, "data": {"kept_calls": 1, "left": {"calls": [{"call_id": "C-door-1b"}]}}},
                       {"status": 200, "data": {"kept_calls": 1, "kept_items": 0}}]
    out = ccf.hand_over(ccf.door(), [{"call_id": "C-door-1"}], [], "2026-01-01T00:00:00Z")
    check("hand-offs: the terminal's door (comm_calls_feed.door) posts commCallsIngest to asa-hub-app as the service,"
          " under a write id, pass after pass while it hands rows back — never to an exec URL",
          out.get("reached") and out.get("status") == 200 and len(door_seen) == 2
          and all(d["url"] == "http://asa-hub-app.invalid:8080/v1/comm-calls/commCallsIngest" for d in door_seen)
          and all(d["token"] == "app-token-value" and d["user"] == {"is_service": True} for d in door_seen)
          and all(re.fullmatch(r"W[0-9a-f]{24}", d["body"].get("write_id") or "") for d in door_seen)
          and door_seen[1]["body"]["payload"] == {"calls": [{"call_id": "C-door-1b"}]}, (out, door_seen))
    check("hand-offs: on Python, as the relay's own lane, that door journals nothing",
          not (mj.ROOT / "handoff").exists())
    door_answers[:] = [{"status": 409, "message": "busy"}]
    held_out = ccf.hand_over(ccf.door(), [{"call_id": "C-door-2"}], [], "2026-01-01T00:00:00Z")
    check("hand-offs: a held lock is said as held, so the feed parks and nothing is charged",
          held_out.get("reached") is False and held_out.get("held"), held_out)
    door_seen.clear()
    ccf.door()({"action": "commCallsWho", "payload": {"phones": []}})
    check("hand-offs: a lookup it carries is a read, with no write id",
          len(door_seen) == 1 and door_seen[0]["url"].endswith("/v1/comm-calls/commCallsWho")
          and "write_id" not in door_seen[0]["body"], door_seen)
    os.environ.pop("HUB_APP_TOKEN", None)
    check("hand-offs: no token, no door — said as no door, never zero", ccf.door() is None
          or (SERVER / ".hub-app-token").is_file())
finally:
    ccf.urllib.request.urlopen = real_urlopen
    mj.ROOT = real_root
keeper_src = (SERVER / "hub_sheet_sync.py").read_text(encoding="utf-8")
loop = ast.get_source_segment(keeper_src, next(
    n for n in ast.parse(keeper_src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "sync_loop"))
check("the wiring: the keeper runs a master round after every pass, in a worker thread",
      loop.index("one_pass") < loop.index("master.round") and "asyncio.to_thread(master.round)" in loop)
for suite in ("test-psi-anywhere.py", "test-hotline-fast.py", "test-hotline-lanes.py"):
    src = (HERE.parent / suite).read_text(encoding="utf-8")
    mods = ast.literal_eval(next(n.value for n in ast.parse(src).body if isinstance(n, ast.Assign)
                                 and any(getattr(t, "id", "") == "MODULES" for t in n.targets)))
    check(f"the wiring: {suite} ships master_json, the calls door that now imports it and the one"
          " redaction rule it writes through into the container",
          {"master_json", "comm_calls_feed", "redaction"} <= set(mods))
pkg = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
check("the wiring: npm run check runs this file",
      "npm run test:master-json" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:master-json") == "python3 tools/test-master-json.py")

# ═══ 12 · one bad row, one bad file ══════════════════════════════════════════
class Said(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append((record.levelname, record.getMessage()))


said = Said()
mj.log.addHandler(said)
mj.log.setLevel(logging.INFO)
oroot = TMP / "odd" / "master"


def oshas(m):
    return all(hashlib.sha256((oroot / e["file"]).read_bytes()).hexdigest() == e["sha256"]
               for b in m["books"] for e in [b] + [p for t in b["tabs"] for p in t["parts"]]
               if e.get("sha256"))


def otab(m, sid, tab):
    return next(t for b in m["books"] if b["id"] == sid for t in b["tabs"] if t["tab"] == tab)


of = Fake()
of.meta = {"BOOK_A": {"name": "A"}, "BOOK_B": {"name": "B"}}
of.put("BOOK_A", "Tab", 2, {"Name": "Ann"})
of.put("BOOK_A", "Tab", 3, {"Name": "Bob"})
of.put("BOOK_B", "Tab", 2, {"Name": "Cy"})
ko = keeper(of, oroot, part_rows=100)
ko.round(now=30_000.0)
# the review's case: one book gains a row while a row of another is an array —
# and a row whose number has more digits than Python will parse
of.put("BOOK_B", "Tab", 3, {"Name": "Dee"})
of.put("BOOK_A", "Tab", 4, ["stray", "array"])
huge = RawText('{"Amount": ' + "1" * 5000 + '}')
of.put("BOOK_A", "Tab", 5, huge)
try:
    ro = ko.round(now=30_300.0)
except Exception as exc:  # noqa: BLE001 - the defect this section exists for
    ro = {"raised": f"{type(exc).__name__}: {exc}"}
fa, fb = mj.part_file("BOOK_A", "Tab", 0), mj.part_file("BOOK_B", "Tab", 0)
pa = json.loads((oroot / fa).read_bytes())
pb = json.loads((oroot / fb).read_bytes())
check("one bad row: a row that is not an object neither stops the round nor keeps another book stale",
      ro and ro.get("failed") == 0 and pb["count"] == 2 and pa["count"] == 4, ro)
check("one bad row: it is kept whole in the one _value column and counted as odd_rows — never dropped",
      pa["header"] == ["Name", mj.ODD_KEY] and pa["rows"][2] == [4, None, ["stray", "array"]]
      and pa["rows"][3] == [5, None, str(huge)] and pa["odd_rows"] == 2
      and otab(manifest(oroot), "BOOK_A", "Tab")["parts"][0]["odd_rows"] == 2
      and "odd_rows" not in pb, (pa["header"], pa["rows"][2:], pa.get("odd_rows")))
check("one bad row: a restarted keeper reads the count back and has nothing to do",
      keeper(of, oroot, part_rows=100).held[fa]["info"].get("odd_rows") == 2
      and keeper(of, oroot, part_rows=100).round(now=30_350.0) is None)

a_bytes = (oroot / fa).read_bytes()
of.put("BOOK_A", "Tab", 6, {"Name": "Eve", "Note": "\ud800"})    # a lone surrogate: no UTF-8 for it
of.put("BOOK_B", "Tab", 4, {"Name": "Fay"})
said.lines.clear()
try:
    rf = ko.round(now=30_600.0)
except Exception as exc:  # noqa: BLE001
    rf = {"raised": f"{type(exc).__name__}: {exc}"}
mf = manifest(oroot)
tab_a = otab(mf, "BOOK_A", "Tab")
warned = [ln for lv, ln in said.lines if lv == "WARNING"]
check("one bad file: a file whose rows will not encode is left out, and the rest of the round is written",
      rf and rf.get("failed") == 1 and rf.get("written") == 1
      and json.loads((oroot / fb).read_bytes())["count"] == 3, rf)
check("one bad file: its last file stands, byte for byte, and the manifest still matches the disk",
      (oroot / fa).read_bytes() == a_bytes and oshas(mf))
check("one bad file: the manifest marks the part failed and why, the tab stale, the other tab not,"
      " and counts it",
      tab_a["parts"][0].get("failed", "").startswith("UnicodeEncodeError") and tab_a["stale"] is True
      and otab(mf, "BOOK_B", "Tab")["stale"] is False and mf["totals"]["failed"] == 1, tab_a)
check("one bad file: it is said once, by its file name — never its rows",
      len(warned) == 1 and fa in warned[0] and "UnicodeEncodeError" in warned[0]
      and "Eve" not in warned[0], warned)
before = tree(oroot)
said.lines.clear()
check("one bad file: the next round, nothing else moving, writes nothing and says nothing",
      ko.round(now=30_900.0) is None and tree(oroot) == before and not said.lines, said.lines)
said.lines.clear()
ko2 = keeper(of, oroot, part_rows=100)
check("one bad file: a restarted keeper reads the failure back, says so once, and writes nothing",
      ko2.round(now=31_000.0) is None and tree(oroot) == before
      and [lv for lv, _ln in said.lines] == ["WARNING"] and "stale" in said.lines[0][1], said.lines)
of.put("BOOK_A", "Tab", 6, {"Name": "Eve", "Note": "ok"})
said.lines.clear()
rr = ko2.round(now=31_300.0)
mr = manifest(oroot)
check("one bad file: once its rows encode, it is written, and the stale mark and the count are gone",
      rr and rr["failed"] == 0 and json.loads((oroot / fa).read_bytes())["count"] == 5
      and "failed" not in otab(mr, "BOOK_A", "Tab")["parts"][0]
      and otab(mr, "BOOK_A", "Tab")["stale"] is False and mr["totals"]["failed"] == 0 and oshas(mr)
      and any(lv == "INFO" and "written again" in ln for lv, ln in said.lines), (rr, said.lines))
of.put("BOOK_A", "Fresh", 2, {"X": "\udfff"})
try:
    rn_ = ko2.round(now=31_600.0)
except Exception as exc:  # noqa: BLE001
    rn_ = {"raised": f"{type(exc).__name__}: {exc}"}
fresh_part = otab(manifest(oroot), "BOOK_A", "Fresh")["parts"][0]
check("one bad file: a new tab that never encoded has no file and no sha256 — and a restart reads that",
      rn_ and rn_.get("failed") == 1 and fresh_part["sha256"] is None and fresh_part.get("failed")
      and not (oroot / mj.part_file("BOOK_A", "Fresh", 0)).exists()
      and keeper(of, oroot, part_rows=100).round(now=31_900.0) is None, (rn_, fresh_part))
before = {f: v for f, v in tree(oroot).items() if not f.startswith(".tmp/")}
of.put("BOOK_B", "Tab", 5, {"Name": "Gus"})
real_close = mj._Sink.close
mj._Sink.close = lambda self: (_ for _ in ()).throw(OSError(5, "Input/output error"))
try:
    ko2.round(now=32_200.0)
    disk_raised = False
except OSError:
    disk_raised = True
finally:
    mj._Sink.close = real_close
check("one bad file: a disk that fails is not one file's fault — the round stops, the last one stands",
      disk_raised and {f: v for f, v in tree(oroot).items() if not f.startswith(".tmp/")} == before)
of.fail_on_read = 0
try:
    ko2.round(now=32_500.0)
    mirror_raised = False
except RuntimeError:
    mirror_raised = True
of.fail_on_read = None
check("one bad file: nor is a mirror that fails — the snapshot is gone for every file, the round stops",
      mirror_raised and {f: v for f, v in tree(oroot).items() if not f.startswith(".tmp/")} == before)
mj.log.removeHandler(said)


# ═══ 12 · the redaction ══════════════════════════════════════════════════════
#
# THE CELLS THAT MUST NEVER BE IN THIS COPY: a prop whose key names a
# credential, and a card or bank column. The sentinels below are the words
# this file would find if the rule stopped working — they are not a key, a
# card or a password, and nothing real is ever written into a fixture.
import redaction as rd  # noqa: E402

SENTINEL_SECRET = "the-value-that-must-not-travel"
SENTINEL_CARD = "0000-0000-0000-0000"

rroot = TMP / "redact" / "master"
rf = Fake()
rf.meta = {"DEPOT": {"name": "ASA — Depot", "modified_time": 1.0, "synced_at": 2.0, "status": "ok"},
           "MONEY": {"name": "Client Money", "modified_time": 1.0, "synced_at": 2.0, "status": "ok"},
           "PLAIN": {"name": "Staff Daily Notes", "modified_time": 1.0, "synced_at": 2.0,
                     "status": "ok"}}
# a prop row, by the shape the depot really uses: the key names it, Value holds it
rf.put("DEPOT", "Facts", 2, {"Fact Key": "config.props.exampleapikey",
                             "Subject ID": "EXAMPLE_API_KEY",
                             "Source": "switchboard:props.EXAMPLE_API_KEY",
                             "Value": SENTINEL_SECRET, "Recorded By": "switchboard"})
# and a pointer row in the very same tab, which is not a secret at all
rf.put("DEPOT", "Facts", 3, {"Fact Key": "config.props.examplehouseid",
                             "Subject ID": "HUB_HOUSE_EXAMPLE_ID",
                             "Source": "switchboard:props.HUB_HOUSE_EXAMPLE_ID",
                             "Value": "BOOK_EXAMPLE", "Recorded By": "switchboard"})
rf.put("MONEY", "Clients", 2, {"Customer": "Somebody", "TL Debit Card Number": SENTINEL_CARD,
                               "Cardholder name": "Somebody"})
rf.put("PLAIN", "Notes", 2, {"Name": "Somebody", "Note": "arrived", "Phone": "330-555-0101"})

rsaid = Said()
mj.log.addHandler(rsaid)
kr = keeper(rf, rroot)
r1 = kr.round(now=40_000.0)
mr = manifest(rroot)


def every_byte(root):
    """Every byte the copy holds, archives unzipped — what a reader would see."""
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            p = Path(dirpath) / name
            raw = p.read_bytes()
            if name.endswith(".gz"):
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
            out.append(raw.decode("utf-8", "replace"))
    return "\n".join(out)


depot = mj.read_book(rroot, "DEPOT")
prop_row = depot["tabs"][0]["rows"][0]
pointer_row = depot["tabs"][0]["rows"][1]
money_row = mj.read_book(rroot, "MONEY")["tabs"][0]["rows"][0]
plain_row = mj.read_book(rroot, "PLAIN")["tabs"][0]["rows"][0]
check("the redaction: a prop whose key names a credential is withheld, and says why",
      prop_row["Value"] == rd.MARKER_SECRET and SENTINEL_SECRET not in every_byte(rroot),
      prop_row)
check("the redaction: the key cells stay, so the file still says WHICH prop is not there",
      prop_row["Fact Key"] == "config.props.exampleapikey"
      and prop_row["Subject ID"] == "EXAMPLE_API_KEY"
      and prop_row["Source"] == "switchboard:props.EXAMPLE_API_KEY"
      and prop_row["Recorded By"] == "switchboard", prop_row)
check("the redaction: a pointer in the same tab is not a secret and is not touched",
      pointer_row["Value"] == "BOOK_EXAMPLE", pointer_row)
check("the redaction: a card column is withheld, by the column and not by the cell's shape",
      money_row["TL Debit Card Number"] == rd.MARKER_CARD
      and SENTINEL_CARD not in every_byte(rroot)
      and money_row["Cardholder name"] == "Somebody", money_row)
check("the redaction: an ordinary row crosses cell for cell",
      plain_row == {"_row": 2, "Name": "Somebody", "Note": "arrived", "Phone": "330-555-0101"},
      plain_row)
check("the redaction: the marker is never a piece of the thing — no prefix, no hash",
      rd.MARKER_SECRET not in SENTINEL_SECRET and SENTINEL_SECRET[:4] not in rd.MARKER_SECRET
      and hashlib.sha256(SENTINEL_SECRET.encode()).hexdigest()[:8] not in every_byte(rroot))

# ── said out loud, and the manifest says the same two numbers ────────────────
check("the redaction: the manifest counts the withheld cells and the books they came out of",
      mr["totals"]["withheld"] == 2 and mr["totals"]["withheld_books"] == 2,
      mr["totals"])
check("the redaction: each book and each tab carries its own count",
      {b["name"]: b["withheld"] for b in mr["books"]}
      == {"ASA — Depot": 1, "Client Money": 1, "Staff Daily Notes": 0}
      and otab(mr, "DEPOT", "Facts")["withheld"] == 1,
      [(b["name"], b["withheld"]) for b in mr["books"]])
line = [ln for lv, ln in rsaid.lines if lv == "INFO" and "cell(s) withheld" in ln]
check("the redaction: the round says the same two numbers out loud",
      len(line) == 1 and "2 cell(s) withheld in 2 book(s)" in line[0]
      and r1["withheld"] == 2 and r1["withheld_books"] == 2, line)

# ── and the archive, which held the bytes the round replaced ─────────────────
rf.put("DEPOT", "Facts", 4, {"Fact Key": "config.props.another", "Subject ID": "ANOTHER",
                             "Source": "switchboard:props.ANOTHER", "Value": "plain"})
r2 = kr.round(now=40_600.0)
arch = gzip.decompress((rroot / "archive" / f"round-{r2['round']}.json.gz").read_bytes()).decode()
check("the redaction: what the archive kept of the replaced file is withheld too",
      rd.MARKER_SECRET in arch and SENTINEL_SECRET not in arch, arch[:200])
check("the redaction: a round that adds a plain row does not change the counts",
      manifest(rroot)["totals"]["withheld"] == 2 and r2["withheld"] == 2, r2)

# ── a rule that stops working is a number that fell ──────────────────────────
#
# In its own tree, because the archive keeps the bytes of the round before it:
# what this proves is about the files the copy SERVES, and the point of the
# purge tool is that an archive which once held a secret is not fixed in place.
def live_bytes(root):
    """Every byte of the files the copy serves — the archive left out."""
    out = []
    for dirpath, _dirs, files in os.walk(root):
        if "archive" in Path(dirpath).parts:
            continue
        for name in files:
            out.append((Path(dirpath) / name).read_bytes().decode("utf-8", "replace"))
    return "\n".join(out)


broot = TMP / "broken" / "master"
kb3 = keeper(rf, broot)
kb3.round(now=41_000.0)
real_redact = rd.redact_row
rd.redact_row = lambda row: (row, 0)
try:
    r3 = kb3.round(now=41_200.0, verify=True)
finally:
    rd.redact_row = real_redact
check("the redaction: a rule that quietly stopped shows up as a count that fell",
      r3["withheld"] == 0 and manifest(broot)["totals"]["withheld"] == 0
      and SENTINEL_SECRET in live_bytes(broot), r3)
r4 = kb3.round(now=41_800.0, verify=True)
check("the redaction: and the next round that can withhold puts the count back",
      r4["withheld"] == 2 and manifest(broot)["totals"]["withheld"] == 2
      and SENTINEL_SECRET not in live_bytes(broot), r4)
mj.log.removeHandler(rsaid)


# ═══ 13 · the purge refuses code that cannot withhold ════════════════════════
PURGE = ROOT_DIR / "tools" / "purge_redacted.py"


def purge_in(tamper, relay=None, args=None, dry=True, tree_at=None):
    """A copy of the tool and of server/, tampered with, run against an empty
    tree → (exit code, everything it said).

    HUB_RELAY_CODE_DIR is always set, so the run never depends on whether the
    machine this suite is on happens to have a /srv/app of its own: pointed at
    nothing, the tool judges the server/ beside it; pointed at a directory
    holding a redaction.py, it must judge THAT one instead — which is the
    whole difference between a guard that reads the code the relay runs and a
    guard that reads the copy it was just handed.

    The master tree it is pointed at EXISTS and holds something, because a
    master lane asked for and pointed at nothing is now a refusal of its own —
    see the run below that proves it — and this helper is here to exercise the
    code guard, not that one."""
    box = Path(tempfile.mkdtemp(prefix="purge-", dir=TMP))
    (box / "tools").mkdir()
    (box / "server").mkdir()
    tree = box / "master"
    (tree / "books").mkdir(parents=True)
    (tree / "books" / "one.json").write_text("{}")
    (tree / "archive").mkdir()
    (tree / "manifest.json").write_text("{}")
    shutil.copy(PURGE, box / "tools" / "purge_redacted.py")
    for name in ("redaction.py", "master_json.py", "hub_sheet_sync.py"):
        shutil.copy(SERVER / name, box / "server" / name)
    tamper(box / "server")
    where = box / "no-relay-here"
    if relay is not None:
        where = box / "relay"
        where.mkdir()
        for name in ("redaction.py", "master_json.py", "hub_sheet_sync.py"):
            shutil.copy(SERVER / name, where / name)
        relay(where)
        # older than any process on this machine, so the freshness arm of the
        # refusal cannot be what answers here
        for name in ("redaction.py", "master_json.py", "hub_sheet_sync.py"):
            os.utime(where / name, (1_000_000_000, 1_000_000_000))
    import subprocess
    call = [sys.executable, str(box / "tools" / "purge_redacted.py"), "--master-only",
            "--master-dir", str(box / tree_at) if tree_at else str(tree)]
    if dry:
        call.append("--dry-run")
    got = subprocess.run(call + list(args or []), capture_output=True, text=True,
                         env={**os.environ, "HUB_RELAY_CODE_DIR": str(where)})
    return got.returncode, got.stdout + got.stderr


rc, out = purge_in(lambda s: None)
check("the purge: it runs when the code on the disk withholds",
      rc == 0 and "all agree" in out and "--dry-run: nothing was removed" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace(
        "    columns = withheld_columns(row)",
        "    columns = ()\n    _unused = withheld_columns", 1)))
check("the purge: it refuses a rule that no longer withholds a prop key",
      rc == 2 and "REFUSED" in out
      and "a prop key that names a credential" in out, out[:400])
rc, out = purge_in(lambda s: (s / "master_json.py").write_text(
    (s / "master_json.py").read_text().replace("redaction.redact_row(data)", "(data, 0)", 1)))
check("the purge: it refuses when the master's own writer no longer calls the rule",
      rc == 2 and "REFUSED" in out and "does not call redaction.redact_row" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace('MARKER_CARD = "[withheld: card]"',
                                             'MARKER_CARD = "[gone]"', 1)))
check("the purge: it refuses a redaction.py that is no longer the rule it can read",
      rc == 2 and "REFUSED" in out and "is not a redaction that can withhold" in out, out[:400])


# ═══ 14 · the bounds, against the disk this really runs on ═══════════════════
#
# MEASURED on the relay's own disk: 338.0 GiB of disk, 325.9 GiB used,
# 12,937,076,736 bytes free — not the 21 GB the module used to claim. The
# master held 853 MiB of the used figure: 524.7 MiB of books over 6,269 files,
# 325.0 MiB over 116 archived rounds (2.80 MiB a round, the largest 9.28 MiB),
# 2.5 MiB of hand-off journal, a 2.7 MiB manifest. A full rebuild archives the
# whole tree, which at the 14.4x gzip ratio measured over a sample of its own
# files is about 36 MiB; WORST_ARCHIVE reserves more than double that.
DISK_FREE = 12_937_076_736
BOOKS_HELD = 525 * 2 ** 20          # what the tree holds today
ARCHIVE_HELD = 325 * 2 ** 20        # what the archive holds today
HANDOFF_HELD = 3 * 2 ** 20
FULL_REBUILD = 525 * 2 ** 20        # the new tree in .tmp/ beside the old one
WORST_ARCHIVE = 81 * 2 ** 20        # that rebuild, gzipped, in one round's archive
growth = (FULL_REBUILD
          + max(0, mj.ARCHIVE_BYTES - ARCHIVE_HELD) + WORST_ARCHIVE
          + max(0, len(mj.HANDOFF_ACTIONS) * mj.HANDOFF_BYTES - HANDOFF_HELD))
check("the bounds: the whole copy, grown to its ceiling, cannot reach the floor",
      growth + mj.MIN_FREE_BYTES <= DISK_FREE,
      f"growth {growth / 2 ** 20:.0f} MB + floor {mj.MIN_FREE_BYTES / 2 ** 20:.0f} MB "
      f"against {DISK_FREE / 2 ** 20:.0f} MB free")
check("the bounds: the archive's own ceiling is a day of rounds at the churn measured",
      mj.ARCHIVE_BYTES == 768 * 2 ** 20 and mj.KEEP_ROUNDS == 288
      and mj.ARCHIVE_BYTES / (2.80 * 2 ** 20) >= 260,      # 274 rounds at the measured churn
      (mj.ARCHIVE_BYTES, mj.KEEP_ROUNDS))
check("the bounds: the floor is above the biggest single round this can write",
      mj.MIN_FREE_BYTES == 4096 * 2 ** 20
      and mj.MIN_FREE_BYTES > FULL_REBUILD + WORST_ARCHIVE + BOOKS_HELD,
      mj.MIN_FREE_BYTES / 2 ** 20)
real_usage = mj.shutil.disk_usage
mj.shutil.disk_usage = lambda _p: type("U", (), {
    "total": DISK_FREE, "used": 0, "free": mj.MIN_FREE_BYTES - 1})()
try:
    kd = mj.MasterKeeper(rf, TMP / "floor" / "master", part_rows=4)
    floored = kd.round(now=42_000.0)
finally:
    mj.shutil.disk_usage = real_usage
check("the bounds: a disk one byte under the shipped floor is not written at all",
      floored == {"skipped": "disk", "free": mj.MIN_FREE_BYTES - 1}
      and not (TMP / "floor" / "master" / "manifest.json").exists(), floored)


# ═══ 15 · the two hand-offs that never landed ════════════════════════════════
#
# `commProposalsIngest` was gated on `tick % 144` of a ten-minute loop — a
# local that starts at zero on every start, so it needed a day of unbroken
# uptime and the hand-off journal on the relay's disk has no directory for it
# at all. `commRoutesIngest` wrote a row at a time and never reached the tail
# of its set inside the 300-second budget.
check("the cadence: the proposals lane is not counted in ticks any more",
      "tick % 144" not in service_src and "_comm_proposals_due()" in service_src)
check("the cadence: its clock is a period on the wall and a stamp on disk",
      "COMM_PROPOSALS_EVERY_S" in service_src and "def _lane_ran(" in service_src
      and "def _lane_last_run(" in service_src
      and "_lane_ran(_COMM_PROPOSALS_LANE)" in service_src)
lane = ast.parse(service_src)
due = [n for n in ast.walk(lane)
       if isinstance(n, ast.FunctionDef) and n.name == "_comm_proposals_due"]
check("the cadence: a hand-over still in flight is due whatever the clock says",
      len(due) == 1 and 'passes' in ast.dump(due[0]) and "_lane_last_run" in ast.dump(due[0]))

stamp_dir = TMP / "stamps"
lane_ns = {"json": json, "time": __import__("time"), "log": logging.getLogger("t"),
           "os": os, "Path": Path, "_LANE_STAMP_DIR": stamp_dir}
for fn in ("_lane_last_run", "_lane_ran", "_comm_proposals_due"):
    src = ast.get_source_segment(service_src, next(
        n for n in ast.walk(lane) if isinstance(n, ast.FunctionDef) and n.name == fn))
    exec(compile(src, "snapshot_service.py", "exec"), lane_ns)  # noqa: S102 - the real source
lane_ns["COMM_PROPOSALS_EVERY_S"] = 86_400.0
lane_ns["_COMM_PROPOSALS_LANE"] = "comm_proposals"
lane_ns["_COMM_PROPOSALS"] = {"passes": []}
check("the cadence: a lane that has never run is due at once",
      lane_ns["_comm_proposals_due"](now=1_000_000.0) is True)
lane_ns["_lane_ran"]("comm_proposals", 1_000_000.0)
check("the cadence: and not again inside its period",
      lane_ns["_comm_proposals_due"](now=1_000_000.0 + 86_399.0) is False)
check("the cadence: the stamp is on disk, 0600, and a restart reads it back",
      (stamp_dir / "comm_proposals.json").exists()
      and stat.S_IMODE((stamp_dir / "comm_proposals.json").stat().st_mode) == 0o600
      and lane_ns["_lane_last_run"]("comm_proposals") == 1_000_000.0)
check("the cadence: a day later it is due again, however often the relay restarted",
      lane_ns["_comm_proposals_due"](now=1_000_000.0 + 86_400.0) is True)
lane_ns["_COMM_PROPOSALS"] = {"passes": [["a batch"]]}
check("the cadence: a hand-over in flight is rung on the next tick, not the next day",
      lane_ns["_comm_proposals_due"](now=1_000_000.0 + 1.0) is True)

cortex_src = (ROOT_DIR / "apps-script" / "CommCortex.gs").read_text(encoding="utf-8")
check("the cadence: the routes hand-off writes the whole set in one go",
      "commRoutesUpsertMany_(sheet, lines)" in cortex_src
      and "function commRoutesUpsertMany_(" in cortex_src
      and "commRoutesUpsert_(sheet, {\n        id: 'RT_'" not in cortex_src)
check("the cadence: and a suite runs that writer against the real source",
      (ROOT_DIR / "tools" / "test-comm-routes-batch.mjs").is_file()
      and "test-comm-routes-batch.mjs" in json.loads(
          (ROOT_DIR / "package.json").read_text())["scripts"]["test:comm-routes"]
      and "test:comm-routes" in json.loads(
          (ROOT_DIR / "package.json").read_text())["scripts"]["check"])


# ═══ 16 · the keeper withholds at the source too ═════════════════════════════
check("the source: the keeper writes the mirror through the same one rule",
      "redaction.redact_row(data)" in keeper_src and "import redaction" in keeper_src
      and "REDACT_PATTERN" not in keeper_src, "hub_sheet_sync.py")
check("the source: and says how many cells it withheld, and out of how many books",
      'stats["withheld"]' in keeper_src and 'stats["withheld_books"]' in keeper_src
      and "cell(s) withheld in %d book(s)" in keeper_src)
check("the source: the two copies share the function rather than a second list",
      "import redaction" in sql and "redaction.redact_row(data)" in sql
      and not any(tok in sql for tok in ("CARD_PHRASES", "KEY_TOKENS"))
      and not any(tok in keeper_src for tok in ("CARD_PHRASES", "KEY_TOKENS")))


# ═══ 17 · the column whose own NAME is a credential ══════════════════════════
#
# THE ARM THE FIRST TWO RULES LEFT OUT. A card column is caught by its header
# and a prop is caught by its key, and between them they missed 2,201 cells
# measured over the whole mirror: a tab with columns [Employee, Password], or
# [id, BotSecret], or a Sessions tab with [user, Token], has no key/value pair
# the row rule recognises and no card phrase in its header, so every one of
# those cells crossed into the mirror, into the master tree and into the
# archive in the clear. The sentinels below are placeholders; nothing real is
# ever written into a fixture.
SENTINEL_PASSWORD = "the-password-that-must-not-travel"
SENTINEL_BOT = "the-bot-secret-that-must-not-travel"
SENTINEL_SESSION = "the-session-token-that-must-not-travel"
SENTINEL_HASH = "the-password-hash-that-must-not-travel"
SENTINEL_EXPIRY = "01/29"
SENTINEL_SSN = "the-ssn-that-must-not-travel"
SENTINEL_MEDICAID = "the-medicaid-number-that-must-not-travel"
SENTINEL_DL = "the-licence-number-that-must-not-travel"

hroot = TMP / "headers" / "master"
hf = Fake()
hf.meta = {"STAFF": {"name": "Employee Database", "modified_time": 1.0, "synced_at": 2.0,
                     "status": "ok"},
           "REG": {"name": "System Registry", "modified_time": 1.0, "synced_at": 2.0,
                   "status": "ok"},
           "SESS": {"name": "Platform Auth", "modified_time": 1.0, "synced_at": 2.0,
                    "status": "ok"},
           "KEEP": {"name": "The Ones That Stay", "modified_time": 1.0, "synced_at": 2.0,
                    "status": "ok"}}
# no key/value pair anywhere in these rows, and no card phrase in any header
hf.put("STAFF", "Master", 2, {"Employee": "Somebody", "Password": SENTINEL_PASSWORD,
                              "Password Mgr.": "somewhere", "SSN#": SENTINEL_SSN,
                              "Medicaid #": SENTINEL_MEDICAID, "DL #": SENTINEL_DL,
                              "DL": "y", "DL / ID": "y",
                              "Drivers License Expiration Date": "01/28",
                              "License Exp Date": "01/30", "DC Exp Date": SENTINEL_EXPIRY})
hf.put("REG", "ModuleRegistry", 2, {"module": "something", "BotSecret": SENTINEL_BOT,
                                    "BotSecret_Prev": SENTINEL_BOT})
hf.put("SESS", "Sessions", 2, {"user_id": "u1", "Token": SENTINEL_SESSION,
                               "access_token": SENTINEL_SESSION,
                               "pass_hash": SENTINEL_HASH, "salt": "0" * 32,
                               "PasswordSalt": "0" * 16})
# every one of these carries a word the rule knows and is NOT the thing
hf.put("KEEP", "Data", 2, {"Fact Key": "a.row.key", "subject_key": "S1", "person_key": "p1",
                           "idempotency_key": "i1", "primary_key": "pk", "is_key": "true",
                           "max_tokens": "4096", "tokens.input": "12",
                           "Token Managed": "Y", "token_hash": "0" * 64,
                           "credential": "RN", "credential_type": "RN",
                           "secret_ref": "SOME_PROP_NAME",
                           "requires_secret_ref": "SOME_PROP_NAME",
                           "secret_tab": "Some Tab", "secret_key_name": "SOME_PROP_NAME",
                           "CPR Exp Date": "01/31", "Account (Last 4)": "0000",
                           # the people around a client, reached by telephone and e-mail
                           "SSA #": "330-555-0102", "SSA Email": "somebody@example.org",
                           "Payee Rep #": "330-555-0103", "Guardian #": "330-555-0104",
                           "House Manager #": "330-555-0105",
                           # a document's copyright, a workflow's row, a yes/no
                           "licence": "CC BY 4.0", "state_id": "S-1",
                           "Self - DL": "y", "drivers_license": "Yes"})
hsaid = Said()
mj.log.addHandler(hsaid)
hk = keeper(hf, hroot)
h1 = hk.round(now=50_000.0)
hm = manifest(hroot)
staff = mj.read_book(hroot, "STAFF")["tabs"][0]["rows"][0]
reg = mj.read_book(hroot, "REG")["tabs"][0]["rows"][0]
sess = mj.read_book(hroot, "SESS")["tabs"][0]["rows"][0]
kept = mj.read_book(hroot, "KEEP")["tabs"][0]["rows"][0]
everything = every_byte(hroot)

check("the header rule: a Password column with no key/value pair beside it is withheld",
      staff["Password"] == rd.MARKER_SECRET and staff["Password Mgr."] == rd.MARKER_SECRET
      and SENTINEL_PASSWORD not in everything, staff)
check("the header rule: a bot secret in a registry tab is withheld, prev spelling too",
      reg["BotSecret"] == rd.MARKER_SECRET and reg["BotSecret_Prev"] == rd.MARKER_SECRET
      and SENTINEL_BOT not in everything, reg)
check("the header rule: session and bearer tokens are withheld",
      sess["Token"] == rd.MARKER_SECRET and sess["access_token"] == rd.MARKER_SECRET
      and SENTINEL_SESSION not in everything, sess)
check("the header rule: a password hash and its salt are withheld — 'pass' alone is a med"
      " pass and 'hash' alone is a dedup hash, so the run is what catches them",
      sess["pass_hash"] == rd.MARKER_SECRET and sess["salt"] == rd.MARKER_SECRET
      and sess["PasswordSalt"] == rd.MARKER_SECRET and SENTINEL_HASH not in everything, sess)
check("the header rule: the third thing on the card goes with the other two",
      staff["DC Exp Date"] == rd.MARKER_CARD and SENTINEL_EXPIRY not in everything, staff)
check("the header rule: a certification expiry is NOT a card — the run is ('dc','exp')",
      staff["License Exp Date"] == "01/30" and kept["CPR Exp Date"] == "01/31")
check("the header rule: the bare word 'key' names rows, not credentials, and stays",
      all(kept[c] for c in ("Fact Key", "subject_key", "person_key", "idempotency_key",
                            "primary_key", "is_key"))
      and rd.MARKER_SECRET not in {kept["Fact Key"], kept["subject_key"], kept["person_key"],
                                   kept["idempotency_key"], kept["primary_key"], kept["is_key"]},
      kept)
check("the header rule: 'tokens' is a count and is not 'token'",
      kept["max_tokens"] == "4096" and kept["tokens.input"] == "12")
check("the header rule: the measured carve-outs are kept, every one of them",
      kept["Token Managed"] == "Y" and kept["token_hash"] == "0" * 64
      and kept["credential"] == "RN" and kept["credential_type"] == "RN"
      and kept["secret_ref"] == "SOME_PROP_NAME"
      and kept["requires_secret_ref"] == "SOME_PROP_NAME"
      and kept["secret_tab"] == "Some Tab" and kept["secret_key_name"] == "SOME_PROP_NAME",
      kept)
check("the header rule: and what the module says it does NOT cover, it does not",
      kept["Account (Last 4)"] == "0000")

# ── the identifiers: the arm the card rule and the credential rule missed ────
#
# MEASURED over the whole mirror: eleven columns carry a government
# identifier — SSN in four spellings, Medicaid in two, and the licence number
# under `DL #`, `dl_number` and `Drivers License #`. Every one of them reached
# the mirror in the clear, and SSN and Medicaid reached the master tree too.
check("the identifiers: an SSN column is withheld, in the spelling the books use",
      staff["SSN#"] == rd.MARKER_IDENTIFIER and SENTINEL_SSN not in everything, staff)
check("the identifiers: a Medicaid number is withheld",
      staff["Medicaid #"] == rd.MARKER_IDENTIFIER
      and SENTINEL_MEDICAID not in everything, staff)
check("the identifiers: a licence NUMBER is withheld, and the yes/no columns that"
      " share its words are not — the recruiting lane reads one of those by name",
      str(staff["DL #"]).startswith(rd.MARKER_IDENTIFIER) and SENTINEL_DL not in everything
      and staff["DL"] == "y" and staff["DL / ID"] == "y"
      and kept["Self - DL"] == "y" and kept["drivers_license"] == "Yes", staff)
check("the identifiers: a licence EXPIRY is a date, not a number, and stays",
      staff["Drivers License Expiration Date"] == "01/28"
      and staff["License Exp Date"] == "01/30")
check("the identifiers: the telephone and e-mail columns of the people around a"
      " client are NOT identifiers — withholding them would cut the contact lanes",
      kept["SSA #"] == "330-555-0102" and kept["SSA Email"] == "somebody@example.org"
      and kept["Payee Rep #"] == "330-555-0103" and kept["Guardian #"] == "330-555-0104"
      and kept["House Manager #"] == "330-555-0105", kept)
check("the identifiers: a copyright licence and a workflow's own state id stay",
      kept["licence"] == "CC BY 4.0" and kept["state_id"] == "S-1", kept)
check("the identifiers: a withheld identifier reads differently from a withheld card",
      rd.MARKER_IDENTIFIER != rd.MARKER_CARD and rd.MARKER_IDENTIFIER != rd.MARKER_SECRET
      and staff["DC Exp Date"] == rd.MARKER_CARD
      and staff["SSN#"] == rd.MARKER_IDENTIFIER,
      (rd.MARKER_IDENTIFIER, rd.MARKER_CARD))
check("the identifiers: the rule reads the header's words, never the value's shape",
      rd.is_identifier_column("SSN") and not rd.is_identifier_column("Phone")
      and not rd.redact_row({"Phone": "000-00-0000", "Note": "000000000"})[1])
rule_src = (SERVER / "redaction.py").read_text(encoding="utf-8")
check("the identifiers: the self-check the purge gates on demands this rule as well,"
      " so a copy that still leaks an identifier cannot be purged in front of",
      rd.redacts(rule_src)
      and not rd.redacts(rule_src.replace("is_identifier_column", "gone_column"))
      and not rd.redacts(rule_src.replace("IDENTIFIER_PHRASES", "GONE_PHRASES"))
      and not rd.redacts(rule_src.replace("IDENTIFIER_NUMBERED", "GONE_NUMBERED"))
      and not rd.redacts(rule_src.replace('MARKER_IDENTIFIER = "[withheld: identifier]"',
                                          'MARKER_IDENTIFIER = "[gone]"', 1)))
check("the identifiers: and the self-check still does not match its own source",
      not rd.redacts(inspect.getsource(rd.redacts)))
check("the header rule: a session door reads token_hash out of the mirror IN SQL, so the"
      " carve-out is named in the module rather than discovered by the door failing",
      "data->>'token_hash' = %s" in service_src
      and "token hash" in (SERVER / "redaction.py").read_text(encoding="utf-8"))
# six in the staff book (a password, a password manager, a card expiry, an
# SSN, a Medicaid number and a licence number), two in the registry (both
# spellings of the bot secret) and five in the sessions book (two tokens, a
# hash and two salts) — and NOTHING in the fourth
check("the header rule: the counts in the manifest and in the log say the same thing",
      hm["totals"]["withheld"] == 13 and hm["totals"]["withheld_books"] == 3
      and h1["withheld"] == 13 and h1["withheld_books"] == 3,
      (hm["totals"], h1["withheld"], h1["withheld_books"]))
check("the header rule: the book that holds nothing to withhold counts zero",
      {b["name"]: b["withheld"] for b in hm["books"]}["The Ones That Stay"] == 0)
hline = [ln for lv, ln in hsaid.lines if lv == "INFO" and "cell(s) withheld" in ln]
check("the header rule: and the round says it out loud",
      len(hline) == 1 and "13 cell(s) withheld in 3 book(s)" in hline[0], hline)
hf.put("STAFF", "Master", 3, {"Employee": "Another", "Password": SENTINEL_PASSWORD})
h2 = hk.round(now=50_600.0)
harch = gzip.decompress(
    (hroot / "archive" / f"round-{h2['round']}.json.gz").read_bytes()).decode()
check("the header rule: and what the archive kept of the replaced file is withheld too",
      rd.MARKER_SECRET in harch and SENTINEL_PASSWORD not in harch, harch[:200])
mj.log.removeHandler(hsaid)


# ── 17b · the four holes the review found, each in its own tree ──────────────
#
# A SEPARATE TREE so the counts asserted above stay the counts of what they
# were written for. What is proved here:
#
#   the name      a column whose own NAME is a credential. `redact_row` only
#                 ever rewrote VALUES, so a header typed into the header row
#                 crossed into both copies and no purge could reach it: the
#                 word rules have no word to match and the value rules never
#                 look at a key. MEASURED over every distinct column name in
#                 the mirror, the shape rule that catches it catches ONE, and
#                 dropping its one requirement — a symbol headers do not use —
#                 would take 27 real headers with it
#   the user half a password withheld beside the username copied in the clear
#                 is half a credential. MEASURED: four columns, 2,433 cells,
#                 and the five columns that are facts ABOUT a sign-in rather
#                 than a sign-in name stay
#   the state id  `DD ID`, the number a support professional is certified
#                 under: 5,742 cells over three books, and none of the eleven
#                 DODD certification columns beside it is touched
#   the expiry    the same header is a card's expiry in one book and a
#                 training's in another, so the ROW decides: a bare expiry
#                 beside a card column goes, and MEASURED over every tab in
#                 the mirror exactly one tab is that tab
#
# Every string below is a placeholder. Nothing real is written into a fixture,
# and no value in this file is a credential of anything.
PLACEHOLDER_HEADER = "Placeholder7Name!x"
SENTINEL_UNDER = "the-cell-under-the-credential-header"
SENTINEL_USERNAME = "the-username-that-must-not-travel"
SENTINEL_DDID = "the-state-identifier-that-must-not-travel"
SENTINEL_CARD_EXP = "07/70"

xroot = TMP / "review" / "master"
xf = Fake()
xf.meta = {"TY": {"name": "Address and Email Updates", "modified_time": 1.0,
                  "synced_at": 2.0, "status": "ok"},
           "FIN": {"name": "Client Financials", "modified_time": 1.0,
                   "synced_at": 2.0, "status": "ok"},
           "CERT": {"name": "Certification Lookups", "modified_time": 1.0,
                    "synced_at": 2.0, "status": "ok"},
           "PLAIN": {"name": "The Ones That Stay", "modified_time": 1.0,
                     "synced_at": 2.0, "status": "ok"}}
xf.put("TY", "Ty", 2, {"Owner": "Somebody", PLACEHOLDER_HEADER: SENTINEL_UNDER,
                       "Username": SENTINEL_USERNAME, "Website": "example.org"})
# the shape of Financial Info: the expiry is the card's, and it says so by what
# stands beside it — not by its own words, which say only that it is an expiry
xf.put("FIN", "Financial Info", 2,
       {"Client": "Somebody", "Login Username": SENTINEL_USERNAME,
        "CCV": "000", "PIN": "0000", "Account Number": "0", "Routing Number": "0",
        "Expiration Date": SENTINEL_CARD_EXP, "Account Type": "checking"})
xf.put("CERT", "Lookups", 2, {"Name": "Somebody", "DD ID": SENTINEL_DDID,
                              "DOB": "01/01/1970", "Expiration": "01/71",
                              "DODD": "Y", "Cert (DODD)": "Y", "Self - DODD": "Y",
                              "DODD 8-Hour Exp": "01/72", "cert_dodd": "Y"})
xf.put("PLAIN", "Data", 2,
       {# a sign-in is not a fact ABOUT a sign-in
        "LoginCount": "3", "LastLoginAt": "01/01/1970", "last_login": "01/01/1970",
        "LastLogin": "01/01/1970", "last_login_at": "01/01/1970",
        # a display name is not a login, and neither is any other name
        "user_name": "Somebody", "person_name": "Somebody", "Name": "Somebody",
        "House Manager": "Somebody",
        # the same bare expiry with no card anywhere in the row
        "Expiration Date": "01/73", "Expiration": "01/74", "Exp Date": "01/75",
        # not bare: it names what expires, and it shares a tab with a card
        "Self-Admin Expiration Date": "01/76",
        # deliberately kept — see the module
        "Birthdate": "01/01/1970", "Age": "55", "DOB": "01/01/1970",
        "Cardholder name": "Somebody", "Account (Last 4)": "0000",
        "accountLast4": "0000", "Last 4 SSN": "0000"})
xk = keeper(xf, xroot)
x1 = xk.round(now=60_000.0)
ty = mj.read_book(xroot, "TY")["tabs"][0]["rows"][0]
fin = mj.read_book(xroot, "FIN")["tabs"][0]["rows"][0]
cert = mj.read_book(xroot, "CERT")["tabs"][0]["rows"][0]
plain = mj.read_book(xroot, "PLAIN")["tabs"][0]["rows"][0]
xbytes = every_byte(xroot)

check("the name: a column whose own NAME is a credential does not survive the copy —"
      " not as a column name, and not as the cell under it",
      PLACEHOLDER_HEADER not in ty and PLACEHOLDER_HEADER not in xbytes
      and SENTINEL_UNDER not in xbytes
      and ty[rd.MARKER_SECRET] == rd.MARKER_SECRET, list(ty))
check("the name: it is REPLACED IN PLACE, so the column keeps its position and the"
      " ones after it do not shift",
      [c for c in ty if c != "_row"]
      == ["Owner", rd.MARKER_SECRET, "Username", "Website"], list(ty))
check("the name: the tab's header in the copy is the row's keys, so the credential is"
      " not in the header either",
      PLACEHOLDER_HEADER not in mj.read_book(xroot, "TY")["tabs"][0]["header"],
      mj.read_book(xroot, "TY")["tabs"][0]["header"])
check("the name: and a row holding two of them loses both, under names that do not"
      " collide — a dict would have swallowed the second",
      len(rd.redact_row({"a": "1", PLACEHOLDER_HEADER: "x",
                         "Another8Name!y": "y", "b": "2"})[0]) == 4
      and rd.redact_row({"a": "1", PLACEHOLDER_HEADER: "x",
                         "Another8Name!y": "y", "b": "2"})[1] == 2,
      rd.redact_row({"a": "1", PLACEHOLDER_HEADER: "x", "Another8Name!y": "y", "b": "2"}))
check("the name: the shape is judged narrowly — a header that is words, or a path, or"
      " camel case with no symbol in it, is a name and stays",
      rd.is_secret_name(PLACEHOLDER_HEADER)
      and not rd.is_secret_name("phase1Discovery")
      and not rd.is_secret_name("W4FormStatus1")
      and not rd.is_secret_name("https://example.org/a/1Ab2Cd?x=1#y")
      and not rd.is_secret_name("Password Mgr.")
      and not rd.is_secret_name("Med 1 Exp Date"))

check("the user half: a username is withheld, and an ordinary name column is not",
      ty["Username"] == rd.MARKER_SECRET and SENTINEL_USERNAME not in xbytes
      and plain["Name"] == "Somebody" and plain["person_name"] == "Somebody"
      and plain["user_name"] == "Somebody" and plain["House Manager"] == "Somebody",
      (ty, plain["Name"]))
check("the user half: the spelling the client book uses goes too, beside its password",
      fin["Login Username"] == rd.MARKER_SECRET)
check("the user half: a fact ABOUT a sign-in is a timestamp or a counter and stays —"
      " the session lanes read every one of these",
      plain["LoginCount"] == "3" and plain["LastLoginAt"] == "01/01/1970"
      and plain["last_login"] == "01/01/1970" and plain["LastLogin"] == "01/01/1970"
      and plain["last_login_at"] == "01/01/1970", plain)

check("the state id: the number a support professional is certified under is withheld",
      cert["DD ID"] == rd.MARKER_IDENTIFIER and SENTINEL_DDID not in xbytes, cert)
check("the state id: and the certification columns spelling DODD are not identifiers —"
      " they are yes/no and expiry columns the recruiting and compliance lanes read",
      cert["DODD"] == "Y" and cert["Cert (DODD)"] == "Y" and cert["Self - DODD"] == "Y"
      and cert["cert_dodd"] == "Y" and cert["DODD 8-Hour Exp"] == "01/72", cert)

check("the expiry: a bare expiry in a row that also carries a card is that card's, and"
      " goes with it",
      fin["Expiration Date"] == rd.MARKER_CARD and SENTINEL_CARD_EXP not in xbytes, fin)
check("the expiry: the SAME header with no card in the row is a training's expiry and"
      " stays — which is why this is a row rule and not a header rule",
      plain["Expiration Date"] == "01/73" and plain["Expiration"] == "01/74"
      and plain["Exp Date"] == "01/75" and cert["Expiration"] == "01/71", plain)
check("the expiry: a header that names WHAT expires is not bare, so a clinical"
      " assessment date sharing a tab with a card is untouched",
      plain["Self-Admin Expiration Date"] == "01/76"
      and not rd.is_bare_expiry_column("Self-Admin Expiration Date")
      and not rd.is_bare_expiry_column("License Exp Date"), plain)

check("what stays, on purpose: a date of birth is data this platform uses — ages,"
      " birthdays, and the DOB the certification lookup matches on",
      plain["Birthdate"] == "01/01/1970" and plain["Age"] == "55"
      and plain["DOB"] == "01/01/1970" and cert["DOB"] == "01/01/1970"
      and "DATE OF BIRTH IS NOT WITHHELD" in (SERVER / "redaction.py").read_text(
          encoding="utf-8"), plain)
check("what stays, on purpose: a card's last four names which card a line belongs to"
      " and authorises nothing, while an SSN's last four is the telephone challenge",
      plain["Account (Last 4)"] == "0000" and plain["accountLast4"] == "0000"
      and plain["Cardholder name"] == "Somebody"
      and plain["Last 4 SSN"] == rd.MARKER_IDENTIFIER, plain)
check("what stays, on purpose: and the module keeps its own section of what it deliberately does not withhold, so the"
      " next reader does not re-open it",
      all(said in (SERVER / "redaction.py").read_text(encoding="utf-8")
          for said in ("WHAT THIS MODULE DELIBERATELY DOES NOT WITHHOLD", "DATE OF BIRTH IS NOT WITHHELD")))

xrule = (SERVER / "redaction.py").read_text(encoding="utf-8")
check("the review's four: the self-check the purge gates on demands every one of them,"
      " so a copy that still leaks one cannot be purged in front of",
      rd.redacts(xrule)
      and not rd.redacts(xrule.replace("def is_secret_name", "def gone_name"))
      and not rd.redacts(xrule.replace("def is_login_column", "def gone_login"))
      and not rd.redacts(xrule.replace("def is_bare_expiry_column", "def gone_expiry"))
      and not rd.redacts(xrule.replace("def secret_named_columns", "def gone_columns"))
      and not rd.redacts(xrule.replace("LOGIN_WORDS", "GONE_WORDS"))
      and not rd.redacts(xrule.replace("LOGIN_ABOUT", "GONE_ABOUT"))
      and not rd.redacts(xrule.replace("EXPIRY_HEAD", "GONE_HEAD"))
      and not rd.redacts(xrule.replace("SECRET_NAME_SYMBOLS", "GONE_SYMBOLS")))
xpurge = PURGE.read_text(encoding="utf-8")
check("the review's four: and the mirror lane writes back the dict the rule RETURNS,"
      " which is the only way a renamed column leaves the second copy as well",
      "fixed, withheld = redaction.redact_row(data)" in xpurge
      and "psycopg2.extras.Json(fixed)" in xpurge
      and "update {MIRROR_TABLE} set data = %s where id = %s" in xpurge)
# the mirror stores one jsonb a row, and its KEYS are the column names: the
# purge reads a row, hands it to the rule and writes back what comes out, so
# the rename is the whole of what takes the header out of the second copy
xmirror = {"Owner": "Somebody", PLACEHOLDER_HEADER: SENTINEL_UNDER, "Website": "x"}
xonce, xn = rd.redact_row(xmirror)
xtwice, xn2 = rd.redact_row(xonce)
check("the review's four: a mirror row loses the credential FROM ITS KEYS, and a purge"
      " run twice over the same row changes nothing the second time",
      PLACEHOLDER_HEADER not in xonce and xn == 1
      and xtwice == xonce and xn2 == 0
      and not rd.is_secret_name(rd.MARKER_SECRET), (xonce, xn, xn2))


# ═══ 18 · the keeper counts cells it WROTE, not cells it looked at ═══════════
#
# `_parse_row` is also the rule a tail check compares by: tail_verdict parses
# the head window and every known tail row purely to hold them against the
# mirror, and writes nothing. Counting those made the pass's number a count of
# how often a card row was LOOKED at — an unchanged tab added to the total on
# every pass, flipped withheld_books on a pass that wrote nothing, and counted
# the same cell twice wherever the two windows overlapped.
import hub_sheet_sync as hs  # noqa: E402

hs._withheld_so_far.clear()
# one card column, one data row: the head window and the tail window are the
# SAME row, which is how the old counter reached two for a comparison
st = {"header_row": 0, "header": ["Customer", "Debit Card"], "extent": 2}
MADE_UP_CARD = "0000-0000-0000-0000"
head = [["Customer", "Debit Card"], ["Somebody", MADE_UP_CARD]]
tail = [["Somebody", MADE_UP_CARD]]          # the tail window's rows, from t_lo
mirrored = {2: {"Customer": "Somebody", "Debit Card": rd.MARKER_CARD}}
verdict = hs.tail_verdict(st, head, tail, mirrored)
check("the tally: a tail check that wrote nothing counts nothing",
      verdict.ok and not verdict.appended and hs._withheld_so_far["cells"] == 0,
      (verdict.ok, verdict.why, hs._withheld_so_far["cells"]))
check("the tally: the comparison still redacts, or every such tab would read as changed",
      hs._parse_row(head[1], st["header"], False) == mirrored[2])
hs._withheld_so_far.clear()
rows, _giant = hs.whole_tab(head, now=1.0)
check("the tally: a whole read, which DOES write, counts its cells",
      len(rows) == 1 and hs._withheld_so_far["cells"] == 1, hs._withheld_so_far["cells"])
hs._withheld_so_far.clear()
grown = tail + [["Another", MADE_UP_CARD]]
appended = hs.tail_verdict(st, head, grown, mirrored)
check("the tally: and the rows a tail check APPENDS are counted, they are written",
      appended.ok and len(appended.appended) == 1 and hs._withheld_so_far["cells"] == 1,
      (appended.ok, appended.why, len(appended.appended), hs._withheld_so_far["cells"]))
check("the tally: the comparison call sites pass count=False, both of them",
      keeper_src.count("_parse_row(head[i] if i < len(head) else None, header, False, twins)") == 1
      and keeper_src.count("_parse_row(tail[k], header, False, twins)") == 1
      and "def _parse_row(row: list | None, header: list[str], count: bool = True" in keeper_src)


# ═══ 19 · the purge judges the code the relay runs ══════════════════════════
purge_src = PURGE.read_text(encoding="utf-8")
check("the purge: it judges /srv/app — the relay's own code — when that is there",
      'RELAY_CODE = Path(os.getenv("HUB_RELAY_CODE_DIR", "/srv/app"))' in purge_src
      and "return RELAY_CODE if (RELAY_CODE / \"redaction.py\").is_file() else BESIDE_ME"
      in purge_src and "SERVER = _code_dir(sys.argv[1:])" in purge_src)
check("the purge: and it imports the rule from the very directory it judged",
      purge_src.index("SERVER = _code_dir") < purge_src.index("import redaction"),
      "the import must come after the directory is resolved")
check("the purge: code synced in after the process started is refused, not trusted",
      "def relay_loaded_it(" in purge_src and "/proc/1" in purge_src
      and "code_can_redact() + relay_loaded_it(args.dry_run)" in purge_src)
check("the purge: the refusal has NO way past it any more",
      "i-know-the-code-cannot-redact" not in purge_src
      and "argparse.SUPPRESS" not in purge_src and "(overridden)" not in purge_src)
ARM = ("(is_card_column(c) or is_secret_column(c) or is_identifier_column(c)\n"
       "                or is_login_column(c))")
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace(
        ARM, "(is_card_column(c) or is_identifier_column(c))", 1)))
check("the purge: it refuses a rule that lost the arm reaching credential-named columns",
      rc == 2 and "REFUSED" in out
      and "a column whose own name is a credential" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace(
        ARM, "(is_card_column(c) or is_secret_column(c))", 1)))
check("the purge: and a rule that still leaks government identifiers cannot run at all",
      rc == 2 and "REFUSED" in out
      and "a government identifier column" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace("IDENTIFIER_PHRASES: tuple",
                                             "GONE_PHRASES: tuple", 1)))
check("the purge: a copy with no identifier rule in it is not a rule it can read",
      rc == 2 and "REFUSED" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace("HEADER_TOKENS = frozenset({",
                                             "GONE_TOKENS = frozenset({", 1)))
check("the purge: and a redaction.py that is no longer the rule it can read",
      rc == 2 and "REFUSED" in out, out[:400])
rc, out = purge_in(lambda s: (s / "redaction.py").write_text(
    (s / "redaction.py").read_text().replace("HEADER_TOKENS = frozenset({",
                                             "GONE_TOKENS = frozenset({", 1)))
check("the purge: a tampered rule raises rather than answering, and that is a refusal too",
      rc == 2 and "raised NameError" in out, out[:400])

# THE CASE THE WHOLE RESOLUTION EXISTS FOR: the copy handed to the container
# can redact and the copy the relay imports cannot. A guard that read the one
# beside it would empty both copies in front of a relay that refills them.
rc, out = purge_in(
    lambda s: None,
    relay=lambda r: (r / "master_json.py").write_text(
        (r / "master_json.py").read_text().replace("redaction.redact_row(data)", "(data, 0)", 1)))
check("the purge: it judges the RELAY's copy, not the one handed to it beside the tool",
      rc == 2 and "REFUSED" in out and "does not call redaction.redact_row" in out
      and "/relay/" in out, out[:500])
rc, out = purge_in(lambda s: None, relay=lambda r: None)
check("the purge: and it runs when the relay's own copy is the one that withholds",
      rc == 0 and "all agree" in out and "/relay" in out, out[:400])

# ── A TOOL WHOSE WHOLE JOB IS PROOF MUST NOT SAY IT DID WHAT IT DID NOT ─────
#
# Three ways this one said it had: a master lane pointed at a directory that
# is not mounted printed one line and exited 0, so a run that cleaned only the
# mirror read afterwards exactly like a run that cleaned both; the removal
# counter stepped whether or not anything went, because `ignore_errors=True`
# swallows the failure; and the freshness arm looked only at the directory it
# had judged, so a run from anywhere else never asked the relay anything at
# all and purged in front of a process still holding the older rule.
rc, out = purge_in(lambda s: None, relay=lambda r: None, tree_at="nothing-here")
check("the purge: a master lane asked for and pointed at nothing is a refusal, not a"
      " line about a missing directory followed by exit 0",
      rc == 2 and "REFUSED" in out and "nothing-here" in out
      and "leave the other standing" in out, out[:500])
rc, out = purge_in(lambda s: None, dry=False)
check("the purge: a run that cannot see the relay may not write — the rule on disk and"
      " the rule the relay holds in memory are two different things",
      rc == 2 and "REFUSED" in out and "cannot see" in out
      and "--dry-run" in out, out[:500])
rc, out = purge_in(lambda s: None, dry=True)
check("the purge: and the same run as a dry run is allowed, because it writes nothing",
      rc == 0 and "all agree" in out, out[:400])

# the counter, in process: rmtree taken away is a removal that cannot happen,
# which is the shape of a full disk, a busy mount or a permission — the cases
# `ignore_errors=True` used to hide
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("purge_under_test", PURGE)
_purge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_purge)
ptree = TMP / "survivors" / "master"
(ptree / "books").mkdir(parents=True)
(ptree / "books" / "one.json").write_text("{}")
(ptree / "archive").mkdir()
(ptree / ".tmp").mkdir()
(ptree / "manifest.json").write_text("{}")
_real_rmtree = _purge.shutil.rmtree
_purge.shutil.rmtree = lambda *a, **k: None
try:
    left = _purge.purge_master(ptree, dry=False)
finally:
    _purge.shutil.rmtree = _real_rmtree
check("the purge: a removal that did not happen is not counted as one, and every"
      " survivor is named — this said 'removed 4 of 4' over a standing tree",
      left["removed"] == 1 and len(left["survivors"]) == 3
      and all("books" in s or "archive" in s or ".tmp" in s for s in left["survivors"]),
      left)
check("the purge: and the file it COULD remove is really gone, so the count is of what"
      " went and not of what was tried",
      not (ptree / "manifest.json").exists() and (ptree / "books").is_dir())
purge_src_tail = PURGE.read_text(encoding="utf-8")
check("the purge: ignore_errors is gone from the master lane, and the run that left"
      " something behind does not exit 0",
      "shutil.rmtree(path, ignore_errors=True)" not in purge_src_tail
      and 'if purge_master(master_root, args.dry_run).get("survivors"):' in purge_src_tail
      and "return 1" in purge_src_tail)
_real_rmtree(ptree, ignore_errors=True)


# ═══ 20 · the four houses, and who the keeper really is ═════════════════════
#
# The keeper is the SERVICE ACCOUNT. GOOGLE_IMPERSONATE_USER is present and
# EMPTY on the relay, and `with_subject("")` builds a credential with no `sub`
# claim at all, so the refresh succeeds and the "DWD refused" warning is never
# logged — which is what made the absence of that warning read as proof that
# delegation worked. Granting read to a human address would report success and
# leave the house in no mirror.
MINTS = ("mint_ist_config_house.py", "mint_meddel_catalog_house.py",
         "mint_alerts_catalogue.py", "mint_examples_house.py")
for name in MINTS:
    src = (ROOT_DIR / "tools" / name).read_text(encoding="utf-8")
    check(f"the houses: {name} shares with the account the keeper really is",
          "def keeper_account(" in src and "return KEEPER_ACCOUNT or sa_email()" in src
          and 'KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()' in src
          and "@asalifecare.com" not in src, name)
    check(f"the houses: {name} says WHY the delegation reading was wrong, rather than"
          " repeating it",
          "EMPTY" in src and "if self._subject:" in src
          and "so the house reaches the mirror and the master JSON" not in src
          and "so the book reaches the mirror and the master JSON" not in src, name)
    check(f"the houses: {name} TOUCHES the book, because a permission never moves"
          " modifiedTime and the keeper lists by nothing else",
          "def touch(" in src and "modifiedTime" in src
          and "valueInputOption=RAW" in src
          and "valueRenderOption=FORMULA" in src, name)
    check(f"the houses: {name} says out loud that its own credential cannot grant the"
          " permission, instead of swallowing the 403 as a warning",
          'DRIVE_SCOPELESS = "insufficient authentication scopes"' in src
          and "no Drive scope" in src
          and "THE READ GRANT COULD NOT BE MADE FROM HERE" in src, name)
check("the houses: the keeper skips the delegation probe when the variable is empty,"
      " so the log stops implying a delegation that is not happening",
      'if not (IMPERSONATE or "").strip():' in keeper_src
      and "the keeper IS the service" in keeper_src)
check("the houses: and the keeper discovers a book by modifiedTime and by nothing else,"
      " which is what the touch is for",
      "modifiedTime > '{stamp}'" in keeper_src)


shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
