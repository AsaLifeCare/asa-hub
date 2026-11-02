#!/usr/bin/env python3
"""Dump the real lanes door's answers, built in the relay against fake books, for the offline contract test."""
import base64
import hashlib
import json
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("hotline_desk", "hotline_lanes")
FIXTURE = "tools/hotline-lanes-door.json"
# by position, so renaming a lane changes nothing here
READS, HOLDS_A_COPY, NEVER_READ = 0, 1, 2


def _root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run_in_container() -> int:
    server = os.path.join(_root(), "server")
    sources = {}
    for name in MODULES:
        path = os.path.join(server, name + ".py")
        if not os.path.exists(path):
            print(f"server/{name}.py is not in this tree — "
                  "the two halves of the lanes door ship together.")
            return 2
        with open(path, encoding="utf-8") as fh:
            sources[name] = fh.read()
    with open(os.path.abspath(__file__), encoding="utf-8") as fh:
        body = fh.read()
    blob = base64.b64encode(json.dumps(sources).encode()).decode()
    script = f"HOTLINE_LANES_SOURCES = {blob!r}\n" + body
    try:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        print("docker is not available here — the dump cannot be rebuilt.")
        return 2
    sys.stderr.write(proc.stderr[-4000:])
    out = proc.stdout
    if "DOOR_JSON_BEGIN" not in out or proc.returncode:
        sys.stdout.write(out[-4000:])
        return proc.returncode or 1
    sys.stdout.write(out.split("DOOR_JSON_BEGIN")[0])
    body = json.loads(out.split("DOOR_JSON_BEGIN")[1].split("DOOR_JSON_END")[0].strip())
    module = os.path.join(server, "hotline_lanes.py")
    with open(module, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    dump = {
        "what": "GET /hub-lanes/hotline/lanes, answered by the real module against fake books",
        "built_by": "tools/emit-hotline-lanes-door.py",
        "read_by": "tools/test-hotline-lanes-contract.mjs",
        "module": {"path": "server/hotline_lanes.py", "sha256": digest},
        "surface": body["surface"],
        "answers": body["answers"],
    }
    path = os.path.join(_root(), FIXTURE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(dump, fh, indent=1, sort_keys=False)
        fh.write("\n")
    print(f"{FIXTURE}: lanes {', '.join(body['surface']['lane_keys'])} — "
          f"{', '.join(sorted(body['answers']))}")
    return 0


def main_inside() -> int:
    import asyncio
    import importlib.abc
    import importlib.util
    import time
    import types

    sources = json.loads(base64.b64decode(HOTLINE_LANES_SOURCES))  # noqa: F821

    class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path, target=None):
            if name in sources:
                return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
            return None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            module.__file__ = "/srv/app/" + module.__name__ + ".py"
            exec(compile(sources[module.__name__], "checkout/" + module.__name__ + ".py", "exec"),
                 module.__dict__)

    sys.meta_path.insert(0, Checkout())
    sys.path.insert(0, "/srv/app")
    import hotline_desk as desk  # noqa: E402
    import hotline_lanes as lanes  # noqa: E402

    class Refused(Exception):
        def __init__(self, status):
            self.resp = types.SimpleNamespace(status=status)
            super().__init__(f"HTTP {status}")

    class Tab:
        def __init__(self, zone, header, rows):
            self.zone, self.header, self.rows = zone, list(header), [list(r) for r in rows]
            self.error = None

    class FakeSheets:
        def __init__(self, tabs):
            self.tabs = tabs

        def __call__(self, *a, **kw):
            return self

        def spreadsheets(self):
            return self

        def values(self):
            return self

        def _tab(self, sheet_id):
            tab = self.tabs.get(sheet_id)
            if tab is None:
                raise Refused(404)
            if tab.error is not None:
                raise tab.error
            return tab

        def get(self, spreadsheetId=None, ranges=None, includeGridData=None, fields=None):
            def run(num_retries=0):
                tab = self._tab(spreadsheetId)
                return {"properties": {"timeZone": tab.zone},
                        "sheets": [{"data": [{"rowData": [
                            {"values": [{"formattedValue": h} for h in tab.header]}]}]}]}
            return types.SimpleNamespace(execute=run)

        def batchGet(self, spreadsheetId=None, ranges=None, majorDimension=None,
                     valueRenderOption=None, dateTimeRenderOption=None):
            def run(num_retries=0):
                tab = self._tab(spreadsheetId)
                out = []
                for rng in ranges or []:
                    letters = rng.split("!")[-1].split(":")[0]
                    idx = 0
                    for ch in letters:
                        idx = idx * 26 + (ord(ch) - 64)
                    idx -= 1
                    col = [tab.header[idx] if idx < len(tab.header) else ""]
                    col += [(r[idx] if idx < len(r) else "") for r in tab.rows]
                    while col and col[-1] == "":
                        col.pop()
                    out.append({"values": [col]})
                return {"valueRanges": out}
            return types.SimpleNamespace(execute=run)

    def cell(lane, key, n):
        if key in lane.dates:
            return 0.5486111111094942 if key.endswith("_time") else 46270.580718831014 + n
        if key == "id":
            return f"ROW_{n + 1}"
        return f"{key} {n + 1}"

    def books():
        made = {}
        for lane in lanes.LANES:
            header = [str(c) for c in lane.fields.values()]
            rows = [[cell(lane, key, n) for key in lane.fields] for n in range(2)]
            made[lane.book.sheet_id] = Tab("America/New_York", header, rows)
        return made

    def reset(tabs):
        for key in lanes.LANE_KEYS:
            lanes._HELD[key].update({"lane": None, "at": 0.0, "task": None,
                                     "failure": "", "failed_at": 0.0})
            lanes._HELD[key]["gen"] = int(lanes._HELD[key]["gen"]) + 1
            desk._LAST_GOOD.pop(f"hotline_lane_{key}", None)
        desk._ZONES.clear()
        desk._HEADERS.clear()
        desk._QUOTA.update({"until": 0.0, "at": 0.0})
        # the depot is pinned empty, not cleared, so no lane reads the platform's database
        forget("_HEADER_AT", {})
        forget("_LOG", {"at": 0.0, "by_call": {}, "task": None})
        forget("_DEPOT", {"until": time.time() + 600, "facts": {}})
        del lanes._LANE_SERVICES[:]
        return FakeSheets(tabs)

    def forget(name, empty):
        cache = getattr(lanes, name, None)
        if cache is not None:
            cache.clear()
            cache.update(empty)

    async def run():
        answers = {}
        sheets = reset(books())
        full = await lanes.current_lanes(sheets, pg_dsn="")
        answers["full"] = full
        answers["unchanged"] = lanes.without_rows(full)

        # all three health words in one answer: read, serving its copy, never read
        tabs = books()
        keys = list(lanes.LANE_KEYS)
        tabs[lanes.LANE_BY_KEY[keys[NEVER_READ]].book.sheet_id].error = Refused(500)
        sheets = reset(tabs)
        await lanes.current_lanes(sheets, pg_dsn="")
        tabs[lanes.LANE_BY_KEY[keys[HOLDS_A_COPY]].book.sheet_id].error = Refused(500)
        answers["degraded"] = await lanes.current_lanes(sheets, pg_dsn="", max_age_s=0.0)

        lane = full["lanes"][keys[READS]]
        surface = {
            "lane_keys": list(lanes.LANE_KEYS),
            "fields": {k: list(lanes.LANE_BY_KEY[k].fields) for k in lanes.LANE_KEYS},
            "lane_words": sorted(lane),
            "answer_words": sorted(full),
        }
        return {"surface": surface, "answers": answers}

    body = asyncio.new_event_loop().run_until_complete(run())
    for key, answer in body["answers"].items():
        lanes_in = answer["lanes"]
        print(f"{key}: " + ", ".join(
            f"{k}={'ok' if v['ok'] else ('copy' if v.get('stale') else 'unreadable')}"
            for k, v in lanes_in.items()))
    print("DOOR_JSON_BEGIN")
    print(json.dumps(body))
    print("DOOR_JSON_END")
    return 0


if __name__ == "__main__":
    if "HOTLINE_LANES_SOURCES" in globals():
        sys.exit(main_inside())
    sys.exit(_run_in_container())
