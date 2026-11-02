#!/usr/bin/env python3
"""Staff whole off asa-hub-db: the licence digits the copies keep for the driving card, the Employee Database's
repeated Master columns the Hub's keeper keeps, then the Staff doors run in asa-hub-db-sync (never inside asa-hub-app)
on the live rows and on the same rows as the new keeper and rule will write them. Nothing is written; no restart; no
value is printed."""
from __future__ import annotations

import argparse
import base64
import json
import py_compile
import random
import shutil
import subprocess
import sys
import tempfile
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SERVER, APP, DB = ROOT / "server", ROOT / "app", ROOT / "db"
# every app module the doors import, in import order: the runner holds no app tree of its own
LIVE_MODULES = ("gsjs", "hubdb", "editions", "scope", "drive", "locations", "clients", "staff_views", "cert_reads",
                "staff", "staff_comms", "staff_perf", "staff_app", "writes", "client_writes")
DOORS = ("staffProfileOverview", "staffProfileEmployment", "staffProfileCompliance", "staffProfileDocuments")

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
import redaction as R  # noqa: E402
import hub_sheet_sync as hss  # noqa: E402

sys.path.insert(1, str(APP))
import client_meds  # noqa: E402
import client_sources  # noqa: E402
import clients as C  # noqa: E402
import scope as sc  # noqa: E402
import staff as SP  # noqa: E402
import staff_comms as SC  # noqa: E402

sys.path.insert(2, str(DB))
import sync as dbsync  # noqa: E402


# ═══ 1. THE RULE ═══════════════════════════════════════════════════════════════════════════════════════════════════

def rule() -> None:
    print("\n1. the rule: a licence number column keeps only what the Staff mask shows")
    yes = ("DL #", "DL#", "DL Number", "Driver License Number", "Drivers License #", "dl_number", "Driving Licence No")
    no = ("DL", "Driver License", "DL / ID", "Self - DL", "Drivers License Expiration Date", "License Exp Date",
          "SSN#", "DL / SSN #", "State ID #", "DL / State ID #", "ID Card Number", "Medicaid #")
    check("a licence number column is told by its header's words, in every spelling the books use",
          all(R.is_licence_column(h) for h in yes) and not any(R.is_licence_column(h) for h in no),
          ([h for h in yes if not R.is_licence_column(h)], [h for h in no if R.is_licence_column(h)]))
    cases = {"OH RX123456": "OH 3456", "oh-rx123456": "OH 3456", "RX 1234 5678": "5678", "12345678": "5678",
             "OH 12345678": "5678", "XX AB123456": "3456", "N/A": "none", "none": "none", "No": "none",
             "12345": "short", "pending": "short", "OH\nRX123456": "OH 3456", "OH RX\n123456": "3456"}
    got = {v: R.redact_row({"Employee": "somebody", "DL #": v})[0]["DL #"] for v in cases}
    want = {v: R.MARKER_IDENTIFIER + R.LICENCE_TAIL + k for v, k in cases.items()}
    check("the marker carries the cell's own state and its last four digits, 'short' under six, 'none' for n/a",
          got == want, {k: (got[k] == want[k]) for k in cases})
    # every character kept is one the mask shows: no digit beyond the last four, no letter beyond the state
    leak = []
    rng = random.Random(7)
    for _ in range(4000):
        raw = "".join(rng.choice("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -#.:\n") for _ in range(rng.randint(0, 18)))
        if rng.random() < 0.4:
            raw = rng.choice(sorted(R.US_STATES)) + rng.choice(" -#:.") + raw
        cell = R.redact_row({"DL #": raw})[0]["DL #"]
        if not raw.strip():
            if cell != raw:
                leak.append(("blank", repr(cell)))
            continue
        kept = cell[len(R.MARKER_IDENTIFIER + R.LICENCE_TAIL):]
        digits = "".join(c for c in raw if c.isdigit())
        if not cell.startswith(R.MARKER_IDENTIFIER + R.LICENCE_TAIL) or not (
                kept in ("none", "short") or (kept[-4:] == digits[-4:] and len(kept) in (4, 7))):
            leak.append((len(raw), cell[len(R.MARKER_IDENTIFIER):]))
        for state in ("", "OH", "pa", "ZZ", None):
            if SP.licence_of(cell, state) != (SP.licence_mask(raw, state), False):
                leak.append(("mask", state))
    check("4000 synthetic licences: the marker keeps nothing past the mask, and the mask read off the marker is the "
          "mask spLicenceMask_ makes of the cell itself, beside any state column", not leak, leak[:5])
    row = {"Employee": "somebody", "SSN#": "123-45-6789", "Card Number": "4111 1111 1111 1111",
           "Medicaid #": "1234567890", "Password": "x", "DL #": "OH RX123456", "Driver License": "1",
           "License Exp Date": "01/30", "DL / State ID #": "OH RX123456"}
    red, n = R.redact_row(row)
    check("SSN, card, Medicaid, password and a mixed DL / State ID column are withheld exactly as before; the yes/no "
          "and expiry columns that share the words stay",
          red["SSN#"] == R.MARKER_IDENTIFIER and red["Card Number"] == R.MARKER_CARD
          and red["Medicaid #"] == R.MARKER_IDENTIFIER and red["Password"] == R.MARKER_SECRET
          and red["DL / State ID #"] == R.MARKER_IDENTIFIER and red["Driver License"] == "1"
          and red["License Exp Date"] == "01/30" and n == 6, {k: v for k, v in red.items() if k != "Employee"})
    again = R.redact_row(red)[0]
    old = R.redact_row({"DL #": R.MARKER_IDENTIFIER})[0]
    check("the rule run over its own output changes nothing, and an old bare marker stays bare (never read as a "
          "licence)", again == red and old == {"DL #": R.MARKER_IDENTIFIER}, (again == red, old))
    new = red["DL #"]
    stub_defer = False
    try:
        client_sources._unwithheld(new, "x")
    except sc.Defer:
        stub_defer = True
    check("a cell that starts with the marker is still read as withheld everywhere: the rule, the relay's readers, "
          "the Python apps' guards",
          R.is_marker_value(new) and all(R.is_marker_value(m) for m in R.MARKERS) and not R.is_marker_value("OH")
          and SP._marker(new) and C._marked(new) and SC._marked(new) and SC._withheld(new) and stub_defer
          and bool(client_meds._RE_WITHHELD.fullmatch(new)) and bool(client_meds._RE_WITHHELD.fullmatch(R.MARKER_PRIVATE))
          and not client_meds._RE_WITHHELD.fullmatch("[withheld: private]x"))
    src = (SERVER / "my_work.py").read_text(encoding="utf-8")
    check("My Work's marker test is the rule's own prefix test, not an equality with the bare markers",
          "return redaction.is_marker_value(str(value or \"\"))" in src and "in redaction.MARKERS" not in src)
    check("the rule still reads as a working copy of itself for the purge tool and the master JSON", R.redacts(
        (SERVER / "redaction.py").read_text(encoding="utf-8")))


