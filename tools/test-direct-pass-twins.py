#!/usr/bin/env python3
"""db-sync's direct pass on a book the Hub's keeper owns: read straight from Google, the Employee Database's Master is
stored as the keeper stores it — every column of a repeated title under its twin key, the catalog in the sheet's order;
any other book still folds a repeated title. The read asks for the text the sheet shows, as the keeper does, so a Date
cell is stored as its day, never a serial number, and Staff reads the copy itself. A copy whose rows lack the twins its
catalog lists is read as the folded copy it is, and the twin fields go to Apps Script. Synthetic rows only; nothing
reaches a database or Google."""
from __future__ import annotations

import json
import re
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SERVER, APP, DB = ROOT / "server", ROOT / "app", ROOT / "db"

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


if "psycopg2" not in sys.modules:  # the host has no driver; nothing here reaches a database
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        fake = types.ModuleType("psycopg2")
        fake.Error = Exception
        extras = types.ModuleType("psycopg2.extras")
        extras.RealDictCursor = object
        errors = types.ModuleType("psycopg2.errors")
        errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
        fake.extras, fake.errors = extras, errors
        sys.modules["psycopg2"] = fake
        sys.modules["psycopg2.extras"] = extras
        sys.modules["psycopg2.errors"] = errors
sys.modules["psycopg2"].connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this check"))

sys.path.insert(0, str(SERVER))
import hub_sheet_sync as hss  # noqa: E402

sys.path.insert(1, str(APP))
import hubdb  # noqa: E402
import sheet_sync as app_sync  # noqa: E402
import staff as SP  # noqa: E402
from scope import Defer  # noqa: E402

sys.path.insert(2, str(DB))
import sheets_source as S  # noqa: E402
import sync as dbsync  # noqa: E402


class _Sql(str):
    """psycopg.sql as far as the store composes it: any composition is text here."""
    def format(self, *a: Any, **k: Any) -> "_Sql":  # type: ignore[override]
        return _Sql(str.format(self, *map(str, a), **{n: str(v) for n, v in k.items()}))

    def join(self, parts: Any) -> "_Sql":  # type: ignore[override]
        return _Sql(str.join(self, map(str, parts)))


if dbsync.sql is None:
    dbsync.sql = types.SimpleNamespace(SQL=_Sql, Identifier=lambda *a: _Sql(".".join(f'"{p}"' for p in a)))
    dbsync.Jsonb = lambda v: v
dbsync.DIRECT_GAP_S = 0.0

EMP, OTHER = "1EmployeeDatabaseFake0000000000000000000000", "1OtherBookFake000000000000000000000000000000"
CERT_PROP_DB = {SP.CERT_SOURCE_PROP: EMP}
# the Employee Database Master as the sheet lays it out: the scorecard, Status, then the data (test-staff-complete)
LAYOUT = ["Employee", "Job App", "Attestation", "HS Diploma", "SAM", "Abuser", "Sex Offender", "Offender",
          "Nurse Aide", "Exclusions", "BCI", "Rapback", "", "Status", "Employee ID", "First Name", "Last Name",
          "Phone Number", "Start Date(doc)", "HS Diploma", "Sex Offender", "Offender", "Nurse Aide",
          "Exclusions Database", "BCI/FBI", "SSN (Last 4)"]
LINES = [["Ann Lee", "1", "1", "1", "0.5", "1", "1", "1", "1", "1", "1", "0", "", "Active", "E1", "Ann", "Lee",
          "555-0101", "1/2/2024", "6/1/2020", "9/1/2025", "9/2/2025", "9/3/2025", "9/4/2025", "9/5/2025", "1234"],
         ["Bo Day", "0", "1", "0", "1", "1", "0", "1", "0", "1", "0", "1", "", "Active", "E2", "Bo", "Day",
          "555-0102", "2/3/2024", "", "8/1/2025", "8/2/2025", "8/3/2025", "8/4/2025", "8/5/2025", "5678"]]
MASTER = [LAYOUT, *LINES]
DUP = [["id", "Dup", "Dup"], ["1", "a", "b"]]
DRIVER = [["Employee", "DL #", "Verified"], ["Ann Lee", "12345678", "TRUE"]]
BOOKS = {EMP: {"Master": MASTER, "employee driver": DRIVER}, OTHER: {"Data": DUP}}
NOW = datetime.now(timezone.utc)
ANN = SP.name_key("Ann Lee")
SHEET_DAY = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def serial(day: str) -> int:
    """A sheet's m/d/yyyy as the serial number UNFORMATTED_VALUE hands back for a Date cell."""
    m = SHEET_DAY.fullmatch(day)
    assert m
    return (date(int(m[3]), int(m[1]), int(m[2])) - date(1899, 12, 30)).days


