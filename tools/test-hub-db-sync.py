#!/usr/bin/env python3
"""asa-hub-db sync (db/sync.py): slugs, table names, the header→column mapping and when a tab reloads.
Pure: no database, no network, no driver; also reads db/compose.yaml and db/.env.example for leaks."""
import hashlib
import importlib.util
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "db"

spec = importlib.util.spec_from_file_location("hub_db_sync", DB / "sync.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

results = {"ok": 0, "failed": []}
IDENT = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


print("slug")
check("accents fold to ascii", sync.slug("Endereço Ação") == "endereco_acao", sync.slug("Endereço Ação"))
check("punctuation runs become one underscore", sync.slug("  Locations – Zona  Sul!! ") == "locations_zona_sul")
check("empty and symbols-only give empty", sync.slug("") == "" and sync.slug("!!!") == "" and sync.slug(None) == "")
check("digits survive", sync.slug("2024 Q1") == "2024_q1")

print("table names")
sid, tab, book = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "Locations", "ASA Places"
h8 = hashlib.sha1((sid + tab).encode()).hexdigest()[:8]
name = sync.table_name(sid, tab, book)
check("t_ + 8 hex of sha1(sheet_id + tab) + slug(book_tab)", name == f"t_{h8}_asa_places_locations", name)
check("deterministic", sync.table_name(sid, tab, book) == name)
check("the tab changes the hash", sync.table_name(sid, "Locations 2", book)[:10] != name[:10])
long = sync.table_name(sid, "A very long tab name " * 6, "An equally long book title " * 6)
check("truncated to 63, no trailing underscore", len(long) <= 63 and not long.endswith("_") and IDENT.match(long), long)
bare = sync.table_name(sid, "", "")
check("no name left gives t_<hash>", bare == "t_" + hashlib.sha1(sid.encode()).hexdigest()[:8], bare)
check("a non-latin name keeps a valid identifier", IDENT.match(sync.table_name(sid, "日本", "Книга")) is not None)
taken = {name}
other = sync.pick_table_name(sid, tab, book, taken)
check("a taken name moves to a 16-hex hash", other.startswith("t_" + hashlib.sha1((sid + tab).encode()).hexdigest()[:16] + "_"), other)
check("a free name is the 8-hex one", sync.pick_table_name(sid, tab, book, set()) == name)

print("columns")
used: set = set()
names = []
for h in ["Name", "name", "NAME ", "2024 Total", "Row Number", "xmin", "!!!", "", "Endereço"]:
    c = sync.column_name(h, used)
    used.add(c)
    names.append(c)
check("dedupe by suffix", names[:3] == ["name", "name_2", "name_3"], names)
check("leading digit gets c_", names[3] == "c_2024_total", names)
check("reserved and system names move aside", names[4] == "row_number_2" and names[5] == "xmin_2", names)
check("empty headers become col, col_2", names[6:8] == ["col", "col_2"], names)
check("accented header", names[8] == "endereco", names)
check("every column a valid identifier", all(IDENT.match(c) for c in names), names)
big = "x" * 80
u2: set = {sync._cut(big)}
c2 = sync.column_name(big, u2)
check("long duplicate keeps its suffix within 63", len(c2) <= 63 and c2.endswith("_2"), c2)

print("mapping")
pairs = sync.map_columns(["Name", "Address", "Name"])
check("fresh mapping in header order, header once", pairs == [["Name", "name"], ["Address", "address"]], pairs)
again = sync.map_columns(["City", "Address", "name"], pairs)
check("known headers keep their column, new ones append",
      again == [["Name", "name"], ["Address", "address"], ["City", "city"], ["name", "name_2"]], again)
check("a gone header keeps its column", ["Name", "name"] in sync.map_columns(["Address"], pairs))
old = [["Total", "c_1"]]
check("an existing column name is never re-slugged", sync.map_columns(["Total"], old) == old)
wide = sync.map_columns([f"h{i}" for i in range(sync.MAX_COLUMNS + 50)])
check("the column cap holds", len(wide) == sync.MAX_COLUMNS, len(wide))
check("columns unique", len({c for _, c in wide}) == len(wide))

print("header order")
check("the sheet's order wins, extra keys follow",
      sync.order_headers(["Id", "City", "Name", "Extra"], ["Name", "Id", "", "Gone", "City", "Name"])
      == ["Name", "Id", "City", "Extra"])
check("no sheet header keeps the mirror's order", sync.order_headers(["b", "a", "b"], None) == ["b", "a"])

print("reload decisions")
t = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
cat = {"row_count": 10, "source_synced_at": t, "gone_at": None}
check("new tab loads", sync.needs_load(None, 0, None))
check("same count and time skip", not sync.needs_load(cat, 10, t))
check("same instant in another zone skips", not sync.needs_load(cat, 10, t.astimezone(timezone(timedelta(hours=-4)))))
check("count change loads", sync.needs_load(cat, 9, t))
check("newer ingest loads", sync.needs_load(cat, 10, t + timedelta(microseconds=1)))
check("a gone tab that came back loads", sync.needs_load(dict(cat, gone_at=t), 10, t))
meta = {"name": "B", "modified_time": t, "last_sync_at": t, "last_sync_status": "ok", "tab_count": 2, "row_count": None}
row = sync.book_row(meta)
check("book row normalises counts", row["row_count"] == 0 and row["synced_at"] == t, row)
check("unchanged book skips", not sync.book_changed(meta, dict(row, gone_at=None)))
check("re-synced book is checked", sync.book_changed(dict(meta, last_sync_at=t + timedelta(seconds=1)), dict(row, gone_at=None)))
check("unknown book is checked", sync.book_changed(meta, None))

print("files")
compose = (DB / "compose.yaml").read_text()
check("no published ports", "ports:" not in compose)
check("backend_network is external", re.search(r"external:\s*true\s*\n\s*name:\s*backend_network", compose) is not None)
check("named volume asa_hub_db_data", "name: asa_hub_db_data" in compose)
env = (DB / ".env.example").read_text()
check(".env.example carries names only",
      all(line.endswith("=") for line in env.splitlines() if line and not line.startswith("#")), env)
check(".env is git-ignored", ".env" in (DB / ".gitignore").read_text().split())
for f in ["compose.yaml", "schema.sql", "sync.py", "requirements.txt", ".env.example", ".gitignore"]:
    head = (DB / f).read_text().splitlines()[:2]
    check(f"{f} opens with a 2-line header", len(head) == 2 and all(head), head)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