# ═══ 2. THE KEEPER ═════════════════════════════════════════════════════════════════════════════════════════════════

class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.t += s


class FakeSheets:
    def __init__(self, books: dict[str, dict[str, list[list]]]) -> None:
        self.books, self.requests = books, []

    def spreadsheets(self) -> "FakeSheets":
        return self

    def values(self) -> "FakeSheets":
        return self

    def get(self, spreadsheetId: str, fields: str) -> Any:  # noqa: N803
        self.requests.append(("titles", spreadsheetId))
        titles = list(self.books[spreadsheetId])
        return types.SimpleNamespace(execute=lambda: {"sheets": [{"properties": {"title": t}} for t in titles]})

    def batchGet(self, spreadsheetId: str, ranges: list[str], valueRenderOption: str) -> Any:  # noqa: N802,N803
        self.requests.append(("values", spreadsheetId))
        tabs = self.books[spreadsheetId]
        out = [{"values": tabs[r.strip("'").replace("''", "'")]} for r in ranges]
        return types.SimpleNamespace(execute=lambda: {"valueRanges": out})


class FakeDrive:
    def __init__(self) -> None:
        self.listed: list[dict] = []

    def files(self) -> "FakeDrive":
        return self

    def list(self, **_k: Any) -> Any:
        return types.SimpleNamespace(execute=lambda: {"files": list(self.listed)})


