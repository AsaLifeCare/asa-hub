#!/usr/bin/env python3
"""asa-hub-app's app packs (app/app_packs.py) and the finish that marks them (app/live_finish.py), on stand-ins of the
session verdicts, App Control's gate, Python's pack doors, the relay's memory and the live stream, inside
asa-hub-snapshot (which has fastapi and starlette; asa-hub-app is never exec'd into), with the slices, the users and
the pack folder in a scratch directory of its own — never the relay's /srv/app-packs.

A pack is filled once for a waiting reader, held, kept on disk 0600 and served from memory to a peek; the master
keeps the edit panels, anyone else released the app is cut of them and of what Settings › My Work hides; refusals:
unreleased, a visit, no session, a switched session, a bad key. A client-role session's own view is its own client's.
A write Python kept makes its pack dirty, rings its app to the relay's memory first, fills it again and rings the
kept copy that changed; an answer the relay carried marks the pack and tells nothing; an App Control save writes the
who-reads-what mark beside the packs and wakes the relay's access copy and sheet keeper; a restart takes the kept
packs up stale; the warm pass fills the houses and the client accounts' own slots.

    python3 tools/test-app-packs-app.py

(tools/test-app-packs.py is the relay's own pack store, offline.)
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"
MODULES = ("app_packs", "live_finish", "badge_follows")

DRIVER = r'''
import asyncio, base64, hashlib, importlib.abc, importlib.util, json, os, stat, sys, tempfile, time, types, urllib.parse
from dataclasses import dataclass

blob = json.loads(sys.stdin.read())
SRC = {k: base64.b64decode(v).decode() for k, v in blob["app"].items()}
WORK = tempfile.mkdtemp(prefix="app-packs-")
OUT, PACKS = os.path.join(WORK, "snapshot"), os.path.join(WORK, "packs")
os.makedirs(OUT); os.makedirs(PACKS)
os.environ.update({"HUB_SNAPSHOT_OUT": OUT, "HUB_APP_PACK_DIR": PACKS, "HUB_APP_PACK_DEFAULT_DIR": PACKS,
                   "HUB_BUNDLE_DIR": os.path.join(WORK, "bundles"),
                   "HUB_RESOLVER_MANIFEST": os.path.join(WORK, "resolver-manifest.json")})
json.dump({"actions": {"clientProfileSave": {"lane": "write", "file": "ClientProfiles.gs"}}},
          open(os.environ["HUB_RESOLVER_MANIFEST"], "w"))
CLIENT = "janedoe"
def slice_(name, rows):
    json.dump({"rows": rows}, open(os.path.join(OUT, name + ".json"), "w"))
slice_("clients", [{"client_key": CLIENT, "name": "Jane Doe", "house": "AB123", "status": "active",
                    "ssa_name": "Sam Agent"}])
slice_("houses", [{"code": "AB123", "active": True}, {"code": "ZZ999", "active": False}])
slice_("people", [{"name": "Ann Staff", "status": "active", "role": "staff"}])
slice_("candidates", []); slice_("potentialClients", [])

from fastapi.responses import Response

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"), flush=True)

# ---- stand-ins -------------------------------------------------------------------------------------------------------
scope = types.ModuleType("scope"); scope.BADGE_FOLLOWS = {"SUPERVISOR": "DIRECTOR"}
gsjs = types.ModuleType("gsjs"); gsjs.str_ = lambda v: "" if v is None else str(v)
health = types.ModuleType("live_health"); health.engine_build = lambda: ""

@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False
    @property
    def master(self):
        return self.ok and self.role == "admin" and not self.acting and self.is_master

SESSIONS = {"master": Session(True, "admin", "u-m", True), "staff": Session(True, "staff", "u-s"),
            "other": Session(True, "staff", "u-o"), "switched": Session(True, "staff", "u-s", acting=True),
            "client": Session(True, "client", "u-c")}
RELEASED = {"u-s": {"client-profiles"}}
USERS = [{"userid": "u-c", "role": "client", "active": True, "types": "CLIENT", "clientkey": CLIENT},
         {"userid": "u-g", "role": "client", "active": True, "types": "CLIENT, GUARDIAN", "clientkey": "other"}]
CALLS, FILLS = [], {}

fd = types.ModuleType("front_door"); fd.Session = Session
async def call_app(app_id, action, user, payload, write_id="", at=0.0):
    CALLS.append((app_id, action, dict(payload), dict(user)))
    if action == "myWorkHidesMine":
        env = {"status": 200, "data": {"client_medication": True, "client_billing": False, "client_care_home": False}}
    elif action == "appReleaseNoticed":
        env = {"status": 200, "data": {"told": 1}}
    elif action.endswith("Pack"):
        key = next(iter(payload.values()))
        n = FILLS[(action, key)] = FILLS.get((action, key), 0) + 1
        parts = {"details": {"name": key, "n": n}, "edit_details": {"raw": key}, "meds": [{"m": 1}],
                 "roster_own": {"me": key}}
        env = {"status": 200, "data": {"client": key, "parts": parts,
                                       "part_status": {p: {"status": 200} for p in parts}}}
    else:
        env = {"status": 404, "message": "Unknown action."}
    return json.dumps(env).encode(), time.time(), env, None, 0.0
fd.call_app = call_app

lg = types.ModuleType("lane_gate")
lg.query = lambda request, name: str(request.query_params.get(name) or "")
def token_of(request):
    a = str(request.headers.get("authorization") or "")
    return a[7:].strip() if a.lower().startswith("bearer ") else ""
lg.token_of = token_of
async def session(token): return SESSIONS.get(token) if token else None
lg.session = session
lg.is_master = lambda s: s is not None and s.master
lg.actor = lambda s: (s.role, s.uid) if s is not None and s.ok else None
async def released(s, app_id, floor=None): return s is not None and app_id in RELEASED.get(s.uid, set())
lg.released = released
async def gate(s, app_id, *, refuse_roles=(), app_label=""):
    return (s.role, s.uid) if s is not None and s.ok and s.role not in refuse_roles else {"status": 403, "reason": "badge"}
lg.gate = gate
class Reads:
    def users(self): return [dict(u) for u in USERS]
lg.in_reads = lambda fn: fn(Reads())
def answer(env, *, no_store=False):
    body = json.dumps(env, ensure_ascii=False, allow_nan=False, separators=(",", ":"), default=str).encode("utf-8")
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "no-store"} if no_store else None)
lg.answer = answer

TOLD, PUBLISHED, DIRTY = [], [], []
notify = types.ModuleType("live_notify")
def told(rang=(), swept=(), wake=()):
    TOLD.append({"rang": sorted(rang), "swept": sorted(swept), "wake": sorted(wake)})
    for name in rang:
        PUBLISHED.append((name, False))
notify.told = told
events = types.ModuleType("live_events")
events.publish = lambda name, kept_copy=False: PUBLISHED.append((name, kept_copy))
slices = types.ModuleType("live_slices")
slices.mark_dirty = lambda names: DIRTY.extend(names) or list(names)
gate_mod = types.ModuleType("hotline_gate"); gate_mod.note_access_written = lambda: None

for name, mod in (("scope", scope), ("gsjs", gsjs), ("live_health", health), ("front_door", fd), ("lane_gate", lg),
                  ("live_notify", notify)):
    sys.modules[name] = mod

class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None
    def create_module(self, spec): return None
    def exec_module(self, module):
        module.__file__ = os.path.join(WORK, module.__name__ + ".py")
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)
sys.meta_path.insert(0, Loader())
TABLES = json.loads(blob["tables"])
import live_finish as LF, app_packs as AP
LF.TABLES.update(TABLES)
LF.FD, LF.EVENTS, LF.SLICES, LF.GATE, LF.PACKS, LF.NOTIFY = fd, events, slices, gate_mod, AP, notify
AP.wire(TABLES)

class Req:
    def __init__(self, token="", key="", **query):
        self.headers = {k: v for k, v in (("authorization", f"Bearer {token}" if token else ""),
                                          ("x-app-pack-key", urllib.parse.quote(key))) if v}
        self.query_params = query
def said(res):
    return json.loads(res.body), res.headers.get("cache-control")
form = lambda env: ("body=" + urllib.parse.quote(json.dumps(env))).encode()

async def main():
    # 1. a waiting reader's fill, then memory
    got, cache = said(await AP.lane_app_pack("client-profiles", Req("master", CLIENT, wait="4")))
    check("the master's read fills the pack and is answered fresh, no-store",
          got.get("status") == 200 and got["data"]["state"] == "fresh" and "edit_details" in got["data"]["parts"]
          and cache == "no-store" and FILLS.get(("clientPack", CLIENT)) == 1, got)
    check("... filled for the service's identity, the key under the app's own name",
          CALLS[-1][:3] == ("clients", "clientPack", {"client": CLIENT}) and CALLS[-1][3] == {"is_service": True},
          CALLS[-1:])
    path = os.path.join(PACKS, hashlib.sha256(f"client-profiles\n{CLIENT}".encode()).hexdigest() + ".json")
    for _ in range(50):
        if os.path.exists(path):
            break
        await asyncio.sleep(0.02)
    check("... kept on disk under a hash of its key, 0600",
          os.path.exists(path) and stat.S_IMODE(os.stat(path).st_mode) == 0o600
          and json.load(open(path))["key"] == CLIENT, os.listdir(PACKS))
    n = len(CALLS)
    got, _ = said(await AP.lane_app_pack("client-profiles", Req("master", CLIENT, peek="1")))
    check("a peek is answered from memory, nothing asked", got["data"]["state"] == "fresh" and len(CALLS) == n, got)
    # 2. who may read it
    got, _ = said(await AP.lane_app_pack("client-profiles", Req("staff", CLIENT, peek="1")))
    parts = got.get("data", {}).get("parts", {})
    check("a session the app is released to is cut of the edit panels and of what My Work hides",
          got.get("status") == 200 and "details" in parts and "edit_details" not in parts and "meds" not in parts
          and "meds" not in got["data"]["part_status"], got)
    refusals = [said(await AP.lane_app_pack("client-profiles", r))[0] for r in (
        Req("other", CLIENT), Req("master", CLIENT, member="x"), Req("", CLIENT), Req("switched", CLIENT),
        Req("master", "bad key!"))]
    check("refused: unreleased, a visit, no session, a switched session, a bad key",
          [(e.get("status"), e.get("reason")) for e in refusals] == [
              (404, "unknown"), (403, "visit"), (401, "session"), (404, "unknown"), (400, "key")], refusals)
    # 3. a client's own view
    got, _ = said(await AP.lane_app_pack_own("client-profiles", Req("client", peek="1")))
    check("a client-role session's own view is its own client's parts, My Work's hidden ones left out",
          got.get("status") == 200 and got["data"]["client"] == CLIENT
          and got["data"]["parts"].get("roster") == {"me": CLIENT} and "meds" not in got["data"]["parts"], got)
    got, _ = said(await AP.lane_app_pack_own("client-profiles", Req("staff", peek="1")))
    check("... and no view for a session that is not a client's", got.get("status") == 404, got)
    # 4. a write Python kept: dirty, rung to the relay's memory first, filled again, the changed copy rung
    TOLD.clear(); PUBLISHED.clear()
    raw = form({"action": "clientProfileSave", "token": "master", "payload": {"client": CLIENT, "changes": []}})
    with LF.Raised():
        LF.final_landed("clientProfileSave", raw, b'{"status": 200, "data": {}}')
    check("the landing marks the key and the pack dirty at once",
          (("client-profiles", CLIENT) in LF.MARKS["touched"]) and AP._app_pack_held[("client-profiles", CLIENT)]["dirty"],
          LF.MARKS["touched"])
    check("... its app rung through the relay's memory", TOLD and "app:client-profiles" in TOLD[0]["rang"], TOLD)
    for _ in range(100):
        if FILLS.get(("clientPack", CLIENT)) == 2 and ("app:client-profiles", True) in PUBLISHED:
            break
        await asyncio.sleep(0.02)
    check("... filled again, the copy that changed rung as a kept copy",
          FILLS.get(("clientPack", CLIENT)) == 2 and ("app:client-profiles", True) in PUBLISHED, (FILLS, PUBLISHED))
    check("... the final write's moment kept beside its mark",
          LF.MARKS["final_at"].get(("client-profiles", CLIENT), 0) >= LF.MARKS["touched"][("client-profiles", CLIENT)],
          LF.MARKS["final_at"])
    # 5. an answer the relay carried: marked here, nothing told or rung
    TOLD.clear(); PUBLISHED.clear()
    at = LF.MARKS["touched"][("client-profiles", CLIENT)]
    await asyncio.sleep(0.01)
    LF.carried("clientProfileSave", raw, b'{"status": 200, "data": {}}')
    await asyncio.sleep(0.05)
    check("an answer the relay carried marks the pack here and tells nothing",
          LF.MARKS["touched"][("client-profiles", CLIENT)] > at and not TOLD
          and not [p for p in PUBLISHED if not p[1]], (TOLD, PUBLISHED))
    # 6. an App Control save: the who-reads-what mark beside the packs, the relay's copies woken, Python told
    TOLD.clear()
    araw = form({"action": "appBadgeAccessSet", "token": "master", "payload": {"app_id": "x", "badges": ["HM"]}})
    began = time.time()
    with LF.Raised():
        LF.app_control_landed("appBadgeAccessSet", araw, b'{"status": 200, "data": {}}')
    await asyncio.sleep(0.05)
    mark = json.load(open(os.path.join(PACKS, "who-reads-what.json")))
    check("an App Control save writes who reads what beside the packs",
          mark.get("v") == 1 and mark["at"] >= began, mark)
    check("... wakes the relay's access copy and sheet keeper",
          TOLD and set(TOLD[0]["wake"]) == {"access-written", "sheet-sync"}, TOLD)
    check("... and hands the save to Python's release announcement",
          any(c[1] == "appReleaseNoticed" for c in CALLS), CALLS[-2:])
    # 7. a restart: the kept packs taken up stale
    await asyncio.sleep(0.2)
    AP._app_pack_held.clear(); AP._app_pack_gen.clear(); LF.MARKS["touched"].clear(); LF.MARKS["void"].clear()
    taken = await AP._app_pack_adopt_disk()
    held = AP._app_pack_held.get(("client-profiles", CLIENT))
    check("a restart takes the kept pack up stale", taken >= 1 and held and held["stale"] and held["lane"] == "disk",
          (taken, held and {k: held[k] for k in ("stale", "lane")}))
    # 8. the warm pass: the houses and the client accounts' own slots
    n = len(CALLS)
    await AP._app_pack_warm_pass()
    asked = {(c[1], json.dumps(c[2], sort_keys=True)) for c in CALLS[n:]}
    check("the warm pass fills the active houses and the client account's own views",
          ("locationPack", '{"house": "AB123"}') in asked and ("staffClientPack", '{"client": "janedoe"}') in asked
          and ("clientPack", '{"client": "janedoe"}') in asked and not any("ZZ999" in a[1] for a in asked)
          and not any('"other"' in a[1] for a in asked), sorted(asked))

asyncio.run(main())
__import__("shutil").rmtree(WORK, ignore_errors=True)
print(f"{sum(ok for _n, ok in results)} ok, {sum(not ok for _n, ok in results)} failed", flush=True)
sys.exit(0 if all(ok for _n, ok in results) else 1)
'''


def main() -> int:
    blob = {"app": {m: base64.b64encode((ROOT / "app" / f"{m}.py").read_bytes()).decode() for m in MODULES},
            "tables": (ROOT / "app" / "live_plane.json").read_text()}
    proc = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=json.dumps(blob).encode(),
                          timeout=300)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
