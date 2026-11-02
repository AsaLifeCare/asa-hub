#!/usr/bin/env python3
"""Support Requests' missing punches on the relay: punch_pairs.first_faults hands facts only, and only real faults;
snapshot_service._support_punch_post posts a set once, again only when it changes or the door did not take it.
Pure: no database, no network, no door — the post is lifted out of the relay's source and run against stand-ins.

    python3 tools/test-support-punch.py
"""
import ast
import asyncio
import hashlib
import json
import logging
import sys
import time
import types
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))
import punch_pairs as pp  # noqa: E402

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


def pair(sid, verdict, fault, **over):
    base = {"id": sid, "ref": pp.ref_of(sid), "person": "Cy Far", "person_key": "cyfar", "keys": {"cyfar"},
            "house": "BM4060", "house_name": "BM home", "shift_code": "8A-4P", "day": "2026-09-25",
            "shift_at": "2026-09-25T08:00:00-04:00", "shift_end": "2026-09-25T16:00:00-04:00", "time": "8:00 AM",
            "ends": "4:00 PM", "verdict": verdict, "why": "a sentence", "fault": fault,
            "read_at": "2026-09-25T09:10:00-04:00", "told_kind": "", "told_source": "", "doubles": [],
            "entry_id": "E1", "entry_ids": ["E1"], "punched_in": "8:02 AM", "punched_out": "", "covers": []}
    base.update(over)
    return base


print("\nfirst_faults: facts only, real faults only")
PAIRS = [
    pair("cyfar|2026-09-25T12:00:00+00:00", pp.MISSING, True),
    pair("dee|2026-09-25T12:00:00+00:00", pp.OPEN, True, person="Dee Way", person_key="deeway",
         shift_at="2026-09-24T20:00:00-04:00", shift_end="2026-09-25T08:00:00-04:00"),
    pair("a", pp.MISSING, False),                        # read before the no-call line: not yet a fault
    pair("b", pp.OPEN, False),                           # still on the clock
    pair("c", pp.COVERED, True),                         # one entry for two shifts: not a missing punch
    pair("d", pp.TOLD, False), pair("e", pp.DOUBLE, False), pair("f", pp.UNREADABLE, False),
    pair("g", pp.PAIRED, False),
    pair("", pp.MISSING, True),                          # a shift with no id cannot be raised once
    {"id": "h", "verdict": "not_entered_yet", "pair_fault": True},   # a board row: the clock's word, not a fault
    {"id": "i", "verdict": pp.MISSING, "pair_fault": True, "fault": False, "person": "Board Row"},
    {"id": "j", "verdict": pp.MISSING, "pair_fault": "yes"},
    "not a row",
]
FF = pp.first_faults(PAIRS)
check("a shift with no entry of its own and one never clocked out are the faults; nothing else ever is",
      [r["id"] for r in FF] == ["cyfar|2026-09-25T12:00:00+00:00", "dee|2026-09-25T12:00:00+00:00", "i"],
      [r["id"] for r in FF])
check("each is the facts the door is given, exactly: no why, no entry, no keys, no told-by",
      all(tuple(r) == pp.FIRST_FAULT_FIELDS for r in FF)
      and pp.FIRST_FAULT_FIELDS == ("id", "person", "person_key", "house", "house_name", "shift_code", "shift_at",
                                    "shift_end", "verdict", "pair_fault", "read_at"),
      [sorted(r) for r in FF])
check("…every value a string, the fault always said true",
      all(r["pair_fault"] is True and all(isinstance(v, str) for k, v in r.items() if k != "pair_fault") for r in FF)
      and FF[1] == {"id": "dee|2026-09-25T12:00:00+00:00", "person": "Dee Way", "person_key": "deeway",
                    "house": "BM4060", "house_name": "BM home", "shift_code": "8A-4P",
                    "shift_at": "2026-09-24T20:00:00-04:00", "shift_end": "2026-09-25T08:00:00-04:00",
                    "verdict": "open", "pair_fault": True, "read_at": "2026-09-25T09:10:00-04:00"}, FF)