class FakeStore:
    def __init__(self, clock: Clock, owned: set[str], meta: dict[str, dict]) -> None:
        self.clock, self.owned, self.meta = clock, owned, meta
        self.rows: dict[tuple[str, str], dict[int, dict]] = {}
        self.records: dict[tuple[str, str], dict] = {}
        self.held_titles: dict[str, tuple[list[str], float]] = {}
        self.mark = datetime.fromtimestamp(clock() - 600, timezone.utc)

    def watermark(self) -> datetime:
        return self.mark

    def known(self, ids: list[str]) -> dict:
        return {}

    def due(self, now: float, exclude: set[str]) -> list[dict]:
        return []

    def owned_ids(self) -> set[str]:
        return set(self.owned)

    def books(self, ids: list[str]) -> dict[str, dict]:
        return {s: {"id": s, **self.meta[s]} for s in ids if s in self.meta}

    def titles(self, sid: str) -> tuple[list[str], float] | None:
        return self.held_titles.get(sid)

    def giants(self, sid: str) -> dict:
        return {}

    def prior_count(self, sid: str) -> int:
        return sum(len(r) for (s, _t), r in self.rows.items() if s == sid)

    def apply(self, change: Any) -> tuple[int, int]:
        if change.titles is not None:
            self.held_titles[change.sid] = (list(change.titles), self.clock())
        for tab, rows in change.replace.items():
            self.rows[(change.sid, tab)] = dict(rows)
        if change.headers is None:
            for k in [k for k in self.records if k[0] == change.sid]:
                del self.records[k]
        for tab, rec in (change.headers or {}).items():
            if rec is None:
                self.records.pop((change.sid, tab), None)
            else:
                self.records[(change.sid, tab)] = rec
        return len(change.replace), sum(len(r) for r in change.replace.values())

    def mark_error(self, *a: Any) -> None:
        pass

    def forget(self, sid: str) -> None:
        pass

    def save_pass(self, *a: Any, **k: Any) -> None:
        pass


