#!/usr/bin/env python3
"""Transportation at the relay: after each of its writes the engine answered 200 — by /gas or by the write ledger —
every open stream hears the app's bare name, and nothing else; a ring never fails a write; and the board, which
carries client names, is a read no receipt is ever kept of. Pure: the relay's own source, lifted, no network."""
import ast
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


def segment(name: str) -> str:
    """One top-level definition or assignment, as written in the relay."""
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


WRITES = {"vehicleCalendarRequest", "vehicleCalendarAnswer", "vehicleCalendarWithdraw", "vehicleCalendarTripSave",
          "vehicleCalendarVehicleSave", "vehicleCalendarSettingsSet", "vehicleCalendarSeed", "vehicleCalendarImport",
          "supportDeskDecide"}

rang: list[str] = []
SPACE = {"json": json, "_publish_slice": rang.append}
for name in ("VEHICLE_CALENDAR_EVENT", "VEHICLE_CALENDAR_WRITES", "_vehicle_calendar_rang",
             "RELAY_NO_RECEIPT_ACTIONS", "HOUSECAL_EVENT"):
    exec(segment(name), SPACE)  # noqa: S102
ring = SPACE["_vehicle_calendar_rang"]

print("\nthe ring")
check("the name is the app's id, and the writes are the app's eight and Support Requests' decision",
      SPACE["VEHICLE_CALENDAR_EVENT"] == "vehicle-calendar" and set(SPACE["VEHICLE_CALENDAR_WRITES"]) == WRITES,
      sorted(SPACE["VEHICLE_CALENDAR_WRITES"]))
check("…a bare name every stream hears: never a hotline: name, never the shift calendar's",
      not SPACE["VEHICLE_CALENDAR_EVENT"].startswith("hotline:")
      and SPACE["VEHICLE_CALENDAR_EVENT"] != SPACE["HOUSECAL_EVENT"])
for action in sorted(WRITES):
    rang.clear()
    ring(action, b'{"status":200,"data":{"ok":true,"said":"Requested."}}')
    check(f"{action} answered 200 rings the name once", rang == ["vehicle-calendar"], rang)
rang.clear()
ring("vehicleCalendarAnswer", '{"status": 200, "data": {"ok": true, "changed": false}}')
check("…an answer read as text rings the same, and so does one that changed nothing", rang == ["vehicle-calendar"],
      rang)
QUIET = [
    ("vehicleCalendarRequest", b'{"status":409,"message":"The Van is booked then."}'),
    ("vehicleCalendarRequest", b'{"status":503,"message":"Nobody is set to approve vehicle requests."}'),
    ("vehicleCalendarAnswer", b'{"status":403,"message":"This one is waiting on Ty Bond."}'),
    ("vehicleCalendarTripSave", b'{"status":"200"}'),
    ("vehicleCalendarTripSave", b'{"data":{"ok":true}}'),
    ("vehicleCalendarSeed", b'[{"status":200}]'),
    ("vehicleCalendarImport", b'200'),
    ("vehicleCalendarImport", b'<html>Google sign-in</html>'),
    ("vehicleCalendarImport", b''),
    ("vehicleCalendarImport", None),
    ("vehicleCalendarImport", b'\xff\xfe\x00'),
    ("vehicleCalendarBoard", b'{"status":200}'),
    ("schedulingAnswer", b'{"status":200}'),
    ("", b'{"status":200}'),
    (None, b'{"status":200}'),
    (["vehicleCalendarAnswer"], b'{"status":200}'),
]
raised = []
rang.clear()
for action, content in QUIET:
    try:
        ring(action, content)
    except Exception as exc:  # noqa: BLE001
        raised.append((action, type(exc).__name__))
check("a refusal, a status that is not the number 200, an answer that is not an envelope, garbage, the board (a read) "
      "and any other action ring nothing — and none of them raises",
      rang == [] and raised == [], {"rang": rang, "raised": raised})


def boom(_name):
    raise RuntimeError("the streams are gone")


SPACE["_publish_slice"] = boom
try:
    ring("vehicleCalendarAnswer", b'{"status":200}')
    swallowed = True
except Exception:  # noqa: BLE001
    swallowed = False
SPACE["_publish_slice"] = rang.append
check("a publish that throws is swallowed: telling nobody never fails the write", swallowed)
body = segment("_vehicle_calendar_rang")
check("the ring publishes the constant name and nothing of the answer",
      body.count("_publish_slice(") == 1 and "_publish_slice(VEHICLE_CALENDAR_EVENT)" in body)

print("\nwhere it is rung")
gas = segment("gas_relay")
check("the answer Python gave gas_relay is offered to the ring once, after the app packs see it, with that very answer",
      gas.count("_vehicle_calendar_rang(") == 1 == gas.count("_relay_observe_app_pack(")
      and -1 < gas.find("_relay_observe_app_pack(action, raw, res.content, python=True)")
      < gas.find("_vehicle_calendar_rang(action, res.content)"))
check("…and no write is queued to ring later: the relay answers no {accepted} of its own",
      "def _accepted" not in gas and not re.search(r"(?<![A-Za-z0-9])_ledger_", SOURCE))
landed = segment("_backend_final_landed")
check("a final write Python kept rings it as it lands, with Python's own answer",
      landed.count("_vehicle_calendar_rang(") == 1 and "_vehicle_calendar_rang(action, content)" in landed)
check("nowhere else in the relay", SOURCE.count("_vehicle_calendar_rang(") == 1 + 1 + 1)

print("\nthe board keeps no receipt")
receipts = SPACE["RELAY_NO_RECEIPT_ACTIONS"]
literal = re.search(r"^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)", SOURCE, re.M)
check("vehicleCalendarBoard is a read no receipt is kept of: a retry runs it again for the viewer it is cut for",
      "vehicleCalendarBoard" in receipts and literal is not None and '"vehicleCalendarBoard"' in literal.group(1))
check("…while every write keeps its receipt, so a re-send lands once",
      not (WRITES & set(receipts)), sorted(WRITES & set(receipts)))

print(f"\nvehicle calendar relay: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
