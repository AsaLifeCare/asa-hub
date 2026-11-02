#!/usr/bin/env python3
"""The examples mint tool, offline: a second run writes nothing, even on a tab somebody rearranged."""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent

results = {"ok": 0, "failed": []}


def check(name: str, cond: bool, detail: object = "") -> None:
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:600]) if detail else ''}")


def load_tool():
    spec = importlib.util.spec_from_file_location(
        "mint_examples_house", REPO / "tools" / "mint_examples_house.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeSheets:
    def __init__(self, essencial_id: str) -> None:
        self.books: dict[str, dict] = {}
        self.facts: list[list[str]] = []
        self.essencial = essencial_id
        self.calls: list[str] = []
        self.next_id = 0

    def make(self, title: str, tabs: list[tuple[str, list[str], list[list]]],
             zone: str = "Etc/GMT", rows: int = 500) -> str:
        self.next_id += 1
        sid = f"BOOK{self.next_id}" + "x" * 20
        self.books[sid] = {"title": title, "timeZone": zone, "tabs": {}}
        for tab, header, body in tabs:
            self.books[sid]["tabs"][tab] = {
                "grid": [list(header)] + [list(r) for r in body], "rowCount": rows}
        return sid

    def grid(self, sid: str, tab: str) -> list[list]:
        return self.books[sid]["tabs"][tab]["grid"]

    def column(self, sid: str, tab: str, name: str) -> list[str]:
        grid = self.grid(sid, tab)
        if not grid:
            return []
        at = [str(h) for h in grid[0]].index(name)
        return [str(r[at]) if at < len(r) else "" for r in grid[1:]]

    def __call__(self, tok, url, payload=None, method="GET", tries=6):  # noqa: ARG002
        self.calls.append(f"{method} {url}")
        base = "https://sheets.googleapis.com/v4/spreadsheets/"
        rest = url[len(base):]

        if rest == "" and method == "POST":
            return self._create(payload)

        sid = rest.split("/")[0].split(":")[0]
        tail = rest[len(sid):]

        if tail == "" and method == "GET":
            return self._meta(sid)
        if tail == ":batchUpdate":
            return self._batch(sid, payload)
        if tail.startswith("/values/"):
            return self._values(sid, tail[len("/values/"):], payload, method)
        raise AssertionError(f"the fake API was asked for {url}")

    def _create(self, payload: dict) -> dict:
        props = payload.get("properties") or {}
        self.next_id += 1
        sid = f"BOOK{self.next_id}" + "x" * 20
        self.books[sid] = {"title": props.get("title", ""),
                           "timeZone": props.get("timeZone", "America/New_York"),
                           "tabs": {}}
        for sheet in payload.get("sheets") or []:
            p = sheet["properties"]
            self.books[sid]["tabs"][p["title"]] = {
                "grid": [], "rowCount": p.get("gridProperties", {}).get("rowCount", 1000)}
        return {"spreadsheetId": sid}

    def _meta(self, sid: str) -> dict:
        book = self.books[sid]
        return {"properties": {"title": book["title"], "timeZone": book["timeZone"]},
                "sheets": [{"properties": {"title": tab,
                                           "gridProperties": {"rowCount": body["rowCount"]}}}
                           for tab, body in book["tabs"].items()]}

    def _batch(self, sid: str, payload: dict) -> dict:
        for req in payload.get("requests") or []:
            if "addSheet" in req:
                p = req["addSheet"]["properties"]
                self.books[sid]["tabs"][p["title"]] = {
                    "grid": [], "rowCount": p.get("gridProperties", {}).get("rowCount", 1000)}
            elif "updateSpreadsheetProperties" in req:
                props = req["updateSpreadsheetProperties"]["properties"]
                if "timeZone" in props:
                    self.books[sid]["timeZone"] = props["timeZone"]
            else:
                raise AssertionError(f"the fake API was asked for {list(req)}")
        return {}

    def _values(self, sid: str, tail: str, payload, method):
        append = False
        path = tail.split("?", 1)[0]
        if path.endswith(":append"):
            append = True
            path = path[: -len(":append")]
        rng = urllib.parse.unquote(path)
        tab, a1 = rng.split("!", 1)
        tab = tab.strip("'")

        if sid == self.essencial:
            if append:
                self.facts.extend([list(r) for r in payload["values"]])
                return {}
            return {"values": [list(r) for r in self.facts]}

        book = self.books[sid]["tabs"].setdefault(tab, {"grid": [], "rowCount": 1000})
        grid = book["grid"]

        if append:
            for row in payload["values"]:
                grid.append(list(row))
            book["rowCount"] = max(book["rowCount"], len(grid))
            return {}

        if method == "PUT":
            values = payload["values"]
            if a1 != "A1" or len(values) != 1:
                raise AssertionError(f"the fake API was asked to PUT {a1}")
            if grid:
                grid[0] = list(values[0])
            else:
                grid.append(list(values[0]))
            return {}

        if a1 == "1:1":
            return {"values": [list(grid[0])]} if grid else {}
        if ":" in a1:
            left, right = a1.split(":", 1)
            col = "".join(c for c in left if c.isalpha())
            first = int("".join(c for c in left if c.isdigit()))
            last = int("".join(c for c in right if c.isdigit()))
            at = 0
            for ch in col:
                at = at * 26 + (ord(ch) - 64)
            at -= 1
            out = []
            for r in range(first - 1, min(last, len(grid))):
                row = grid[r]
                out.append([row[at]] if at < len(row) and str(row[at]) != "" else [])
            while out and not out[-1]:
                out.pop()
            return {"values": out}
        raise AssertionError(f"the fake API was asked for {rng}")


def run_tool(fake: FakeSheets, argv: list[str] | None = None):
    mod = load_tool()
    mod.token = lambda: "a-token"
    mod.api = fake
    fake.essencial = mod.ESSENCIAL_ID
    held_argv = sys.argv
    sys.argv = ["mint_examples_house.py"] + (argv or [])
    printed: list[str] = []
    held_print = mod.print if hasattr(mod, "print") else None  # noqa: F841
    import builtins
    real_print = builtins.print

    def capture(*args, **kwargs):  # noqa: ANN001
        printed.append(" ".join(str(a) for a in args))

    builtins.print = capture
    try:
        mod.main()
        return mod, "\n".join(printed), None
    except SystemExit as stop:
        return mod, "\n".join(printed), str(stop)
    finally:
        builtins.print = real_print
        sys.argv = held_argv


SEED = json.loads((REPO / "tools" / "examples-seed.json").read_text(encoding="utf-8"))
TABS = {t["tab"]: t for t in SEED["tabs"]}
TOTAL = sum(len(t["rows"]) for t in SEED["tabs"])


def facts_map(fake: FakeSheets) -> dict[str, str]:
    """The depot's reading law: last row wins per Source."""
    state: dict[str, str] = {}
    for row in fake.facts:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


# 1. a fresh mint, then the same command again
fake = FakeSheets("essencial")
mod, said, stopped = run_tool(fake)
sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
check("FRESH: the book is minted with every tab and every seed row",
      stopped is None and len(fake.books[sid]["tabs"]) == len(TABS) and
      sum(len(fake.grid(sid, t)) - 1 for t in TABS) == TOTAL,
      {t: len(fake.grid(sid, t)) - 1 for t in TABS})
check("FRESH: the book is born on Etc/GMT — the only clock cellText_ is valid for",
      fake.books[sid]["timeZone"] == "Etc/GMT", fake.books[sid]["timeZone"])
check("FRESH: every row carries its EX_ id, the only thing the removal job finds rows by",
      all(i.startswith("EX_") for t in TABS for i in fake.column(sid, t, "id")))
state = facts_map(fake)
check("FRESH: the depot names the house, arms the switch and records the header, per tab",
      all(state.get(f"switchboard:props.{mod.prop_for(t)}") == sid and
          state.get(f"switchboard:moved.{t}") == "on" and
          json.loads(state.get(f"schema:{t}.header", "[]")) == TABS[t]["header"] for t in TABS),
      state)

before = copy.deepcopy(fake.books[sid]["tabs"])
facts_before = len(fake.facts)
mod, said, stopped = run_tool(fake)
check("AGAIN: a second run over untouched tabs writes not one row",
      stopped is None and all(len(fake.grid(sid, t)) == len(before[t]["grid"]) for t in TABS),
      {t: (len(before[t]["grid"]), len(fake.grid(sid, t))) for t in TABS})
check("AGAIN: and it appends no depot fact either",
      len(fake.facts) == facts_before, f"{facts_before} → {len(fake.facts)}")


# 2. the column somebody moved
for tab in ("example_shop_items", "example_trips"):
    fake = FakeSheets("essencial")
    run_tool(fake)
    sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
    grid = fake.grid(sid, tab)
    grid[:] = [row[1:] + [row[0]] for row in grid]
    kept = [list(r) for r in grid]
    mod, said, stopped = run_tool(fake)
    ids = fake.column(sid, tab, "id")
    check(f"MOVED ({tab}): `id` at the end is still found — no row is appended twice",
          stopped is None and fake.grid(sid, tab) == kept and len(ids) == len(set(ids)),
          {"rows": len(fake.grid(sid, tab)) - 1, "ids": ids})

fake = FakeSheets("essencial")
run_tool(fake)
sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
tab = "example_shop_items"
grid = fake.grid(sid, tab)
grid[:] = [row[1:] + [row[0]] for row in grid]
del grid[1]
mod, said, stopped = run_tool(fake)
header_now = [str(h) for h in fake.grid(sid, tab)[0]]
landed = fake.grid(sid, tab)[-1]
seed_row = TABS[tab]["rows"][0]
check("MOVED: a row put back lands under the header's own names, not in the seed's order",
      stopped is None and len(fake.grid(sid, tab)) == len(TABS[tab]["rows"]) + 1 and
      all(str(landed[header_now.index(name)]) == str(seed_row[i])
          for i, name in enumerate(TABS[tab]["header"])),
      {"header": header_now, "landed": landed})


# 3. a gap left in the header
fake = FakeSheets("essencial")
run_tool(fake)
sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
tab = "example_skills"
grid = fake.grid(sid, tab)
grid[:] = [[row[0], ""] + list(row[1:]) for row in grid]
grid[0][1] = ""
del grid[1]
mod, said, stopped = run_tool(fake)
header_now = [str(h) for h in fake.grid(sid, tab)[0]]
landed = fake.grid(sid, tab)[-1]
seed_row = TABS[tab]["rows"][0]
check("GAP: a blank column in the header does not shift the appended values one column left",
      stopped is None and header_now[1] == "" and str(landed[1]) == "" and
      all(str(landed[header_now.index(name)]) == str(seed_row[i])
          for i, name in enumerate(TABS[tab]["header"])),
      {"header": header_now, "landed": landed})
check("GAP: and the schema fact records the header a READER sees, without the gap",
      json.loads(facts_map(fake).get(f"schema:{tab}.header", "[]")) == TABS[tab]["header"],
      facts_map(fake).get(f"schema:{tab}.header"))


# 4. a tab grown past the height it was born with
fake = FakeSheets("essencial")
run_tool(fake)
sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
tab = "example_attempts"
book = fake.books[sid]["tabs"][tab]
width = len(TABS[tab]["header"])
book["grid"][1:1] = [[""] * width for _ in range(600)]
book["rowCount"] = len(book["grid"])
kept = [list(r) for r in book["grid"]]
mod, said, stopped = run_tool(fake)
ids = [i for i in fake.column(sid, tab, "id") if i]
check("GROWN: rows past the height the tab was born with are still found — read to its real "
      "last row, not to a fixed ceiling",
      stopped is None and fake.grid(sid, tab) == kept and len(ids) == len(set(ids)),
      {"rows": len(fake.grid(sid, tab)), "was": len(kept), "ids": len(ids)})


# 5. the header with no id column at all
fake = FakeSheets("essencial")
run_tool(fake)
sid = next(k for k in fake.books if fake.books[k]["title"] == SEED["book_title"])
tab = "example_trips"
grid = fake.grid(sid, tab)
grid[0][grid[0].index("id")] = "reference"
kept = [list(r) for r in grid]
mod, said, stopped = run_tool(fake)
check("NO ID: a live header with no `id` column stops the tool instead of doubling every row",
      stopped is not None and "id" in str(stopped) and fake.grid(sid, tab) == kept,
      stopped)


# 6. a book that was minted before the clock was pinned
fake = FakeSheets("essencial")
sid = fake.make(SEED["book_title"],
                [(t["tab"], t["header"], t["rows"]) for t in SEED["tabs"]],
                zone="America/New_York")
fake.facts.extend([["config", mod.prop_for(t), sid, "", f"switchboard:props.{mod.prop_for(t)}",
                    "", "", "mint-examples", ""] for t in TABS])
mod, said, stopped = run_tool(fake)
check("OLD BOOK: a catalogue on the account's own clock is MOVED to Etc/GMT, not left on it",
      stopped is None and fake.books[sid]["timeZone"] == "Etc/GMT" and
      "America/New_York" in said, said[-400:])
check("OLD BOOK: and nothing is re-seeded while it is moved",
      sum(len(fake.grid(sid, t)) - 1 for t in TABS) == TOTAL,
      {t: len(fake.grid(sid, t)) - 1 for t in TABS})


# 7. the seed itself, and what the tool never does
src = (REPO / "tools" / "mint_examples_house.py").read_text(encoding="utf-8")
check("THE TOOL: it never reads ids from a hard-wired column A again",
      "'{tab}'!A2:A" not in src and 'f"\'{tab}\'!{letter}2:{letter}{last}"' in src)
check("THE TOOL: it reads the seed rather than carrying a second copy of the rows",
      "examples-seed.json" in src and "Dyson" not in src)

gs = (REPO / "apps-script" / "Examples.gs").read_text(encoding="utf-8")
check("THE READER: the two agree on the clock the catalogue is read in",
      "Etc/GMT" in gs and "BOOK_TIMEZONE = \"Etc/GMT\"" in src)
check("THE READER: and on the prefix every seed id carries",
      "EX_PREFIX = 'EX_'" in gs and
      all(str(r[0]).startswith("EX_") for t in SEED["tabs"] for r in t["rows"]))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