def keeper() -> None:
    print("\n2. the keeper: an owned book keeps its repeated columns and is read on its own clock")
    header = ["Employee", "HS Diploma", "SAM", "Nurse Aide", "Status", "HS Diploma", "Nurse Aide", "Ticket",
              "HS Diploma", "DL #", "Password", ""]
    keys = hss.twin_keys(header)
    check("the keys: a repeated name's last column keeps it, each earlier one '<name> ⟨n⟩' in order",
          keys == ["Employee", "HS Diploma ⟨1⟩", "SAM", "Nurse Aide ⟨1⟩", "Status", "HS Diploma ⟨2⟩", "Nurse Aide",
                   "Ticket", "HS Diploma", "DL #", "Password", ""], keys)
    line = ["somebody", "1", "0.5", "1", "Active", "x-second", "9/1/2026", "t", "6/1/2020", "OH RX123456", "pw", "z"]
    owned = hss._parse_row(line, header, False, True)
    plain = hss._parse_row(line, header, False)
    check("the plain key keeps today's value (the last column), the earlier ones ride beside it",
          owned["HS Diploma"] == "6/1/2020" and owned["HS Diploma ⟨1⟩"] == "1" and owned["HS Diploma ⟨2⟩"] == "x-second"
          and owned["Nurse Aide"] == "9/1/2026" and owned["Nurse Aide ⟨1⟩"] == "1" and plain["HS Diploma"] == "6/1/2020",
          sorted(owned))
    check("every reader of the plain keys reads the same bytes as before; only the twins are new",
          {k: v for k, v in owned.items() if "⟨" not in k} == plain and all("⟨" in k for k in set(owned) - set(plain)))
    check("the licence and the credential in those rows go through the one rule as always",
          owned["DL #"] == R.MARKER_IDENTIFIER + R.LICENCE_TAIL + "OH 3456" and owned["Password"] == R.MARKER_SECRET)
    rec = hss.header_record([header, line, line], [(2, owned), (3, owned)], 100.0)
    check("the header the keeper records keeps the sheet's order with the twins' names, blanks left out",
          rec and rec["header"] == [k for k in keys if k] and rec["rows"] == 2 and rec["header_row"] == 0, rec)

    t = 1_900_000_000.0
    clock = Clock(t)
    emp, other = "1EmployeeDatabaseFake0000000000000000000000", "1OtherBookFake000000000000000000000000000000"
    books = {emp: {"Master": [header, line, line[:5]], "employee driver": [["Employee", "DL #"], ["somebody", "12345678"]]},
             other: {"Data": [["id", "Dup", "Dup"], ["1", "a", "b"]]}}
    sheets, drive = FakeSheets(books), FakeDrive()
    meta = {emp: {"name": "Employee Database", "modifiedTime": hss._iso(t - 86400), "parents": []},
            other: {"name": "Other", "modifiedTime": hss._iso(t - 30), "parents": []}}
    store = FakeStore(clock, {emp}, meta)
    pace = hss.Pace(per_minute=1000, spacing=0.0, clock=clock, sleep=clock.sleep)
    hss._OWNED.update(at=0.0, ids=frozenset(), read={})
    hss._KEEP_OUT.update(at=0.0, ids=frozenset())
    drive.listed = [{"id": other, "name": "Other", "modifiedTime": hss._iso(t - 30), "parents": []}]
    out = hss.one_pass(drive, sheets, store, pace, now=clock)
    first = list(sheets.requests)
    m = store.rows[(emp, "Master")]
    check("an owned book Drive did not list is read anyway, in the pass's spare room: its tab list and one read of "
          "every tab — two requests through the keeper's own pace",
          out["kept"] == 1 and out["books"] == 2 and first.count(("titles", emp)) == 1
          and first.count(("values", emp)) == 1, (out, first))
    check("its rows carry the twins and its tabs' headers are recorded in the sheet's order",
          m[2]["HS Diploma ⟨1⟩"] == "1" and m[2]["HS Diploma"] == "6/1/2020"
          and store.records[(emp, "Master")]["header"] == [k for k in keys if k]
          and store.records[(emp, "employee driver")]["header"] == ["Employee", "DL #"], sorted(store.records))
    check("any other book keeps its stored shape: a repeated header folds to its last column, no header record",
          store.rows[(other, "Data")][2] == {"id": "1", "Dup": "b"} and not any(k[0] == other for k in store.records))
    drive.listed = []
    clock.t += 300
    sheets.requests.clear()
    out = hss.one_pass(drive, sheets, store, pace, now=clock)
    check("inside its clock it is not read again: no request", out["kept"] == 0 and not sheets.requests,
          (out, sheets.requests))
    clock.t += hss.OWNED_EVERY_S
    sheets.requests.clear()
    out = hss.one_pass(drive, sheets, store, pace, now=clock)
    check("past its clock it is read again — one request, its tab list still fresh",
          out["kept"] == 1 and sheets.requests == [("values", emp)], (out, sheets.requests))
    clock.t += hss.OWNED_EVERY_S
    sheets.requests.clear()
    keep, hss.BOOKS_PER_PASS = hss.BOOKS_PER_PASS, 1
    drive.listed = [{"id": other, "name": "Other", "modifiedTime": hss._iso(clock() - 30), "parents": []}]
    try:
        out = hss.one_pass(drive, sheets, store, pace, now=clock)
    finally:
        hss.BOOKS_PER_PASS = keep
    check("a pass with no room left never takes it: the listed books come first",
          out["kept"] == 0 and ("values", emp) not in sheets.requests, (out, sheets.requests))
    check("the deployed keeper resolves the owned book the way it resolves the kept-out ones: the depot's pointer",
          hss.OWNED_POINTERS == ("switchboard:props.CERT_SOURCE_ID",) and hss.PgStore.owned_ids.__code__.co_names
          and "pointer_ids" in hss.PgStore.owned_ids.__code__.co_names)
    hss._OWNED.update(at=0.0, ids=frozenset(), read={})

    print("\n   the sync: catalog order and the one reload")
    before = [["HS Diploma", "hs_diploma"], ["Status", "status"], ["Employee", "employee"], ["DL #", "dl"]]
    ordered = dbsync.order_headers(["HS Diploma", "Status", "Employee", "DL #", "HS Diploma ⟨1⟩"],
                                   ["Employee", "HS Diploma ⟨1⟩", "Status", "DL #", "HS Diploma"])
    pairs = dbsync.in_sheet_order(dbsync.map_columns(ordered, before), ordered)
    check("an owned tab's catalog lists its columns in the sheet's order; each header keeps its column",
          [h for h, _c in pairs] == ["Employee", "HS Diploma ⟨1⟩", "Status", "DL #", "HS Diploma"]
          and dict(pairs)["HS Diploma"] == "hs_diploma" and dict(pairs)["HS Diploma ⟨1⟩"] == "hs_diploma_1", pairs)
    check("the sync stores what the rule keeps of a raw licence, and a cell the keeper already withheld unchanged",
          dbsync.withhold({"DL #": "OH RX123456", "Employee": "e"}, ["Employee", "DL #"])["DL #"]
          == R.MARKER_IDENTIFIER + R.LICENCE_TAIL + "OH 3456"
          and dbsync.withhold({"DL #": R.MARKER_IDENTIFIER}, ["DL #"])["DL #"] == R.MARKER_IDENTIFIER)

    class Cur:
        def __init__(self, hub: "Hub") -> None:
            self.hub = hub

        def __enter__(self) -> "Cur":
            return self

        def __exit__(self, *a: Any) -> None:
            pass

        def executemany(self, q: str, keys: list) -> None:
            self.hub.unguarded += list(keys)

        def execute(self, q: str, p: Any = None) -> None:
            self.hub.marks.add(p[0])

    class Hub:
        def __init__(self) -> None:
            self.marks: set[str] = set()
            self.unguarded: list = []

        def execute(self, q: str, p: Any = None) -> Any:
            return types.SimpleNamespace(fetchone=lambda: (1,) if p and p[0] in self.marks else None)

        def transaction(self) -> Cur:
            return Cur(self)

        def cursor(self) -> Cur:
            return Cur(self)

    tabs = {("b", "Master"): {"guarded": True, "gone_at": None, "columns": [["DL #", "dl"], ["Employee", "e"]]},
            ("b", "Other"): {"guarded": True, "gone_at": None, "columns": [["DL", "dl"], ["SSN#", "ssn"]]},
            ("c", "Gone"): {"guarded": True, "gone_at": "x", "columns": [["DL #", "dl"]]}}
    s = dbsync.Sync.__new__(dbsync.Sync)
    s.hub, s.reloaded = Hub(), set()
    s.reload_once(dbsync.LICENCE_RELOAD, tabs, dbsync.licence_tab)
    first_keys = list(s.hub.unguarded)
    s2 = dbsync.Sync.__new__(dbsync.Sync)
    s2.hub, s2.reloaded = s.hub, set()
    s2.hub.unguarded = []
    s2.reload_once(dbsync.LICENCE_RELOAD, tabs, dbsync.licence_tab)
    check("on its next start the sync unguards only the live tabs holding a licence column, once: a later start "
          "finds the reload done and unguards nothing",
          first_keys == [("b", "Master")] and tabs[("b", "Other")]["guarded"] is True
          and s2.hub.unguarded == [] and "create table if not exists catalog.reloads" in
          (DB / "schema.sql").read_text(encoding="utf-8"), (first_keys, s2.hub.unguarded))


