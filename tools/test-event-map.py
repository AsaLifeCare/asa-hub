#!/usr/bin/env python3
"""Settings › Events (app/event_switches.py) and the signals app/live_notify.py answers, run here on stand-ins.
- Every wake the app raises has a row in the map. Every row that is not retired has an owner that answers it.
- No signal opens a connection to the relay.
- Each live signal runs its owner, and is dropped when its switch is off.
- A retired one is never run.
- The held roster's mockup row reports whether it was kept.
- The sheet keeper is woken on the worker.
Nothing is written and no database is asked.

    python3 tools/test-event-map.py
"""
from __future__ import annotations

import json
import re
import sys
import threading
import types
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:200]}"


# ---- static: the map covers what the code raises ---------------------------------------------------------------------
src = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
consts = {"SHEET_SYNC": "sheet-sync", "ACCESS_WRITTEN": "access-written"}
raised: set[str] = set()
for text in src.values():
    for lit in re.findall(r"wake=\[([^\]]*)\]", text):
        for tok in re.findall(r'"([a-z_-]+)"|([A-Z_]+)', lit):
            raised.add(tok[0] or consts.get(tok[1], tok[1]))
    for c in re.findall(r"wake\((ACCESS_WRITTEN|SHEET_SYNC)\)", text):
        raised.add(consts[c])
owners = {m for text in src.values() for m in re.findall(r'LOCAL_WAKES\["([a-z_-]+)"\]', text)}

import event_switches as ES  # noqa: E402

wake_rows = {k.partition(":")[2] for k in ES.KEYS if k.startswith("wake:")}
check("every wake the app raises has a row in the map", raised <= wake_rows, sorted(raised - wake_rows))
live_wakes = {k.partition(":")[2] for k in ES.KEYS - ES.RETIRED if k.startswith("wake:")}
check("every live wake has an owner that answers it", live_wakes <= owners, sorted(live_wakes - owners))
check("sched_lanes answers the published and the held roster",
      "LOCAL_SIGNALS.update(roster=_roster_moved, held_roster=_held_kept)" in src["sched_lanes.py"])
check("live_notify names no relay address", "asa-hub-snapshot" not in src["live_notify.py"]
      and "/lanes/told" not in src["live_notify.py"] and "/live-notify/told" not in src["live_notify.py"])

# ---- in-process, every connection watched ----------------------------------------------------------------------------
opened: list[str] = []


class _Res:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self) -> bytes:
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(req, *a, **k):
    url = getattr(req, "full_url", str(req))
    opened.append(url)
    return _Res(b'{"woken": true}')


urllib.request.urlopen = _urlopen
published: list[str] = []
sys.modules["live_events"] = types.SimpleNamespace(publish=lambda name: published.append(name))
marks: list = []
sys.modules["live_finish"] = types.SimpleNamespace(merge_marks=lambda m: marks.append(m))
sys.modules["live_slices"] = types.SimpleNamespace(mark_dirty=lambda names: [])

ES.read_rows = lambda: dict(ROWS)
ROWS: dict[str, dict] = {}
import live_notify as LN  # noqa: E402

woke: list[str] = []
for name in ("notices", "attendance", "calloff_road", "sms-ears"):
    LN.LOCAL_WAKES[name] = (lambda n: lambda: woke.append(n))(name)
signals: list = []
LN.LOCAL_SIGNALS["roster"] = lambda body: signals.append(("roster", body))
LN.LOCAL_SIGNALS["held_roster"] = lambda body: signals.append(("held", body)) or True


def settle() -> None:
    for t in list(threading.enumerate()):
        if t.name in ("live-tell", "event-switches"):
            t.join(2)


def switches(rows: dict[str, dict]) -> None:
    ROWS.clear()
    ROWS.update(rows)
    ES._HELD.update(next=0.0, busy=False)
    ES.refresh()


switches({})
LN.tell(wake=["notices"], events=["housecal"], forget=["time_off"])
settle()
check("a wake runs its own clock here", woke == ["notices"], woke)
check("a rung name is told to the open screens here", published == ["housecal"], published)
LN.told(rang=["smartcomms"], swept=["staff-candidates"], wake=["access-written"])
check("a retired wake runs nothing", woke == ["notices"], woke)
check("a swept pack is marked here", marks and marks[-1]["swept"][0][0] == "staff-candidates", marks)
got = LN.tell_now(held_roster={"location": "H1", "cells": [{"a": 1}], "via": "v", "actor": "x", "act": "a",
                               "switch": {"on": True}})
check("the held roster's mockup row is kept here, and says so", got.get("held_kept") is True and signals[-1][0] == "held",
      got)
LN.tell(roster={"location": "H1", "cells": []})
settle()
check("a published roster is answered here", signals[-1][0] == "roster", signals)
LN.lane({"test_mode": {"on": True}})

switches({"wake:notices": {"enabled": False, "set_by": "m", "set_at": ""},
          "ring:*": {"enabled": False, "set_by": "m", "set_at": ""},
          "roster:held": {"enabled": False, "set_by": "m", "set_at": ""}})
woke.clear()
published.clear()
LN.tell(wake=["notices", "attendance"], events=["housecal"])
settle()
check("a wake switched off is dropped, the others still run", woke == ["attendance"], woke)
check("rings switched off are dropped", published == [], published)
got = LN.tell_now(held_roster={"location": "H1", "cells": [], "via": "", "actor": "", "act": "", "switch": {}})
check("a held roster switched off is not kept, and says so", got.get("held_kept") is False, got)
check("a retired signal stays off whatever its row says",
      ES.allowed("lane:config") is False and ES.allowed("forget:time_off") is False)

LN.SHEET_SYNC_WAKE_S = 0.0
LN.told(wake=["sheet-sync"])
for t in list(threading.enumerate()):
    if isinstance(t, threading.Timer):
        t.join(2)
check("the sheet keeper is woken on the worker", any(u.endswith("asa-hub-worker:8091/sheet-sync/wake") for u in opened),
      opened)
check("no signal opened a connection to the relay", not any("asa-hub-snapshot" in u for u in opened), opened)

view = ES.view()
check("the map lists every signal, the relay's own ones retired",
      len(view["events"]) == len(ES.CATALOG) and view["retired"] == len(ES.RETIRED) and view["relay"] == "told nothing"
      and all(not e["enabled"] for e in view["events"] if e["retired"]), view["retired"])

failed = [k for k, v in results.items() if v != "ok"]
print(json.dumps({"results": results, "failed": failed}, indent=1))
sys.exit(1 if failed else 0)
