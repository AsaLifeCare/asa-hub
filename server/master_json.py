"""THE MASTER JSON — every sheet the platform holds, on the relay's own disk.

THE LAW: Postgres current; all sheet data in JSON. The JSON is written first,
the sheets after. Every round zips the old JSON and starts a new one.
JSON → slices → Google last.

WHAT IT IS. After every pass of the sheet keeper (hub_sheet_sync, in the
keeper's own process — never the relay's event loop), the state of every tab
the Postgres mirror holds is written here FROM THE MIRROR, costing zero Google
requests: the book, its name, each tab, its header, its rows, their count, a
fingerprint, and when they were read. The mirror (asa_drive_sheets_rows) is
the only source: the keeper holds no rows in memory between passes and keeps
no copy on disk, so what the mirror holds after a pass IS the platform's
current copy of its sheets, and this is that copy as JSON.

WHY A MANIFEST AND A FILE PER TAB, NOT ONE FILE. Measured on the live
mirror: 878 books, 3,887 tabs, 1,256,148 rows, 15.3 million cells (every one
of them text) — 541.7 MB of JSON in the shape below (737.7 MB keyed by column
name), 81.3 MB gzipped, about a minute to stream out of Postgres and encode. Nearly
every keeper pass lands a book (44 of 45 logged passes in a day), and the
books that gain rows on nearly every pass are the biggest ones (ASA Data —
Events 83 MB, ASA Hub — Logs 70 MB, ASA Data — Texts 21 MB). One file would
rewrite 541 MB and archive 81 MB every five minutes — some 156 GB written and
23 GB archived a day, on a disk with 12.05 GiB free — measured; the 21 GB that
stood here was never re-read after the disk filled. One file per book is not
enough either: ASA Hub — DB keeps 31 MB in 93 tabs under 5,000 rows, and one
session row landing would rewrite all of them. So a round writes only the
tabs that changed — measured against live passes, 1 to 51 files (5 KB to 15 MB)
and 0.7 to 3.4 MB into the archive; the first round writes all 5,805 files
(513 MB) in 70 to 130 s, in the keeper's process:

  manifest.json         the round: every book, its tabs, their files,
                        fingerprints, row counts and read times, and how far
                        the mirror itself is behind Drive. Written LAST: it is
                        the commit point of a round.
  books/<id>.json       one book's index: its name and its tabs in the
                        sheet's order, each naming the files that hold it.
  books/<id>.<tab>.<k>.json
                        one tab's rows, in parts: part k holds sheet rows
                        k·PART_ROWS+1 through (k+1)·PART_ROWS, so a log that
                        gains a row rewrites its last part, not 80 MB. Most
                        tabs are one part.
  archive/round-<id>.json.gz
                        everything one round replaced or removed — the previous
                        manifest and the previous version of every file it
                        rewrote — in ONE gzip, written before the new files take
                        their place. The oldest go first past KEEP_ROUNDS
                        rounds or ARCHIVE_MB megabytes, whichever comes first;
                        the newest is always kept.

THE ROW SHAPE. A part is {"format", "id", "tab", "part", "rows", "header",
"count", "first_row", "last_row"}; a row is [sheet row, cell, cell, …] aligned
with that part's "header". Every mirrored cell is text, so a null cell means
the row has no such column, and trailing absent cells are left off. The header
starts from the one the keeper read in the sheet's own order
(hub_sheet_sync_tabs, for its giant tabs) and grows by the columns the rows
name, in the order first seen — Postgres keeps a row's columns in its own order
(shortest name first), so a tab the keeper never held as giant lists its
columns in that order, not the sheet's. A header only grows at its end, so
every row stays aligned with the header written after it. Four writers fill
the mirror; a row that is not an object (an array, a scalar, a number past the
digits Python parses) is kept whole in one "_value" column and counted as the
part's "odd_rows" — never dropped, never the end of the round.

ONE BAD FILE STOPS ONLY ITSELF. A file whose rows will not encode is left
out of its round: its last file and its last manifest entry stand, the entry
says "failed" and why, its tab says "stale", the warning is said once, and
every other file of the round is written as ever. What fails in the mirror
itself or on the disk is different: the snapshot or the disk is gone for every
file alike, so the round stops there and the previous one stands.

WHAT MAKES A ROUND WRITE. Each file's slice of the mirror has a signature: its
row count, its highest row id and its newest ingested_at — whoever writes the
table (the keeper, or the platform's other writers) moves it. A file whose
signature moved is encoded again; one whose bytes hash the same as the held
file is NOT written (the keeper re-reading a giant tab whole moves every
signature and changes nothing). A round in which no file changed writes
nothing at all — no manifest, no archive. Once every VERIFY_EVERY_S every file
is encoded again and compared, the net under a writer that could change a row
without moving its id or its ingested_at.

A CRASH LOSES NOTHING. Files are written to .tmp/ (0600) and hashed as they
are written, row by row from a server-side cursor — a book is never held whole
in memory. The archive of what is about to be replaced is closed first, the new
files replace the old ones by rename, and the manifest is renamed into place
last. A round cut short leaves the previous round standing; one cut between
the files and the manifest is healed by the next round, which finds the files
newer than the manifest says and writes the manifest again.

PRIVATE. This holds every row of every book — people's names, phones, notes.
The directory is 0700 and every file 0600, under /srv/snapshot, which the web
tier serves as another user: that user cannot enter the directory whatever the
gate in front of it says. And no file here is ever named index.json or all.json,
the two names the snapshot gate lets through by name alone.

AND TWO KINDS OF CELL NEVER COME ACROSS AT ALL. A switchboard prop whose key
names a credential, and a card or bank column, are replaced by a marker as
they are written — `redaction.redact_row`, the SAME rule the keeper writes the
mirror by, so what is withheld here is withheld at the source too and neither
copy can drift from the other. Permissions are a fence; this is the cell not
being in the file. Every round's log line and the manifest's `totals` carry
how many cells are withheld and out of how many books, so a rule that stops
working is a number that fell rather than a silence.

THE HAND-OFF JOURNAL (handoff_first). The same law, for the platform's own
rows going the other way: a hand-off the relay's clocks make to Python
(HANDOFF_ACTIONS) is written here — its action and payload, never the
credential it travels with — before the post leaves, and a disk that refused
stops the post. The door that carries one calls it: snapshot_service._service_door.
handoff/<action>/current.json is the last one, the ones before
it are gzipped beside it, HANDOFF_KEEP at most and HANDOFF_MB megabytes.

Stdlib only at import; psycopg2 is asked for when the mirror is.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import redaction

try:
    import psycopg2
except Exception:  # pragma: no cover - the relay's image always carries it
    psycopg2 = None  # type: ignore[assignment]

log = logging.getLogger("hub.master_json")

FORMAT = "hub-master-json/1"
# the one column a row that is not an object is kept under, whole
ODD_KEY = "_value"
ROOT = Path(os.getenv("HUB_MASTER_JSON_DIR",
                      str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "master")))
# sheet rows per part of a tab: about half a megabyte of JSON for the logs that
# gain rows every pass (ASA Data — Events, ASA Hub — Logs), so an append costs
# that, not the 2.5 MB of 5,000 rows; a transcript tab (18 KB a row) is the
# one kind whose part stays big
PART_ROWS = int(os.getenv("HUB_MASTER_PART_ROWS", "1000"))
# A day of five-minute rounds, and 768 MiB, whichever is reached first.
#
# THE BOUND IS SET AGAINST THE DISK THIS RUNS ON, MEASURED ON IT. 338.0 GiB of
# disk, 325.9 GiB of it used, 12.05 GiB free — not the 21 GB the note above
# used to claim, which was never re-read after the disk filled. The master
# owns 853 MiB of the used figure: 524.7 MiB of books over 6,269 files,
# 325.0 MiB over 116 archived rounds, 2.5 MiB of hand-off journal and a
# 2.7 MiB manifest.
#
# What the archive can reach is ARCHIVE_BYTES plus ONE round, because a round
# writes its archive and prunes afterwards. The rounds measured on this disk
# average 2.80 MiB (116 of them holding 325.0 MiB) and the largest is
# 9.28 MiB. A full rebuild — every file rewritten at once — archives the whole
# previous tree: 524.8 MiB of JSON at the 14.4x gzip ratio measured over a
# sample of its own files is about 36 MiB, and the ceiling below reserves 81
# MiB for it, more than double. So 768 MiB holds about 274 rounds at the
# measured churn, a little under the day KEEP_ROUNDS asks for, and the
# archive's own ceiling is 768 + 81 = 849 MiB.
#
# The whole copy's ceiling is then 525 MiB of books + 849 MiB of archive +
# HANDOFF_MB per hand-off action (6 × 64 = 384 MiB at worst, 2.5 MiB today) =
# 1.72 GiB, which is 14% of what is free. THE STATED FLOOR IS 4 GiB: see
# MIN_FREE_BYTES.
KEEP_ROUNDS = int(os.getenv("HUB_MASTER_KEEP_ROUNDS", "288"))
ARCHIVE_BYTES = int(float(os.getenv("HUB_MASTER_ARCHIVE_MB", "768")) * 2 ** 20)
# NO ROUND IS WRITTEN WHILE THE DISK HAS LESS THAN 4 GiB FREE. The slices,
# the bundles and the web tier share this disk and this copy must never be
# what fills it. Four is not a round number picked for comfort: the worst
# round is a full rebuild, which holds the old tree, the new tree in .tmp/ and
# one archive at the same moment — 525 + 525 + 81 MiB, about 1.1 GiB — so a
# floor of 2 GiB (what stood here) could pass the check and leave 900 MiB. A
# 4 GiB floor leaves at least 2.8 GiB after the worst round this can have.
MIN_FREE_BYTES = int(float(os.getenv("HUB_MASTER_MIN_FREE_MB", "4096")) * 2 ** 20)
VERIFY_EVERY_S = float(os.getenv("HUB_MASTER_VERIFY_EVERY_S", "86400"))
# a disk that keeps refusing is said once per this, not once a pass
SAY_EVERY_S = 3600.0

HANDOFF_ACTIONS = frozenset({
    "peopleSyncFromPlatform",   # the contacts hand-off
    "commRoutesIngest",
    "behaviorSignalsIngest",
    "commWhenIngest",
    "commProposalsIngest",
    "commCallsIngest",
})
HANDOFF_KEEP = int(os.getenv("HUB_HANDOFF_KEEP", "48"))
HANDOFF_BYTES = int(float(os.getenv("HUB_HANDOFF_MB", "64")) * 2 ** 20)

_ENC = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"))
_CHUNK = 1 << 20
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
# the names the snapshot gate lets through without asking the manifest
_GATE_OPEN = frozenset({"index", "all"})
_HANDOFF_LOCK = threading.Lock()


def _iso(epoch: float | None) -> str:
    if not epoch:
        return ""
    return datetime.fromtimestamp(float(epoch), timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def _epoch(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _stamp(epoch: float) -> str:
    """A round's id: its UTC moment to the millisecond, sortable as text."""
    dt = datetime.fromtimestamp(epoch, timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%S") + f"{dt.microsecond // 1000:03d}Z"


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _private_dir(path: Path) -> None:
    """0700 whatever the umask said, so the web tier's user cannot enter."""
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def _write_atomic(path: Path, data: bytes) -> None:
    """0600 from the first byte, fsync'd, renamed into place."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix="." + path.name, suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(tmp, path)
    except BaseException:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    _fsync_dir(path.parent)


def _file_id(sheet_id: str) -> str:
    """A book's file name: its sheet id when that is a plain name the gate does
    not open by itself, a hash of it otherwise."""
    sid = str(sheet_id)
    if _SAFE_ID.match(sid) and sid not in _GATE_OPEN:
        return sid
    return "x" + hashlib.sha1(sid.encode("utf-8")).hexdigest()


def book_file(sheet_id: str) -> str:
    return f"books/{_file_id(sheet_id)}.json"


def part_file(sheet_id: str, tab: str, part: int) -> str:
    tag = hashlib.sha1(str(tab).encode("utf-8")).hexdigest()[:12]
    return f"books/{_file_id(sheet_id)}.{tag}.{int(part)}.json"


# ═══════════════════════════════════════════════════════════════════════════
# The mirror, read in one snapshot
# ═══════════════════════════════════════════════════════════════════════════
class PgSource:
    """The Postgres mirror, read-only, one REPEATABLE READ snapshot a round —
    so the signatures and the rows encoded under them are the same moment."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    @contextmanager
    def snapshot(self) -> Iterator["_PgSnap"]:
        if psycopg2 is None:
            raise RuntimeError("psycopg2 is not importable")
        if not self.dsn:
            raise RuntimeError("no database is configured")
        conn = psycopg2.connect(self.dsn, connect_timeout=10, application_name="hub-master-json")
        try:
            conn.set_session(isolation_level="REPEATABLE READ", readonly=True)
            yield _PgSnap(conn)
        finally:
            try:
                conn.rollback()
            finally:
                conn.close()


class _PgSnap:
    def __init__(self, conn: Any) -> None:
        self.conn = conn
        self._n = 0

    def _all(self, sql: str, args: tuple = ()) -> list[tuple]:
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    def _has(self, table: str) -> bool:
        return bool(self._all("select to_regclass(%s) is not null", (f"public.{table}",))[0][0])

    def signatures(self, part_rows: int) -> list[tuple[str, str, int, int, int, float]]:
        """(sheet id, tab, part, rows, highest row id, newest ingested_at)."""
        got = self._all(
            "select sheet_id, tab_name, greatest(row_number - 1, 0) / %s, count(*), max(id),"
            " max(ingested_at) from asa_drive_sheets_rows group by 1, 2, 3", (int(part_rows),))
        return [(s, t, int(k), int(n), int(mid or 0), _epoch(at)) for s, t, k, n, mid, at in got]

    def books(self) -> dict[str, dict[str, Any]]:
        got = self._all("select sheet_id, name, modified_time, last_sync_at, last_sync_status"
                        " from asa_drive_sheets_meta")
        return {s: {"name": str(n or ""), "modified_time": _epoch(mt), "synced_at": _epoch(at),
                    "status": str(st or "")} for s, n, mt, at, st in got}

    def titles(self) -> dict[str, list[str]]:
        if not self._has("hub_sheet_sync_books"):
            return {}
        return {s: [str(t) for t in (ts or [])]
                for s, ts in self._all("select sheet_id, titles from hub_sheet_sync_books")}

    def tabs(self) -> dict[tuple[str, str], dict[str, Any]]:
        """The keeper's giant tabs: the header in the sheet's order, and whether
        it can vouch for the rows between the ends (mirror_first.vouch)."""
        if not self._has("hub_sheet_sync_tabs"):
            return {}
        got = self._all("select sheet_id, tab_name, header, whole_at, dirty_since"
                        " from hub_sheet_sync_tabs")
        return {(s, t): {"header": [str(h) for h in (hd or [])], "whole_at": _epoch(wa),
                         "dirty": ds is not None} for s, t, hd, wa, ds in got}

    def mirror(self) -> dict[str, Any]:
        if not self._has("hub_sheet_sync_state"):
            return {}
        got = self._all("select watermark, last_pass_at, listed_at, pending"
                        " from hub_sheet_sync_state where id = 1")
        if not got:
            return {}
        wm, last, listed, pending = got[0]
        return {"watermark": _epoch(wm), "last_pass_at": _epoch(last),
                "listed_at": _epoch(listed), "pending": [str(p) for p in (pending or [])]}

    def rows(self, sheet_id: str, tab: str, lo: int | None, hi: int | None
             ) -> Iterator[tuple[int, str]]:
        """(sheet row, the row as JSON text), in sheet order, from a server-side
        cursor: rows cross from Postgres a batch at a time."""
        self._n += 1
        cur = self.conn.cursor(name=f"master_json_{self._n}")
        cur.itersize = 2000
        try:
            sql = ("select row_number, data::text from asa_drive_sheets_rows"
                   " where sheet_id = %s and tab_name = %s")
            args: list[Any] = [sheet_id, tab]
            if lo is not None:
                sql += " and row_number >= %s"
                args.append(int(lo))
            if hi is not None:
                sql += " and row_number <= %s"
                args.append(int(hi))
            cur.execute(sql + " order by row_number", args)
            for rn, text in cur:
                yield int(rn), text
        finally:
            cur.close()


# ═══════════════════════════════════════════════════════════════════════════
# The record books, as the platform's record holds them
# ═══════════════════════════════════════════════════════════════════════════
RECORD_DOOR = "/v1/sheet-tabs/recordTabs"
RECORD_TIMEOUT_S = float(os.getenv("HUB_MASTER_JSON_RECORD_TIMEOUT_S") or 60)


def _app_token() -> str:
    """The relay's token for asa-hub-app: the env, else the private file beside the relay's code."""
    held = Path(__file__).with_name(".hub-app-token")
    return os.getenv("HUB_APP_TOKEN", "") or (held.read_text().strip() if held.is_file() else "")


class RecordSource:
    """A book Postgres keeps the record of (asa-hub-app's recordTabs: its copy in asa-hub-db with the kept edits
    laid — what every read of it shows) in place of its mirror rows; every other book from the mirror. A round
    that cannot ask the record reads the mirror alone, and says so once."""

    def __init__(self, mirror: Any, url: str | None = None, token: str | None = None,
                 timeout: float = RECORD_TIMEOUT_S, ask: Any = None) -> None:
        self.mirror = mirror
        self.dsn = getattr(mirror, "dsn", "")
        self.url = (url or os.getenv("HUB_APP_URL") or "http://asa-hub-app:8080").rstrip("/")
        self.token = _app_token() if token is None else token
        self.timeout = timeout
        self._ask = ask
        self._said = False

    def ask(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._ask is not None:
            return self._ask(payload)
        import urllib.request  # noqa: PLC0415
        req = urllib.request.Request(self.url + RECORD_DOOR, data=json.dumps({"payload": payload}).encode("utf-8"),
                                     method="POST", headers={"Content-Type": "application/json",
                                                             "X-Hub-Token": self.token,
                                                             "X-Hub-User": json.dumps({"is_service": True})})
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            env = json.loads(res.read())
        if not isinstance(env, dict) or env.get("status") != 200:
            raise RuntimeError(f"the record answered {env.get('status') if isinstance(env, dict) else '?'}")
        return env.get("data") or {}

    @contextmanager
    def snapshot(self) -> Iterator[Any]:
        books: dict[str, Any] = {}
        if self.token or self._ask is not None:
            try:
                books = self.ask({"marks": True}).get("books") or {}
                self._said = False
            except Exception as exc:  # noqa: BLE001 - the mirror alone this round
                if not self._said:
                    self._said = True
                    log.warning("master-json: the record books could not be asked (%s: %.120s) — the mirror alone"
                                " this round", type(exc).__name__, str(exc))
        with self.mirror.snapshot() as snap:
            yield _RecordSnap(snap, books, self) if books else snap


class _RecordSnap:
    def __init__(self, snap: Any, books: dict[str, Any], source: RecordSource) -> None:
        self.snap, self.record, self.source = snap, books, source
        self._held: tuple[tuple[str, str], list] | None = None

    def signatures(self, part_rows: int) -> list[tuple[str, str, int, int, int, float]]:
        out = [s for s in self.snap.signatures(part_rows) if s[0] not in self.record]
        for sid, b in self.record.items():
            for t in b.get("tabs") or []:
                if not int(t.get("rows") or 0):
                    continue
                mid = int(hashlib.sha1(str(t.get("sig")).encode("utf-8")).hexdigest()[:15], 16)
                at = _epoch(t.get("loaded_at"))
                last = max(1, int(t.get("last_row") or 1))
                for k in range((last - 1) // int(part_rows) + 1):
                    out.append((sid, str(t["tab"]), k, int(t["rows"]) if k == 0 else 0, mid, at))
        return out

    def books(self) -> dict[str, dict[str, Any]]:
        out = {s: b for s, b in self.snap.books().items() if s not in self.record}
        for sid, b in self.record.items():
            out[sid] = {"name": str(b.get("name") or ""), "modified_time": 0.0,
                        "synced_at": _epoch(b.get("synced_at")), "status": "record"}
        return out

    def titles(self) -> dict[str, list[str]]:
        out = {s: t for s, t in self.snap.titles().items() if s not in self.record}
        out.update({sid: [str(t["tab"]) for t in b.get("tabs") or []] for sid, b in self.record.items()})
        return out

    def tabs(self) -> dict[tuple[str, str], dict[str, Any]]:
        out = {k: v for k, v in self.snap.tabs().items() if k[0] not in self.record}
        for sid, b in self.record.items():
            for t in b.get("tabs") or []:
                out[(sid, str(t["tab"]))] = {"header": [str(h) for h in t.get("headers") or []],
                                             "whole_at": _epoch(t.get("loaded_at")), "dirty": False}
        return out

    def mirror(self) -> dict[str, Any]:
        return self.snap.mirror()

    def rows(self, sheet_id: str, tab: str, lo: int | None, hi: int | None) -> Iterator[tuple[int, str]]:
        if sheet_id not in self.record:
            yield from self.snap.rows(sheet_id, tab, lo, hi)
            return
        if self._held is None or self._held[0] != (sheet_id, tab):
            got = self.source.ask({"sheet_id": sheet_id, "tab": tab})
            self._held = ((sheet_id, tab), list(got.get("rows") or []))
        for rn, raw in self._held[1]:
            if (lo is None or int(rn) >= lo) and (hi is None or int(rn) <= hi):
                yield int(rn), json.dumps(raw, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════════
# What a round should hold
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class TabPlan:
    tab: str
    parts: list[int]          # the parts the tab is kept in (0 alone for most tabs)
    seed: list[str]           # the header in the sheet's order, when the keeper holds it
    rows: int
    read_at: float
    dirty: bool = False


@dataclass
class Piece:
    """One file of the master: a book's index, or one part of one tab."""
    file: str
    sid: str
    sig: list
    name: str = ""
    tabs: list[TabPlan] = field(default_factory=list)   # a book
    tab: str = ""                                       # a part
    part: int = -1
    lo: int | None = None
    hi: int | None = None
    seed: list[str] = field(default_factory=list)


def _seed(header: list[str]) -> list[str]:
    """The keeper keys a row by every non-blank header cell, a repeated name
    once — so the seed is exactly the names a row can carry, in sheet order."""
    return list(dict.fromkeys(h for h in header if h))


def plan(sigs: list[tuple], books: dict[str, dict], titles: dict[str, list[str]],
         tabs: dict[tuple[str, str], dict], part_rows: int = PART_ROWS
         ) -> tuple[dict[str, Piece], dict[str, list[TabPlan]]]:
    """Every file the master should hold → its Piece; and each book's tabs in
    the sheet's order (the keeper's tab list, then any it does not name)."""
    by_tab: dict[tuple[str, str], dict[int, tuple[int, int, float]]] = {}
    for sid, tab, k, n, mid, at in sigs:
        by_tab.setdefault((sid, tab), {})[int(k)] = (int(n), int(mid), float(at))
    per_book: dict[str, list[str]] = {}
    for sid, tab in by_tab:
        per_book.setdefault(sid, []).append(tab)
    pieces: dict[str, Piece] = {}
    layout: dict[str, list[TabPlan]] = {}
    for sid in sorted(per_book):
        held = per_book[sid]
        known = [t for t in titles.get(sid, []) if t in held]
        order = list(dict.fromkeys(known)) + sorted(t for t in held if t not in known)
        meta = books.get(sid) or {}
        name = str(meta.get("name") or "")
        tab_plans: list[TabPlan] = []
        book_sig: list = [name]
        for tab in order:
            parts = by_tab[(sid, tab)]
            st = tabs.get((sid, tab)) or {}
            seed = _seed(st.get("header") or [])
            whole_at = float(st.get("whole_at") or 0.0)
            dirty = bool(st.get("dirty")) or bool(
                whole_at and float(meta.get("modified_time") or 0.0) > whole_at)
            ks = sorted(parts)
            tab_plans.append(TabPlan(tab, ks, seed, sum(p[0] for p in parts.values()),
                                     max(p[2] for p in parts.values()), dirty))
            book_sig.append([tab, ks])
            # the header a part is aligned with starts from the seed, so a new
            # seed is a new file; its hash, not its words, is what is kept
            seed_tag = hashlib.sha1(_ENC.encode(seed).encode("utf-8")).hexdigest()[:12] if seed else ""
            for k in ks:
                n, mid, at = parts[k]
                f = part_file(sid, tab, k)
                pieces[f] = Piece(file=f, sid=sid, sig=[n, mid, at, seed_tag], tab=tab, part=k,
                                  lo=(k * part_rows + 1) if k else None,
                                  hi=(k + 1) * part_rows, seed=seed)
        f = book_file(sid)
        pieces[f] = Piece(file=f, sid=sid, sig=book_sig, name=name, tabs=tab_plans)
        layout[sid] = tab_plans
    return pieces, layout


# ═══════════════════════════════════════════════════════════════════════════
# Writing one file
# ═══════════════════════════════════════════════════════════════════════════
class _Sink:
    """One file being written: a 0600 temporary, hashed as it is written, in
    chunks of about a megabyte."""

    def __init__(self, tmp_dir: Path) -> None:
        fd, name = tempfile.mkstemp(dir=str(tmp_dir), suffix=".json")
        os.fchmod(fd, 0o600)
        self.path = Path(name)
        self._fh = os.fdopen(fd, "wb")
        self._sha = hashlib.sha256()
        self._buf: list[str] = []
        self._n = 0
        self.bytes = 0

    def write(self, text: str) -> None:
        self._buf.append(text)
        self._n += len(text)
        if self._n >= _CHUNK:
            self._flush()

    def _flush(self) -> None:
        if not self._buf:
            return
        data = "".join(self._buf).encode("utf-8")
        self._buf, self._n = [], 0
        self._sha.update(data)
        self._fh.write(data)
        self.bytes += len(data)

    def close(self) -> str:
        self._flush()
        self._fh.flush()
        os.fsync(self._fh.fileno())
        self._fh.close()
        return self._sha.hexdigest()

    def discard(self) -> None:
        try:
            self._fh.close()
        except Exception:  # noqa: BLE001 - it is being thrown away
            pass
        try:
            self.path.unlink()
        except OSError:
            pass


def _as_row(raw: Any) -> tuple[dict[str, Any], bool]:
    """A mirrored row as the object it should be → (row, whether it was not).

    Four writers fill the mirror, and one row that is not an object — an array,
    a scalar, a number past the digits Python will parse — must not stop a
    round: it is kept whole under ODD_KEY and counted, never dropped."""
    if raw is None:
        return {}, False
    if isinstance(raw, (str, bytes)):
        try:
            raw = json.loads(raw)
        except ValueError:
            text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
            return {ODD_KEY: text}, True
    if isinstance(raw, dict):
        return raw, False
    return {ODD_KEY: raw}, True


def _write_rows(sink: _Sink, rows: Iterable[tuple[int, Any]], seed: list[str]) -> dict[str, Any]:
    """`"rows":[…],"header":[…],"count":n,"first_row":a,"last_row":b` for one
    tab's rows, one row at a time (and `"odd_rows":k` when k rows were not
    objects, `"withheld":k` when k cells were not copied).

    EVERY CELL CROSSES THROUGH THE REDACTION, and this is the only place a
    mirrored cell becomes a byte of the master. The rule is `redaction`'s, the
    same one the keeper writes the mirror by, so a cell withheld there and a
    cell withheld here are withheld for the same reason and by the same
    sentence — see that module for which cells and why."""
    header = list(seed)
    where = {h: i for i, h in enumerate(header)}
    n, first, last, odd, withheld = 0, 0, 0, 0, 0
    sink.write('"rows":[')
    for rn, raw in rows:
        data, was_odd = _as_row(raw)
        odd += was_odd
        data, hidden = redaction.redact_row(data)
        withheld += hidden
        for key in data:
            if key not in where:
                where[key] = len(header)
                header.append(key)
        keys = list(data)
        if keys == header[:len(keys)]:
            cells = list(data.values())
        else:
            cells = [data.get(h) for h in header]
            while cells and cells[-1] is None:
                cells.pop()
        sink.write(("," if n else "") + _ENC.encode([rn, *cells]))
        if not n:
            first = rn
        last = rn
        n += 1
    sink.write('],"header":' + _ENC.encode(header)
               + f',"count":{n},"first_row":{first},"last_row":{last}'
               + (f',"odd_rows":{odd}' if odd else "")
               + (f',"withheld":{withheld}' if withheld else ""))
    info = {"rows": n, "first_row": first, "last_row": last}
    if odd:
        info["odd_rows"] = odd
    if withheld:
        info["withheld"] = withheld
    return info


_INFO_KEYS = ("rows", "first_row", "last_row", "odd_rows", "withheld")


@dataclass
class _Encoded:
    tmp: Path
    sha256: str
    bytes: int
    info: dict[str, Any]


class PieceFailed(Exception):
    """One file's rows could not be encoded. The round carries on without it:
    its previous file stands and the manifest says it is stale, and why."""


def _watched(fetch: Any, fault: list) -> Iterator[tuple[int, Any]]:
    """The mirror's rows, with a note of whether it was the MIRROR that failed."""
    try:
        yield from fetch()
    except Exception:
        fault.append(True)
        raise


def _encode(snap: Any, piece: Piece, tmp_dir: Path) -> _Encoded:
    """One file into a temporary. What fails in the mirror (a dropped
    connection aborts the whole snapshot) or on the disk raises as it is and
    ends the round; what fails in this file's own rows raises PieceFailed."""
    sink = _Sink(tmp_dir)
    fault: list = []
    try:
        if piece.part >= 0:
            sink.write('{"format":' + _ENC.encode(FORMAT) + ',"id":' + _ENC.encode(piece.sid)
                       + ',"tab":' + _ENC.encode(piece.tab) + f',"part":{piece.part},')
            info = _write_rows(sink, _watched(
                lambda: snap.rows(piece.sid, piece.tab, piece.lo, piece.hi), fault), piece.seed)
            sink.write("}")
        else:
            info = {}
            sink.write(_ENC.encode({"format": FORMAT, "id": piece.sid, "name": piece.name,
                                    "tabs": [{"tab": tp.tab,
                                              "parts": [part_file(piece.sid, tp.tab, k)
                                                        for k in tp.parts]}
                                             for tp in piece.tabs]}))
        sha = sink.close()
    except Exception as exc:
        sink.discard()
        if fault or isinstance(exc, OSError):
            raise
        raise PieceFailed(f"{type(exc).__name__}: {str(exc).splitlines()[0][:160] if str(exc) else ''}"
                          ) from exc
    except BaseException:
        sink.discard()
        raise
    return _Encoded(sink.path, sha, sink.bytes, info)


# ═══════════════════════════════════════════════════════════════════════════
# The rounds
# ═══════════════════════════════════════════════════════════════════════════
class MasterKeeper:
    """The master on disk, and what this process knows it holds (`held`:
    file → sha256, bytes, the mirror signature it was written under, and its
    row counts), read back from the manifest when the keeper starts."""

    def __init__(self, source: Any, root: Path | str | None = None, *,
                 part_rows: int = PART_ROWS, keep_rounds: int = KEEP_ROUNDS,
                 archive_bytes: int = ARCHIVE_BYTES, min_free_bytes: int = MIN_FREE_BYTES,
                 verify_every_s: float = VERIFY_EVERY_S) -> None:
        self.source = source
        self.root = Path(root) if root is not None else ROOT
        self.part_rows = max(1, int(part_rows))
        self.keep_rounds = max(1, int(keep_rounds))
        self.archive_bytes = max(0, int(archive_bytes))
        self.min_free_bytes = max(0, int(min_free_bytes))
        self.verify_every_s = float(verify_every_s)
        self.held: dict[str, dict[str, Any]] = {}
        self.round_id = ""
        self.verified_at = 0.0
        self._round_at = 0.0
        # set from the moment a round starts replacing files (or finds which
        # files fail has changed) until its manifest is in place: a round cut
        # between the two owes the manifest, even if the mirror does not move
        self._manifest_owed = False
        # file → why its rows would not encode, as the manifest last said
        self._failed: dict[str, str] = {}
        self._said = 0.0
        self._lock = threading.Lock()
        self._load()

    # ── what is already on disk ────────────────────────────────────────────
    def _load(self) -> None:
        path = self.root / "manifest.json"
        try:
            doc = json.loads(path.read_bytes())
        except FileNotFoundError:
            return
        except Exception as exc:  # noqa: BLE001 - a manifest it cannot read is a first round
            log.warning("master-json: the manifest could not be read back (%s) — every file is"
                        " encoded again", type(exc).__name__)
            return
        if doc.get("format") != FORMAT or int(doc.get("part_rows") or 0) != self.part_rows:
            return
        self.round_id = str(doc.get("round") or "")
        self.verified_at = _epoch(doc.get("verified_at"))
        try:
            stamped = datetime.strptime(self.round_id[:-4], "%Y%m%dT%H%M%S").replace(
                tzinfo=timezone.utc).timestamp() + int(self.round_id[-4:-1]) / 1000.0
        except ValueError:
            stamped = 0.0
        self._round_at = max(_epoch(doc.get("written_at")), stamped)
        # a file that failed with nothing before it has no sha256: nothing holds it
        for b in doc.get("books") or []:
            for t in b.get("tabs") or []:
                for p in t.get("parts") or []:
                    if p.get("sha256"):
                        self.held[p["file"]] = {"sha256": p["sha256"], "bytes": p["bytes"],
                                                "sig": p["sig"], "info": {
                                                    k: p[k] for k in _INFO_KEYS if k in p}}
                    if p.get("failed"):
                        self._failed[p["file"]] = str(p["failed"])
            if b.get("sha256"):
                self.held[b["file"]] = {"sha256": b["sha256"], "bytes": b["bytes"],
                                        "sig": b["sig"], "info": {}}
            if b.get("failed"):
                self._failed[b["file"]] = str(b["failed"])
        if self._failed:
            log.warning("master-json: %d file(s) stale since the last round — their rows would not"
                        " encode; the manifest says which and why", len(self._failed))

    # ── one round ──────────────────────────────────────────────────────────
    def round(self, now: float | None = None, verify: bool | None = None) -> dict[str, Any] | None:
        """Bring the master to the mirror as it stands. None when nothing
        changed (and nothing was written); else what the round wrote."""
        with self._lock:
            return self._round(time.time() if now is None else now, verify)

    def _round(self, now: float, verify: bool | None) -> dict[str, Any] | None:
        started = time.monotonic()
        root = self.root
        for d in (root, root / "books", root / "archive", root / ".tmp"):
            _private_dir(d)
        tmp_dir = root / ".tmp"
        for leftover in tmp_dir.iterdir():
            try:
                leftover.unlink()
            except OSError:
                pass
        free = shutil.disk_usage(root).free
        if free < self.min_free_bytes:
            if now - self._said >= SAY_EVERY_S:
                self._said = now
                log.warning("master-json: %d MB free on the disk, under the %d MB floor — the"
                            " master is not written until there is room",
                            free // 2 ** 20, self.min_free_bytes // 2 ** 20)
            return {"skipped": "disk", "free": free}
        verify = (now - self.verified_at >= self.verify_every_s) if verify is None else verify
        fresh: dict[str, tuple[dict[str, Any], Path]] = {}
        moved: dict[str, dict[str, Any]] = {}
        # ONE BAD FILE STOPS ONLY ITSELF: file → why its rows would not encode.
        # Its previous file and held entry stand, the manifest marks it stale,
        # and the other files of the round are written as ever.
        failed: dict[str, str] = {}
        encoded = 0
        try:
            with self.source.snapshot() as snap:
                sigs = snap.signatures(self.part_rows)
                books = snap.books()
                titles = snap.titles()
                tabs = snap.tabs()
                mirror = snap.mirror()
                pieces, layout = plan(sigs, books, titles, tabs, self.part_rows)
                for f, piece in pieces.items():
                    held = self.held.get(f)
                    on_disk = (root / f).is_file()
                    if not verify and held and held["sig"] == piece.sig and on_disk:
                        continue
                    try:
                        got = _encode(snap, piece, tmp_dir)
                    except PieceFailed as exc:
                        failed[f] = str(exc)
                        if held and not on_disk:
                            self.held.pop(f, None)
                        continue
                    encoded += 1
                    entry = {"sha256": got.sha256, "bytes": got.bytes, "sig": piece.sig,
                             "info": got.info}
                    # the sweep believes the bytes on disk, not what it wrote down
                    same = (on_disk and _sha_file(root / f) == got.sha256) if verify else (
                        held and held["sha256"] == got.sha256 and on_disk)
                    if same:
                        # the mirror's rows were written again, the same
                        got.tmp.unlink()
                        moved[f] = entry
                    else:
                        fresh[f] = (entry, got.tmp)
        except BaseException:
            for _entry, tmp in fresh.values():
                try:
                    tmp.unlink()
                except OSError:
                    pass
            raise
        on_disk_files = {f"books/{p.name}" for p in (root / "books").iterdir() if p.is_file()}
        gone = sorted((set(self.held) | on_disk_files) - set(pieces))
        if verify:
            self.verified_at = now
        if failed != self._failed:
            # said once, when a file starts failing or stops: not every pass
            for f in sorted(set(failed) - set(self._failed)):
                # the file's name, never its tab's: a tab can be named for a person
                log.warning("master-json: %s could not be encoded (%s) — %s; the rest of the round"
                            " is written, and so is it once its rows encode", f,
                            failed[f].split(":", 1)[0],
                            "its last file stands, marked stale" if f in self.held
                            else "it has no file yet")
            if set(self._failed) - set(failed):
                log.info("master-json: %d file(s) that would not encode are written again",
                         len(set(self._failed) - set(failed)))
            self._failed = failed
            self._manifest_owed = True
        if not fresh and not gone and not self._manifest_owed:
            self.held.update(moved)
            return None

        # a round's id only ever grows, even two rounds inside one millisecond
        at = max(now, self._round_at + 0.001)
        round_id = _stamp(at)
        replaced = sorted(f for f in fresh if (root / f).is_file())
        archived = self._archive(round_id, now, replaced, [f for f in gone if (root / f).is_file()])
        self._manifest_owed = True
        for f, (_entry, tmp) in fresh.items():
            os.replace(tmp, root / f)
        for f in gone:
            try:
                (root / f).unlink()
            except FileNotFoundError:
                pass
        _fsync_dir(root / "books")
        for f in gone:
            self.held.pop(f, None)
        self.held.update(moved)
        self.held.update({f: entry for f, (entry, _tmp) in fresh.items()})
        manifest = self._manifest(round_id, now, pieces, layout, books, mirror)
        _write_atomic(root / "manifest.json",
                      json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        self._manifest_owed = False
        self.round_id, self._round_at = round_id, at
        kept, kept_bytes = self._prune()
        totals = manifest["totals"]
        lag = manifest["mirror"].get("lag_s")
        out = {"round": round_id, "written": len(fresh), "removed": len(gone),
               "written_bytes": sum(int(entry["bytes"]) for entry, _tmp in fresh.values()),
               "encoded": encoded, "rows": totals["rows"], "bytes": totals["bytes"],
               "files": totals["files"], "books": totals["books"], "tabs": totals["tabs"],
               "archived": archived, "archives": kept, "archive_bytes": kept_bytes,
               "lag_s": lag, "owed": manifest["mirror"].get("owed_books", 0),
               "failed": len(self._failed), "withheld": totals["withheld"],
               "withheld_books": totals["withheld_books"],
               "seconds": round(time.monotonic() - started, 1)}
        # THE WITHHELD CELLS ARE SAID OUT LOUD, EVERY ROUND. A redaction
        # nobody can see is a redaction nobody notices stopping: the two
        # numbers here are the manifest's own, so a rule that broke shows as a
        # count that fell on the next round that writes anything.
        log.info("master-json: round %s — %d file(s) written (%.1f MB), %d removed, %d encoded,"
                 " %d stale; %d row(s) in %d book(s), %d tab(s), %.1f MB over %d file(s);"
                 " %d cell(s) withheld in %d book(s); archive %d"
                 " round(s), %.1f MB (this one %.1f MB); the mirror listed Drive %s ago, %d book(s)"
                 " owed; in %.1fs",
                 round_id, out["written"], out["written_bytes"] / 2 ** 20, out["removed"], encoded,
                 out["failed"], out["rows"], out["books"], out["tabs"], out["bytes"] / 2 ** 20,
                 out["files"], out["withheld"], out["withheld_books"],
                 kept, kept_bytes / 2 ** 20, archived / 2 ** 20,
                 "an unknown time" if lag is None else f"{lag:.0f}s", out["owed"], out["seconds"])
        return out

    def _manifest(self, round_id: str, now: float, pieces: dict[str, Piece],
                  layout: dict[str, list[TabPlan]], books: dict[str, dict],
                  mirror: dict[str, Any]) -> dict[str, Any]:
        pending = set(mirror.get("pending") or [])
        failed = self._failed
        out_books = []
        total_rows = total_bytes = total_tabs = 0
        # THE WHOLE TREE'S WITHHELD CELLS, NOT THIS ROUND'S. A round rewrites
        # the files that moved and leaves the rest standing, so "how much this
        # round withheld" would fall to nothing on a quiet round and say
        # nothing about whether the rule still works. These two numbers count
        # every file the master holds, which is why the same two can go in the
        # log line: they only move when the master's own contents move.
        total_withheld = withheld_books = 0

        def entry(f: str) -> dict[str, Any]:
            """What the disk holds for a file — and, when this round's rows
            would not encode, why its last file is stale (or absent)."""
            h = self.held.get(f)
            out = ({"sha256": h["sha256"], "bytes": h["bytes"], "sig": h["sig"], **h["info"]}
                   if h else {"sha256": None, "bytes": 0})
            if f in failed:
                out["failed"] = failed[f]
            return out

        for sid, tab_plans in layout.items():
            f = book_file(sid)
            meta = books.get(sid) or {}
            tabs_out = []
            book_withheld = 0
            for tp in tab_plans:
                parts = []
                tab_withheld = 0
                for k in tp.parts:
                    pf = part_file(sid, tp.tab, k)
                    parts.append({"part": k, "file": pf, **entry(pf)})
                    total_bytes += int(parts[-1]["bytes"])
                    tab_withheld += int(parts[-1].get("withheld") or 0)
                # the tab's fingerprint: its parts' hashes, in order
                tabs_out.append({"tab": tp.tab, "rows": tp.rows,
                                 "first_row": parts[0].get("first_row", 0),
                                 "last_row": parts[-1].get("last_row", 0), "read_at": _iso(tp.read_at),
                                 "fingerprint": hashlib.sha256("\n".join(
                                     f"{p['part']}:{p['sha256'] or ''}" for p in parts).encode()).hexdigest(),
                                 "dirty": tp.dirty,
                                 # the mirror holds rows this tab's files do not
                                 "stale": any("failed" in p for p in parts),
                                 "withheld": tab_withheld, "parts": parts})
                total_rows += tp.rows
                total_tabs += 1
                book_withheld += tab_withheld
            book = entry(f)
            total_bytes += int(book["bytes"])
            total_withheld += book_withheld
            withheld_books += 1 if book_withheld else 0
            out_books.append({"id": sid, "name": str(meta.get("name") or ""), "file": f, **book,
                              "rows": sum(tp.rows for tp in tab_plans),
                              "modified_time": _iso(meta.get("modified_time")),
                              "synced_at": _iso(meta.get("synced_at")),
                              "status": str(meta.get("status") or ""), "owed": sid in pending,
                              "withheld": book_withheld, "tabs": tabs_out})
        listed = float(mirror.get("listed_at") or 0.0)
        return {
            "format": FORMAT, "round": round_id, "written_at": _iso(now),
            "verified_at": _iso(self.verified_at),
            "source": "asa_drive_sheets_rows (the Postgres mirror hub_sheet_sync keeps)",
            "part_rows": self.part_rows,
            # THE MIRROR'S OWN LAG: this is the mirror as it stood when the
            # round read it; the mirror is Drive as of its keeper's last
            # listing, less the books that listing still owes.
            "mirror": {"listed_at": _iso(listed), "last_pass_at": _iso(mirror.get("last_pass_at")),
                       "watermark": _iso(mirror.get("watermark")),
                       "lag_s": round(now - listed, 1) if listed else None,
                       "owed_books": len(pending)},
            # `withheld` and `withheld_books`: the cells this copy does not
            # hold and how many books they came out of — the same two numbers
            # the round's log line says, so a rule that quietly stopped
            # withholding shows up as a number that fell.
            "totals": {"books": len(out_books), "tabs": total_tabs, "rows": total_rows,
                       "bytes": total_bytes, "files": len(pieces), "failed": len(failed),
                       "withheld": total_withheld, "withheld_books": withheld_books},
            "books": out_books,
        }

    # ── the archive ────────────────────────────────────────────────────────
    def _archive(self, round_id: str, now: float, replaced: list[str], removed: list[str]) -> int:
        """ONE gzip of what this round replaces: the previous manifest and the
        previous version of every file rewritten or removed — each copied in
        verbatim, so the archive is one JSON document. → its size (0: none)."""
        manifest = self.root / "manifest.json"
        olds = replaced + removed
        if not olds and not manifest.is_file():
            return 0
        final = self.root / "archive" / f"round-{round_id}.json.gz"
        fd, tmp = tempfile.mkstemp(dir=str(final.parent), prefix=".round-", suffix=".tmp")
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as raw:
                fd = -1
                with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0) as gz:
                    gz.write(('{"format":' + _ENC.encode(FORMAT) + ',"round":' + _ENC.encode(round_id)
                              + ',"previous_round":' + _ENC.encode(self.round_id)
                              + ',"replaced_at":' + _ENC.encode(_iso(now))
                              + ',"removed":' + _ENC.encode(removed) + ',"manifest":').encode())
                    if manifest.is_file():
                        _copy(manifest, gz)
                    else:
                        gz.write(b"null")
                    gz.write(b',"files":{')
                    for i, f in enumerate(olds):
                        gz.write((("," if i else "") + _ENC.encode(f) + ":").encode("utf-8"))
                        _copy(self.root / f, gz)
                    gz.write(b"}}")
                raw.flush()
                os.fsync(raw.fileno())
            os.replace(tmp, final)
        except BaseException:
            if fd >= 0:
                os.close(fd)
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        _fsync_dir(final.parent)
        return final.stat().st_size

    def _prune(self) -> tuple[int, int]:
        """Oldest first, past KEEP_ROUNDS or ARCHIVE_MB; the newest always stays."""
        rounds = sorted((p for p in (self.root / "archive").iterdir()
                         if p.name.startswith("round-") and p.name.endswith(".json.gz")),
                        key=lambda p: p.name)
        sizes = {p: p.stat().st_size for p in rounds}
        total = sum(sizes.values())
        while len(rounds) > 1 and (len(rounds) > self.keep_rounds or total > self.archive_bytes):
            oldest = rounds.pop(0)
            try:
                oldest.unlink()
            except FileNotFoundError:
                pass
            total -= sizes[oldest]
        return len(rounds), total


def _sha_file(path: Path) -> str:
    sha = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_CHUNK)
            if not chunk:
                return sha.hexdigest()
            sha.update(chunk)


def _copy(path: Path, out: Any) -> None:
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_CHUNK)
            if not chunk:
                return
            out.write(chunk)


def read_book(root: Path | str, sheet_id: str) -> dict[str, Any]:
    """A book as the master holds it: {"id", "name", "tabs": [{"tab", "header",
    "rows": [{"_row": n, column: cell, …}]}]} — its parts joined, each row keyed
    by the header it was written against. For tests and for a reader that
    wants a book whole; it holds the book in memory."""
    root = Path(root)
    doc = json.loads((root / book_file(sheet_id)).read_bytes())
    out = {"id": doc["id"], "name": doc.get("name", ""), "tabs": []}
    for t in doc["tabs"]:
        segs = ([json.loads((root / f).read_bytes()) for f in t["parts"]] if "parts" in t else [t])
        header: list[str] = []
        rows = []
        for seg in segs:
            for h in seg["header"]:
                if h not in header:
                    header.append(h)
            for r in seg["rows"]:
                row = {"_row": r[0]}
                row.update({h: c for h, c in zip(seg["header"], r[1:]) if c is not None})
                rows.append(row)
        out["tabs"].append({"tab": t["tab"], "header": header, "rows": rows})
    return out


# ═══════════════════════════════════════════════════════════════════════════
# The hand-off journal
# ═══════════════════════════════════════════════════════════════════════════
def handoff_first(body: dict[str, Any], root: Path | str | None = None,
                  now: float | None = None) -> Path:
    """Write a hand-off to the relay's disk before its door hears of it.

    Only the action and its payload are written — never the credential the
    body travels with. Raises when the disk refused: the caller then does not
    post, and its next tick hands the same rows again."""
    action = str(body.get("action") or "")
    if action not in HANDOFF_ACTIONS:
        raise ValueError(f"not a hand-off this journal keeps: {action[:40]!r}")
    now = time.time() if now is None else now
    base = (Path(root) if root is not None else ROOT) / "handoff" / action
    record = json.dumps({"format": FORMAT, "action": action, "written_at": _iso(now),
                         "payload": body.get("payload")}, separators=(",", ":")).encode("ascii")
    with _HANDOFF_LOCK:
        for d in (base.parent.parent, base.parent, base):
            _private_dir(d)
        current = base / "current.json"
        if current.is_file():
            name = f"round-{_stamp(now)}.json.gz"
            if (base / name).exists():
                name = f"round-{_stamp(now)}-{os.getpid()}-{time.monotonic_ns()}.json.gz"
            fd, tmp = tempfile.mkstemp(dir=str(base), prefix=".round-", suffix=".tmp")
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "wb") as raw:
                    fd = -1
                    with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0) as gz:
                        _copy(current, gz)
                    raw.flush()
                    os.fsync(raw.fileno())
                os.replace(tmp, base / name)
            except BaseException:
                if fd >= 0:
                    os.close(fd)
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        _write_atomic(current, record)
        olds = sorted((p for p in base.iterdir()
                       if p.name.startswith("round-") and p.name.endswith(".json.gz")),
                      key=lambda p: p.name)
        total = sum(p.stat().st_size for p in olds)
        while olds and (len(olds) > HANDOFF_KEEP or total > HANDOFF_BYTES):
            oldest = olds.pop(0)
            total -= oldest.stat().st_size
            oldest.unlink()
    return current