# the Employee Database Master's header row as the sheet lays it out: the scorecard, Status, the data
MASTER_LAYOUT = [
    "Employee", "All Completed", "Referral Paid", "Job App", "Attestation", "i9 Form", "i9 (Type 1)", "i9 (Type 2)",
    "W4 Form", "HIPAA Form", "Pay Auth Form", "HS Diploma", "Driver License", "Drive Abstract (last)", "Car Insurance",
    "SAM", "OIG", "Abuser", "Sex Offender", "Offender", "Nurse Aide", "Exclusions", "BCI", "Rapback", "Train - DODD",
    "Train - CPR", "", "Status", "Employee ID", "First Name", "Last Name", "SSN#", "Date of Birth", "Address", "City",
    "State", "Zip", "Phone Number", "Email", "Referral", "Referral Paid?", "Start Date(doc)", "Start Date (first day)",
    "End Date\n(last day)", "Job App Date", "Resume", "Attestation Date", "I-9 Date", "I-9 Completed", "I-9 Type 1",
    "I-9 1 Exp Date", "I-9 Type 2", "I-9 2 Exp Date", "W-4 Date", "HIPAA Form Date", "Pay Auth Form Date",
    "HS Diploma", "Driver", "DL #", "License Exp Date", "Driver's Abstract (Original)", "Driver's Abstract (Latest)",
    "Insurance Exp Date", "SAM Database", "OIG Exclusions", "Abuser registry", "Sex Offender", "Offender",
    "Nurse Aide", "Exclusions Database", "BCI/FBI", "BCI Check Date", "Rapback Entry Date", "Login", "Password",
    "SSN (Last 4)"]


def js_master_cols(header: list[str]) -> tuple[dict[str, int], list[str]]:
    """spMasterIndexFrom_'s column loop over the sheet's own header row: positions, inside the two blocks."""
    head = [SP.sp_head(h) for h in header]
    at = head.index("status") if "status" in head else -1
    col: dict[str, int] = {}
    missing = []
    for fid, block, alts, _s in SP.MASTER_FIELDS:
        lo = at if block == "data" and at != -1 else 0
        hi = (0 if at == -1 else at) if block == "score" else len(head)
        for a in alts:
            hit = next((c for c in range(lo, hi) if head[c] == SP.sp_head(a)), None)
            if hit is not None:
                col[fid] = hit
                break
        if fid not in col:
            missing.append(fid)
    return col, missing