check("a board row's own fault word decides over the pairing's, and only a real true counts",
      [r["id"] for r in pp.first_faults([PAIRS[10], PAIRS[11], PAIRS[12]])] == ["i"])
check("nothing to read is nothing handed over", pp.first_faults([]) == [])
with pp._LOCK:
    pp._P.update(at=time.time(), rows=[dict(r) for r in PAIRS if isinstance(r, dict)], counts={}, why="")
check("with nothing given it reads the last pairing, and never changes it",
      pp.first_faults() == pp.first_faults([r for r in PAIRS if isinstance(r, dict)]) and len(pp.rows()) == 13)

print("\nthe post: transport only, once per set")
svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return ast.get_source_segment(svc, node) or ""
    return ""


CLOCK = [1_000_000.0]
SENT: list = []
ANSWER: dict = {"env": {"status": 200, "data": {"ok": True, "raised": 2, "already": 0, "off": False, "why": ""}}}


async def _support_punch_passes(rows):
    """Python's supportDeskPunch, pass after pass (its own suite runs the passes): what the door answers."""
    SENT.append(({"action": "supportDeskPunch", "payload": {"rows": rows}}, {}))
    got = ANSWER["env"]
    if isinstance(got, Exception):
        raise got
    return json.loads(json.dumps(got))


RUNG: list = []
ns = {"Any": Any, "hashlib": hashlib, "log": logging.getLogger("test"), "_support_punch_passes": _support_punch_passes,
      "time": types.SimpleNamespace(time=lambda: CLOCK[0]), "_publish_slice": RUNG.append,
      "SUPPORT_PUNCH_APP": "support-punch"}