def unformatted(cell: str) -> Any:
    """A cell as values:batchGet hands it back UNFORMATTED_VALUE: a Date or a number as a number, a checkbox a bool."""
    if cell in ("TRUE", "FALSE"):
        return cell == "TRUE"
    if SHEET_DAY.fullmatch(cell):
        return serial(cell)
    if re.fullmatch(r"-?\d+", cell):
        return int(cell)
    if re.fullmatch(r"-?\d+\.\d+", cell):
        return float(cell)
    return cell


class FakeGoogle(S.Google):
    """living-brain answering from BOOKS: the real list and book reads over a fake HTTP GET; the sheet's text when the
    read asks FORMATTED_VALUE, its raw values when it asks UNFORMATTED_VALUE."""
    def __init__(self) -> None:
        super().__init__("/nonexistent")
        self.available = True
        self.asked: list[str] = []

    def _get(self, url: str, params: list[tuple[str, str]]) -> dict[str, Any]:
        if url == S.DRIVE:
            mod = (NOW - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
            return {"files": [{"id": s, "name": s, "modifiedTime": mod} for s in BOOKS]}
        sid = url[len(S.SHEETS) + 1:].split("/")[0]
        self.asked.append(sid)
        if url.endswith(":batchGet"):
            want = [v.strip("'").replace("''", "'") for k, v in params if k == "ranges"]
            raw = dict(params).get("valueRenderOption", "FORMATTED_VALUE") == "UNFORMATTED_VALUE"
            return {"valueRanges": [{"values": [[unformatted(c) if raw else c for c in row] for row in BOOKS[sid][t]]}
                                    for t in want]}
        return {"sheets": [{"properties": {"title": t}} for t in BOOKS[sid]]}


class Cur:
    def __init__(self, hub: "Hub") -> None:
        self.hub, self.copied = hub, []

    def __enter__(self) -> "Cur":
        return self

    def __exit__(self, *a: Any) -> None:
        pass

    def execute(self, q: Any, p: Any = None) -> None:
        if str(q) == dbsync.UPSERT_TAB:
            sid, tab, name, pairs, n, _newest, _digest, keys = p
            self.hub.tabs[(sid, tab)] = {"table": name, "pairs": pairs, "keys": keys, "n": n,
                                         "rows": [(r[0], json.loads(r[1])) for r in self.copied]}

    def executemany(self, q: str, keys: list) -> None:
        pass

    def fetchall(self) -> list:
        return []

    def fetchone(self) -> tuple:
        return ("digest",)

    def copy(self, q: Any) -> "Cur":
        return self

    def write_row(self, row: tuple) -> None:
        self.copied.append(row)


class Hub:
    def __init__(self) -> None:
        self.tabs: dict[tuple[str, str], dict] = {}
        self.books: list[tuple] = []

    def execute(self, q: Any, p: Any = None) -> None:
        if "update catalog.books" in str(q):
            self.books.append(p)

    def transaction(self) -> Cur:
        return Cur(self)

    def cursor(self) -> Cur:
        return Cur(self)


class Mirror:
    """The keeper's tracked tabs: an owned book's headers in the sheet's order (giant false)."""
    def __init__(self, records: list[tuple]) -> None:
        self.records = records

    def execute(self, q: str, p: Any = None) -> list[tuple]:
        return list(self.records)


class FakeDb:
    def __init__(self, tabs: dict[str, tuple[list[str], list[tuple[int, dict]]]], status: str = "ok") -> None:
        self.held, self.status = tabs, status

    def prop(self, name: str) -> str:
        return CERT_PROP_DB.get(name, "")

    def tab(self, sid: str, tab: str) -> Any:
        if sid != EMP or tab not in self.held:
            return None
        heads, rows = self.held[tab]
        return hubdb.TabRef(sid, tab, "emp_" + tab.lower().replace(" ", "_"), tuple(heads), None, len(rows))

    def book(self, sid: str) -> Any:
        return hubdb.Book(sid, "Employee Database", NOW, NOW, self.status) if sid == EMP else None

    def rows(self, ref: Any) -> list[tuple[int, dict]]:
        return list(self.held[ref.tab][1])

    def note_book(self, sid: str) -> None:
        pass


class FakeReads:
    def __init__(self, db: FakeDb) -> None:
        self.db = db

    def once(self, key: str, fn: Any) -> Any:
        return fn()

    def tab_of(self, sid: str, tab: str, missing: str) -> Any:
        return self.db.tab(sid, tab)


def keeper_copy() -> tuple[list[list[str]], list[tuple[int, dict]], list[str]]:
    """The Master as a keeper load leaves it in asa-hub-db: the catalog's pairs, each row's _raw, the keeper header."""
    rows, giant = hss.whole_tab(MASTER, 100.0, True)
    rec = hss.header_record(MASTER, rows, 100.0)
    assert giant is None and rec is not None
    keys = list(dict.fromkeys(k for _rn, d in rows for k in d))
    _h, pairs, _d = dbsync.plan_columns(None, keys, rec["header"], True)
    return pairs, [(rn, dbsync.withhold(d, keys)) for rn, d in rows], rec["header"]


def staff_reads(pairs: list[list[str]], raw: list[tuple[int, dict]], status: str = "ok") -> dict[str, Any]:
    """Staff's Master index over a copy, through the same tab read the app makes."""
    reads = FakeReads(FakeDb({"Master": ([h for h, _c in pairs], raw)}, status))
    heads, rows = SP._emp_tab(reads, "Master")
    out = SP.master_index_from(heads, rows)
    out["heads"] = heads
    return out


def rule() -> None:
    print("\n1. one rule for an owned book's keys, in all three places")
    keys = S.twin_keys(LAYOUT)
    check("db-sync keys a repeated title as the keeper and the app do: the last column keeps the name",
          keys == hss.twin_keys(LAYOUT) == app_sync.twin_keys(LAYOUT)
          and keys[3] == "HS Diploma ⟨1⟩" and keys[19] == "HS Diploma", keys)
    k, rows = S.shape(MASTER, True)
    kept, _g = hss.whole_tab(MASTER, 100.0, True)
    check("a book's tab shaped with twins holds the rows the keeper parses from the same values",
          k == [h for h in keys if h] and [rn for rn, _d in rows] == [rn for rn, _d in kept]
          and all(dbsync.withhold(d, k) == dbsync.withhold(e, k) for (_a, d), (_b, e) in zip(rows, kept)),
          (k, rows[0][1]))
    _k, folded = S.shape(DUP)
    check("without twins a repeated title still folds to its last column, as before",
          folded == [(2, {"id": "1", "Dup": "b"})], folded)


def direct_pass() -> None:
    print("\n2. the direct pass stores an owned book as its keeper does")
    pairs, raw, header = keeper_copy()
    s = dbsync.Sync()
    s.google, s.hub = FakeGoogle(), Hub()
    s.mirror = Mirror([(EMP, "Master", header, "false"), (EMP, "employee driver", DRIVER[0], "false")])
    old = NOW - timedelta(days=2)
    books = {sid: {"name": sid, "gone_at": None, "direct_modified": None, "modified_time": old, "synced_at": old}
             for sid in BOOKS}
    meta = {sid: {"modified_time": old, "last_sync_at": old} for sid in BOOKS}
    tabs = {(EMP, "Master"): {"table_name": "emp_master", "columns": pairs, "gone_at": None},
            (OTHER, "Data"): {"table_name": "other_data", "columns": [["id", "id"], ["Dup", "dup"]], "gone_at": None}}
    s.direct_pass(meta, books, tabs, {"emp_master", "other_data"})
    got = s.hub.tabs.get((EMP, "Master")) or {}
    heads = [h for h, _c in got.get("pairs") or []]
    check("both books behind their sheet were read straight from Google and stored",
          sorted(set(s.google.asked)) == sorted(BOOKS) and {p[-1] for p in s.hub.books} == set(BOOKS)
          and (EMP, "employee driver") in s.hub.tabs, (s.google.asked, s.hub.books))
    check("the owned tab's catalog lists every column in the sheet's order, each twin in its own column",
          heads == [h for h, _c in pairs] and got["pairs"] == pairs and hubdb.in_sheet_order(heads), heads)
    twins = [h for h in heads if hubdb.TWIN_KEY.fullmatch(h)]
    check("every row read straight from Google carries every twin the catalog lists",
          len(twins) == 4 and all(t in r for _rn, r in got["rows"] for t in twins)
          and got["rows"][0][1]["HS Diploma ⟨1⟩"] == "1" and got["rows"][0][1]["HS Diploma"] == "6/1/2020", twins)
    check("its rows are the rows a keeper load stores, a Date cell's text included: same keys, cells, row numbers",
          got["rows"] == raw and got["keys"] == list(dict.fromkeys(k for _rn, d in raw for k in d))
          and got["rows"][0][1]["Start Date(doc)"] == "1/2/2024" != str(serial("1/2/2024")), (got["rows"][:1], raw[:1]))
    check("the copy is marked as read as the sheet shows it, and held over an older mirror as a raw one was",
          {p[1] for p in s.hub.books} == {dbsync.DIRECT_STATUS} == {"direct_formatted"}
          and all(dbsync.direct_newer({"status": st, "synced_at": NOW}, {"last_sync_at": old})
                  for st in ("direct", dbsync.DIRECT_STATUS))
          and not dbsync.direct_newer({"status": "ok", "synced_at": NOW}, {"last_sync_at": old}), s.hub.books)
    driver = (s.hub.tabs.get((EMP, "employee driver")) or {}).get("rows") or []
    check("a checkbox read straight from Google is stored as the sheet shows it, as the keeper stores it",
          [(rn, d.get("Employee"), d.get("Verified")) for rn, d in driver] == [(2, "Ann Lee", "TRUE")], driver)
    other = s.hub.tabs.get((OTHER, "Data")) or {}
    check("a book nobody owns keeps its stored shape: the repeated title folds, the catalog unchanged",
          other.get("rows") == [(2, {"id": "1", "Dup": "b"})] and other.get("pairs") == [["id", "id"], ["Dup", "dup"]],
          other)
    kept = staff_reads(pairs, raw)
    read: dict[str, Any] = {}
    for st in (dbsync.DIRECT_STATUS, "direct"):
        try:
            read[st] = staff_reads(got["pairs"], got["rows"], st)
        except Defer as e:
            read[st] = {"deferred": str(e)}
    check("Staff reads a copy read straight from Google itself, whatever its mark: nothing left to Apps Script",
          not any("deferred" in r for r in read.values()), read)
    direct = read[dbsync.DIRECT_STATUS]
    check("that copy reads every scorecard twin by position and the sheet's day, exactly as the keeper's copy does",
          not direct.get("unsure") and direct["rows"][ANN]["fields"].get("flag_hs_diploma") == "1"
          and direct["rows"][ANN]["fields"].get("hs_diploma") == "2020-06-01" and direct["rows"] == kept["rows"],
          (direct.get("unsure"), (direct.get("rows") or {}).get(ANN)))


def staff_guard() -> None:
    print("\n3. Staff never reads a twin the rows do not carry")
    pairs, raw, _header = keeper_copy()
    keys, folded = S.shape(MASTER)
    stale = [(rn, dbsync.withhold(d, keys)) for rn, d in folded]
    heads = [h for h, _c in pairs]
    blind = SP.master_index_from(heads, [{h: hubdb.typed(r.get(h), "estate") for h in heads} for _rn, r in stale])
    check("rows stored without their twins under a catalog that lists them read the scorecard blank by position",
          hubdb.in_sheet_order(heads) and not blind["unsure"]
          and not blind["rows"][ANN]["fields"].get("flag_hs_diploma"), blind["rows"][ANN]["fields"])
    got = staff_reads(pairs, stale)
    check("the tab read drops the twins those rows lack, so the copy is read as the folded copy it is",
          not any(hubdb.TWIN_KEY.fullmatch(h) for h in got["heads"]) and not hubdb.in_sheet_order(got["heads"]),
          got["heads"])
    check("the scorecard fields under a folded title are unsure, and the data block still reads its own column",
          {"flag_hs_diploma", "flag_nurse_aide", "flag_offender"} <= got["unsure"]
          and got["rows"][ANN]["fields"].get("phone") == "555-0101", (got["unsure"], got["rows"][ANN]))
    try:
        SP._unsure({"master_read": True, "_unsure": got["unsure"]}, ["flag_hs_diploma"], "Compliance")
        deferred = ""
    except Defer as e:
        deferred = str(e)
    check("an answer reading one of them is Apps Script's", "folds into one" in deferred, deferred)
    whole = staff_reads(pairs, raw)
    check("rows carrying their twins are read by position as before",
          whole["heads"] == heads and not whole["unsure"], whole["unsure"])


def main() -> int:
    rule()
    direct_pass()
    staff_guard()
    print(f"\ntest-direct-pass-twins: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