def master_by_position() -> None:
    print("\n   the Master read by position, as Apps Script reads it")
    keys = hss.twin_keys(MASTER_LAYOUT)
    line = [f"v{i}" for i in range(len(MASTER_LAYOUT))]
    stored = hss._parse_row(line, MASTER_LAYOUT, False, True)
    rec = hss.header_record([MASTER_LAYOUT, line], [(2, stored)], 0.0)
    headers = rec["header"]
    rows = [{h: stored.get(h, "") for h in headers}]
    js_col, js_missing = js_master_cols(MASTER_LAYOUT)
    mi = SP.master_index_from(headers, rows)
    py_at = {}
    for fid, _b, _a, _s in SP.MASTER_FIELDS:
        key = mi["cols"].get(fid, {}).get("head") if fid in SP.EDIT_MASTER_IDS else None
        if key is not None:
            py_at[fid] = keys.index(key)
    row = next(iter(mi["rows"].values()))
    want = {fid: f"v{c}" for fid, c in js_col.items() if not dict((f, s) for f, _b, _a, s in SP.MASTER_FIELDS)[fid]}
    got = {fid: row["fields"].get(fid) for fid in want}
    check("every Master field reads the column spMasterIndexFrom_ reads — the scorecard twin before Status, the data "
          "twin after it, a name only one block holds (SAM, OIG, Abuser) where that block holds it",
          got == want and sorted(mi["missing"]) == sorted(js_missing) and not mi["unsure"]
          and all(py_at[f] == js_col[f] for f in py_at),
          ({f: (got[f], want[f]) for f in want if got[f] != want[f]}, sorted(set(mi["missing"]) ^ set(js_missing)),
           sorted(mi["unsure"])))
    check("the four repeated names each read twice, as the sheet holds them",
          {f: js_col.get(f) for f in ("flag_hs_diploma", "hs_diploma", "flag_nurse_aide", "nurse_aide")}
          == {"flag_hs_diploma": 11, "hs_diploma": 56, "flag_nurse_aide": 20, "nurse_aide": 68}
          and row["fields"]["flag_hs_diploma"] == "v11" and row["fields"]["hs_diploma"] == "v56"
          # the data block names SAM and OIG "SAM Database" and "OIG Exclusions"; the scorecard's SAM is the flag
          and "sam" not in mi["missing"] and row["fields"]["sam"] == f"v{MASTER_LAYOUT.index('SAM Database')}"
          and row["fields"]["abuser"] == "v65")
    jsonb = sorted(headers, key=lambda h: (len(h.encode()), h.encode()))
    old = [h for h in headers if not SP.TWIN_KEY.fullmatch(h)]
    late = old + [h for h in headers if SP.TWIN_KEY.fullmatch(h)]
    check("rows without the twins, or a copy not in the sheet's order, still leave the twins to Apps Script",
          SP.master_index_from(old, rows)["unsure"] and SP.master_index_from(jsonb, rows)["unsure"]
          and SP.master_index_from(late, rows)["unsure"])
    certs = SP.in_sheet_order(headers)
    check("the copy's own order marks itself: the twins before their plain name only when the catalog follows the "
          "sheet", certs and not SP.in_sheet_order(jsonb) and not SP.in_sheet_order(late) and not SP.in_sheet_order(old))


# ═══ 3. THE RUNNING APP ════════════════════════════════════════════════════════════════════════════════════════════