for name in ("SUPPORT_DESK_EVENT", "_SUPPORT_PUNCH", "SUPPORT_PUNCH_MAX", "SUPPORT_PUNCH_OFF_RETRY_S",
             "_support_punch_digest", "_support_punch_post"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source


def beat():
    before = len(SENT)
    asyncio.run(ns["_support_punch_post"]())
    return SENT[before:]


def set_pairs(rows, at=None):
    with pp._LOCK:
        pp._P.update(at=time.time() if at is None else at, rows=[dict(r) for r in rows], counts={}, why="")


TWO = [PAIRS[0], PAIRS[1], PAIRS[2]]
set_pairs(TWO)
first = beat()
check("the first beat with faults posts them once, to Python's supportDeskPunch",
      len(first) == 1 and first[0][0]["action"] == "supportDeskPunch"
      and [r["id"] for r in first[0][0]["payload"]["rows"]] == ["cyfar|2026-09-25T12:00:00+00:00",
                                                                "dee|2026-09-25T12:00:00+00:00"], first)
check("…and the payload is the facts alone", all(tuple(r) == pp.FIRST_FAULT_FIELDS
                                                 for r in first[0][0]["payload"]["rows"]))
check("a post that raised something rings the open Support Requests screens, once", RUNG == ["support-desk"], RUNG)
check("the same set on the next beat is not posted again", beat() == [] and beat() == [])
set_pairs([pair("cyfar|2026-09-25T12:00:00+00:00", pp.OPEN, True), PAIRS[1]])
check("a shift that turns from no entry to an entry never clocked out is offered again", len(beat()) == 1)
check("…once", beat() == [])
set_pairs([PAIRS[0], PAIRS[1], pair("eli|x", pp.MISSING, True)])
RUNG.clear()
ANSWER["env"] = {"status": 503, "message": "Support Requests' houses are not set up yet."}
check("a refusal keeps the last set taken, so the next beat offers it again",
      len(beat()) == 1 and len(beat()) == 1)
ANSWER["env"] = RuntimeError("down")
check("…so does a door that could not be reached", len(beat()) == 1 and len(beat()) == 1)
ANSWER["env"] = {"status": 200, "data": {"ok": False, "why": "unreadable"}}
check("…and an answer that is not ok", len(beat()) == 1 and len(beat()) == 1)
ANSWER["env"] = {"status": 200, "data": {"ok": True, "raised": 0, "already": 0, "off": True,
                                         "why": "the switch is off"}}
check("a switch that is off is asked again only after its wait, never every beat",
      len(beat()) == 1 and beat() == [] and beat() == [])
check("…and a refusal, an unreachable door or a post that raised nothing rings nobody", RUNG == [], RUNG)
CLOCK[0] += ns["SUPPORT_PUNCH_OFF_RETRY_S"] + 1
check("…then asked again", len(beat()) == 1 and beat() == [])
set_pairs([PAIRS[0]])
check("…while a set that changed is asked at once", len(beat()) == 1)
ANSWER["env"] = {"status": 200, "data": {"ok": True, "raised": [1], "already": 1, "off": False, "why": ""}}
check("a switch turned on is seen at the end of the wait, not before", beat() == [])
CLOCK[0] += ns["SUPPORT_PUNCH_OFF_RETRY_S"] + 1
check("once the door takes a set it is not posted again", len(beat()) == 1 and beat() == [])
set_pairs([PAIRS[0]], at=time.time() - pp.STALE_S - 60)
check("nothing is posted from a pairing too old to act on", beat() == [])
set_pairs([PAIRS[2], PAIRS[3]])
check("no fault posts nothing", beat() == [])
set_pairs([PAIRS[0]])
check("…and a fault that comes back after the set emptied is offered again", len(beat()) == 1)
MANY = [pair(f"p{i:03d}", pp.MISSING, True, shift_at=f"2026-09-25T{i % 24:02d}:{i % 60:02d}:00-04:00")
        for i in range(ns["SUPPORT_PUNCH_MAX"] + 30)]
set_pairs(MANY)
big = beat()
check("a post carries at most the cap, newest shifts first",
      len(big) == 1 and len(big[0][0]["payload"]["rows"]) == ns["SUPPORT_PUNCH_MAX"] == 200
      and [r["shift_at"] for r in big[0][0]["payload"]["rows"]]
      == sorted((r["shift_at"] for r in big[0][0]["payload"]["rows"]), reverse=True))

print("\nwhere the relay calls it, and what it never does")
check("the post rides the attendance beat right after the punch pairs' own",
      "        await _punch_pairs_post()\n        await _support_punch_post()\n" in svc
      and svc.count("await _support_punch_post()") == 1)
check("the relay names the door once, in Python's passes, and decides nothing: no switch, no recipient, no text",
      svc.count('"supportDeskPunch"') == 1 and '"supportDeskPunch"' in segment("_support_punch_passes")
      and not any(w in segment(fn) for fn in ("_support_punch_post", "_support_punch_passes")
                  for w in ("smartTell", "mywork_auto", "Ty Bond", "phone")))
no_receipt: dict = {}
exec(segment("RELAY_NO_RECEIPT_ACTIONS"), no_receipt)  # noqa: S102
check("Support Requests' list and My Calendar's vacation route are reads no receipt is kept of",
      {"supportDeskList", "myCalendarVacationRoute"} <= no_receipt["RELAY_NO_RECEIPT_ACTIONS"]
      and "supportDeskDecide" not in no_receipt["RELAY_NO_RECEIPT_ACTIONS"])
POST_SRC = segment("_support_punch_post")
LOG_LINES = [chunk.split(")\n")[0] for chunk in POST_SRC.split("log.")[1:]]
LEAKS = ("r.get(", "rows[", "person", "shift_at", "said.get(\"why")
check("the log says counts and kinds of error, never a person or a shift",
      len(LOG_LINES) >= 5 and not any(w in line for line in LOG_LINES for w in LEAKS), LOG_LINES)

print(f"\nsupport punch: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
