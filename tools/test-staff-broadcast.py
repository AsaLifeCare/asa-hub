#!/usr/bin/env python3
"""
The broadcast's relay half, offline: the PRN reader, the relay door, the mint tool's header.

    python3 tools/test-staff-broadcast.py
"""
import re
import sys
import types
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
SERVER = REPO / "server"
GS = REPO / "apps-script"
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(HERE.parent))

results = {"ok": 0, "failed": []}


def check(name, cond, detail=None):
    if cond:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


# ── the PRN reader, with the Calendar Builder's reader stood in ─────────────
fake = types.ModuleType("calendar_builder_slices")
fake.ROWS = []
fake.FAIL = False


def _staff(dsn):
    if fake.FAIL:
        raise RuntimeError("the mirror would not answer")
    return list(fake.ROWS), "2026-09-22T21:04:00Z"


fake._staff = _staff
sys.modules["calendar_builder_slices"] = fake

import staff_broadcast  # noqa: E402

rows = [
    {"name": "Pat Prn", "note": "PRN"},
    {"name": "Quinn Query", "note": " prn "},
    {"name": "Rae Weekend", "note": "PRN weekends"},
    {"name": "Sol House", "note": "MF"},
    {"name": "Ivy Ink", "note": "not PRN any more"},
    {"name": "Pat  Prn", "note": "PRN"},
    {"name": "Uma Umber", "note": "Prefers midnights"},
    {"name": "", "note": "PRN"},
    {"name": "Late Exact", "note": "PRN weekends"},
    {"name": "Late Exact", "note": "PRN"},
]
got = staff_broadcast.prn_from_staff(rows)
check("an exact PRN note counts, in any case and with spaces around it",
      got["names"][:2] == ["Pat Prn", "Quinn Query"], got)
check("the same person listed twice (another space in the name) is listed once",
      got["names"].count("Pat Prn") == 1 and "Pat  Prn" not in got["names"], got["names"])
check("a note that only MENTIONS PRN is reported with its words and never counted",
      [m["name"] for m in got["mentions"]] == ["Rae Weekend", "Ivy Ink"] and
      got["mentions"][0]["note"] == "PRN weekends" and "Rae Weekend" not in got["names"], got["mentions"])
check("an exact note wins over a mention for the same person, whatever the order",
      "Late Exact" in got["names"] and all(m["name"] != "Late Exact" for m in got["mentions"]), got)
check("a note that says something else, and a row with no name, are nobody",
      "Sol House" not in got["names"] and "Uma Umber" not in got["names"] and "" not in got["names"], got)
check("nothing in, nothing out — and never an error",
      staff_broadcast.prn_from_staff(None) == {"names": [], "mentions": []}, None)

fake.ROWS = rows
view = staff_broadcast.prn_view("dsn")
check("the door's answer says it read the mirror, how many rows, and as of when",
      view["readable"] is True and view["rows"] == len(rows) and view["as_of"] == "2026-09-22T21:04:00Z" and
      view["names"] == got["names"], view)
fake.FAIL = True
raised = False
try:
    staff_broadcast.prn_view("dsn")
except RuntimeError:
    raised = True
check("a mirror that cannot be read RAISES — it is never an empty list that reads as \"nobody is PRN\"", raised)
fake.FAIL = False

# the real reader carries the NOTE column under the name this module reads
cbs = (SERVER / "calendar_builder_slices.py").read_text(encoding="utf-8")
check("the Calendar Builder's reader hands the NOTE column back as `note`, the key this reads",
      re.search(r'"note":\s*str\(r\.get\("NOTE"\)', cbs) is not None and "def _staff(" in cbs, None)

# ── the door ─────────────────────────────────────────────────────────────────
relay = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
start = relay.find('@app.post("/hub-lanes/broadcast/prn")')
route = relay[start:relay.find("\n\n\n", start)] if start != -1 else ""
check("the relay answers the PRN door under /hub-lanes/, the prefix the web server already hands it",
      start != -1, None)
check("the door asks for the service secret before it reads anything",
      "_mail_auth_ok(body)" in route and route.find("_mail_auth_ok(body)") < route.find("prn_view"), route[:300])
check("the door reads through staff_broadcast.prn_view and turns a failed read into a 502 with the reason",
      "staff_broadcast.prn_view" in route and '"status": 502' in route, route[-400:])

gs = (GS / "CommBroadcast.gs").read_text(encoding="utf-8")
m = re.search(r"var COMM_BROADCAST_PRN_PATH = '([^']+)';", gs)
check("the lane knocks on exactly the path the relay answers",
      bool(m) and m.group(1) == "/hub-lanes/broadcast/prn", m.group(1) if m else None)
check("the lane knocks through staffRelayPost_, the helper that carries the service secret",
      "staffRelayPost_(COMM_BROADCAST_PRN_PATH" in gs, None)

# ── the house ────────────────────────────────────────────────────────────────
import mint_comm_broadcasts_house as mint  # noqa: E402

check("importing the mint tool reaches no network — the token is only fetched when it is run",
      mint.TOK == "", None)
hm = re.search(r"var COMM_BROADCAST_HEADER = \[([\s\S]*?)\];", gs)
writer = re.findall(r"'([^']+)'", hm.group(1)) if hm else []
check("the mint stamps the header the writer reads, column for column",
      writer and writer == mint.HOUSE["header"], {"writer": writer, "mint": mint.HOUSE["header"]})
hs = re.search(r"var COMM_BROADCAST_HOUSE = '([^']+)';", gs)
check("the mint declares the house the writer resolves (HUB_HOUSE_<TAB>_ID, moved.<tab>)",
      bool(hs) and mint.HOUSE["tab"] == hs.group(1) and
      mint.HOUSE["prop"] == "HUB_HOUSE_" + hs.group(1).upper() + "_ID", mint.HOUSE)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
