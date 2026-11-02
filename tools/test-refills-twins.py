#!/usr/bin/env python3
"""Clients › Refills off asa-hub-db when the Missing Medications form repeats a client's medications title: the Hub's
keeper owns the book and keeps both columns, the sync lists them in the sheet's order, and the Refills part reads the
first answer as csrGrid_ does; a copy that folded the title still leaves the client to Apps Script, while a copy read
straight from Google holds the form's own text and is read in Python. Synthetic rows only; nothing reaches a database
or Google."""
from __future__ import annotations

import sys
import types
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
import client_meds as CM  # noqa: E402
import hubdb  # noqa: E402
import staff as SP  # noqa: E402
from gsjs import name_key  # noqa: E402
from scope import Defer  # noqa: E402

sys.path.insert(2, str(DB))
import sheets_source  # noqa: E402
import sync as dbsync  # noqa: E402

BOOK, TAB = CM.CSR_BOOK_FALLBACK, CM.CSR_LIVE_TAB
# Form Responses 4's shape: a house's clients asked once in the first section and again in a later one
HEADER = ["Timestamp", "Your Name", "Select Client:", "Ann Lee: Medications", "Bo Day: Medications",
          "What's the issue related?", "Expected date to run out of medication", "Ann Lee: Medications",
          "Cy Fox: Medications", "Status", "Column 1"]
MATRIX = [HEADER,
          ["9/22/2026 9:51:14", "hm", "Ann Lee", "ann-first", "bo-stray", "Refill", "10/1/2026", "", "", "", ""],
          ["9/23/2026 9:51:14", "hm", "Ann Lee", "", "", "Refill", "", "ann-last", "", "Done", ""],
          ["9/24/2026 9:51:14", "hm", "Bo Day", "ann-stray", "bo-own", "Refill", "", "", "", "", "office"],
          ["9/25/2026 9:51:14", "hm", "Ann Lee", "ann-a", "", "Refill", "", "ann-b", "", "", ""]]
# csrFormRows_ on csrGrid_: a repeated title reads its first non-blank column; another client's column is not read
APPS_SCRIPT = {"Ann Lee": {"live-2": "ann-first", "live-3": "ann-last", "live-5": "ann-a"},
               "Bo Day": {"live-4": "bo-own"}}


class FakeDb:
    def __init__(self, headers: list[str], rows: list[tuple[int, dict]], status: str = "ok") -> None:
        self.ref = hubdb.TabRef(BOOK, TAB, "missing_meds_form_responses_4", tuple(headers), None, len(rows))
        self.held, self.status = rows, status

    def tab(self, sid: str, tab: str) -> Any:
        return self.ref if (sid, tab) == (BOOK, TAB) else None

    def book(self, sid: str) -> Any:
        return hubdb.Book(sid, "Missing Medications", None, None, self.status) if sid == BOOK else None

    def rows(self, ref: Any) -> list[tuple[int, dict]]:
        return list(self.held)

    def note_book(self, sid: str) -> None:
        pass


class FakeReads:
    def __init__(self, db: FakeDb) -> None:
        self.db = db

    def once(self, key: str, fn: Any) -> Any:
        return fn()


def copy_of(rows: list[tuple[int, dict]], order: list[str], exact: bool, cat: dict | None = None) -> tuple:
    """What asa-hub-db holds of the mirror's rows: the catalog's headers and each row as the sync writes its _raw."""
    keys = list(dict.fromkeys(k for _rn, d in rows for k in d))
    _h, pairs, _d = dbsync.plan_columns(cat, keys, order, exact)
    return pairs, [(rn, dbsync.withhold(d, keys)) for rn, d in rows]


def reports(headers: list[str], rows: list[tuple[int, dict]], client: str, status: str = "ok") -> list[dict] | str:
    """The Refills part's live-form reports for one client, or the Defer it raised."""
    try:
        grid = CM._grid(FakeReads(FakeDb(headers, rows, status)), BOOK, TAB)
        return CM._form_rows(grid, {name_key(client): True}, "live", "Missing Medications form")["rows"]
    except Defer as e:
        return "Defer: " + str(e)


def refills(headers: list[str], rows: list[tuple[int, dict]], client: str) -> dict[str, str] | str:
    """The Refills part's live-form reports for one client: report id → medications, or the Defer it raised."""
    got = reports(headers, rows, client)
    return got if isinstance(got, str) else {r["id"]: r["medications"] for r in got}