DRIVER = r'''
import base64, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, gsjs, locations as L, scope as sc, drive as dr, staff as SP, staff_app as SA
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
users = L.Reads(db, drv).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss) if boss else None
LIC = "[withheld: identifier] licence:"

def run(dbx, keys):
    out = {}
    for i, key in enumerate(keys):
        row = {}
        for action in job["doors"]:
            sess = L.Session(L.Reads(dbx, drv), master)
            try:
                env = SA.ACTIONS[action](sess, {"staff": key})
                st = env.get("status")
                why = "" if st == 200 else str(env.get("message") or "")[:160]
                if st == 200:
                    text = json.dumps(env.get("data"), default=str)
                    if "[withheld:" in text:
                        st, why = "leak", "an answer carries a marker"
                    if action == "staffProfileOverview":
                        d = (env.get("data") or {}).get("driving") or {}
                        row["driving"] = {"found": bool(d.get("found")), "dl": bool(d.get("dl_last4")),
                                          "masked": bool(d.get("dl_last4")) and d.get("dl_last4", "").count("•") in (0, 4)}
                row[action] = {"status": st, "why": why}
            except (sc.Defer, hubdb.Unreadable) as e:
                row[action] = {"status": "deferred", "why": type(e).__name__ + ": " + str(e)[:160]}
            except Exception as e:
                row[action] = {"status": "crashed", "why": type(e).__name__ + ": " + str(e)[:160]}
        out["#%d" % (i + 1)] = row
    return out

reads = L.Reads(db, drv)
sid = SP.emp_db_id(reads)
mtab = SP.cert_source_tab(reads, "master")
mi = SP.master_index(reads)
di = SP.driver_index(reads, SP.DRIVER_TAB)
roster = SA.ACTIONS["staffProfileRoster"](L.Session(L.Reads(db, drv), master), {})
active = [r["key"] for r in ((roster.get("data") or {}).get("staff") or [])
          if r.get("status") == "active" and not r.get("ambiguous")]
both = [k for k in active if k in mi["rows"] and not mi["rows"][k].get("ambiguous") and k in di["rows"]]
keys = (both + [k for k in active if k not in both])[: job["n"]]
mref = db.tab(sid, mtab)
live_twins = sum(1 for h in mref.headers if SP.TWIN_KEY.fullmatch(h))
out = {"master": master is not None, "keys": len(keys), "with_driving_row": sum(1 for k in keys if k in di["rows"]),
       "live_twin_columns": live_twins, "live_unsure": len(mi["unsure"])}
out["live"] = run(db, keys)

# the same rows as the new keeper and rule write them: the Master laid out scorecard, Status, data, every header both
# blocks name repeated (its scorecard column a synthetic flag), and each withheld licence carrying synthetic digits
score = {SP.sp_head(a) for _f, b, alts, _s in SP.MASTER_FIELDS if b == "score" for a in alts}
data = {SP.sp_head(a) for _f, b, alts, _s in SP.MASTER_FIELDS if b == "data" for a in alts}
heads = [h for h in mref.headers if not SP.TWIN_KEY.fullmatch(h)]
twins = [h for h in heads if SP.sp_head(h) in score and SP.sp_head(h) in data]
first = [h for h in heads if SP.sp_head(h) == "employee"]
order = (first + [h for h in heads if SP.sp_head(h) in score and SP.sp_head(h) not in data and h not in first]
         + [h + " ⟨1⟩" for h in twins] + [h for h in heads if SP.sp_head(h) == "status"]
         + [h for h in heads if SP.sp_head(h) not in score and SP.sp_head(h) != "status"] + twins)

def lic(v):
    return LIC + "0000" if isinstance(v, str) and v.startswith("[withheld") and not v.startswith(LIC) else v

refs, rows = {}, {}
rows[(sid, mtab)] = [(rn, dict({k: lic(v) if SP.sp_head(k) in ("dl#", "dl #") else v for k, v in raw.items()},
                               **{h + " ⟨1⟩": "1" for h in twins})) for rn, raw in db.rows(mref)]
refs[(sid, mtab)] = mref._replace(headers=tuple(order))
for tab in (SP.DRIVER_TAB, SP.DRIVER_COMPLIANCE_TAB):
    ref = db.tab(sid, tab)
    if ref is not None:
        refs[(sid, tab)] = ref
        rows[(sid, tab)] = [(rn, {k: lic(v) if SP.sp_head(k) in ("dl#", "dl #") else v for k, v in raw.items()})
                            for rn, raw in db.rows(ref)]
sdb = hubdb.HubDb()
real_tab, real_rows = sdb.tab, sdb.rows
sdb.tab = lambda s, t: refs.get((s, t)) or real_tab(s, t)
sdb.rows = lambda ref: rows[(ref.sheet_id, ref.tab)] if (ref.sheet_id, ref.tab) in rows else real_rows(ref)
smi = SP.master_index(L.Reads(sdb, drv))
out["synthetic_twins"] = len(twins)
out["synthetic_unsure"] = len(smi["unsure"])
out["synthetic_positional"] = SP.in_sheet_order(list(order))
out["synthetic"] = run(sdb, keys)
print(json.dumps(out, default=str))
'''


def docker(*args: str, data: bytes | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], input=data, capture_output=True, timeout=timeout)


