#!/usr/bin/env python3
"""
THE MIRROR COMES FIRST, asserted against the real functions, offline.

WHAT IT PROVES.

  the keeper   hub_sheet_sync reads a changed book in ONE request once it
               knows the book; a giant tab whose header, first rows and last
               rows are exactly the mirror's gets only its new rows appended;
               an edit at the end, a rotation at the top or a header that
               changed is never taken for an append — the tab is marked and
               read whole when its turn comes; an edit in the middle is NOT
               seen by the appends and IS caught by the whole read the due
               sweep owes the tab (the stated bound); a renamed tab is caught
               at once; a book that parsed to nothing never wipes its copy;
               the cap leaves the rest owed, never dropped; a 429 keeps every
               book already landed — the watermark stops short of the owed
               ones only, and the next pass re-reads none of the landed ones
  the order    a reader answers from its kept copy, then the mirror, then
               Google — and Google only when the mirror is older than the
               stated age, misses the book, or a filing is newer than both;
               a kept copy never answers alone beside a mirror that cannot
               vouch; when Google refuses, the newest copy answers and says
               so, and "no earlier copy" is said only when nothing exists
  restart      the copies land on disk 0600 with built_at and source_at, come
               back after a restart, and answer (as copies) when Google is
               refused — the desk's index and the notes exist, never "no
               earlier copy" while the mirror holds the book
  both shapes  the Daily Notes built from the mirror (the TEXT a date cell
               shows) and from a Sheets read of the same rows (the SERIAL)
               match note for note, dates of both shapes included; so does
               the calls index
  confirm      a lane's live copy is confirmed by the mirror (a form stamp's
               milliseconds against the second it shows) with no request; a
               changed row or a filing sends it to Google
  the number   caller_phone never leaves the mirror: refused before the
               database is asked, absent from every note and every copy
  the retry    the Hotline screen asks a never-read notes book again on its
               poll, backing off, and at once when the index recovers

HOW IT STAYS OFFLINE. It runs on the host against this checkout's server/.
Every book is a fake made here; the mirror is a fake backend; the network is
refused (`urlopen` and socket connects raise), psycopg2 is never asked for a
connection, and the copies live in a temporary folder.

    python3 tools/test-mirror-first.py
"""
import asyncio
import json
import os
import re
import socket
import stat
import sys
import tempfile
import time
import types
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
TMP = Path(tempfile.mkdtemp(prefix="mirror-first-"))
os.environ.update({
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_HOTLINE_PEOPLE": str(TMP / "people.json"),
    "GOOGLE_SERVICE_ACCOUNT_JSON": str(TMP / "no-such-key.json"),
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network
socket.create_connection = _no_network
socket.socket.connect = _no_network  # type: ignore[method-assign]

import hub_sheet_sync as hss  # noqa: E402
import mirror_first as mf  # noqa: E402
import hotline_desk as desk  # noqa: E402
import daily_notes as dn  # noqa: E402
import hotline_lanes as lanes  # noqa: E402

try:  # the relay's own image has it; nothing here may ever connect with it
    import psycopg2 as _pg  # noqa: E402
    _pg.connect = _no_network
except Exception:  # noqa: BLE001
    pass

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


class HttpError(Exception):
    """What googleapiclient raises, as far as the readers look at it."""

    def __init__(self, status, text):
        self.resp = types.SimpleNamespace(status=status)
        super().__init__(f"<HttpError {status} when requesting fake: {text}>")


class RealHttpError(Exception):
    """googleapiclient's HttpError as it really reads: its text carries the whole
    request URI (sheet id, every range asked), Google's words in reason/content."""

    def __init__(self, status, uri, reason, content=b""):
        self.resp = types.SimpleNamespace(status=status)
        self.uri, self.reason, self.content = uri, reason, content
        self.error_details = reason
        super().__init__(f'<HttpError {status} when requesting {uri} returned "{reason}".'
                         f' Details: "{reason}">')


def quota():
    return HttpError(429, "Quota exceeded for quota metric 'Read requests'")


# ═══════════════════════════════════════════════════════════════════════════
# 1. THE KEEPER
# ═══════════════════════════════════════════════════════════════════════════
class Clock:
    def __init__(self, at):
        self.t = float(at)

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s

    slept: list = []


class KeeperSheets:
    """spreadsheets().get (titles) and values().batchGet (FORMATTED ranges),
    answering the way the API does: trailing empty cells and rows trimmed."""

    def __init__(self):
        self.books = {}          # sid -> {title: matrix of strings}
        self.requests = []       # (kind, sid, ranges)
        self.fail = []           # exceptions to raise, one per request, in order

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def _next_failure(self):
        if self.fail:
            exc = self.fail.pop(0)
            if exc is not None:
                raise exc

    def get(self, spreadsheetId=None, fields=None):
        def run(num_retries=0):
            self.requests.append(("titles", spreadsheetId, None))
            self._next_failure()
            return {"sheets": [{"properties": {"title": t}} for t in self.books[spreadsheetId]]}
        return types.SimpleNamespace(execute=run)

    @staticmethod
    def _col(letters):
        n = 0
        for ch in letters:
            n = n * 26 + (ord(ch) - 64)
        return n

    @staticmethod
    def _trim(rows):
        out = []
        for r in rows:
            r = list(r)
            while r and r[-1] in ("", None):
                r.pop()
            out.append(r)
        while out and not out[-1]:
            out.pop()
        return out

    def _range(self, sid, rng):
        m = re.match(r"^'((?:[^']|'')*)'(?:!(.*))?$", rng)
        if not m:
            raise HttpError(400, f"Unable to parse range: {rng}")
        title, part = m.group(1).replace("''", "'"), m.group(2)
        book = self.books[sid]
        if title not in book:
            raise HttpError(400, f"Unable to parse range: {rng}")
        matrix = book[title]
        if part is None:
            return self._trim(matrix)
        m = re.match(r"^(\d+):(\d+)$", part)
        if m:
            return self._trim(matrix[int(m.group(1)) - 1:int(m.group(2))])
        m = re.match(r"^A(\d+):([A-Z]+)$", part)
        if m:
            start, width = int(m.group(1)), self._col(m.group(2))
            return self._trim([r[:width] for r in matrix[start - 1:]])
        raise HttpError(400, f"Unable to parse range: {rng}")

    def batchGet(self, spreadsheetId=None, ranges=None, valueRenderOption=None):
        def run(num_retries=0):
            self.requests.append(("batch", spreadsheetId, list(ranges)))
            self._next_failure()
            return {"valueRanges": [{"values": self._range(spreadsheetId, r)} for r in ranges]}
        return types.SimpleNamespace(execute=run)


class FakeDrive:
    def __init__(self, sheets, mtimes, names):
        self.sheets, self.mtimes, self.names = sheets, mtimes, names
        self.lists = 0

    def files(self):
        return self

    def list(self, q=None, **_kw):
        def run(num_retries=0):
            self.lists += 1
            since = hss._ts(re.search(r"modifiedTime > '([^']+)'", q).group(1))
            files = [{"id": sid, "name": self.names.get(sid, sid), "modifiedTime": hss._iso(mt)}
                     for sid, mt in self.mtimes.items() if mt > since]
            return {"files": files}
        return types.SimpleNamespace(execute=run)


class FakeStore:
    """PgStore's contract, in memory — the same rules, row for row."""

    def __init__(self, clock, watermark):
        self.clock = clock
        self.rows = {}           # (sid, tab, rn) -> data
        self.meta = {}           # sid -> {modified_time, status, name, tabs, rows, error}
        self.books = {}          # sid -> (titles, titles_at)
        self.tabs = {}           # (sid, tab) -> state
        self.state = {"watermark": watermark, "listed_at": None, "pending": [], "books": 0,
                      "errors": 0}

    def ensure(self):
        pass

    def watermark(self):
        return self.state["watermark"]

    def known(self, ids):
        return {s: (m["modified_time"], m["status"], m.get("synced_at", 0.0))
                for s, m in self.meta.items() if s in ids}

    def titles(self, sid):
        return self.books.get(sid)

    def giants(self, sid):
        return {t: dict(st) for (s, t), st in self.tabs.items() if s == sid}

    def rows_in(self, sid, tab, windows):
        return {rn: dict(d) for (s, t, rn), d in self.rows.items()
                if s == sid and t == tab and any(lo <= rn <= hi for lo, hi in windows)}

    def prior_count(self, sid):
        return sum(1 for (s, _t, _r) in self.rows if s == sid)

    def due(self, now, exclude):
        out = set()
        for (sid, _tab), st in self.tabs.items():
            m = self.meta.get(sid)
            if m and st["whole_at"] < now - hss.WHOLE_EVERY_S and (
                    st.get("dirty_since") or m["modified_time"] > st["whole_at"]):
                out.add(sid)
        for sid, (_titles, at) in self.books.items():
            m = self.meta.get(sid)
            if m and at < now - hss.TITLES_EVERY_S and m["modified_time"] > at:
                out.add(sid)
        # a read that failed waits DUE_RETRY_S before the sweep asks again
        out = {s for s in out if not (self.meta[s]["status"] == "error"
                                      and self.meta[s].get("synced_at", 0.0) > now - hss.DUE_RETRY_S)}
        return [{"id": s, "name": self.meta[s]["name"],
                 "modifiedTime": hss._iso(self.meta[s]["modified_time"])}
                for s in sorted(out) if s not in exclude]

    def forget(self, sid):
        self.books.pop(sid, None)
        for key in [k for k in self.tabs if k[0] == sid]:
            del self.tabs[key]

    def tab_rows(self, sid, tab):
        return {rn: d for (s, t, rn), d in self.rows.items() if s == sid and t == tab}

    def apply(self, change):
        sid = change.sid
        if change.titles is not None:
            for key in [k for k in self.rows if k[0] == sid and k[1] not in change.titles]:
                del self.rows[key]
            for key in [k for k in self.tabs if k[0] == sid and k[1] not in change.titles]:
                del self.tabs[key]
            self.books[sid] = (list(change.titles), self.clock())
        for tab, rows in change.replace.items():
            for key in [k for k in self.rows if k[0] == sid and k[1] == tab]:
                del self.rows[key]
            for rn, data in rows:
                self.rows[(sid, tab, rn)] = json.loads(json.dumps(data))
        for tab, rows in change.append.items():
            for rn, data in rows:
                self.rows[(sid, tab, rn)] = json.loads(json.dumps(data))
        for tab, st in change.giants.items():
            if st is None:
                self.tabs.pop((sid, tab), None)
            else:
                self.tabs[(sid, tab)] = dict(st)
        total = sum(1 for k in self.rows if k[0] == sid)
        tabs = len({k[1] for k in self.rows if k[0] == sid})
        self.meta[sid] = {"modified_time": hss._ts(change.mtime), "status": "ok",
                          "name": change.name, "tabs": tabs, "rows": total, "error": None,
                          "synced_at": self.clock()}
        return tabs, total

    def mark_error(self, sid, name, mtime, err):
        m = self.meta.setdefault(sid, {"modified_time": hss._ts(mtime), "name": name,
                                       "tabs": 0, "rows": 0})
        m.update(status="error", error=err, synced_at=self.clock())

    def vouch_row(self, sid, tab):
        """What mirror_first.PgMirror.vouch_row answers, from this store's state."""
        m = self.meta.get(sid) or {}
        st = self.tabs.get((sid, tab)) or {}
        return {"known": bool(m), "status": m.get("status", ""),
                "modified_time": m.get("modified_time"), "synced_at": m.get("synced_at"),
                "has_rows": bool(self.tab_rows(sid, tab)), "listed_at": self.state["listed_at"],
                "pending": list(self.state["pending"]), "dirty": bool(st.get("dirty_since")),
                "whole_at": st.get("whole_at")}

    def save_pass(self, mark, books, errors, listed_at, pending):
        if mark is not None:
            self.state["watermark"] = mark
        self.state.update(listed_at=listed_at, pending=sorted(set(pending)), books=books,
                          errors=errors)


def log_rows(n, start=1, stamp="2026-09-21T10:{:02d}:{:02d}.000Z"):
    return [[stamp.format((i // 60) % 60, i % 60), f"action {i}", str(i)]
            for i in range(start, start + n)]


def mirrored(store, sid, tab):
    return store.tab_rows(sid, tab)


def truth(matrix):
    return {rn: d for rn, d in hss.whole_tab(matrix, 0.0)[0]}


def keeper_tests():
    hss.GIANT_TAB_ROWS = 10
    hss.WHOLE_EVERY_S = 3 * 3600.0
    hss.TITLES_EVERY_S = 3600.0
    hss.QUOTA_BREATHE_S = 60.0
    T0 = 1_790_000_000.0
    clock = Clock(T0)
    Clock.slept = []
    sheets = KeeperSheets()
    store = FakeStore(clock, datetime.fromtimestamp(T0 - 3600, timezone.utc))
    pace = hss.Pace(per_minute=1000, spacing=0.0, clock=clock, sleep=clock.sleep)
    SID = "1giantBookFake000000000000000000000000000"
    header = ["timestamp", "action", "n"]
    log = [header] + log_rows(20)
    small = [["key", "value"], ["a", "1"], ["b", "2"], ["c", "3"]]
    sheets.books[SID] = {"Log": log, "Small": small}
    f = {"id": SID, "name": "ASA Hub — Logs (fake)", "modifiedTime": hss._iso(T0)}

    def sync(**kw):
        before = pace.count
        r = hss.sync_book(sheets, store, pace, dict(f), now=clock(), **kw)
        return r, pace.count - before

    # first contact: the tab list and one read of every tab, whole
    r, asked = sync()
    check("keeper: a book never seen costs the tab list and one read (2 requests)", asked == 2, asked)
    check("keeper: the first read mirrors every tab exactly as a whole read keys it",
          mirrored(store, SID, "Log") == truth(log) and mirrored(store, SID, "Small") == truth(small))
    st = store.tabs.get((SID, "Log"))
    check("keeper: a tab past GIANT_TAB_ROWS is remembered — header row, header and last row",
          st is not None and st["header_row"] == 0 and st["header"] == header and st["extent"] == 21,
          st)
    check("keeper: a short tab keeps no append state (it is read whole whenever it changes)",
          (SID, "Small") not in store.tabs)

    # appends
    clock.t += 300
    log.extend(log_rows(3, start=21))
    small[1][1] = "one"
    f["modifiedTime"] = hss._iso(clock())
    r, asked = sync()
    check("keeper: a known book that changed costs ONE request", asked == 1, asked)
    batch = sheets.requests[-1][2]
    check("keeper: the giant tab is asked for its head and its tail only, the short one whole",
          batch == ["'Log'!1:4", "'Log'!A17:C", "'Small'"], batch)
    check("keeper: only the three new rows are appended", r.tail_tabs == 1 and r.appended == 3,
          vars(r))
    check("keeper: after the appends the mirror is exactly what a whole read would hold",
          mirrored(store, SID, "Log") == truth(log) and mirrored(store, SID, "Small") == truth(small))
    check("keeper: the last covered row moves with the appends",
          store.tabs[(SID, "Log")]["extent"] == 24)
    check("keeper: the book's meta carries the version it now holds",
          store.meta[SID]["modified_time"] == hss._ts(f["modifiedTime"])
          and store.meta[SID]["rows"] == 23 + 3)

    # an edit at the end is never an append
    clock.t += 300
    log[22][1] = "EDITED near the end"
    f["modifiedTime"] = hss._iso(clock())
    r, asked = sync()
    check("keeper: an edit in the last rows fails the check — nothing is appended over it",
          r.tail_tabs == 0 and r.dirty == 1 and asked == 1, vars(r))
    check("keeper: that tab is marked dirty (the whole read waits for its turn)",
          store.tabs[(SID, "Log")]["dirty_since"] is not None)
    check("keeper: the mirror still holds the old row meanwhile (known stale, said so)",
          mirrored(store, SID, "Log")[23]["action"] == "action 22")
    due = store.due(clock(), set())
    check("keeper: before WHOLE_EVERY_S the due sweep does not owe it yet", due == [], due)
    clock.t += hss.WHOLE_EVERY_S + 1
    due = store.due(clock(), set())
    check("keeper: past WHOLE_EVERY_S the due sweep owes the book, unlisted",
          [d["id"] for d in due] == [SID], due)
    r, asked = sync(due=True)
    check("keeper: the owed read is the tab list and the dirty tab alone, whole",
          asked == 2 and sheets.requests[-1][2] == ["'Log'"], sheets.requests[-2:])
    check("keeper: after the owed whole read the mirror is exact and the tab clean",
          mirrored(store, SID, "Log") == truth(log)
          and store.tabs[(SID, "Log")]["dirty_since"] is None)

    # an edit in the middle: not seen by appends, caught by the due whole read
    clock.t += 300
    log[8][1] = "EDITED in the middle"
    f["modifiedTime"] = hss._iso(clock())
    r, asked = sync()
    check("keeper: an edit in the MIDDLE of a giant tab passes the check (the documented blind spot)",
          r.tail_tabs == 1 and r.appended == 0 and mirrored(store, SID, "Log")[9]["action"] != "EDITED in the middle",
          vars(r))
    clock.t += hss.WHOLE_EVERY_S + 1
    due = store.due(clock(), set())
    check("keeper: ...and the book changed since the tab's last whole read, so the due sweep owes it",
          [d["id"] for d in due] == [SID], due)
    sync(due=True)
    check("keeper: the owed whole read catches the old row's edit — the bound is WHOLE_EVERY_S plus a pass",
          mirrored(store, SID, "Log")[9]["action"] == "EDITED in the middle"
          and mirrored(store, SID, "Log") == truth(log))

    # a rotation at the top and a header change are not appends either
    clock.t += 300
    del log[1:3]
    log.extend(log_rows(2, start=100))
    f["modifiedTime"] = hss._iso(clock())
    r, _ = sync()
    check("keeper: rows deleted at the top (a rotation) fail the check — nothing appended under shifted rows",
          r.dirty == 1 and r.appended == 0, vars(r))
    clock.t += hss.WHOLE_EVERY_S + 1
    f["modifiedTime"] = hss._iso(clock())
    r, _ = sync()
    check("keeper: a listed book whose giant tab is past its turn is read whole, and exact",
          r.giant_whole == 1 and mirrored(store, SID, "Log") == truth(log), vars(r))
    clock.t += 300
    log[0] = ["timestamp", "what", "n"]
    log.append(["2026-09-21T11:00:00.000Z", "after rename", "999"])
    f["modifiedTime"] = hss._iso(clock())
    r, _ = sync()
    check("keeper: a header that changed is never taken for an append under the old names",
          r.dirty == 1 and not any("what" in d for d in mirrored(store, SID, "Log").values()),
          vars(r))
    clock.t += hss.WHOLE_EVERY_S + 1
    sync(due=True)
    check("keeper: the whole read re-keys the tab under its new header",
          mirrored(store, SID, "Log") == truth(log))

    # a renamed tab is caught at once
    clock.t += 300
    sheets.books[SID] = {"Log": log, "Tiny": small}
    f["modifiedTime"] = hss._iso(clock())
    before = len(sheets.requests)
    r, asked = sync()
    kinds = [k for k, _, _ in sheets.requests[before:]]
    check("keeper: a renamed tab fails its range, the list is asked again and the book read against it",
          kinds == ["batch", "titles", "batch"], sheets.requests[before:])
    check("keeper: the vanished tab's rows leave the mirror, the new name's arrive",
          not mirrored(store, SID, "Small") and mirrored(store, SID, "Tiny") == truth(small)
          and mirrored(store, SID, "Log") == truth(log))

    # a fetch that parsed to nothing never wipes a good copy
    EMPTY = "1emptiedBookFake00000000000000000000000000"
    sheets.books[EMPTY] = {"Data": [["id", "name"], ["1", "a"], ["2", "b"]]}
    e = {"id": EMPTY, "name": "a house", "modifiedTime": hss._iso(clock())}
    hss.sync_book(sheets, store, pace, e, now=clock())
    sheets.books[EMPTY]["Data"] = [["id", "name"]]
    try:
        hss.sync_book(sheets, store, pace, e, now=clock())
        refused = False
    except RuntimeError as exc:
        refused = "refusing to wipe" in str(exc)
    check("keeper: a book that parsed to nothing never wipes the copy it had",
          refused and len(mirrored(store, EMPTY, "Data")) == 2)

    # ── the pass: the cap, the skip, and a 429 that keeps what landed ──
    hss.BOOKS_PER_PASS = 2
    clock.t += 3600
    sheets2 = KeeperSheets()
    t = clock()
    ids = [f"1passBook{i}Fake00000000000000000000000000" for i in range(5)]
    for i, sid in enumerate(ids):
        sheets2.books[sid] = {"Data": [["id", "v"], [str(i), "x"]]}
    store2 = FakeStore(clock, datetime.fromtimestamp(t - 600, timezone.utc))
    mtimes = {ids[0]: t - 300, ids[1]: t - 200, ids[2]: t - 100}
    drive = FakeDrive(sheets2, mtimes, {})
    pace2 = hss.Pace(per_minute=1000, spacing=0.0, clock=clock, sleep=clock.sleep)
    out = hss.one_pass(drive, sheets2, store2, pace2, now=clock)
    check("pass: the cap reads the OLDEST changes first and leaves the rest owed",
          out["books"] == 2 and store2.state["pending"] == [ids[2]], out)
    check("pass: the watermark stops a millisecond short of the owed book, past the landed ones",
          abs(hss._ts(store2.state["watermark"]) - (t - 200)) < 0.01, store2.state["watermark"])
    check("pass: the pass says when it listed (what the readers' vouch stands on)",
          store2.state["listed_at"] == t)
    clock.t += 300
    before = pace2.count
    out = hss.one_pass(drive, sheets2, store2, pace2, now=clock)
    check("pass: a landed book relisted in the lap costs nothing; the owed one is read",
          out["current"] >= 1 and out["books"] == 1 and pace2.count - before == 2
          and store2.state["pending"] == [], (out, pace2.count - before))

    # a 429 twice: the pass stops, and what landed stays landed
    clock.t += 300
    mtimes[ids[3]] = clock() - 50
    mtimes[ids[4]] = clock() - 40
    Clock.slept = []
    sheets2.fail = [None, None, quota(), quota()]   # book 3: titles + batch ok; book 4 refused twice
    out = hss.one_pass(drive, sheets2, store2, pace2, now=clock)
    check("pass: a second 429 in a row shuts the pass (after breathing a whole minute once)",
          out["shut"] and 60.0 in Clock.slept, (out, Clock.slept))
    check("pass: the book that landed before the refusal is KEPT (its version is in the mirror)",
          store2.meta[ids[3]]["status"] == "ok"
          and store2.meta[ids[3]]["modified_time"] == hss._ts(hss._iso(mtimes[ids[3]])))
    check("pass: the refused book is owed, and the line stops just short of it — not at the old watermark",
          store2.state["pending"] == [ids[4]]
          and abs(hss._ts(store2.state["watermark"]) - hss._ts(hss._iso(mtimes[ids[3]]))) < 0.01,
          (store2.state["pending"], store2.state["watermark"]))
    clock.t += 300
    before = pace2.count
    out = hss.one_pass(drive, sheets2, store2, pace2, now=clock)
    check("pass: the next pass re-reads NONE of the landed books — only the owed one (2 requests, first contact)",
          out["books"] == 1 and pace2.count - before == 2 and store2.state["pending"] == [],
          (out, pace2.count - before))
    check("watermark: nothing landed holds the line",
          hss.next_watermark(datetime.fromtimestamp(t, timezone.utc), [], [hss._iso(t + 5)]) is None)
    check("watermark: never moves backwards",
          hss.next_watermark(datetime.fromtimestamp(t, timezone.utc), [hss._iso(t - 30)], []) is None)
    hss.BOOKS_PER_PASS = 40

    # ── KEPT OUT: the full punch record never reaches the mirror ──
    # It carries clients' names, addresses and GPS points; not sharing it
    # with the service account does not keep this keeper (listing as jarvis@)
    # from seeing it, so the keeper refuses it by title and by its pointer.
    clock.t += 300
    t = clock()
    sheets3 = KeeperSheets()
    by_title = "1fullPunchByTitleFake000000000000000000000"
    by_ptr = "1fullPunchByPointerFake00000000000000000000"
    plain = "1plainHouseFake0000000000000000000000000000"
    for sid in (by_title, by_ptr, plain):
        sheets3.books[sid] = {"Data": [["id", "latitude"], ["1", "40.81"]]}

    class PointerStore(FakeStore):
        asked = 0

        def pointer_ids(self, sources):
            PointerStore.asked += 1
            return {by_ptr} if "switchboard:props.HUB_HOUSE_PSI_PUNCHES_FULL_ID" in sources else set()

    store3 = PointerStore(clock, datetime.fromtimestamp(t - 600, timezone.utc))
    drive3 = FakeDrive(sheets3, {by_title: t - 300, by_ptr: t - 200, plain: t - 100},
                       {by_title: "ASA Data — PsiPunchesFull", by_ptr: "renamed by somebody",
                        plain: "ASA Data — Plain"})
    pace3 = hss.Pace(per_minute=1000, spacing=0.0, clock=clock, sleep=clock.sleep)
    hss._KEEP_OUT.update(at=0.0, ids=frozenset())
    out = hss.one_pass(drive3, sheets3, store3, pace3, now=clock)
    read_ids = {r[1] for r in sheets3.requests}
    check("kept out: the full punch house is never read nor mirrored — by its minted title, and by the depot "
          "pointer that names it whatever it is called; the plain house lands",
          out["kept_out"] == 2 and out["books"] == 1 and by_title not in read_ids and by_ptr not in read_ids
          and plain in read_ids and not store3.tab_rows(by_title, "Data") and not store3.tab_rows(by_ptr, "Data")
          and by_title not in store3.meta and by_ptr not in store3.meta and store3.tab_rows(plain, "Data"),
          (out, read_ids))
    check("kept out: nothing is owed for it — the watermark passes it instead of relisting it every pass",
          store3.state["pending"] == []
          and abs(hss._ts(store3.state["watermark"]) - (t - 100)) < 0.01, store3.state)
    clock.t += 300
    drive3.mtimes[by_ptr] = clock() - 10
    out = hss.one_pass(drive3, sheets3, store3, pace3, now=clock)
    check("kept out: a later change is kept out too, and the pointer is not asked again inside its hour",
          out["kept_out"] == 1 and out["books"] == 0 and PointerStore.asked == 1
          and by_ptr not in {r[1] for r in sheets3.requests}, (out, PointerStore.asked))
    import psi_punches_full  # noqa: PLC0415
    mint_src = (ROOT / "tools" / "mint_psi_punches_full_house.py").read_text(encoding="utf-8")
    check("kept out: the title and the pointer the mint writes are the ones the keeper refuses",
          '"title": "ASA Data — PsiPunchesFull"' in mint_src and "ASA Data — PsiPunchesFull" in hss.KEEP_OUT_TITLES
          and '"prop": "HUB_HOUSE_PSI_PUNCHES_FULL_ID"' in mint_src
          and "switchboard:props.HUB_HOUSE_PSI_PUNCHES_FULL_ID" in hss.KEEP_OUT_POINTERS
          and psi_punches_full.TAB == "psi_punches_full")
    hss._KEEP_OUT.update(at=0.0, ids=frozenset())


# ═══════════════════════════════════════════════════════════════════════════
# 2. THE MIRROR, FAKED
# ═══════════════════════════════════════════════════════════════════════════
class FakeMirror:
    """mirror_first's backend: the mirror's rows are the TEXT each cell shows."""

    def __init__(self):
        self.tabs = {}        # (sid, tab) -> {"keys": [...], "rows": [(rn, {header: text})]}
        self.meta = {}        # sid -> {status, modified_time}
        self.listed_at = None
        self.pending = []
        self.dirty = set()
        self.synced = {}      # sid -> when the keeper last wrote the book (last_sync_at)
        self.asked = []       # every header asked for, in every read
        self.reads = 0
        self.down = False

    def __call__(self, dsn):
        if self.down:
            raise ConnectionError("the mirror is down")
        return self

    def put(self, sid, tab, header, rows, modified=None):
        self.tabs[(sid, tab)] = {"keys": list(header),
                                 "rows": [(i + 2, dict(zip(header, r))) for i, r in enumerate(rows)]}
        self.meta[sid] = {"status": "ok", "modified_time": modified or time.time() - 3600}

    def vouch_row(self, sid, tab):
        t = self.tabs.get((sid, tab))
        m = self.meta.get(sid)
        return {"known": m is not None, "status": (m or {}).get("status", ""),
                "modified_time": (m or {}).get("modified_time"),
                "synced_at": self.synced.get(sid),
                "has_rows": bool(t and t["rows"]), "listed_at": self.listed_at,
                "pending": list(self.pending), "dirty": (sid, tab) in self.dirty}

    def tab_keys(self, sid, tab):
        t = self.tabs.get((sid, tab))
        return set(t["keys"]) if t and t["rows"] else set()

    def tab_rows(self, sid, tab, headers):
        self.reads += 1
        self.asked.extend(headers)
        t = self.tabs.get((sid, tab)) or {"keys": [], "rows": []}
        keys = set(t["keys"]) if t["rows"] else set()
        return keys, [(rn, [d.get(h) for h in headers]) for rn, d in t["rows"]]


MIRROR = FakeMirror()
mf.backend = MIRROR


def order_tests():
    copies = mf.Copies("order-test")
    calls = {"mirror": 0, "live": 0}
    state = {"pause": "", "live_fails": False, "value": 1}

    def from_mirror(kept):
        calls["mirror"] += 1
        return {"from": "mirror", "v": state["value"]}, 1

    def from_live():
        calls["live"] += 1
        if state["live_fails"]:
            raise desk.SourceError("The fake book could not be read (HTTP 429).")
        return {"from": "live", "v": state["value"]}, 1

    def ask(v, need_after=0.0, now=None):
        return mf.read("src", copies, label="the fake book", need_after=need_after,
                       vouch=lambda: v, from_mirror=from_mirror, from_live=from_live,
                       paused=lambda: state["pause"], fail=desk.SourceError,
                       sentence_of=lambda exc: str(exc), now=now)

    now = time.time()
    fresh = mf.Vouch(True, True, now - 70, "")
    a = ask(fresh)
    check("order: with nothing kept and a fresh mirror, the MIRROR answers — Google is not asked",
          a.via == "mirror" and calls == {"mirror": 1, "live": 0} and not a.stale, (a, calls))
    a = ask(fresh)
    check("order: the same mirror again: the KEPT COPY answers — neither Postgres rows nor Google",
          a.via == "copy" and calls == {"mirror": 1, "live": 0}, (a, calls))
    a = ask(fresh, need_after=now)
    check("order: a filing newer than both copies sends the read to Google, once",
          a.via == "live" and calls["live"] == 1, (a, calls))
    a = ask(fresh, need_after=now)
    check("order: after that live read, the kept copy carries the news until the mirror catches up",
          a.via == "copy" and calls["live"] == 1, (a, calls))
    later = mf.Vouch(True, True, time.time() + 5, "")
    a = ask(later, need_after=now)
    check("order: a mirror newer than the kept copy answers again (and becomes the copy)",
          a.via == "mirror" and calls["mirror"] == 2, (a, calls))
    stale = mf.Vouch(True, False, now - 7200, "the mirror last looked long ago")
    a = ask(stale, now=time.time() + 30)
    check("order: beside a mirror that cannot vouch, a kept copy never answers alone — Google is asked",
          a.via == "live" and calls["live"] == 2, (a, calls))
    state["live_fails"] = True
    a = ask(stale, now=time.time() + 30)
    check("order: Google refused: the NEWEST copy answers, said to be a copy",
          a.via == "copy" and "could not be read" in a.stale and "Showing the copy read at" in a.stale,
          a)
    state["pause"] = "The fake book was not asked: the desk holds its reads."
    before = calls["live"]
    a = ask(stale, now=time.time() + 30)
    check("order: during the desk's pause Google is not even asked; the copy answers with the pause's sentence",
          calls["live"] == before and a.stale.startswith("The fake book was not asked"), a)
    empty = mf.Copies("order-empty")
    try:
        mf.read("src", empty, label="the fake book", need_after=0.0,
                vouch=lambda: mf.Vouch(False, False, 0.0, "no rows"),
                from_mirror=from_mirror, from_live=from_live, paused=lambda: "",
                fail=desk.SourceError, sentence_of=lambda exc: str(exc))
        said = ""
    except desk.SourceError as exc:
        said = str(exc)
    check("order: 'no earlier copy' is said ONLY when the mirror holds nothing and nothing was kept",
          "No earlier copy exists" in said, said)
    only_mirror = mf.read("src", empty, label="the fake book", need_after=time.time() + 60,
                          vouch=lambda: mf.Vouch(True, False, now - 100, "owed"),
                          from_mirror=from_mirror, from_live=from_live, paused=lambda: "",
                          fail=desk.SourceError, sentence_of=lambda exc: str(exc))
    check("order: with no kept copy and Google refused, the mirror's copy answers rather than nothing",
          only_mirror.via == "mirror" and "Showing the mirror's copy" in only_mirror.stale, only_mirror)

    # the mirror's own vouch
    MIRROR.put("1vouchFake", "Data", ["a", "b"], [["1", "2"]])
    MIRROR.listed_at = time.time() - 30
    v = mf.vouch("fake", "1vouchFake", "Data")
    check("vouch: a landed, clean book vouches as of the keeper's listing less the Drive margin",
          v.fresh and abs(v.as_of - (MIRROR.listed_at - mf.VOUCH_MARGIN_S)) < 0.01, v)
    MIRROR.pending = ["1vouchFake"]
    check("vouch: a book the last pass still owes cannot vouch", not mf.vouch("fake", "1vouchFake", "Data").fresh)
    MIRROR.pending = []
    MIRROR.dirty.add(("1vouchFake", "Data"))
    check("vouch: a tab waiting on its whole re-read cannot vouch",
          not mf.vouch("fake", "1vouchFake", "Data").fresh)
    MIRROR.dirty.clear()
    MIRROR.listed_at = time.time() - mf.MAX_AGE_S - 120
    check("vouch: a keeper whose last look is older than the stated age cannot vouch",
          not mf.vouch("fake", "1vouchFake", "Data").fresh)
    MIRROR.listed_at = None
    check("vouch: a keeper that never said when it looked cannot vouch (an older keeper)",
          not mf.vouch("fake", "1vouchFake", "Data").fresh)
    check("vouch: no database, no vouch — never an error", not mf.vouch("", "x", "y").has)


# ═══════════════════════════════════════════════════════════════════════════
# 3. DATES IN BOTH SHAPES, AND THE NOTES NOTE FOR NOTE
# ═══════════════════════════════════════════════════════════════════════════
EPOCH = datetime(1899, 12, 30)


def serial_of(local: datetime) -> float:
    return (local - EPOCH).total_seconds() / 86400.0


def shown(value) -> str:
    """The text Sheets shows for a cell (FORMATTED_VALUE, en_US): a date cell
    as M/D/YYYY H:MM:SS (or M/D/YYYY for a whole day), a number as written."""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    # the fixtures' date cells are this estate's years; a phone written as a
    # number (13309197779) is past the last day a serial can name
    is_date = isinstance(value, float) and 30000 < value < 2958465
    if is_date and not value.is_integer():
        # Sheets shows a half second rounded UP
        at = EPOCH + timedelta(seconds=int(value * 86400.0 + 0.5))
        return f"{at.month}/{at.day}/{at.year} {at.hour}:{at.minute:02d}:{at.second:02d}"
    if is_date:
        at = EPOCH + timedelta(days=value)
        return f"{at.month}/{at.day}/{at.year}"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return "" if value is None else str(value)


class LiveSheets:
    """The desk's reads of a book: spreadsheets().get for zone + header, and
    values().batchGet of whole columns, UNFORMATTED (serials for date cells)."""

    def __init__(self):
        self.books = {}       # sid -> (zone, header, rows)
        self.requests = []
        self.refuse = False

    def __call__(self, *a, **k):
        return self

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, ranges=None, includeGridData=None, fields=None):
        def run(num_retries=0):
            self.requests.append(("meta", spreadsheetId))
            if self.refuse:
                raise quota()
            zone, header, _rows = self.books[spreadsheetId]
            return {"properties": {"timeZone": zone},
                    "sheets": [{"data": [{"rowData": [
                        {"values": [{"formattedValue": h} for h in header]}]}]}]}
        return types.SimpleNamespace(execute=run)

    def batchGet(self, spreadsheetId=None, ranges=None, majorDimension=None,
                 valueRenderOption=None, dateTimeRenderOption=None):
        def run(num_retries=0):
            self.requests.append(("columns", spreadsheetId))
            if self.refuse:
                raise quota()
            _zone, header, rows = self.books[spreadsheetId]
            out = []
            for rng in ranges:
                letters = rng.split("!")[-1].split(":")[0]
                idx = KeeperSheets._col(re.sub(r"\d", "", letters)) - 1
                col = [header[idx] if idx < len(header) else ""]
                col += [(r[idx] if idx < len(r) else "") for r in rows]
                while col and col[-1] == "":
                    col.pop()
                out.append({"values": [col]})
            return {"valueRanges": out}
        return types.SimpleNamespace(execute=run)


def mirror_book(sid, tab, header, rows):
    """The same rows as the keeper mirrors them: every cell as the text it shows."""
    MIRROR.put(sid, tab, header, [[shown(c) for c in r] for r in rows])


BOOK_ZONE = "America/Sao_Paulo"
NOTES_HEADER = ["timestamp", "call_id", "reporting_date", "dsp_name", "client_name", "category",
                "caller_phone", "response"]
PHONES = ["+13305550111", 13305550122.0, "+13305550133"]


def notes_rows():
    s1 = serial_of(datetime(2026, 9, 17, 8, 1, 23))     # a date CELL (the book's clock)
    s2 = serial_of(datetime(2026, 9, 17, 23, 59, 59))   # late: the day must not move
    return [
        [s1, "AC1", "2026-09-17", "Dana Lee", "Robin Client", "sleep", PHONES[0], "slept well"],
        ["2026-09-18T12:34:56.789Z", "AC2", 46283.0, "Dana Lee", "Robin Clint", "meals",
         PHONES[1], "ate lunch"],
        [s2, "AC3", "Thu Sep 17 2026 23:30:00 GMT-0400 (Eastern Daylight Time)", "Sam Staff",
         "Nobody Known", "incidents", PHONES[2], "a fall, no injury"],
        ["", "", "", "", "", "", "", ""],
        ["", "AC4", "2026-09-19", "Sam Staff", "", "other", PHONES[0], "a note with no client"],
        [s1, "AC1", "2026-09-17", "Dana Lee", "Robin Client", "sleep", PHONES[0], "slept well"],
    ]


def wipe_disk():
    """No copy on disk either — a first start, not a restart (reset_desk keeps
    the disk: a restarted process reads its copies back)."""
    d = mf.armed()
    for path in (d.glob("*.private.json") if d else []):
        path.unlink()


def reset_desk():
    desk._QUOTA.update({"until": 0.0, "at": 0.0})
    desk._ZONES.clear()
    desk._HEADERS.clear()
    desk._LAST_GOOD.clear()
    desk._COPIES.forget()
    dn._COPIES.forget()


def dates_and_notes_tests():
    z = BOOK_ZONE
    s = serial_of(datetime(2026, 9, 17, 8, 1, 23))
    check("dates: a date cell and the text it shows are the same instant",
          desk.parse_when(s, z) == desk.parse_when(shown(s), z) is not None,
          (desk.parse_when(s, z), desk.parse_when(shown(s), z)))
    check("dates: a whole-day cell and the day it shows are the same reporting day",
          dn.reporting_day(46282.0, z) == dn.reporting_day(shown(46282.0), z) == date(2026, 9, 17))
    late = serial_of(datetime(2026, 9, 17, 23, 59, 59))
    check("dates: a late evening stamp keeps its day in both shapes",
          dn.reporting_day(late, z) == dn.reporting_day(shown(late), z) == date(2026, 9, 17))
    half = 3998808000.5 / 86400.0      # a stamp exactly on half a second (measured: 1 in 1,743)
    check("dates: a stamp on half a second reads the same second from the serial and from its text",
          desk.parse_when(half, z) == desk.parse_when(shown(half), z)
          and desk.parse_when(half, z).second == 1,
          (desk.parse_when(half, z), shown(half)))

    clients = TMP / "clients.json"
    clients.write_text(json.dumps({"rows": [{"name": "Robin Client", "house": "H12"},
                                            {"name": "Alex Other", "house": "H7"}]}))
    sid = dn.NOTES.sheet_id
    rows = notes_rows()
    sheets = LiveSheets()
    sheets.books[sid] = (BOOK_ZONE, NOTES_HEADER, rows)
    mirror_book(sid, dn.NOTES.tab, NOTES_HEADER, rows)
    MIRROR.asked.clear()

    # the live build: the mirror cannot vouch, so Google answers
    reset_desk()
    desk._NEWS["at"] = 0.0
    MIRROR.listed_at = None
    live = dn.build_book(sheets, "fake-dsn", str(clients))
    asked_live = len(sheets.requests)
    # the mirror build: the mirror vouches and nothing kept — no request at all
    reset_desk()
    MIRROR.listed_at = time.time() - 10
    mirror = dn.build_book(sheets, "fake-dsn", str(clients))
    check("notes: the live build asked Google; the mirror build asked it NOTHING",
          asked_live >= 2 and len(sheets.requests) == asked_live, sheets.requests)
    a, b = live["payload"], mirror["payload"]
    check("notes: built from the mirror and from a Sheets read of the same rows — the same notes, note for note",
          a["notes"] == b["notes"] and len(a["notes"]) == 5,
          json.dumps([a["notes"], b["notes"]])[:600])
    check("notes: ...the same version, the same unmatched counts, and every source ok in both",
          a["version"] == b["version"] and a["unmatched"] == b["unmatched"]
          and b["sources"]["notes"]["ok"], (a["version"], b["version"], b["sources"]["notes"]))
    check("notes: the reporting dates of both shapes and the call times land where they should",
          [n["reporting_date"] for n in b["notes"]].count("2026-09-17") == 3
          and "2026-09-18" in [n["reporting_date"] for n in b["notes"]]
          and any(n["call_at"] == "2026-09-17T11:01:23Z" for n in b["notes"]),
          [(n["reporting_date"], n["call_at"]) for n in b["notes"]])
    check("notes: the payload says when the notes are the book as of (source_at) beside built_at",
          bool(b["source_at"]) and b["source_at"] <= b["built_at"], (b["source_at"], b["built_at"]))
    blob = json.dumps([a, b])
    check("notes: caller_phone is in no note, by name or by number",
          "caller_phone" not in blob and not any(str(p).replace("+", "").split(".")[0][-10:] in blob
                                                 for p in PHONES))
    check("notes: caller_phone was never even asked of the mirror",
          "caller_phone" not in MIRROR.asked and "timestamp" in MIRROR.asked, MIRROR.asked)
    try:
        mf.mirror_rows("fake-dsn", sid, dn.NOTES.tab, {"x": "caller_phone"}, refuse=dn._NEVER_READ)
        refused = False
    except ValueError:
        refused = True
    check("notes: a read that names caller_phone is refused before Postgres is asked", refused)

    # restart: the copy comes back from disk and answers when Google refuses
    mf.arm(TMP / "mirror-first")
    reset_desk()
    MIRROR.listed_at = time.time() - 10
    dn.build_book(sheets, "fake-dsn", str(clients))
    path = TMP / "mirror-first" / "daily-notes.private.json"
    on_disk = json.loads(path.read_text()) if path.exists() else {}
    check("restart: the notes copy is on disk, 0600, with built_at and each source's source_at",
          path.exists() and stat.S_IMODE(path.stat().st_mode) == 0o600
          and on_disk.get("built_at") and on_disk["copies"]["daily_notes"]["source_at"] > 0,
          on_disk.keys() if on_disk else "missing")
    check("restart: no caller_phone and no caller's number in the copy on disk",
          "caller_phone" not in path.read_text()
          and not any(str(p).replace("+", "").split(".")[0][-10:] in path.read_text() for p in PHONES))
    reset_desk()                      # a new process: nothing in memory
    desk._NEWS["at"] = time.time()    # ...that cannot know what was filed while down
    MIRROR.down = True                # ...with Postgres gone as well
    sheets.refuse = True              # ...and Google refusing
    got = dn.build_book(sheets, "fake-dsn", str(clients))
    MIRROR.down = False
    check("restart: into a 429 with Postgres down, the copy on disk answers — as a copy, never 'no note'",
          len(got["payload"]["notes"]) == 5 and not got["payload"]["sources"]["notes"]["ok"]
          and "Showing the copy read at" in got["payload"]["sources"]["notes"]["error"],
          got["payload"]["sources"]["notes"])
    reset_desk()
    desk._NEWS["at"] = time.time()
    (TMP / "mirror-first" / "daily-notes.private.json").unlink()
    got = dn.build_book(sheets, "fake-dsn", str(clients))
    check("restart: into a 429 with no copy anywhere but the mirror, the MIRROR answers — never 'no note'",
          len(got["payload"]["notes"]) == 5
          and "Showing the mirror's copy" in got["payload"]["sources"]["notes"]["error"],
          got["payload"]["sources"]["notes"])
    sheets.refuse = False
    desk._QUOTA.update({"until": 0.0, "at": 0.0})

    # the held book is old the moment a filing is rung for
    async def cached():
        dn._BOOK.update({"book": None, "at": 0.0, "from": 0.0, "task": None, "failure": ""})
        desk._NEWS["at"] = 0.0
        first = await dn.current_book(sheets, "fake-dsn", str(clients))
        again = await dn.current_book(sheets, "fake-dsn", str(clients))
        desk.invalidate()
        after = await dn.current_book(sheets, "fake-dsn", str(clients))
        return first, again, after
    MIRROR.listed_at = time.time() - 10
    first, again, after = asyncio.run(cached())
    check("notes: a held book answers while young and nothing was filed",
          again is first)
    check("notes: a filing (desk.invalidate) makes the held book old at once — the next ask rebuilds",
          after is not first)


# ═══════════════════════════════════════════════════════════════════════════
# 4. THE CALLS INDEX, BOTH WAYS, AND ITS RESTART
# ═══════════════════════════════════════════════════════════════════════════
def index_tests():
    A, L, B, R = desk.TRANSCRIPTS, desk.HOTLINE_LOG, desk.CALLS_HOUSE, desk.RECAPS
    a_header = list(desk.A_FIELDS.values()) + list(desk.A_WORDS.values())
    at1 = serial_of(datetime(2026, 9, 17, 8, 1, 23))
    at2 = serial_of(datetime(2026, 9, 18, 14, 5, 9))
    a_rows = [
        ["CALLAAA1", at1, at1, 184.0, "+13309195558", "+13305550111", "+13309195558", "incoming",
         12.0, "", "", "full words one", "[0:00] +13309195558: Hello."],
        ["CALLAAA2", at2, at2, 61.0, "+13307544040", "+13305550122", "+13307544040", "incoming",
         4.0, "", "", "full words two", "[0:00] +13307544040: Hi."],
    ]
    l_header = ["call_id", "at", "caller", "items", "kinds", "status", "via"]
    l_rows = [["CALLAAA1", "2026-09-17T11:10:00.000Z", "+13305550111", 2.0, "DailyNote, Request",
               "processed", "groq"]]
    b_header = list(desk.B_FIELDS.values())
    b_rows = [["CALLBBB3", "9/16/2026 17:45:36", "9/16/2026 17:45:36", "33.5", "+13309195558",
               "+13305550133", "+13309195558", "incoming", "3"]]
    r_header = list(desk.R_FIELDS.values())
    r_rows = [["CALLAAA1", "The caller reported a fall.", '["Call back"]',
               "2026-09-17T11:05:00.000Z", "2026-09-17T11:05:00.000Z"]]
    sheets = LiveSheets()
    for book, zone, header, rows in ((A, BOOK_ZONE, a_header, a_rows), (L, "UTC", l_header, l_rows),
                                     (B, "Etc/GMT", b_header, b_rows), (R, "UTC", r_header, r_rows)):
        sheets.books[book.sheet_id] = (zone, header, rows)
        mirror_book(book.sheet_id, book.tab, header, rows)
    people = TMP / "people.json"
    people.write_text(json.dumps({"rows": [{"name": "Nobody", "phone": "+13305559999"}]}))
    now = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    MIRROR.asked.clear()

    reset_desk()
    desk._NEWS["at"] = 0.0
    MIRROR.listed_at = None
    live = desk.build_index(sheets, "fake-dsn", str(people), now=now)
    n_live = len(sheets.requests)
    reset_desk()
    MIRROR.listed_at = time.time() - 10
    mirror = desk.build_index(sheets, "fake-dsn", str(people), now=now)
    check("index: the mirror build asked Google nothing (the live one asked every book)",
          n_live >= 8 and len(sheets.requests) == n_live, sheets.requests)
    check("index: built from the mirror and from Sheets — the same calls, the same states, the same times",
          live["payload"]["calls"] == mirror["payload"]["calls"]
          and len(mirror["payload"]["calls"]) == 3,
          json.dumps([live["payload"]["calls"], mirror["payload"]["calls"]])[:700])
    check("index: ...the same version and the same rows behind each call",
          live["payload"]["version"] == mirror["payload"]["version"]
          and live["where"] == mirror["where"], (live["payload"]["version"], mirror["payload"]["version"]))
    check("index: a date cell's text is read in inbox A's declared zone before any live read taught it",
          any(c["at"] == "2026-09-17T11:01:23Z" for c in mirror["payload"]["calls"]),
          [c["at"] for c in mirror["payload"]["calls"]])
    check("index: the words and the log's caller column were never asked of the mirror",
          not ({"Full Transcript", "Speaker Transcript", "caller"} & set(MIRROR.asked)),
          sorted(set(MIRROR.asked)))

    # a restarted relay in a 429 with the mirror behind the restart: an index, not a 503
    reset_desk()
    desk._NEWS["at"] = time.time()
    MIRROR.listed_at = time.time() - 900
    sheets.refuse = True
    got = desk.build_index(sheets, "fake-dsn", str(people), now=now)
    sheets.refuse = False
    health = got["payload"]["sources"]
    check("index: a restart into a 429 builds from the copies on disk — never 'no earlier copy exists yet'",
          len(got["payload"]["calls"]) == 3 and not health["transcripts"]["ok"]
          and "Showing the copy read at" in health["transcripts"]["error"], health["transcripts"])
    check("index: ...and the first 429 paused the desk's reads, so the other books were not even asked",
          sum(1 for k, _ in sheets.requests[n_live:] if k in ("meta", "columns")) == 1,
          sheets.requests[n_live:])
    path = TMP / "mirror-first" / "hotline-desk.private.json"
    check("index: the desk's copies are on disk after a build, 0600",
          path.exists() and stat.S_IMODE(path.stat().st_mode) == 0o600)
    text = path.read_text() if path.exists() else ""
    check("index: no transcript words and no log caller column in the desk's copies",
          bool(text) and "full words one" not in text and '"caller"' not in text)
    reset_desk()
    desk._QUOTA.update({"until": time.time() + 180, "at": time.time()})
    path.unlink()
    desk._COPIES.forget()
    got = desk.build_index(sheets, "fake-dsn", str(people), now=now)
    health = got["payload"]["sources"]
    check("index: with no copy on disk, the MIRROR's copy builds the index during the pause",
          len(got["payload"]["calls"]) == 3
          and "Showing the mirror's copy" in health["transcripts"]["error"]
          and "Showing the mirror's copy" in health["hotline_log"]["error"], health)
    desk._QUOTA.update({"until": 0.0, "at": 0.0})


# ═══════════════════════════════════════════════════════════════════════════
# 5. A LANE: THE MIRROR CONFIRMS, GOOGLE READS
# ═══════════════════════════════════════════════════════════════════════════
def lane_tests():
    check("confirm: a form stamp's milliseconds and the second the cell shows are the same moment",
          lanes._date_equiv("2026-09-17T16:55:52.123Z", "9/17/2026 13:55:52", BOOK_ZONE))
    check("confirm: another second is another moment",
          not lanes._date_equiv("2026-09-17T16:55:52.123Z", "9/17/2026 13:55:54", BOOK_ZONE))
    check("confirm: a time-only cell and the hour it shows",
          lanes._date_equiv("13:10", "1:10:00 PM", BOOK_ZONE)
          and not lanes._date_equiv("13:10", "1:11:00 PM", BOOK_ZONE))
    check("confirm: text is compared as text", lanes._date_equiv("9/18/2026", "9/18/2026", BOOK_ZONE)
          and not lanes._date_equiv("", "9/18/2026", BOOK_ZONE))

    lane = lanes.LANE_BY_KEY["supportQueue"]
    book = lane.book
    header = ["Status", "Urgency", "Date Received", "Requestor", "Requestor Phone",
              "Type of Request", "Description of Request", "Notes", "Processed"]
    stamp1 = serial_of(datetime(2026, 9, 17, 13, 55, 52, 123000))
    rows = [["Pending", "High", stamp1, "Jessica Book", 13309197779.0, "PSI - Reset Password",
             "Password reset", "", ""],
            ["Processed", "Low", "2026-09-18", "Alex Rivera", 13309190000.0, "Supplies",
             "Gloves", "", "Processed"]]
    sheets = LiveSheets()
    sheets.books[book.sheet_id] = ("America/New_York", header, rows)
    mirror_book(book.sheet_id, book.tab, header, rows)
    lanes.switchboard = lambda dsn: {}          # every lane on its named book, no depot
    reset_desk()
    lanes._COPIES.forget()
    lanes._NEWS[lane.key] = 0.0
    MIRROR.listed_at = time.time() - 10
    first = lanes.build_lane(sheets, lane.key, "fake-dsn")
    n1 = len(sheets.requests)
    check("lane: with nothing kept, the lane reads Google (the mirror only confirms)",
          n1 >= 2 and first["ok"] and first["count"] == 2, (sheets.requests, first["error"]))
    check("lane: the live read keeps the stamp's milliseconds",
          first["rows"][0]["date_received"].endswith(".123Z"), first["rows"][0])
    # the live read was five minutes ago, and the keeper has looked since
    source = f"lane:{lane.key}"
    kept = lanes._COPIES.get(source)
    lanes._COPIES.put(source, kept["value"], kept["count"], time.time() - 300, "live")
    first_at = datetime.fromtimestamp(time.time() - 300, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    MIRROR.listed_at = time.time() - 10
    again = lanes.build_lane(sheets, lane.key, "fake-dsn")
    check("lane: the mirror confirms the copy row for row — no request at all",
          len(sheets.requests) == n1 and again["ok"] and again["rows"] == first["rows"],
          sheets.requests[n1:])
    check("lane: a confirmed copy is dated by the mirror's look, not by its old live read",
          again["read_at"] > first_at, (first_at, again["read_at"]))
    rows.append(["Pending", "Low", "2026-09-19", "New Person", 13309191111.0, "Other", "x", "", ""])
    mirror_book(book.sheet_id, book.tab, header, rows)
    MIRROR.listed_at = time.time() - 5
    changed = lanes.build_lane(sheets, lane.key, "fake-dsn")
    check("lane: a row the mirror shows and the copy does not sends the lane to Google",
          len(sheets.requests) > n1 and changed["count"] == 3, changed["count"])
    n2 = len(sheets.requests)
    lanes.invalidate((lane.key,))
    filed = lanes.build_lane(sheets, lane.key, "fake-dsn")
    check("lane: a filing rung for the lane sends the next read to Google, whatever the mirror says",
          len(sheets.requests) > n2 and filed["ok"], sheets.requests[n2:])
    phone_blob = json.dumps(MIRROR.asked)
    check("lane: a caller's phone column is never asked of the mirror (Requestor Phone is the queue's own)",
          not ({"caller", "caller_phone", "Caller Phone"} & set(MIRROR.asked)), phone_blob[:200])


# ═══════════════════════════════════════════════════════════════════════════
# 6. THE SCREEN'S RETRY (source-level: the hook runs in a browser)
# ═══════════════════════════════════════════════════════════════════════════
def screen_tests():
    src = (ROOT / "src/pages/features/smartcomms/hotline/useHotlineData.ts").read_text()
    poll = src[src.index("const timer = window.setInterval"):src.index("POLL_TICK_MS)", src.index("const timer = window.setInterval"))]
    check("screen: the poll asks a never-read notes book again once its wait is over",
          "notesRetryAtRef.current" in poll and "!notes.dataAt" in poll and "loadNotes()" in poll
          and "!notes.refusal" in poll)
    check("screen: each refusal doubles the wait, up to a ceiling; a good read resets it",
          "notesRetryDelayRef.current * 2, NOTES_RETRY_MAX_MS" in src
          and "notesRetryDelayRef.current = NOTES_RETRY_FIRST_MS" in src)
    check("screen: the gate's refusal is never retried by the poll",
          re.search(r"isAccessRefusal\(p\)\) \{\s*// THE GATE'S NO[^\n]*\n\s*notesRetryAtRef\.current = 0", src)
          is not None)
    check("screen: a calls index that recovers asks for the never-read notes at once",
          "const recovered = problemRef.current !== null" in src
          and re.search(r"if \(recovered && \(!notes\.dataAt \|\| notesCopyRef\.current\) && !notes\.refusal",
                        src) is not None)
    # a notes book the relay answered from a COPY (sources.notes not ok)
    check("screen: a notes book is dated by what its notes are of (source_at), not when it was built",
          "Date.parse(ans.data.source_at || ans.data.built_at)" in src)
    check("screen: a copy's sentence becomes the notes' error (the panel says 'could not be read', not 'no row')",
          "const health = ans.data.sources.notes" in src and "health.ok === false" in src
          and "error: copy, refusal: null" in src)
    check("screen: a notes book answered only as a copy is asked again on the poll, backing off",
          "(!notes.dataAt || notesCopyRef.current)" in poll
          and re.search(r"if \(copy\) \{\s*notesRetryAtRef\.current = now \+ notesRetryDelayRef\.current",
                        src) is not None)
    api = (ROOT / "src/pages/features/smartcomms/hotline/hotlineApi.ts").read_text()
    check("screen: the notes door's source_at is read off the answer",
          "source_at: str(d.source_at)" in api)
    page = (ROOT / "src/pages/features/smartcomms/SmartCommsHotlinePage.tsx").read_text()
    check("screen: the copy's sentence is said once, not again as a notes source",
          "if (k === 'notes' && lanes.notes.error) continue" in page)


# ═══════════════════════════════════════════════════════════════════════════
# 7. THE KEEPER'S FAULTS: quota by status, gone books, failing books, repeats
# ═══════════════════════════════════════════════════════════════════════════
class UriSheets(KeeperSheets):
    """KeeperSheets whose range errors read as googleapiclient's: the text
    carries the request URI — here a sheet id and a tail range holding '429'."""

    def _range(self, sid, rng):
        try:
            return super()._range(sid, rng)
        except HttpError:
            from urllib.parse import quote
            raise RealHttpError(400, f"https://sheets.googleapis.com/v4/spreadsheets/{sid}"
                                     f"/values:batchGet?ranges={quote(rng, safe='')}"
                                     "&ranges=%27Log%27%21A14293%3AC&alt=json",
                                f"Unable to parse range: {rng}") from None


def _keeper_setup(sheets=None, back=3600):
    T0 = 1_790_000_000.0
    clock = Clock(T0)
    Clock.slept = []
    sheets = sheets or KeeperSheets()
    store = FakeStore(clock, datetime.fromtimestamp(T0 - back, timezone.utc))
    pace = hss.Pace(per_minute=1000, spacing=0.0, clock=clock, sleep=clock.sleep)
    return clock, sheets, store, pace


def keeper_fault_tests():
    hss.GIANT_TAB_ROWS = 10
    hss.WHOLE_EVERY_S = 3 * 3600.0
    hss.TITLES_EVERY_S = 3600.0
    hss.QUOTA_BREATHE_S = 60.0
    hss.BOOKS_PER_PASS = 40

    # ── a quota refusal is decided by the status, never by the URI in the text
    uri_400 = RealHttpError(400, "https://sheets.googleapis.com/v4/spreadsheets/1ab429/values:batchGet"
                                 "?ranges=%27Log%27%21A14293%3AC&ranges=%27Small%27",
                            "Unable to parse range: 'Small'")
    check("quota: a 400 whose request URI holds '429' is a range error, never a quota refusal",
          not hss._is_429(uri_400) and hss._is_range_error(uri_400))
    check("quota: a 429 is a quota refusal",
          hss._is_429(RealHttpError(429, "https://x", "Quota exceeded for quota metric 'Read requests'")))
    rate = RealHttpError(403, "https://x", "Rate Limit Exceeded",
                         b'{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')
    check("quota: a 403 whose own reason is a rate limit is a quota refusal, not a book gone",
          hss._is_429(rate) and not hss._is_gone(rate))
    perm = RealHttpError(403, "https://x/429/Quota", "The caller does not have permission",
                         b'{"error":{"status":"PERMISSION_DENIED"}}')
    check("quota: a 403 permission refusal is not quota — whatever its URI holds — it is a book gone",
          not hss._is_429(perm) and hss._is_gone(perm))
    check("quota: a 404 is a book gone; an error with no status is neither",
          hss._is_gone(RealHttpError(404, "https://x", "Requested entity was not found."))
          and not hss._is_429(RuntimeError("HttpError 429 in a message")) and not hss._is_gone(RuntimeError("x")))

    clock, sheets, store, pace = _keeper_setup(UriSheets())
    SID = "1bigBook429Fake000000000000000000000000000"
    OTHER = "1otherBookFake0000000000000000000000000000"
    log = [["timestamp", "action", "n"]] + log_rows(30)
    sheets.books[SID] = {"Log": log, "Small": [["k", "v"], ["a", "1"]]}
    sheets.books[OTHER] = {"Data": [["id", "v"], ["1", "a"]]}
    mt = {SID: clock() - 200}
    drive = FakeDrive(sheets, mt, {})
    hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += 300
    sheets.books[SID] = {"Log": log, "Small (old)": [["k", "v"], ["a", "1"]]}   # renamed, list held
    mt[SID], mt[OTHER] = clock() - 20, clock() - 10
    Clock.slept = []
    out = hss.one_pass(drive, sheets, store, pace, now=clock)
    check("quota: a renamed tab's 400 (its URI full of '429') is not breathed on — no minute lost, the pass not shut",
          60.0 not in Clock.slept and not out["shut"] and out["errors"] == 0, (out, Clock.slept))
    check("quota: ...the book re-reads its tab list and lands, and the other book lands in the same pass",
          store.meta[SID]["status"] == "ok" and store.meta.get(OTHER, {}).get("status") == "ok"
          and mirrored(store, SID, "Small (old)") and not mirrored(store, SID, "Small"))

    # ── a book deleted while the due sweep owes it: forgotten, never asked again
    clock, sheets, store, pace = _keeper_setup()
    GONE = "1deletedBookFake0000000000000000000000000"
    sheets.books[GONE] = {"Data": [["id", "v"], ["1", "a"]]}
    mt = {GONE: clock() - 100}
    drive = FakeDrive(sheets, mt, {})
    hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += 600
    sheets.books[GONE]["Data"].append(["2", "b"])          # changed within the hour: list held
    mt[GONE] = clock() - 5
    hss.one_pass(drive, sheets, store, pace, now=clock)
    del sheets.books[GONE]
    del mt[GONE]                                            # Drive no longer lists it

    def gone(*_a, **_k):
        def run(num_retries=0):
            sheets.requests.append(("gone", GONE, None))
            raise RealHttpError(404, f"https://sheets.googleapis.com/v4/spreadsheets/{GONE}",
                                "Requested entity was not found.")
        return types.SimpleNamespace(execute=run)
    sheets.get = sheets.batchGet = gone
    seen = []
    for _ in range(4):
        clock.t += 3700
        before = pace.count
        out = hss.one_pass(drive, sheets, store, pace, now=clock)
        seen.append((out["due"], out["errors"], pace.count - before))
    check("gone: the due sweep asks a deleted book ONCE, then forgets it — no request, no error after",
          seen[0] == (1, 1, 1) and all(s == (0, 0, 0) for s in seen[1:]), seen)
    check("gone: ...its keeper state is dropped; its mirrored rows stay behind a failed status",
          GONE not in store.books and not any(k[0] == GONE for k in store.tabs)
          and store.meta[GONE]["status"] == "error")

    # ── an owed read that fails for another reason waits DUE_RETRY_S
    clock, sheets, store, pace = _keeper_setup()
    FLAKY = "1flakyBookFake00000000000000000000000000"
    sheets.books[FLAKY] = {"Data": [["id", "v"], ["1", "a"]]}
    mt = {FLAKY: clock() - 100}
    drive = FakeDrive(sheets, mt, {})
    hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += 600
    sheets.books[FLAKY]["Data"].append(["2", "b"])
    mt[FLAKY] = clock() - 5
    hss.one_pass(drive, sheets, store, pace, now=clock)
    del mt[FLAKY]
    clock.t += 3700
    sheets.fail = [RealHttpError(500, "https://x", "Internal error")]
    out1 = hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += 300
    out2 = hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += hss.DUE_RETRY_S
    out3 = hss.one_pass(drive, sheets, store, pace, now=clock)
    check("due: an owed read that failed (500) is not asked again every pass — it waits, then lands",
          (out1["due"], out1["errors"]) == (1, 1) and out2["due"] == 0
          and (out3["due"], out3["errors"]) == (1, 0) and store.meta[FLAKY]["status"] == "ok",
          (out1, out2, out3))

    # ── books that always fail never starve the cap
    hss.BOOKS_PER_PASS = 2
    clock, sheets, store, pace = _keeper_setup()
    A, B, G = ("1emptiedA" + "0" * 35, "1emptiedB" + "0" * 35, "1goodBook" + "0" * 35)
    for sid in (A, B, G):
        sheets.books[sid] = {"Data": [["id", "v"], ["1", "a"]]}
    mt = {A: clock() - 300, B: clock() - 290, G: clock() - 280}
    drive = FakeDrive(sheets, mt, {})
    hss.one_pass(drive, sheets, store, pace, now=clock)
    clock.t += 300
    for sid in (A, B):
        sheets.books[sid]["Data"] = [["id", "v"]]         # emptied: refused to wipe, forever
        mt[sid] = clock() - 100
    landed, tried = [], []
    for i in range(4):
        sheets.books[G]["Data"].append([str(10 + i), "new"])
        mt[G] = clock() - 10
        before = len(sheets.requests)
        hss.one_pass(drive, sheets, store, pace, now=clock)
        landed.append(mirrored(store, G, "Data") == truth(sheets.books[G]["Data"]))
        tried.append(sorted({r[1][:9] for r in sheets.requests[before:] if r[1] in (A, B)}))
        clock.t += 300
    # pass 1 is the two books' first failure (until then they were good books,
    # oldest first); from then on they are failing books
    check("cap: two books that always fail never take the places of one that changed — it lands every pass after",
          not landed[0] and all(landed[1:]), (landed, tried))
    check("cap: ...and the failing ones are still retried, in the places left, least recently tried first",
          all(len(t) == 1 for t in tried[1:]) and tried[1] != tried[2], tried)
    hss.BOOKS_PER_PASS = 40

    # ── last rows that repeat cannot vouch for an append
    clock, sheets, store, pace = _keeper_setup()
    SID = "1dupBookFake00000000000000000000000000000"
    rows = [[f"2026-09-{(i % 28) + 1:02d}", f"open {i}"] for i in range(20)] + [["", "FALSE"]] * 6
    tab = [["date", "status"]] + rows
    sheets.books[SID] = {"Q": tab}
    f = {"id": SID, "name": "q", "modifiedTime": hss._iso(clock())}
    hss.sync_book(sheets, store, pace, dict(f), now=clock())
    clock.t += 300
    tab.insert(8, ["2026-09-30", "INSERTED"])
    f["modifiedTime"] = hss._iso(clock())
    r = hss.sync_book(sheets, store, pace, dict(f), now=clock())
    shifted = [rn for rn, d in mirrored(store, SID, "Q").items() if truth(tab).get(rn) != d]
    check("repeats: an insertion above six identical last rows is NOT taken for an append",
          r.appended == 0 and r.tail_tabs == 0 and r.dirty == 1, vars(r))
    check("repeats: ...the mirror holds no extra row (it is behind, and marked dirty, never shifted by one)",
          len(mirrored(store, SID, "Q")) == 26 and store.tabs[(SID, "Q")]["dirty_since"], len(shifted))
    clock.t += hss.WHOLE_EVERY_S + 1
    hss.sync_book(sheets, store, pace, dict(f), now=clock(), due=True)
    check("repeats: the whole read owed makes it exact", mirrored(store, SID, "Q") == truth(tab))
    alt = {rn: {"v": "a" if rn % 2 else "b"} for rn in range(40, 60)}
    check("repeats: a window that repeats every 2 rows is blind to a shift of 2; distinct rows are not blind",
          hss.shift_blind(alt, 55, 59) == 2
          and hss.shift_blind({rn: {"v": str(rn)} for rn in range(40, 60)}, 55, 59) == 0)

    # ── the mirror does not vouch for a giant tab it has not re-read whole since it changed
    clock, sheets, store, pace = _keeper_setup()
    SID = "1callsHouseFake00000000000000000000000000"
    calls = [["call_id", "processed", "event_at"]] + [[f"c{i}", "", f"2026-09-21 10:{i % 60:02d}"]
                                                     for i in range(30)]
    sheets.books[SID] = {"Data": calls}
    mt = {SID: clock() - 100}
    drive = FakeDrive(sheets, mt, {})
    hss.one_pass(drive, sheets, store, pace, now=clock)
    held_backend = mf.backend
    mf.backend = lambda dsn: store
    try:
        v0 = mf.vouch("dsn", SID, "Data", now=clock() + 30)
        clock.t += 300
        calls[5][1] = "yes"                                  # an old row marked in place
        mt[SID] = clock() - 30
        out = hss.one_pass(drive, sheets, store, pace, now=clock)
        clock.t += 300
        hss.one_pass(drive, sheets, store, pace, now=clock)
        v1 = mf.vouch("dsn", SID, "Data", now=clock() + 30)
        clock.t += hss.WHOLE_EVERY_S
        hss.one_pass(drive, sheets, store, pace, now=clock)
        v2 = mf.vouch("dsn", SID, "Data", now=clock() + 30)
    finally:
        mf.backend = held_backend
    check("vouch: a giant tab right after its whole read is vouched for", v0.fresh, v0)
    check("vouch: once its book changed after that whole read, an old-row edit may be missing — no vouch",
          out["tail_tabs"] == 1 and not v1.fresh and "re-read it whole" in v1.why, (out, v1))
    check("vouch: the owed whole read brings the edit and the vouch back",
          v2.fresh and store.rows[(SID, "Data", 6)]["processed"] == "yes", v2)
    hss.GIANT_TAB_ROWS = 5000


# ═══════════════════════════════════════════════════════════════════════════
# 8. THE NOTES AND THE NEWS: a build in flight, a book built from a copy
# ═══════════════════════════════════════════════════════════════════════════
NEW_NOTE = ["2026-09-22T12:00:00.000Z", "ACNEWNOTE", "2026-09-22", "Dana Lee", "Robin Client",
            "sleep", "+13305550999", "new note"]


def notes_news_tests():
    clients = TMP / "clients.json"
    clients.write_text(json.dumps({"rows": [{"name": "Robin Client", "house": "H12"}]}))
    sid = dn.NOTES.sheet_id

    def fresh_book():
        rows = notes_rows()
        sheets = LiveSheets()
        sheets.books[sid] = (BOOK_ZONE, NOTES_HEADER, rows)
        mirror_book(sid, dn.NOTES.tab, NOTES_HEADER, rows)
        wipe_disk()
        reset_desk()
        MIRROR.listed_at = time.time() - 10
        desk._NEWS["at"] = 0.0
        dn._BOOK.update({"book": None, "at": 0.0, "from": 0.0, "task": None, "task_from": 0.0,
                         "failure": ""})
        return rows, sheets

    def ids(book):
        return [n.get("call_id") for n in book["payload"]["notes"]]

    # a build running when the filing rings is not handed to the ask the filing made
    rows, sheets = fresh_book()
    real_clients = dn._read_clients
    slow = {"on": False}

    def slow_clients(path):
        if slow["on"]:
            time.sleep(0.8)            # the notes are read; the build is still running
        return real_clients(path)
    dn._read_clients = slow_clients

    async def in_flight():
        await dn.current_book(sheets, "fake-dsn", str(clients))
        dn._BOOK["at"] = 0.0                             # the held book ages out
        slow["on"] = True
        other = asyncio.ensure_future(dn.current_book(sheets, "fake-dsn", str(clients)))
        await asyncio.sleep(0.3)
        rows.append(list(NEW_NOTE))                       # THE FILING, then the ring
        mirror_book(sid, dn.NOTES.tab, NOTES_HEADER, rows)
        desk.invalidate()
        after = await dn.current_book(sheets, "fake-dsn", str(clients))
        await other
        return after
    try:
        after = asyncio.run(in_flight())
    finally:
        slow["on"] = False
        dn._read_clients = real_clients
    check("news: a build already running when a filing rings is not the answer to the ask made after it",
          "ACNEWNOTE" in ids(after), ids(after))

    # a book built from a COPY is dated by the copy, and rebuilt once Google answers
    rows, sheets = fresh_book()

    async def from_copy():
        await dn.current_book(sheets, "fake-dsn", str(clients))
        rows.append(list(NEW_NOTE))
        desk.invalidate()
        news = desk.news_at()
        sheets.refuse = True                               # the read draws a 429
        got = await dn.current_book(sheets, "fake-dsn", str(clients))
        sheets.refuse = False
        dated_old = dn._BOOK["from"] < news
        desk._QUOTA.update({"until": 0.0, "at": 0.0})      # the pause is over
        again = await dn.current_book(sheets, "fake-dsn", str(clients))
        return got, dated_old, again
    got, dated_old, again = asyncio.run(from_copy())
    p = got["payload"]
    check("news: a book a 429 answered from a copy says so, and its source_at is older than its built_at",
          not p["sources"]["notes"]["ok"] and p["source_at"] < p["built_at"] and "ACNEWNOTE" not in ids(got),
          (p["source_at"], p["built_at"], p["sources"]["notes"]))
    check("news: ...the held copy is dated by what its notes are of, so it is old against the filing",
          dated_old)
    check("news: ...and the first ask after the pause rebuilds it, with the filed note",
          again is not got and "ACNEWNOTE" in ids(again), ids(again))
    desk._QUOTA.update({"until": 0.0, "at": 0.0})


# ═══════════════════════════════════════════════════════════════════════════
# 9. THE LOG AGAINST INBOX A: a log older than the inbox cannot say "legacy"
# ═══════════════════════════════════════════════════════════════════════════
def index_order_tests():
    A, L, B, R = desk.TRANSCRIPTS, desk.HOTLINE_LOG, desk.CALLS_HOUSE, desk.RECAPS
    a_header = list(desk.A_FIELDS.values()) + list(desk.A_WORDS.values())
    young = serial_of(datetime.now().replace(microsecond=0))
    # the sweep has just MARKED the call; its log row lands seconds later
    a_rows = [["CALLX1", young, young, 120.0, "+13309195558", "+13305550111", "+13309195558",
               "incoming", 12.0, "Yes", "", "w", "s"]]
    l_header = ["call_id", "at", "caller", "items", "kinds", "status", "via"]
    old_row = ["CALLOLD", "2026-09-17T11:10:00.000Z", "+13305550111", 1.0, "DailyNote",
               "processed", "groq"]
    l_live = [["CALLX1", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
               "+13305550111", 1.0, "DailyNote", "processed", "groq"], old_row]
    sheets = LiveSheets()
    sheets.books[A.sheet_id] = (BOOK_ZONE, a_header, a_rows)
    sheets.books[L.sheet_id] = ("UTC", l_header, l_live)
    sheets.books[B.sheet_id] = ("Etc/GMT", list(desk.B_FIELDS.values()), [])
    sheets.books[R.sheet_id] = ("UTC", list(desk.R_FIELDS.values()), [])
    mirror_book(A.sheet_id, A.tab, a_header, a_rows)
    mirror_book(L.sheet_id, L.tab, l_header, [old_row])  # the keeper read the log before the row
    mirror_book(B.sheet_id, B.tab, list(desk.B_FIELDS.values()), [["x"] * len(desk.B_FIELDS)])
    mirror_book(R.sheet_id, R.tab, list(desk.R_FIELDS.values()), [["x"] * len(desk.R_FIELDS)])
    people = TMP / "people.json"
    people.write_text(json.dumps({"rows": []}))

    def state(ix):
        c = [c for c in ix["payload"]["calls"] if c["call_id"] == "CALLX1"][0]
        return c["hotline"]["state"], c["hotline"]["why"]

    def first_start():
        wipe_disk()
        reset_desk()

    first_start()
    desk._NEWS["at"] = time.time() + 3600                # only Google may answer
    live = desk.build_index(sheets, "fake-dsn", str(people))
    check("log order: every book live, A then the log — the call reads filed", state(live)[0] == "filed",
          state(live))

    # A owed by the keeper (read live), the log from the mirror: older than A
    first_start()
    desk._NEWS["at"] = 0.0
    MIRROR.listed_at = time.time() - 30
    MIRROR.pending = [A.sheet_id]
    mixed = desk.build_index(sheets, "fake-dsn", str(people))
    MIRROR.pending = []
    st, why = state(mixed)
    check("log order: A live and a mirrored log older than it — the call is NOT called legacy",
          st == "unlogged" and "older than the inbox" in why
          and mixed["payload"]["sources"]["hotline_log"]["ok"], (st, why))

    # both from one keeper pass: A synced after the sweep's mark, the log before its row
    listed = time.time() - 300
    MIRROR.listed_at = listed
    MIRROR.synced = {A.sheet_id: listed + 100, L.sheet_id: listed + 50}
    first_start()
    torn = desk.build_index(sheets, "fake-dsn", str(people))
    check("log order: one keeper pass that read the log before A is not in step — not legacy",
          state(torn)[0] == "unlogged", state(torn))
    MIRROR.synced = {A.sheet_id: listed + 100, L.sheet_id: listed + 150}
    first_start()
    after = desk.build_index(sheets, "fake-dsn", str(people))
    check("log order: the same pass with the log read after A may say legacy (the log truly has no row)",
          state(after)[0] == "legacy", state(after))
    MIRROR.synced = {}
    check("log order: a log with no bounds (no mirror_first) keeps the old rule",
          desk._log_in_step({"rows": []}, {"rows": []}))


# ═══════════════════════════════════════════════════════════════════════════
# 10. A COPY'S DATE: a copy that outlived a restart is never called this morning's
# ═══════════════════════════════════════════════════════════════════════════
def copy_date_tests():
    now = time.time()
    two_days = now - 49 * 3600
    check("date: a copy from today says its time alone",
          re.fullmatch(r"\d{2}:\d{2}:\d{2}Z", mf.stamp(now - 60, now)) is not None, mf.stamp(now - 60, now))
    check("date: a copy from another day says its date too",
          mf.stamp(two_days, now).startswith(datetime.fromtimestamp(two_days, timezone.utc)
                                             .strftime("%Y-%m-%d ")), mf.stamp(two_days, now))
    kept = mf.Copies("date-test")
    kept.put("book", {"rows": []}, 0, two_days, "live", write=False)
    a = mf.read("book", kept, label="the fake book", need_after=now,
                vouch=lambda: mf.Vouch(False, False, 0.0, "the mirror could not be asked"),
                from_mirror=lambda k: (_ for _ in ()).throw(RuntimeError()),
                from_live=lambda: (_ for _ in ()).throw(RuntimeError("429")),
                paused=lambda: "", fail=RuntimeError)
    day = datetime.fromtimestamp(two_days, timezone.utc).strftime("%Y-%m-%d")
    check("date: the sentence a two-day-old copy answers with names its day",
          a.via == "copy" and f"Showing the copy read at {day} " in a.stale, a.stale)
    old = datetime.fromtimestamp(two_days, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    said = lanes._as_copy({"read_at": old, "rows": []}, "The lane could not be read.")["error"]
    check("date: a lane's copy from another day names its day too",
          f"Showing the copy read at {day} " in said, said)
    today = datetime.fromtimestamp(now - 60, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    said = lanes._as_copy({"read_at": today, "rows": []}, "The lane could not be read.")["error"]
    check("date: ...and today's, its time alone", said.endswith(f"read at {today[11:]}."), said)


def main() -> int:
    for section in (keeper_tests, order_tests, dates_and_notes_tests, index_tests, lane_tests,
                    screen_tests, keeper_fault_tests, notes_news_tests, index_order_tests,
                    copy_date_tests):
        try:
            section()
        except Exception as exc:  # noqa: BLE001 - a section that throws is a failure, said
            import traceback
            traceback.print_exc()
            results["failed"].append(f"{section.__name__} threw {type(exc).__name__}: {exc}")
            print(f"FAIL {section.__name__} threw {type(exc).__name__}: {exc}")
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
    total = results["ok"] + len(results["failed"])
    print(f"\nmirror-first: {results['ok']}/{total} passed")
    if results["failed"]:
        print("failed:\n  " + "\n  ".join(results["failed"]))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