def keeper() -> None:
    print("\n1. the keeper owns the Missing Medications book")
    store = hss.PgStore.__new__(hss.PgStore)
    store.pointer_ids = lambda sources: {"cert-book"} if sources == hss.OWNED_POINTERS else set()
    check("with no prop for it, the book Apps Script falls back to is owned beside the Employee Database",
          store.owned_ids() == {"cert-book", CM.CSR_BOOK_FALLBACK} and hss.MISSING_MEDS_FALLBACK == CM.CSR_BOOK_FALLBACK
          and hss.MISSING_MEDS_POINTER == "switchboard:props." + CM.CSR_BOOK_PROP, store.owned_ids())
    store.pointer_ids = lambda sources: ({"cert-book"} if sources == hss.OWNED_POINTERS
                                         else {"moved-book"} if sources == (hss.MISSING_MEDS_POINTER,) else set())
    check("a prop naming another book owns that one instead, as csrBookId_ opens it",
          store.owned_ids() == {"cert-book", "moved-book"}, store.owned_ids())


def by_position() -> None:
    print("\n2. Refills reads the twins by position")
    rows, giant = hss.whole_tab(MATRIX, 100.0, True)
    rec = hss.header_record(MATRIX, rows, 100.0)
    check("the keeper keeps both columns of the repeated title and records the sheet's order",
          giant is None and rows[0][1]["Ann Lee: Medications ⟨1⟩"] == "ann-first" and rows[0][1]["Ann Lee: Medications"] == ""
          and rec["header"][7] == "Ann Lee: Medications", rec and rec["header"])
    pairs, raw = copy_of(rows, rec["header"], True)
    headers = [h for h, _c in pairs]
    check("the sync lists the copy's columns in the sheet's order, so the twin stands where the sheet has it",
          headers == rec["header"] and hubdb.in_sheet_order(headers), headers)
    got = {c: refills(headers, raw, c) for c in APPS_SCRIPT}
    check("every report reads what csrFormRows_ reads: the first answer of a repeated title, another client's "
          "column left unread, nothing left to Apps Script", got == APPS_SCRIPT, got)

    folded, _g = hss.whole_tab(MATRIX, 100.0)
    fpairs, fraw = copy_of(folded, [], False)
    got = refills([h for h, _c in fpairs], fraw, "Ann Lee")
    check("a copy that folded the title still leaves the client to Apps Script",
          isinstance(got, str) and "another client's column" in got, got)
    _keys, direct = sheets_source.shape(MATRIX)
    _p, draw = copy_of(direct, [], False, {"columns": pairs})
    got = refills(headers, draw, "Ann Lee")
    check("rows read straight from Google under the twins' old columns are folded too: Apps Script's",
          isinstance(got, str) and "another client's column" in got, got)
    jsonb = sorted(headers, key=lambda h: (len(h.encode()), h.encode()))
    got = refills(jsonb, raw, "Ann Lee")
    check("a catalog that lost the sheet's order is never read by position", isinstance(got, str), got)
    check("Staff reads the twins under the same rule", SP.in_sheet_order is hubdb.in_sheet_order
          and SP.twin_base is hubdb.twin_base and SP.TWIN_KEY is hubdb.TWIN_KEY)


def straight() -> None:
    print("\n3. a copy read straight from Google is read in Python")
    kept, _g = hss.whole_tab(MATRIX, 100.0, True)
    rec = hss.header_record(MATRIX, kept, 100.0)
    pairs, raw = copy_of(kept, rec["header"], True)
    headers = [h for h, _c in pairs]
    # FORMATTED_VALUE hands back the text the sheet shows, which MATRIX is
    _keys, rows = sheets_source.shape(MATRIX, True)
    _p, draw = copy_of(rows, rec["header"], True, {"columns": pairs})
    check("db-sync's direct pass stores every twin and the form's own timestamp and run-out text, as the keeper does",
          draw == raw and draw[0][1]["Ann Lee: Medications ⟨1⟩"] == "ann-first"
          and draw[0][1]["Timestamp"] == "9/22/2026 9:51:14"
          and draw[0][1]["Expected date to run out of medication"] == "10/1/2026", draw[0][1])
    keep = reports(headers, raw, "Ann Lee")
    for status in (dbsync.DIRECT_STATUS, "direct"):
        got = reports(headers, draw, "Ann Lee", status)
        first = next((r for r in got if r["id"] == "live-2"), {}) if isinstance(got, list) else {}
        check(f"a copy marked {status} is read in Python: nothing left to Apps Script, the keeper's very reports",
              isinstance(got, list) and got == keep
              and {r["id"]: r["medications"] for r in got} == APPS_SCRIPT["Ann Lee"]
              and first.get("reported_at", "").startswith("2026-09-22T09:51") and first.get("runs_out") == "2026-10-01",
              got)


def main() -> int:
    keeper()
    by_position()
    straight()
    print(f"\ntest-refills-twins: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