def running(name: str) -> bool:
    got = docker("ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}", timeout=30)
    return got.returncode == 0 and name in got.stdout.decode().split()


def tally(doors: dict[str, dict]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {d: {} for d in DOORS}
    for row in doors.values():
        for d in DOORS:
            st = str(row[d]["status"])
            out[d][st] = out[d].get(st, 0) + 1
    return out


def reasons(doors: dict[str, dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in doors.values():
        for d in DOORS:
            if row[d]["status"] != 200:
                k = f"{d}: {row[d]['why'][:120]}"
                out[k] = out.get(k, 0) + 1
    return out


def live(runner: str, n: int) -> None:
    print(f"\n3. the Staff doors in the running {runner} (this branch's modules, streamed; no restart)")
    if not shutil.which("docker") or not running(runner):
        print(f"  skipped — no running {runner}")
        return
    blob = {"order": list(LIVE_MODULES),
            "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in LIVE_MODULES},
            "job": {"n": n, "doors": list(DOORS)}}
    got = docker("exec", "-i", runner, "python", "-c", DRIVER,
                 data=base64.b64encode(json.dumps(blob).encode()) + b"\n")
    if got.returncode != 0:
        check("the doors ran in the app", False, got.stderr.decode()[-800:])
        return
    py = json.loads(got.stdout.decode().strip().splitlines()[-1])
    print(f"  {py['keys']} active staff ({py['with_driving_row']} with an employee driver row); the live Master copy "
          f"holds {py['live_twin_columns']} twin column(s), {py['live_unsure']} Master field(s) unsure")
    lt, st = tally(py["live"]), tally(py["synthetic"])
    print("  door                      live rows (old keeper/rule)        rows as the new keeper and rule write them")
    for d in DOORS:
        print(f"  {d:<26}{json.dumps(lt[d]):<35}{json.dumps(st[d])}")
    for k, v in sorted(reasons(py["live"]).items()):
        print(f"    live    {v}× {k}")
    for k, v in sorted(reasons(py["synthetic"]).items()):
        print(f"    new     {v}× {k}")
    check("the doors ran as the master for real active staff", py["master"] and py["keys"] == n, py["keys"])
    check("no answer anywhere carries a marker or crashes",
          not any(str(r[d]["status"]) in ("leak", "crashed") for mode in ("live", "synthetic")
                  for r in py[mode].values() for d in DOORS))
    check("on the rows the new keeper writes the Master is read by position: no field unsure, the synthetic twins "
          "in the sheet's order", py["synthetic_positional"] and py["synthetic_unsure"] == 0
          and py["synthetic_twins"] > 0, py)
    drv = [r["driving"] for r in py["synthetic"].values() if "driving" in r]
    check("the driving card answers with the masked licence for every staff member whose driving row carries one",
          all(x["masked"] for x in drv if x["dl"]) and sum(1 for x in drv if x["dl"]) > 0,
          [x for x in drv])
    for d in DOORS:
        def master_defer(r: dict, d: str = d) -> bool:
            w = r[d]["why"]
            return r[d]["status"] == "deferred" and ("scorecard twin" in w or "licence number" in w)
        check(f"{d}: on the new rows no answer is left to Apps Script for a licence or a Master twin",
              not any(master_defer(r) for r in py["synthetic"].values()), reasons(py["synthetic"]))


def compiled() -> None:
    print("\n4. every Python file of the server, the app and the sync compiles")
    bad = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(sorted([*SERVER.glob("*.py"), *APP.glob("*.py"), *DB.glob("*.py")])):
            try:
                py_compile.compile(str(f), cfile=str(Path(tmp) / f"{i}.pyc"), doraise=True)
            except py_compile.PyCompileError as e:
                bad.append(f"{f.name}: {e.msg[:200]}")
    check(f"py_compile server/*.py app/*.py db/*.py ({len(list(SERVER.glob('*.py'))) + len(list(APP.glob('*.py')))}"
          f" + {len(list(DB.glob('*.py')))} files)", not bad, bad)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    # the driver holds ~170 MB beside the app's own: inside asa-hub-app (768 MiB) it gets uvicorn OOM-killed
    ap.add_argument("--runner", default="asa-hub-db-sync", help="the container that runs the Python side")
    ap.add_argument("--staff", type=int, default=8, help="how many active staff the doors are run for")
    args = ap.parse_args()
    rule()
    keeper()
    master_by_position()
    live(args.runner, args.staff)
    compiled()
    print(f"\ntest-staff-complete: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
