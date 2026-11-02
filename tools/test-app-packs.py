#!/usr/bin/env python3
"""APP PACKS on the relay's side, offline: the door (the master's, and a released viewer nothing narrows), held in
memory and kept in a volume of the relay's own across a restart (taken up stale; a dirty, voided, refused, trimmed or
expired pack's file gone, a dirtying write's before it leaves; never under the served tree or the bundle deposit), stale across a publish, invalidation by writes
(an upload the relay does not parse included), served while refilled, never past the ceiling, a person's read never
queued behind
background work, two fills at most on a person's lane and none for a read that stops waiting before one answers, and a
bounded warm pass on the housekeeping lane."""
from __future__ import annotations

import __future__
import ast
import asyncio
import atexit
import base64
import builtins
import hashlib
import importlib.util
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import types
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
# every namespace keeps its packs in a temporary folder of its own, never the relay's, all gone at the end
KEPT_ROOT = Path(tempfile.mkdtemp(prefix="app-packs-kept-"))
atexit.register(shutil.rmtree, KEPT_ROOT, True)
os.environ["HUB_APP_PACK_DIR"] = str(KEPT_ROOT / "env" / "app-packs")
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SVC = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SVC)
# the doors only Python answers: never stamped for a receipt, each in asa-hub-app's own words
PY_DOORS: dict[str, dict] = json.loads((ROOT / "app" / "doors.json").read_text(encoding="utf-8"))
# the one rule for a live client, the relay's own module the pack code imports
_spec = importlib.util.spec_from_file_location("client_status", ROOT / "server" / "client_status.py")
CLIENT_STATUS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(CLIENT_STATUS)

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


def node_name(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    return type(node).__name__


def is_pack(name: str) -> bool:
    return name.startswith(("_app_pack", "APP_PACK", "_APP_PACK", "_AppPack")) or name in (
        "_relay_observe_app_pack", "lane_app_pack", "lane_app_pack_own")


PACK_NODES = [n for n in TREE.body if is_pack(node_name(n))]
REAL = {"_note_session_answer", "_iso", "_my_work_acting", "_my_work_learn_master", "_relay_envelope",
        "_relay_json_constant", "_relay_action"}
REAL_NODES = [n for n in TREE.body if node_name(n) in REAL]
HOUSES = ["ABD1305", "ABD1547", "ABD1711", "ABD2005", "ABD2704", "ABD4708", "BM4060", "BS4527", "EC4048", "HF2908",
          "LD4048", "MF305", "MK11787", "MS4060", "NW4045", "SB4045", "TS2745"]
NAMES = ["Kenny Marsh", "Ann Lee"]


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def time(self) -> float:
        return self.now

    def monotonic(self) -> float:
        return time.monotonic()

    def strftime(self, fmt: str, t: Any = None) -> str:
        return time.strftime(fmt, t if t is not None else time.gmtime(self.now))

    def gmtime(self, t: Any = None) -> Any:
        return time.gmtime(self.now if t is None else t)


class Records(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(record.getMessage())


RECORDS = Records()
LOG = logging.getLogger("app-packs-test")
LOG.addHandler(RECORDS)
LOG.setLevel(logging.INFO)
LOG.propagate = False
ROUTES: dict[str, Any] = {}


class Tickets(asyncio.Semaphore):
    """The relay's housekeeping semaphore, counting what is out."""

    def __init__(self, n: int) -> None:
        super().__init__(n)
        self.n = n

    @property
    def out(self) -> int:
        return self.n - self._value


class FakeApp:
    def get(self, path: str):
        def deco(fn):
            ROUTES[path] = fn
            return fn
        return deco


def build(*, sessions: dict[str, tuple[str, str]] | None = None, masters: dict[str, Any] | None = None,
          pack=None, delay: float = 0.0, out_dir: Path | None = None, wait_s: float | None = None,
          auth_delay: float = 0.0, pack_dir: Path | str | None = None, engine: str = "b1") -> dict[str, Any]:
    """A fresh relay namespace: the real app-pack code over a fake backend, a fake clock and a pack folder of its own
    (a temporary one, made as the volume would be, unless `pack_dir` names one); the bundle deposit and the default
    pack folder are temporary ones no pack is ever meant to reach."""
    clock = Clock()
    ns: dict[str, Any] = {
        "asyncio": asyncio, "json": json, "os": os, "re": re, "base64": base64, "urllib": urllib,
        "hashlib": hashlib, "tempfile": tempfile, "Path": Path,
        "Any": Any, "Response": object, "Header": lambda default="": default, "app": FakeApp(), "log": LOG,
        "time": clock, "clock": clock, "OUT_DIR": out_dir or Path(tempfile.mkdtemp(prefix="app-packs-none-")),
        "BUNDLE_DIR": Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "bundles",
        "_hotline_token": lambda a: a[7:].strip() if a.lower().startswith("bearer ") else "",
        "_auth_master": {}, "_acting": {}, "_acting_beat_at": {}, "calls": [], "live": [0], "peak": [0],
        "lane_live": {"person": 0, "housekeeping": 0}, "lane_peak": {"person": 0, "housekeeping": 0},
        "version": [1], "load_manifest": lambda: [], "_resolver_invalidates": lambda a: (), "_dirty": set(),
        "_dirty_at": 0.0, "DEBOUNCE_SECONDS": 6.0, "LEDGER_NOTIFY_RESOURCES": (), "_ENGINE_BUILD": engine,
        "_housekeeping_slots": Tickets(3), "client_status": CLIENT_STATUS,
        # the pending edits laid over a pack are the overlay's own suite (test:overlay); none here
        "edit_overlay": None,
        # Settings › My Work's switches as asa-hub-app answers them: every part shown unless a case names it in
        # hidden_parts, SSA's Documents "shown" unless a case says "hidden", none answered when it says "unanswered"
        "HUB_APP_TOKEN": "t", "ssa_docs": "shown", "hidden_parts": set(), "hides_asked": [],
    }

    async def backend_call(app_id: str, action: str, payload: dict, user: dict, extra: Any = None,
                           timeout: Any = None):
        ns["hides_asked"].append((app_id, action, dict(user)))
        if action != "myWorkHidesMine" or ns["ssa_docs"] == "unanswered":
            return None
        parts = {p: p in ns["hidden_parts"] for p in ("add_apps", "client_medication", "client_billing",
                                                      "client_care_home", "location_supplies", "profile_docs")}
        return b"", 0.0, {"status": 200, "data": {**parts, "ssa_documents": ns["ssa_docs"] == "hidden"}}, None, 0.0

    ns["_backend_call"] = backend_call
    people = sessions or {}
    flags = masters or {}

    async def session_actor(authorization: str):
        return people.get(authorization)

    def pack_lane(payload: dict) -> str:
        """The lane of the fill executing this call: a person's while its promote event holds one."""
        said = payload.get("payload") or {}
        if payload.get("action") == "familyIndexPack":
            said = {"index": "all"}
        app, field = {"clientPack": ("client-profiles", "client"), "ssaPack": ("ssa-profiles", "ssa"),
                      "familyPack": ("family-profiles", "family"), "candidatePack": ("staff-candidates", "candidate"),
                      "clientCandidatePack": ("client-candidates", "candidate"),
                      "staffClientPack": ("staff-profiles", "client"), "staffPack": ("staff-team", "staff"),
                      "familyIndexPack": ("family-index", "index")
                      }.get(payload.get("action"), ("locations", "house"))
        slot = (app, said.get(field))
        promote = ns["_app_pack_promote"].get(slot)
        return "person" if promote is not None and promote in ns["_app_pack_person_lane"] else "housekeeping"

    async def python_door(payload: dict, **kw):
        """asa-hub-app as the fake answers it: authMe for a session, a pack filled for the relay's own identity."""
        action = payload.get("action")
        ns["calls"].append({"action": action, "payload": payload.get("payload"), "kw": kw,
                            "service": action != "authMe", "tickets_out": ns["_housekeeping_slots"].out})
        if action == "authMe":
            if auth_delay:
                await asyncio.sleep(auth_delay)
            said = flags.get(payload.get("token"))
            if isinstance(said, BaseException):
                raise said
            return said if isinstance(said, dict) else {"status": 200, "data": {"user": {"is_master": bool(said)}}}
        lane = pack_lane(payload)
        ns["live"][0] += 1
        ns["peak"][0] = max(ns["peak"][0], ns["live"][0])
        ns["lane_live"][lane] += 1
        ns["lane_peak"][lane] = max(ns["lane_peak"][lane], ns["lane_live"][lane])
        try:
            if delay:
                await asyncio.sleep(delay)
            if pack is not None:
                return pack(payload, ns)
            if action == "clientPack":
                ck = payload["payload"]["client"]
                return {"status": 200, "data": {"client": ck, "built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"details": {"client_key": ck, "v": ns["version"][0]},
                                                          "funds": {"rows": []}},
                                                "part_status": {"details": {"status": 200}, "funds": {"status": 200}}}}
            if action == "ssaPack":
                sk = payload["payload"]["ssa"]
                return {"status": 200, "data": {"ssa": sk, "built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"overview": {"ssa": {"key": sk}, "v": ns["version"][0]},
                                                          "notes": {"notes": []}},
                                                "part_status": {"overview": {"status": 200}, "notes": {"status": 200}}}}
            if action == "familyPack":
                fk = payload["payload"]["family"]
                return {"status": 200, "data": {"family": fk, "built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"overview": {"family": fk, "v": ns["version"][0]},
                                                          "notes": {"notes": []}},
                                                "part_status": {"overview": {"status": 200}, "notes": {"status": 200}}}}
            if action == "familyIndexPack":
                # the roster and the records Python builds off asa-hub-db: a case names its own, else one member
                return {"status": 200, "data": {"built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"roster": {"families": ns.get("family_roster",
                                                                                        [{"key": "fam_ritalong"}]),
                                                                     "why": [], "degraded": False,
                                                                     "v": ns["version"][0]},
                                                          "records": ns.get("family_records", {}),
                                                          "aliases": {}, "overviews": {"fam_ritalong": {"v": 1}},
                                                          "notes": {"fam_ritalong": {"notes": []}}},
                                                "part_status": {p: {"status": 200} for p in
                                                                ("roster", "aliases", "overviews", "notes")}}}
            if action == "candidatePack":
                ck = payload["payload"]["candidate"]
                return {"status": 200, "data": {"candidate": ck, "built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"overview": {"candidate": {"key": ck}, "v": ns["version"][0]},
                                                          "texts": {"rows": []}},
                                                "part_status": {"overview": {"status": 200}, "texts": {"status": 200}}}}
            if action == "clientCandidatePack":
                lk = payload["payload"]["candidate"]
                return {"status": 200, "data": {"candidate": lk, "built_at": "2026-09-28T12:00:00Z",
                                                "parts": {"overview": {"candidate": {"key": lk}, "v": ns["version"][0]},
                                                          "intake": {"steps": []}},
                                                "part_status": {"overview": {"status": 200}, "intake": {"status": 200}}}}
            key = payload["payload"]["house"]
            return {"status": 200, "data": {"house": key, "built_at": "2026-09-28T12:00:00Z",
                                            "parts": {"overview": {"house": key, "v": ns["version"][0]},
                                                      "staff": {"rows": []}},
                                            "part_status": {"overview": {"status": 200}, "staff": {"status": 200}}}}
        finally:
            ns["live"][0] -= 1
            ns["lane_live"][lane] -= 1

    async def auth_me(token: str):
        return await python_door({"action": "authMe", "token": token})

    async def backend_pack(app_id: str, action: str, key: str, *, pack: str = "", named: str = ""):
        field = named or {"clientPack": "client", "ssaPack": "ssa", "familyPack": "family",
                          "candidatePack": "candidate", "clientCandidatePack": "candidate",
                          "staffPack": "staff"}.get(action, "house")
        payload = {} if action == "familyIndexPack" else {field: key}
        return await python_door({"action": action, "payload": payload}, app=app_id, pack=pack)

    ns["_session_actor"], ns["_auth_me"], ns["_backend_pack"] = session_actor, auth_me, backend_pack
    for node in REAL_NODES + PACK_NODES:
        exec(compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec",
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    if wait_s is not None:
        ns["APP_PACK_WAIT_S"] = wait_s
    if pack_dir is None:
        pack_dir = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "app-packs"
        pack_dir.mkdir()
    ns["APP_PACK_DIR"] = str(pack_dir)
    ns["APP_PACK_DEFAULT_DIR"] = str(Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "default-not-mounted")
    return ns


def ask(ns: dict[str, Any], authorization: str, app_id: str = "locations", key: str = "ABD1305",
        member: str = "") -> tuple[dict[str, Any], dict[str, str]]:
    """The door as the SPA asks it: the key in X-App-Pack-Key, URI-encoded, never in the address."""
    resp = types.SimpleNamespace(headers={})

    async def go():
        return await ns["lane_app_pack"](app_id, resp, member=member, authorization=authorization,
                                        x_app_pack_key=urllib.parse.quote(key))
    return asyncio.run(go()), resp.headers


def execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "locationPack"]


def client_execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "clientPack"]


def ssa_execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "ssaPack"]


def candidate_execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "candidatePack"]


def lead_execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "clientCandidatePack"]


def door_said(answer: dict[str, Any]) -> tuple[Any, Any, Any]:
    """(status, state, the overview's version) of a door answer; a refusal carries no data."""
    data = answer.get("data") or {}
    return answer.get("status"), data.get("state"), ((data.get("parts") or {}).get("overview") or {}).get("v")


def form(action: str, payload: dict | None = None, resource: str = "") -> bytes:
    body: dict[str, Any] = {"token": "tok-boss", "action": action}
    if payload is not None:
        body["payload"] = payload
    if resource:
        body["resource"] = resource
    return urllib.parse.urlencode({"body": json.dumps(body)}).encode()


BOSS = {"Bearer boss": ("admin", "u-boss"), "Bearer adm": ("admin", "u-a"), "Bearer mia": ("manager", "u-m"),
        "Bearer sam": ("staff", "u-s"), "Bearer child": ("admin", "u-kid")}
FLAGS = {"boss": True, "adm": False}

print("the route and its wiring")
check("the relay serves the door at /hub-lanes/app-pack/{app_id}",
      '@app.get("/hub-lanes/app-pack/{app_id}")' in SVC and "lane_app_pack" in {node_name(n) for n in TREE.body})
gas_node = next(n for n in TREE.body if node_name(n) == "gas_relay")
gas_src = ast.get_source_segment(SVC, gas_node) or ""
check("the /gas relay observes the write Python answered, once — no receipt recovery is left to observe",
      gas_src.count("_relay_observe_app_pack(action, raw, res.content, python=True)") == 1
      and gas_src.count("_relay_observe_app_pack(") == 1 and "again = await client.post(" not in gas_src)
check("…and no write is left unconfirmed or delivered later: Python's answer is the write's verdict",
      "_relay_note_app_pack_unconfirmed" not in SVC and "_ledger_mark_delivered" not in SVC)
check("the warm loop starts with the relay, and the rest is held against the engine build the relay kept",
      "asyncio.create_task(_app_pack_warm_loop())" in SVC and "_ENGINE_BUILD = _engine_build_kept()" in SVC
      and 'globals().get("_ENGINE_BUILD")' in ast.get_source_segment(
          SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_engine")))
exec_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_locations")) or ""
client_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_clients")) or ""
fill_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_fill")) or ""
back_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_ticket_back")) or ""
check("the fill is Python's locationPack, asking for no ticket of its own — the fill holds the housekeeping ticket and "
      "the one background turn itself and gives both back whatever happens",
      '_backend_pack("locations", "locationPack", key)' in exec_src and "housekeeping=" not in exec_src
      and "await _app_pack_ticket(promote)" in fill_src
      and re.search(r"finally:\s+if ticket:\s+_app_pack_ticket_back\(\)", fill_src) is not None
      and "_housekeeping_slots.release()" in back_src and "_app_pack_bg_sem.release()" in back_src)
check("…and a client's is Python's clientPack for {client}",
      '_backend_pack("clients", "clientPack", key)' in client_src and "housekeeping=" not in client_src)
ssa_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_ssas")) or ""
check("…and an SSA's is Python's ssaPack for {ssa}",
      '_backend_pack("ssa", "ssaPack", key)' in ssa_src and "housekeeping=" not in ssa_src)
receipts = re.search(r"^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)", SVC, re.M)
check("no pack is ever stamped for a receipt, should one ride /gas",
      receipts is not None and all(f'"{a}"' in receipts.group(1)
                                   for a in ("locationPack", "clientPack", "ssaPack", "familyPack", "candidatePack",
                                             "clientCandidatePack")))
check("the Smart Comms desk's situations and trail run again on a retry, never a receipt (a situations answer is past "
      "the receipt's cut); its save keeps its receipt",
      receipts is not None and all(f'"{a}"' in receipts.group(1) for a in ("smartCommsGet", "smartCommsHistory"))
      and '"smartCommsSet"' not in receipts.group(1))
SSA_READS = ("ssaProfileRoster", "ssaProfileOverview", "ssaProfileDocuments", "ssaProfileDocFile",
             "ssaProfileActivity", "ssaProfileNotes")
check("every read of the SSA app runs again on a retry, never a receipt; its one write keeps its receipt",
      receipts is not None and all(f'"{a}"' in receipts.group(1) for a in SSA_READS)
      and "ssaProfileNoteAdd" not in receipts.group(1))
cand_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_candidates")) or ""
check("…and a candidate's is Python's candidatePack for {candidate}",
      '_backend_pack("candidates", "candidatePack", key)' in cand_src and "housekeeping=" not in cand_src)
CANDIDATE_READS = ("candidatePack", "candidateProfileRoster", "candidateProfileOverview", "candidateProfileActions",
                   "candidateProfileInterviews", "candidateProfileDocuments", "candidateProfileDocFile",
                   "candidateProfileActivity", "candidateProfileTexts", "candidateProfileTranscripts",
                   "candidateProfileTranscript", "candidateProfileResume")
listed = set(re.findall(r'"(\w+)"', receipts.group(1))) if receipts is not None else set()
check("every read of a candidate and the candidate's pack run again on a retry, never a receipt",
      set(CANDIDATE_READS) <= listed, sorted(set(CANDIDATE_READS) - listed))


def policy_lane(block: str) -> str:
    said = re.search(r"\blane:\s*'(\w+)'", block)
    return said.group(1) if said else ""


def policy_writes(block: str) -> bool:
    """A write: the write lane, or a tool that is never safe to send twice."""
    return policy_lane(block) == "write" or re.search(r"\bidempotent:\s*false\b", block) is not None


CANDIDATE_GS = ROOT / "apps-script" / "CandidateProfiles.gs"
if CANDIDATE_GS.exists():
    declared = {name: policy_writes(block) for name, block in
                re.findall(r"HUB_POLICY\.(\w+)\s*=\s*\{(.*?)\n\};", CANDIDATE_GS.read_text(encoding="utf-8"), re.S)}
    unlisted = sorted(a for a, write in declared.items() if not write and a not in listed)
    stamped = sorted(a for a, write in declared.items() if write and a in listed)
    undeclared = sorted(a for a in CANDIDATE_READS if a not in declared)
    check("…as CandidateProfiles.gs declares them: each of its reads is listed, none of its writes, and no listed "
          "candidate read is one the file does not declare",
          bool(declared) and not unlisted and not stamped and not undeclared,
          {"unlisted": unlisted, "stamped": stamped, "undeclared": undeclared})
else:
    print("  skip CandidateProfiles.gs is not in this tree: its lanes are not compared")
lead_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_leads")) or ""
check("…and a referral's is Python's clientCandidatePack for {candidate}",
      '_backend_pack("client-candidates", "clientCandidatePack", key)' in lead_src
      and "housekeeping=" not in lead_src)
LEAD_READS = {"clientCandidatePack", "clientCandidateRoster", "clientCandidateOverview", "clientCandidateActions",
              "clientCandidateIntake", "clientCandidateDocuments", "clientCandidateDocFile", "clientCandidateActivity",
              "clientCandidateTexts", "clientCandidateTranscripts", "clientCandidateTranscript"}
lead_said = set(re.findall(r'"(clientCandidate\w*)"', receipts.group(1))) if receipts else set()
LEAD_OWN = {a for a in PY_DOORS if a.startswith("clientCandidate")}
check("the Client Candidates pack and every read of the app run again on a retry, never a receipt — and no write of it "
      "rides without one, but Python's own doors, which answer in asa-hub-app's words",
      lead_said == LEAD_READS | LEAD_OWN, sorted(lead_said ^ (LEAD_READS | LEAD_OWN)))

limits = build()
pack_timeout = re.search(r'^HUB_APP_PACK_TIMEOUT_S = min\(120\.0, max\(HUB_APP_TIMEOUT_S, float\(os\.getenv\('
                         r'"HUB_APP_PACK_TIMEOUT_S", "(\d+)"\)\)\)\)', SVC, re.M)
check("a person waits on a fill for less than the proxy's 30-second read timeout on /hub-lanes/, the ceiling is past "
      "fresh, and Python's fill is given longer than a person waits",
      limits["APP_PACK_WAIT_S"] < 30 and limits["APP_PACK_CEILING_S"] > limits["APP_PACK_FRESH_S"]
      and pack_timeout is not None and float(pack_timeout.group(1)) > limits["APP_PACK_WAIT_S"]
      and limits["APP_PACK_CLIENT_FILL_TIMEOUT_S"] > 240,
      {k: limits[k] for k in ("APP_PACK_WAIT_S", "APP_PACK_FRESH_S", "APP_PACK_CEILING_S",
                              "APP_PACK_CLIENT_FILL_TIMEOUT_S")})
check("fresh for 40 minutes, served while refilled for 4 hours — longer than one warm pass over every key — both "
      "still set by the environment; 160 keys held across every app",
      limits["APP_PACK_FRESH_S"] == 2400.0 and limits["APP_PACK_CEILING_S"] == 14400.0
      and limits["APP_PACK_MAX_KEYS"] == 160
      and 'os.getenv("HUB_APP_PACK_FRESH_S", "2400")' in SVC and 'os.getenv("HUB_APP_PACK_CEILING_S", "14400")' in SVC
      and 'APP_PACK_DEFAULT_DIR = "/srv/app-packs"' in SVC
      and 'os.getenv("HUB_APP_PACK_DIR", APP_PACK_DEFAULT_DIR)' in SVC and "/srv/bundles/app-packs" not in SVC,
      {k: limits[k] for k in ("APP_PACK_FRESH_S", "APP_PACK_CEILING_S", "APP_PACK_MAX_KEYS")})

print("\nthe master, and nobody else while no access gate is loaded")
ns = build(sessions=BOSS, masters=FLAGS)
body, headers = ask(ns, "Bearer boss")
check("the master's own session reads the pack, fresh, never cached by the browser",
      body.get("status") == 200 and body["data"]["state"] == "fresh" and body["data"]["parts"]["overview"]["v"] == 1
      and headers.get("Cache-Control") == "no-store" and body["data"]["built_at"] == "2026-09-28T12:00:00Z", body)
auth_calls = [c for c in ns["calls"] if c["action"] == "authMe"]
ask(ns, "Bearer boss")
check("an unknown flag is asked of authMe exactly once, then held",
      len(auth_calls) == 1 and len([c for c in ns["calls"] if c["action"] == "authMe"]) == 1
      and ns["_auth_master"] == {"boss": True}, ns["calls"])
shut = {who: ask(ns, who)[0] for who in ("Bearer adm", "Bearer mia", "Bearer sam", "Bearer nobody")}
check("with no access gate loaded, an admin who is not the master, a manager, staff and an unknown session get 404 "
      "'Unknown lane.'",
      all(b == {"status": 404, "reason": "unknown", "message": "Unknown lane."} for b in shut.values()), shut)
check("authMe is spent only on admin sessions",
      [c["action"] for c in ns["calls"] if c["action"] == "authMe"] == ["authMe", "authMe"], ns["calls"])
check("no session is 401", ask(ns, "")[0].get("status") == 401)
visit = ask(ns, "Bearer boss", member="mem_1")[0]
check("a visit is 403 before anything else is read", visit.get("status") == 403 and visit.get("reason") == "visit"
      and "data" not in visit, visit)
ns["_acting"]["child"] = (time.time() + 600, "u-boss", "u-kid")
before = len(ns["calls"])
acting = ask(ns, "Bearer child")[0]
check("a switched session is 404, and no authMe is spent on it",
      acting == {"status": 404, "reason": "unknown", "message": "Unknown lane."} and len(ns["calls"]) == before, acting)
check("an unknown app is 404, a key that is not a house code 400",
      ask(ns, "Bearer boss", app_id="clients")[0].get("status") == 404
      and ask(ns, "Bearer boss", key="House 12")[0].get("status") == 400
      and ask(ns, "Bearer boss", key="../x")[0].get("status") == 400)
down = build(sessions=BOSS, masters={"boss": TimeoutError("no answer")})
failed = ask(down, "Bearer boss")[0]
check("an authMe that fails is 503 with no data, never the not-the-master 404, and nothing is held",
      failed.get("status") == 503 and "data" not in failed and down["_auth_master"] == {} and not execs(down), failed)
odd = build(sessions=BOSS, masters={"boss": {"status": 500, "message": "boom"}})
check("an authMe that answers without the flag is 503 as well",
      ask(odd, "Bearer boss")[0].get("status") == 503 and odd["_auth_master"] == {})
switched = build(sessions=BOSS, masters={"boss": {"status": 200, "data": {
    "user": {"id": "u-kid", "is_master": True},
    "be_another": {"acting": {"id": "u-kid", "until": "2099-01-01T00:00:00Z"}, "real": {"id": "u-boss"}}}}})
sw = ask(switched, "Bearer boss")[0]
check("a token authMe says is switched is 404 and is never held as the master",
      sw.get("status") == 404 and switched["_auth_master"] == {} and "boss" in switched["_acting"], sw)

print("\nheld in memory, kept only in the private folder")
tmp = Path(tempfile.mkdtemp(dir=KEPT_ROOT))
(tmp / "houses.json").write_text(json.dumps({"rows": [{"code": h, "active": True} for h in HOUSES]
                                            + [{"code": "ZK1109", "active": False}, {"code": "not a code", "active": True},
                                               "junk"]}))
keys_ns = build(out_dir=tmp)
check("the warm keys are the houses slice's active codes, nothing else",
      keys_ns["_app_pack_house_keys"]() == HOUSES and build()["_app_pack_house_keys"]() == [])
writes: list[str] = []
real_open, real_wt, real_wb = builtins.open, Path.write_text, Path.write_bytes
real_replace, real_mkstemp, real_mkdir, real_chmod = os.replace, tempfile.mkstemp, Path.mkdir, os.chmod


def guarded_open(file, mode="r", *a, **k):
    if any(c in mode for c in "wax+"):
        writes.append(str(file))
    return real_open(file, mode, *a, **k)


def guarded_mkstemp(*a, **k):
    writes.append(str(k.get("dir")))
    return real_mkstemp(*a, **k)


builtins.open = guarded_open
Path.write_text = lambda self, *a, **k: writes.append(str(self)) or 0  # type: ignore[assignment]
Path.write_bytes = lambda self, *a, **k: writes.append(str(self)) or 0  # type: ignore[assignment]
os.replace = lambda src, dst, *a, **k: writes.append(str(dst)) or real_replace(src, dst, *a, **k)
tempfile.mkstemp = guarded_mkstemp
Path.mkdir = lambda self, *a, **k: writes.append(str(self)) or real_mkdir(self, *a, **k)  # type: ignore[assignment]
os.chmod = lambda path, *a, **k: writes.append(str(path)) or real_chmod(path, *a, **k)


def kept_name(app: str, key: str) -> str:
    """A kept pack's file name, spelled here on its own: the hash of its app and key."""
    return hashlib.sha256(f"{app}\n{key}".encode("utf-8")).hexdigest() + ".json"


def kept_files(ns: dict[str, Any]) -> dict[str, Path]:
    folder = Path(ns["APP_PACK_DIR"])
    return {p.name: p for p in sorted(folder.iterdir())} if folder.is_dir() else {}


# what every warm pass adds of Families: the index, always, and the family member this fake engine's index names
INDEX_WARMED = [("family-index", "all"), ("family-profiles", "fam_ritalong")]


def hold_family_index(ns: dict[str, Any], families: list[dict] | None = None,
                      records: dict[str, str] | None = None) -> None:
    """A fresh families index held as Python's familyIndexPack leaves it: its roster names the family members warmed,
    its records the family member each client's own record names."""
    ns["_app_pack_held"][(ns["_APP_PACK_FAMILY_INDEX"], ns["_APP_PACK_FAMILY_INDEX_KEY"])] = {
        "data": {"parts": {"roster": {"families": list(families or [])}, "records": dict(records or {})}},
        "filled_at": ns["clock"].time(), "read_at": ns["clock"].time(), "dirty": False}


def tree_of(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*"))


async def memory_round(mem: dict[str, Any]) -> None:
    await mem["_app_pack_get"]("locations", "ABD1305")
    mem["_app_pack_invalidate"]("locations", "ABD1305")
    await mem["_app_pack_get"]("locations", "ABD1305")
    mem["_app_pack_invalidate"]("locations")
    await mem["_app_pack_warm_pass"]()
    await asyncio.sleep(0.01)


try:
    mem = build(sessions=BOSS, masters=FLAGS, out_dir=tmp)
    ask(mem, "Bearer boss")
    asyncio.run(memory_round(mem))
finally:
    builtins.open, Path.write_text, Path.write_bytes = real_open, real_wt, real_wb
    os.replace, tempfile.mkstemp, Path.mkdir, os.chmod = real_replace, real_mkstemp, real_mkdir, real_chmod
mem_dir = Path(mem["APP_PACK_DIR"]).resolve()
check("a fill, a read, a write's invalidation and a warm pass write only inside the pack folder — nothing beside the "
      "slices, nothing anywhere else",
      writes and all(Path(w).resolve() == mem_dir or mem_dir in Path(w).resolve().parents for w in writes)
      and tree_of(tmp) == ["houses.json"], (writes[:6], tree_of(tmp)))
check("what is held lives in the process's own dicts, empty at start, and each clean pack is kept as one file",
      build()["_app_pack_held"] == {}
      and sorted(mem["_app_pack_held"]) == sorted([("locations", h) for h in HOUSES] + INDEX_WARMED)
      and sorted(kept_files(mem)) == sorted([kept_name("locations", h) for h in HOUSES]
                                            + [kept_name(*s) for s in INDEX_WARMED]), sorted(mem["_app_pack_held"]))
readers = sorted({node_name(n) for n in TREE.body
                  if any(isinstance(x, ast.Name) and x.id in ("_app_pack_held", "_app_pack_get") for x in ast.walk(n))})
check("only the pack's own code touches the held packs — no bundle, slice, all.json or master JSON writer does; the edit "
      "overlay reads a fresh one to lay its pending edits",
      all(is_pack(r) or r.startswith("_edit_overlay_held_") for r in readers), readers)
pack_src = "\n".join(ast.get_source_segment(SVC, n) or "" for n in PACK_NODES)
pack_by_node = {node_name(n): ast.get_source_segment(SVC, n) or "" for n in PACK_NODES}


def pack_holders(pattern: str) -> list[str]:
    return sorted(k for k, v in pack_by_node.items() if re.search(pattern, v))


check("the pack's code writes a file in one place (a temporary neighbour renamed over it), for a kept pack off the "
      "loop and for an app's few-byte mark; makes no folder; removes files in four; reads the folder off the loop — "
      "and opens no database but the Core users copy (the client accounts the warm pass keeps, read off the loop), no "
      "slice, no master JSON, and names the bundle deposit only to refuse it",
      pack_holders(r"os\.replace\(|mkstemp\(|os\.chmod\(|fdopen\(") == ["_app_pack_write_file"]
      and pack_holders(r"\.mkdir\(|makedirs") == []
      and pack_holders(r"_app_pack_write_file\b") == ["_app_pack_keep", "_app_pack_mark", "_app_pack_write_file"]
      and pack_holders(r"\.unlink\(") == ["_app_pack_adopt_disk", "_app_pack_forget", "_app_pack_purge_unused",
                                          "_app_pack_write_file"]
      and pack_holders(r"to_thread") == ["_app_pack_adopt_disk", "_app_pack_keep", "_app_pack_warm_pass"]
      and re.search(r"to_thread\(_app_pack_write_file,", pack_by_node["_app_pack_keep"]) is not None
      and re.search(r"to_thread\(_app_pack_client_accounts_refresh\)", pack_by_node["_app_pack_warm_pass"]) is not None
      and pack_holders(r"psycopg2") == ["_app_pack_client_account_rows"]
      and "tab_name = 'users'" in pack_by_node["_app_pack_client_account_rows"]
      and pack_holders(r"(?<!def )_app_pack_client_account_rows\(") == ["_app_pack_client_accounts_refresh"]
      and pack_holders(r"BUNDLE_DIR") == ["_app_pack_dir_state"]
      and not re.search(r"write_text|write_bytes|(?<![a-z])open\(|master_json|_vouch_put", pack_src),
      {p: pack_holders(p) for p in (r"os\.replace\(", r"\.unlink\(", r"to_thread", r"BUNDLE_DIR", r"psycopg2")})

print("\ninvalidation")


async def invalidation() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS)
    got = {}
    first = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305",
                                     authorization="Bearer boss")
    got["first"] = first["data"]["parts"]["overview"]["v"]
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "abd1305", "details": "x"}),
                                  json.dumps({"status": 200, "data": {"note": {"id": "HN_1"}}}).encode())
    got["dirty"] = ns["_app_pack_held"][("locations", "ABD1305")]["dirty"]
    after = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305",
                                     authorization="Bearer boss")
    got["after"] = after["data"]["parts"]["overview"]["v"]
    got["after_state"] = after["data"]["state"]
    await asyncio.sleep(0)
    got["execs"] = len(execs(ns))
    # the house only in the answer
    await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1547", authorization="Bearer boss")
    ns["_relay_observe_app_pack"]("locationNoteState", form("locationNoteState", {"id": "HN_1", "state": "resolved"}),
                                  json.dumps({"status": 200, "data": {"note": {"house": "ABD1547"}}}).encode())
    got["by_answer"] = ns["_app_pack_held"][("locations", "ABD1547")]["dirty"]
    got["other_clean"] = ns["_app_pack_held"][("locations", "ABD1305")]["dirty"] is False
    await asyncio.sleep(0.01)
    # a refused write changes nothing
    for slot in ns["_app_pack_held"]:
        ns["_app_pack_held"][slot]["dirty"] = False
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305"}),
                                  json.dumps({"status": 409, "message": "busy"}).encode())
    got["refused_clean"] = not any(e["dirty"] for e in ns["_app_pack_held"].values())
    # a generic write to another resource changes nothing; to istRecords, every pack
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "r1"}, resource="workOrders"),
                                  json.dumps({"status": 200}).encode())
    got["other_resource_clean"] = not any(e["dirty"] for e in ns["_app_pack_held"].values())
    ns["_app_pack_warm_wake"].clear()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "i1", "house": "ABD1547"}, resource="istRecords"),
                                  json.dumps({"status": 200}).encode())
    got["all_stale"] = all(e["stale"] and not e["dirty"] for e in ns["_app_pack_held"].values()) \
        and len(ns["_app_pack_held"]) == 2
    got["warm_woken"] = ns["_app_pack_warm_wake"].is_set()
    # a stale pack is served while it is filled again in the background, once
    n0 = len(execs(ns))
    ns["version"][0] = 3
    served = await asyncio.gather(*(ns["_app_pack_get"]("locations", "ABD1305") for _ in range(3)))
    got["stale_served"] = [(a["data"]["state"], a["data"]["parts"]["overview"]["v"]) for a in served]
    await asyncio.sleep(0.02)
    got["stale_refill"] = (len(execs(ns)) - n0, ns["_app_pack_held"][("locations", "ABD1305")]["stale"],
                           ns["_app_pack_held"][("locations", "ABD1305")]["lane"])
    # the IST pairs rebuilt: every house
    for slot in ns["_app_pack_held"]:
        ns["_app_pack_held"][slot]["dirty"] = ns["_app_pack_held"][slot]["stale"] = False
    ns["_relay_observe_app_pack"]("istRebuild", form("istRebuild", {}), json.dumps({"status": 200, "data": {}}).encode())
    got["rebuild"] = all(e["stale"] and not e["dirty"] for e in ns["_app_pack_held"].values())
    await asyncio.sleep(0.01)
    return got


inv = asyncio.run(invalidation())
check("a locationNoteAdd that landed makes its house dirty at once", inv["dirty"] is True, inv)
check("the next read waits for the refill and never serves the copy from before the write",
      inv["first"] == 1 and inv["after"] == 2 and inv["after_state"] == "fresh", inv)
check("the house an answer names (locationNoteState) is the one made dirty; the other stays clean",
      inv["by_answer"] is True and inv["other_clean"], inv)
check("a refused write and a generic write to another resource change nothing",
      inv["refused_clean"] and inv["other_resource_clean"], inv)
check("a generic write to istRecords makes every house's pack stale — not dirty, whatever house it names — and wakes "
      "the warm pass", inv["all_stale"] and inv["warm_woken"], inv)
check("a stale pack is served at once as `refreshing` to three readers, and exactly one background fill makes it "
      "fresh again", inv["stale_served"] == [("refreshing", 2)] * 3 and inv["stale_refill"] == (1, False, "housekeeping"),
      inv)
check("an IST rebuild makes every house's pack stale", inv["rebuild"], inv)


async def editions() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS)
    got: dict[str, Any] = {}
    for house in ("ABD1305", "ABD1547"):
        await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key=house, authorization="Bearer boss")
    ok = json.dumps({"status": 200, "data": {"steps": [{"id": "sheet", "landed": True}]}}).encode()
    doors = ["locationStaffRemove", "locationIncidentFile", "locationIncidentEdit", "locationRepairFile",
             "locationRepairEdit", "locationDocRemove", "locationDocLink", "locationDocUpload", "locationClientsAdd"]
    got["declared"] = [d for d in doors if d not in ns["_APP_PACKS"]["locations"]["writes"]]
    dirty = {}
    for door in doors:
        for slot in ns["_app_pack_held"]:
            ns["_app_pack_held"][slot]["dirty"] = ns["_app_pack_held"][slot]["stale"] = False
        ns["_relay_observe_app_pack"](door, form(door, {"house": "ABD1547", "id": "r9"}), ok)
        dirty[door] = (ns["_app_pack_held"][("locations", "ABD1547")]["dirty"],
                       ns["_app_pack_held"][("locations", "ABD1305")]["dirty"])
        await asyncio.sleep(0.01)
    got["dirty"] = dirty
    got["incident_apps"] = sorted(ns["_app_pack_apps_of"]("locationIncidentEdit",
                                                         form("locationIncidentEdit", {"house": "ABD1547"})))
    got["repair_apps"] = sorted(ns["_app_pack_apps_of"]("locationRepairFile",
                                                       form("locationRepairFile", {"house": "ABD1547"})))
    got["clients_follow"] = "locationClientsAdd" in ns["_APP_PACKS"][ns["_APP_PACK_CLIENTS"]]["elsewhere"]
    return got


ed = asyncio.run(editions())
check("every Locations edition door is one of the app's own writes: the house it names dirty at once, the other clean",
      not ed["declared"] and all(v == (True, False) for v in ed["dirty"].values()), ed)
check("an incident or repair written through a Locations door rings every app that reads that estate resource, as a "
      "generic write to it does, and an added client's own record follows",
      "locations" in ed["incident_apps"] and any("client" in a for a in ed["incident_apps"])
      and "locations" in ed["repair_apps"] and ed["clients_follow"], ed)


async def racing() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05)
    task = ns["_app_pack_kick"]("locations", "ABD1305", housekeeping=True)
    await asyncio.sleep(0.01)
    ns["version"][0] = 2
    ns["_app_pack_invalidate"]("locations", "ABD1305")
    answer = await ns["_app_pack_get"]("locations", "ABD1305")
    await task
    return {"v": answer["data"]["parts"]["overview"]["v"], "execs": len(execs(ns))}


race = asyncio.run(racing())
check("a write while a fill is in flight: that fill lands dirty, is filled again, and the read gets the new copy",
      race["v"] == 2 and race["execs"] == 2, race)


def big_form(action: str, house: str | None, size: int = 120_000) -> bytes:
    """An upload as the SPA sends it (token, action, payload first), past what the relay parses."""
    payload: dict[str, Any] = {} if house is None else {"house": house}
    payload.update({"staff": NAMES[1], "client": NAMES[0],
                    "file": {"name": "ist.pdf", "mime": "application/pdf", "b64": "QUJD" * (size // 4)}})
    return form(action, payload)


OK_IST = json.dumps({"status": 200, "data": {"ist": {"doc_url": "https://drive.google.com/file/d/x/view"}}}).encode()


async def uploads() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS)
    for house in ("ABD1305", "ABD1547"):
        await ns["_app_pack_get"]("locations", house)

    def dirty() -> dict[str, str]:
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (_, k), e in ns["_app_pack_held"].items()}

    def clean() -> None:
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    got: dict[str, Any] = {}
    big = big_form("locationIstFile", "ABD1305")
    action = ns["_relay_action"](big)
    got["parsed"] = (len(big) > 100_000, action, ns["_relay_envelope"](big))
    ns["_relay_observe_app_pack"](action, big, OK_IST)
    got["named"] = dirty()
    await asyncio.sleep(0.01)
    clean()
    ns["_relay_observe_app_pack"](ns["_relay_action"](big_form("locationIstFile", None)), big_form("locationIstFile", None),
                                  OK_IST)
    got["unnamed"] = dirty()
    clean()
    ns["_relay_observe_app_pack"]("", big, json.dumps({"status": 404, "message": "No IST record pairs them."}).encode())
    ns["_relay_observe_app_pack"]("", big_form("docUpload", "ABD1305"), OK_IST)
    got["refused_or_other"] = dirty()
    await asyncio.sleep(0.01)
    return got


up = asyncio.run(uploads())
check("an IST paper past 100 KB is an upload the relay does not parse: _relay_action names no action",
      up["parsed"] == (True, "", None), up["parsed"][:2])
check("…and its landed answer still makes its own house dirty, read from the envelope's opening bytes",
      up["named"] == {"ABD1305": "dirty", "ABD1547": "clean"}, up)
check("an upload whose opening bytes name no house makes every house of the app stale",
      up["unnamed"] == {"ABD1305": "stale", "ABD1547": "stale"}, up)
check("a refused upload, and an upload of another action, change nothing",
      up["refused_or_other"] == {"ABD1305": "clean", "ABD1547": "clean"}, up)

print("\na person never queues behind background work")


async def hold_every_ticket(ns: dict[str, Any]) -> None:
    """A bundle cycle and two sweeps: every housekeeping ticket is out."""
    for _ in range(ns["_housekeeping_slots"].n):
        await ns["_housekeeping_slots"].acquire()


def give_tickets_back(ns: dict[str, Any]) -> None:
    for _ in range(ns["_housekeeping_slots"].n):
        ns["_housekeeping_slots"].release()


async def within(aw: Any, seconds: float = 2.0) -> Any:
    """What `aw` gives inside the time, else 'stuck' — reported as a failure, never a hang."""
    try:
        return await asyncio.wait_for(aw, seconds)
    except asyncio.TimeoutError:
        return "stuck"


def lane_of(ns: dict[str, Any], key: str) -> str:
    return (ns["_app_pack_held"].get(("locations", key)) or {}).get("lane", "none")


async def after_write() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05, wait_s=1.0)
    await ns["_app_pack_get"]("locations", "ABD1305")
    await hold_every_ticket(ns)
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}),
                                  json.dumps({"status": 200, "data": {"note": {"id": "HN_1"}}}).encode())
    kicked = ns["_app_pack_inflight"].get(("locations", "ABD1305"))
    promoted = ns["_app_pack_promote"][("locations", "ABD1305")].is_set()
    t0 = time.monotonic()
    answer = await ns["_app_pack_get"]("locations", "ABD1305")
    spent = time.monotonic() - t0
    give_tickets_back(ns)
    return {"answer": door_said(answer), "lane": lane_of(ns, "ABD1305"), "kicked": kicked is not None,
            "promoted": promoted, "quick": spent < 0.5, "execs": len(execs(ns)), "out": ns["_housekeeping_slots"].out}


aw = asyncio.run(after_write())
check("with every housekeeping ticket out, the refill a write kicks is on the person's lane, and the read after it "
      "is answered by it at once with the new copy",
      aw["kicked"] and aw["promoted"] and aw["answer"] == (200, "fresh", 2) and aw["lane"] == "person" and aw["quick"]
      and aw["execs"] == 2 and aw["out"] == 0, aw)


async def overlap_warm() -> dict[str, Any]:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-overlap-"))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1547", "active": True}]}))
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05, wait_s=1.0, out_dir=tmp)
    # the families index already held fresh and naming nobody: the warm pass goes to the house first
    hold_family_index(ns)
    await hold_every_ticket(ns)
    warm = asyncio.ensure_future(ns["_app_pack_warm_pass"]())
    await asyncio.sleep(0.05)
    queued = (len(execs(ns)), ("locations", "ABD1547") in ns["_app_pack_inflight"])
    t0 = time.monotonic()
    answer = await ns["_app_pack_get"]("locations", "ABD1547")
    spent = time.monotonic() - t0
    filled = await within(warm, 0.5)
    still_out = ns["_housekeeping_slots"].out
    give_tickets_back(ns)
    await asyncio.sleep(0.1)
    return {"queued": queued, "answer": door_said(answer)[:2], "quick": spent < 0.5, "lane": lane_of(ns, "ABD1547"),
            "execs": len(execs(ns)), "filled": filled, "still_out": still_out, "out": ns["_housekeeping_slots"].out}


ow = asyncio.run(overlap_warm())
check("a read of the house a warm pass is waiting on a ticket for moves that fill to the person's lane: one "
      "execution, answered at once, and the warm pass counts it filled",
      ow["queued"] == (0, True) and ow["answer"] == (200, "fresh") and ow["quick"] and ow["lane"] == "person"
      and ow["execs"] == 1 and ow["filled"] == 1, ow)
check("…and the ticket it had queued for is neither taken nor lost", ow["still_out"] == 3 and ow["out"] == 0, ow)


async def dirty_rekick() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05, wait_s=1.0)
    await hold_every_ticket(ns)
    reader = asyncio.ensure_future(ns["_app_pack_get"]("locations", "ABD1305"))
    await asyncio.sleep(0.01)
    ns["version"][0] = 2
    ns["_app_pack_invalidate"]("locations", "ABD1305")
    answer = await within(reader)
    lane = lane_of(ns, "ABD1305")
    give_tickets_back(ns)
    await asyncio.sleep(0.1)
    return {"v": door_said(answer)[2] if isinstance(answer, dict) else answer, "execs": len(execs(ns)), "lane": lane}


dr = asyncio.run(dirty_rekick())
check("a fill a write made dirty is filled again, and the person waiting on it moves the refill to their lane",
      dr == {"v": 2, "execs": 2, "lane": "person"}, dr)


async def write_while_queued() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05, wait_s=1.0)
    await hold_every_ticket(ns)
    task = ns["_app_pack_kick"]("locations", "ABD1305", housekeeping=True)
    await asyncio.sleep(0.01)
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("locationSupplyEntry", form("locationSupplyEntry", {"house": "ABD1305"}),
                                  json.dumps({"status": 200, "data": {"entry": {"house": "ABD1305"}}}).encode())
    entry = await within(asyncio.shield(task), 0.5)
    stuck = entry == "stuck"
    give_tickets_back(ns)
    if stuck:
        entry = await within(task)
    await asyncio.sleep(0.1)
    if not isinstance(entry, dict):
        return {"stuck": entry}
    return {"v": entry["data"]["parts"]["overview"]["v"], "dirty": entry["dirty"],
            "execs": len(execs(ns)), "lane": entry["lane"], **({"stuck": True} if stuck else {})}


wq = asyncio.run(write_while_queued())
check("a write while a background fill still queues for its ticket: the fill moves to the person's lane, reads "
      "after the write and lands clean — one execution", wq == {"v": 2, "dirty": False, "execs": 1, "lane": "person"}, wq)


async def tickets_kept() -> dict[str, Any]:
    got: dict[str, Any] = {}
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.2)
    await hold_every_ticket(ns)
    queued = ns["_app_pack_kick"]("locations", "ABD1305", housekeeping=True)
    await asyncio.sleep(0.01)
    queued.cancel()
    await asyncio.sleep(0.01)
    give_tickets_back(ns)
    got["cancelled_queued"] = (ns["_housekeeping_slots"].out, len(execs(ns)))
    running = ns["_app_pack_kick"]("locations", "ABD1547", housekeeping=True)
    await asyncio.sleep(0.05)
    got["running_out"] = ns["_housekeeping_slots"].out
    running.cancel()
    await asyncio.sleep(0.01)
    got["cancelled_running"] = ns["_housekeeping_slots"].out

    def broken(payload: dict, ns: dict[str, Any]) -> dict:
        raise ConnectionError("gone")
    bad = build(sessions=BOSS, masters=FLAGS, pack=broken)
    try:
        await bad["_app_pack_kick"]("locations", "ABD1305", housekeeping=True)
    except ConnectionError:
        pass
    got["failed"] = bad["_housekeeping_slots"].out
    return got


tk = asyncio.run(tickets_kept())
check("a background fill cancelled while it queues, cancelled while it runs, or whose execution fails leaves every "
      "ticket where it was", tk == {"cancelled_queued": (0, 0), "running_out": 1, "cancelled_running": 0, "failed": 0},
      tk)


async def arrival() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.4, wait_s=0.2, auth_delay=0.15)
    t0 = time.monotonic()
    answer = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305",
                                      authorization="Bearer boss")
    spent = time.monotonic() - t0
    await asyncio.sleep(0.45)
    return {"answer": answer, "spent": round(spent, 3), "held": ("locations", "ABD1305") in ns["_app_pack_held"]}


ar = asyncio.run(arrival())
check("the wait is counted from the request's arrival: a first read that spends part of it on the sign-in check "
      "answers `filling` inside the budget, and the fill still lands",
      ar["answer"].get("reason") == "filling" and 0.15 <= ar["spent"] < 0.3 and ar["held"], ar)

print("\nserved while refilled, and the ceiling")


async def swr() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05)
    got: dict[str, Any] = {}
    await ns["_app_pack_get"]("locations", "ABD1305")
    n0 = len(execs(ns))
    ns["clock"].now += 60
    fresh = await ns["_app_pack_get"]("locations", "ABD1305")
    got["fresh"] = (fresh["data"]["state"], len(execs(ns)) - n0)
    ns["clock"].now += ns["APP_PACK_FRESH_S"]
    ns["version"][0] = 2
    many = await asyncio.gather(*(ns["_app_pack_get"]("locations", "ABD1305") for _ in range(5)))
    got["served"] = [(a["data"]["state"], a["data"]["parts"]["overview"]["v"]) for a in many]
    await asyncio.sleep(0.1)
    got["refills"] = len(execs(ns)) - n0
    got["refill_call"] = (execs(ns)[-1]["tickets_out"], ns["_app_pack_held"][("locations", "ABD1305")]["lane"],
                          ns["_housekeeping_slots"].out)
    after = await ns["_app_pack_get"]("locations", "ABD1305")
    got["after"] = (after["data"]["state"], after["data"]["parts"]["overview"]["v"])
    # five people at once on a key nobody holds: one execution
    cold = await asyncio.gather(*(ns["_app_pack_get"]("locations", "ABD1547") for _ in range(5)))
    got["cold"] = ([a["status"] for a in cold], len([c for c in execs(ns) if c["payload"]["house"] == "ABD1547"]),
                   [c["tickets_out"] for c in execs(ns) if c["payload"]["house"] == "ABD1547"],
                   ns["_app_pack_held"][("locations", "ABD1547")]["lane"])
    got["own_ticket"] = any(c["kw"].get("housekeeping") for c in execs(ns))
    # past the ceiling nothing is served from memory
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + 1
    ns["version"][0] = 3
    past = await ns["_app_pack_get"]("locations", "ABD1305")
    got["past"] = (past["data"]["state"], past["data"]["parts"]["overview"]["v"])
    return got


s = asyncio.run(swr())
check("inside the fresh window the held copy answers and nothing is executed", s["fresh"] == ("fresh", 0), s)
check("past fresh, inside the ceiling, the held copy is served as `refreshing` to five readers at once",
      s["served"] == [("refreshing", 1)] * 5, s)
check("…and exactly one background fill runs for them, holding a housekeeping ticket it gives back",
      s["refills"] == 1 and s["refill_call"] == (1, "housekeeping", 0) and s["after"] == ("fresh", 2), s)
check("five readers of a key nobody holds cause one execution, on the person's lane (no ticket)",
      s["cold"] == ([200] * 5, 1, [0], "person") and s["own_ticket"] is False, s)
check("past the ceiling the copy is never served: the read waits for the fill", s["past"] == ("fresh", 3), s)


async def slow() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.3, wait_s=0.05)
    answer = await ns["_app_pack_get"]("locations", "ABD1305")
    await asyncio.sleep(0.35)
    held = ns["_app_pack_held"].get(("locations", "ABD1305"))
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + 5
    stale = await ns["_app_pack_get"]("locations", "ABD1305")
    await asyncio.sleep(0.35)
    return {"answer": answer, "held_after": bool(held), "stale": stale}


sl = asyncio.run(slow())
check("a fill slower than the wait is 503 `filling` with no data, and still lands for the next read",
      sl["answer"].get("status") == 503 and sl["answer"].get("reason") == "filling" and "data" not in sl["answer"]
      and sl["held_after"], sl["answer"])
check("past the ceiling with a slow fill: 503, never the old copy",
      sl["stale"].get("status") == 503 and "data" not in sl["stale"], sl["stale"])


NOT_SERVED = {
    "the router's own words": {"status": 404, "message": 'Unknown action: "locationPack". If this action is new, '
                                                          "the Apps Script may not have been published yet"},
    "the handler's own words": {"status": 404, "message": "Unknown action."},
    "the service list without it": {"status": 403, "message": "The service identity may only read."},
    "a service identity it does not know": {"status": 401, "message": "Authentication required."},
}


async def unpublished(said: dict) -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, pack=lambda payload, ns: dict(said))
    first = await ns["_app_pack_get"]("locations", "ABD1305")
    n = len(execs(ns))
    second = await ns["_app_pack_get"]("locations", "ABD1547")
    filled = await ns["_app_pack_warm_pass"]()
    resting = (len(execs(ns)), filled)
    ns["clock"].now += 60
    still = ns["_app_pack_resting"]("locations")
    ns["_ENGINE_BUILD"] = "b2"
    return {"first": first, "second": second, "n": n, "resting": resting, "still": still,
            "after": ns["_app_pack_resting"]("locations")}


for why, said in NOT_SERVED.items():
    u = asyncio.run(unpublished(said))
    check(f"an engine that serves no pack ({why}): 503 `unpublished`, and the next read and the warm pass ask nothing",
          all(a.get("status") == 503 and a.get("reason") == "unpublished" and "data" not in a
              for a in (u["first"], u["second"])) and u["n"] == 1 and u["resting"] == (1, 0), u)
check("the rest holds while the engine is the same one, and a new engine build ends it",
      u["still"] is True and u["after"] is False, u)


async def one_house() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS,
               pack=lambda payload, ns: {"status": 404, "message": 'No house "ZZ1000" is on the registry or on a client.'})
    first = await ns["_app_pack_get"]("locations", "ZZ1000")
    other = await ns["_app_pack_get"]("locations", "ABD1305")
    return {"first": first, "other": other, "execs": len(execs(ns)), "resting": ns["_app_pack_resting"]("locations")}


oh = asyncio.run(one_house())
check("a refusal about one house is that house's answer, in the engine's words; the other houses are still asked",
      oh["first"].get("status") == 404 and "No house" in oh["first"].get("message", "") and oh["execs"] == 2
      and oh["resting"] is False and "data" not in oh["first"], oh)


def half(payload: dict, ns: dict[str, Any]) -> dict:
    key = payload["payload"]["house"]
    return {"status": 200, "data": {"house": key, "built_at": "2026-09-28T12:00:00Z",
                                    "parts": {"overview": {"v": 1}},
                                    "part_status": {"overview": {"status": 200},
                                                    "notes": {"status": 503, "message": "closed"}}}}


h = build(sessions=BOSS, masters=FLAGS, pack=half)
hb = ask(h, "Bearer boss")[0]
check("a part that failed rides as its own refusal; the parts that answered are served",
      hb.get("status") == 200 and hb["data"]["part_status"]["notes"]["status"] == 503
      and hb["data"]["parts"]["overview"] == {"v": 1}, hb)

print("\nthe warm pass")


async def warm() -> dict[str, Any]:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-warm-"))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": c, "active": True} for c in HOUSES]}))
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.01, out_dir=tmp)
    await ns["_app_pack_get"]("locations", "ABD1305")
    await ns["_app_pack_get"]("locations", "ABD1547")
    ns["_app_pack_invalidate"]("locations", "ABD1547")
    await asyncio.sleep(0.05)
    ns["peak"][0] = 0
    before = len(execs(ns))
    ns["_app_pack_held"][("locations", "ABD1547")]["dirty"] = True
    filled = await ns["_app_pack_warm_pass"]()
    mine = execs(ns)[before:]
    return {"filled": filled, "peak": ns["peak"][0], "houses": [c["payload"]["house"] for c in mine],
            "lanes": {c["tickets_out"] for c in mine}, "held": len(ns["_app_pack_held"]),
            "again": await ns["_app_pack_warm_pass"](), "out": ns["_housekeeping_slots"].out}


w = asyncio.run(warm())
check("seventeen houses never run more than one execution at a time", w["peak"] == 1, w)
check("every warm fill holds a housekeeping ticket, and every ticket is given back", w["lanes"] == {1} and w["out"] == 0, w)
check("a fresh key is skipped, a dirty one is filled again, the rest are filled once",
      "ABD1305" not in w["houses"] and "ABD1547" in w["houses"]
      and w["filled"] == len(HOUSES) - 1 + len(INDEX_WARMED) and w["held"] == len(HOUSES) + len(INDEX_WARMED)
      and w["again"] == 0, w)

print("\nthe background turn")


async def one_background() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05)
    for key in ("ABD1305", "ABD1547", "ABD1711"):
        await ns["_app_pack_get"]("locations", key)
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    ns["peak"][0] = 0
    # three readers of three packs past fresh: three background fills, taking turns
    served = await asyncio.gather(*(ns["_app_pack_get"]("locations", k) for k in ("ABD1305", "ABD1547", "ABD1711")))
    await asyncio.sleep(0.02)
    during = (ns["_app_pack_bg_sem"]._value, ns["_housekeeping_slots"].out)
    # a person's read of a pack nobody holds does not wait for them
    t0 = time.monotonic()
    cold = await ns["_app_pack_get"]("locations", "BM4060")
    spent = time.monotonic() - t0
    await asyncio.sleep(0.3)
    return {"served": [a["data"]["state"] for a in served], "peak": ns["peak"][0], "during": during,
            "cold": (cold["status"], cold["data"]["state"]), "quick": spent < 0.12,
            "after": (ns["_app_pack_bg_sem"]._value, ns["_housekeeping_slots"].out), "execs": len(execs(ns))}


ob = asyncio.run(one_background())
check("background fills of every app take one turn at a time — never more than one housekeeping ticket for the packs",
      ob["served"] == ["refreshing"] * 3 and ob["during"] == (0, 1) and ob["after"] == (1, 0) and ob["execs"] == 7, ob)
check("…and a person's read never waits for that turn", ob["cold"] == (200, "fresh") and ob["quick"] and ob["peak"] == 2, ob)

print("\na client's pack")
CLIENT_ROWS = [{"client_key": "kay_test", "name": "Kay Test", "status": "active", "medications": ["secret pill"]},
               {"client_key": "lee_other", "name": "Lee Other", "status": ""},
               {"client_key": "old_gone", "name": "Old Gone", "status": "inactive"},
               {"client_key": "", "name": "Nora Key", "status": "Active"},
               {"client_key": "twin_a", "name": "Twin Name", "status": "active"},
               {"client_key": "twin_b", "name": "Twin  Name", "status": "active"},
               {"client_key": "../bad", "name": "Bad Key", "status": "active"}, "junk"]
CLIENT_WORDS = ["kay_test", "Kay Test", "lee_other", "Lee Other", "twin_a", "Twin Name", "secret pill"]


def clients_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-clients-"))
    (tmp / "clients.json").write_text(json.dumps({"rows": CLIENT_ROWS}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
    return tmp


cdir = clients_dir()
cix = build(out_dir=cdir)
index = cix["_app_pack_client_index"]()
check("the warm keys are the clients slice's current clients (a blank status is current, a row with no key answers to "
      "its folded name), nothing else; a name two clients carry names neither",
      cix["_app_pack_client_keys"]() == ["kay_test", "lee_other", "norakey", "twin_a", "twin_b"]
      and index["names"].get("kaytest") == "kay_test" and "twinname" not in index["names"]
      and "old_gone" in index["keys"] and "../bad" not in index["keys"] and build()["_app_pack_client_keys"]() == [],
      index)
cns = build(sessions=BOSS, masters=FLAGS, out_dir=cdir)
first, cheaders = ask(cns, "Bearer boss", app_id="client-profiles", key=" kay_test ")
again = ask(cns, "Bearer boss", app_id="client-profiles", key="kay_test")[0]
check("the master reads a client's pack by its key as the roster gives it — never folded to capitals — once",
      first.get("status") == 200 and first["data"]["parts"]["details"]["client_key"] == "kay_test"
      and first["data"]["state"] == "fresh" and again["data"]["state"] == "fresh" and len(client_execs(cns)) == 1
      and client_execs(cns)[0]["payload"] == {"client": "kay_test"} and client_execs(cns)[0]["service"]
      and "write_id" not in json.dumps(client_execs(cns)[0]) and cheaders.get("Cache-Control") == "no-store", first)
check("…with how long ago its execution began reading, never younger than the copy itself",
      isinstance(first["data"].get("read_age_s"), float) and first["data"]["read_age_s"] >= first["data"]["age_s"], first)
check("a client key the roster could not give is 400; another session is 404, a visit 403",
      all(ask(cns, "Bearer boss", app_id="client-profiles", key=k)[0].get("status") == 400
          for k in ("../x", "a b", "", "x" * 81))
      and ask(cns, "Bearer adm", app_id="client-profiles", key="kay_test")[0].get("status") == 404
      and ask(cns, "Bearer boss", app_id="client-profiles", key="kay_test", member="m1")[0].get("status") == 403)


async def client_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir())
    for k in ("kay_test", "lee_other"):
        await ns["_app_pack_get"]("client-profiles", k)
    await ns["_app_pack_get"]("locations", "ABD1305")

    def state() -> dict[str, str]:
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (a, k), e in ns["_app_pack_held"].items()}

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    ok = json.dumps({"status": 200, "data": {"saved": True}}).encode()
    got: dict[str, Any] = {}
    n0 = len(client_execs(ns))
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "fields": {"outcome": "x"}}), ok)
    got["own"] = state()
    await asyncio.sleep(0.02)
    got["own_refill"] = (len(client_execs(ns)) - n0, ns["_app_pack_held"][("client-profiles", "kay_test")]["lane"])
    await settle()
    ns["_relay_observe_app_pack"]("clientProfileIspSections", form("clientProfileIspSections", {}),
                                  json.dumps({"status": 200, "data": {"filed": "Lee Other", "client_key": "lee_other"}}).encode())
    got["by_answer"] = state()
    await settle()
    n1 = len(client_execs(ns))
    ns["_relay_observe_app_pack"]("emarMedAdd", form("emarMedAdd", {"client": "Lee  Other", "name": "Med"}),
                                  json.dumps({"status": 200, "data": {"id": "7"}}).encode())
    got["by_name"] = state()
    await asyncio.sleep(0.02)
    got["by_name_refill"] = (len(client_execs(ns)) - n1, ns["_app_pack_held"][("client-profiles", "lee_other")]["lane"])
    await settle()
    ns["_relay_observe_app_pack"]("finSubmitTransaction", form("finSubmitTransaction", {"client": "Twin Name"}), ok)
    got["twin"] = state()
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}), ok)
    got["note_no_client"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "client_key": "kay_test",
                                                                               "details": "x"}), ok)
    got["note_client"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("create", form("create", {"Client": "Kay Test", "given": "yes"}, resource="marEntries"),
                                  ok)
    got["verb"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "m1", "client_key": "CLI_lee_other"},
                                                 resource="financeTransactions"), ok)
    got["verb_cli"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "m1"}, resource="marEntries"), ok)
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "p1", "client": "Kay Test"}, resource="people"), ok)
    ns["_relay_observe_app_pack"]("finMarkNoReceipt", form("finMarkNoReceipt", {"id": "t1", "reason": "Lost"}), ok)
    got["unplaced"] = state()
    ns["_relay_observe_app_pack"]("ispContactsSweep", form("ispContactsSweep", {"redo": True}), ok)
    got["sweep"] = state()
    await settle()
    return got


cw = asyncio.run(client_writes())
check("the Clients app's own write makes the client it names dirty, filled again at once on the person's lane; no other "
      "client and no house is touched",
      cw["own"] == {"kay_test": "dirty", "lee_other": "clean", "ABD1305": "clean"} and cw["own_refill"] == (1, "person"),
      cw)
check("…a plan filed with no client asked is placed by the client its answer names",
      cw["by_answer"] == {"kay_test": "clean", "lee_other": "dirty", "ABD1305": "clean"}, cw)
check("a write made elsewhere (the eMAR list) names its client by name: that client stale, filled again in the "
      "background", cw["by_name"] == {"kay_test": "clean", "lee_other": "stale", "ABD1305": "clean"}
      and cw["by_name_refill"] == (1, "housekeeping"), cw)
check("a name two clients carry, or a house note about no client, touches no client",
      cw["twin"] == {"kay_test": "clean", "lee_other": "clean", "ABD1305": "clean"}
      and cw["note_no_client"] == {"kay_test": "clean", "lee_other": "clean", "ABD1305": "dirty"}, cw)
check("a house note about a client: its house dirty (the Locations write) and its client stale",
      cw["note_client"] == {"kay_test": "stale", "lee_other": "clean", "ABD1305": "dirty"}, cw)
check("a generic write to a resource a client's pack reads makes the client it names stale — by any field that speaks "
      "of a client, by name or as CLI_<key>",
      cw["verb"] == {"kay_test": "stale", "lee_other": "clean", "ABD1305": "clean"}
      and cw["verb_cli"] == {"kay_test": "clean", "lee_other": "stale", "ABD1305": "clean"}, cw)
check("an update by id alone, a resource no client pack reads, and a receipt the relay cannot place touch nothing",
      cw["unplaced"] == {"kay_test": "clean", "lee_other": "clean", "ABD1305": "clean"}, cw)
check("the plans' contacts read again make every client's pack stale, and no house's",
      cw["sweep"] == {"kay_test": "stale", "lee_other": "stale", "ABD1305": "clean"}, cw)


async def own_write() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir())
    door = ns["lane_app_pack"]
    headers = types.SimpleNamespace(headers={})
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    n0 = len(client_execs(ns))
    ns["clock"].now += 30
    ns["version"][0] = 2
    # the session wrote 10 s ago, after this copy was read: the copy is never the answer
    after = await door("client-profiles", headers, x_app_pack_key="kay_test", written_ms="10000",
                       authorization="Bearer boss")
    n1 = len(client_execs(ns))
    # wrote 60 s ago, before this copy was read: served as it is
    ns["clock"].now += 30
    before = await door("client-profiles", headers, x_app_pack_key="kay_test", written_ms="60000",
                        authorization="Bearer boss")
    n2 = len(client_execs(ns))
    odd = [await door("client-profiles", headers, x_app_pack_key="kay_test", written_ms=w, authorization="Bearer boss")
           for w in ("-5", "abc", str(20 * 60 * 1000), "0")]
    return {"after": door_client(after), "refilled": n1 - n0, "before": door_client(before), "again": n2 - n1,
            "odd": [door_client(a) for a in odd], "odd_execs": len(client_execs(ns)) - n2}


def door_client(answer: dict[str, Any]) -> tuple[Any, Any, Any]:
    data = answer.get("data") or {}
    return answer.get("status"), data.get("state"), ((data.get("parts") or {}).get("details") or {}).get("v")


ow2 = asyncio.run(own_write())
check("a read that names the session's own write (written_ms) is never answered from a copy read before it: it waits "
      "for one execution and answers the new copy", ow2["after"] == (200, "fresh", 2) and ow2["refilled"] == 1, ow2)
check("…a copy read after the write is served as it is, and a written_ms that is not a count of milliseconds within "
      "fifteen minutes is not heard", ow2["before"] == (200, "fresh", 2) and ow2["again"] == 0
      and ow2["odd"] == [(200, "fresh", 2)] * 4 and ow2["odd_execs"] == 0, ow2)


async def writer_read(ns: dict[str, Any], key: str, written: str, sent: str = "", **more: str) -> dict[str, Any]:
    return await ns["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key=key,
                                    written_ms=written, sent_ms=sent, authorization="Bearer boss", **more)


async def since_sent() -> dict[str, Any]:
    """The writer's read names when its write was answered and when it was sent; the relay answers it with the refill
    it began when it saw the write land."""
    got: dict[str, Any] = {}
    ok = json.dumps({"status": 200, "data": {"saved": True}}).encode()

    async def after_write(action: str, payload: dict, key: str, *, landed: bool, sent: str = "5000") -> tuple:
        ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.2)
        await ns["_app_pack_get"]("client-profiles", key)
        n0 = len(client_execs(ns))
        ns["clock"].now += 30
        ns["version"][0] = 2
        ns["_relay_observe_app_pack"](action, form(action, payload), ok)
        await asyncio.sleep(0.5 if landed else 0.01)
        # the browser stamped the answer 50 ms ago; the write left five seconds ago
        ns["clock"].now += 0.1
        answer = await writer_read(ns, key, "50", sent)
        await asyncio.sleep(0.6)
        return door_client(answer), len(client_execs(ns)) - n0

    # a medicine added in Clients — a write made elsewhere — with the background lane free
    got["elsewhere"] = await after_write("emarMedAdd", {"client": "Lee Other", "name": "Med"}, "lee_other",
                                         landed=False)
    got["elsewhere_landed"] = await after_write("emarMedAdd", {"client": "Lee Other", "name": "Med"}, "lee_other",
                                                landed=True)
    got["own_running"] = await after_write("clientProfileSave", {"client": "kay_test", "fields": {}}, "kay_test",
                                           landed=False)
    got["own_landed"] = await after_write("clientProfileSave", {"client": "kay_test", "fields": {}}, "kay_test",
                                          landed=True)
    # a read that names only when the answer came back: the relay cannot tell when the write landed
    got["no_sent"] = await after_write("clientProfileSave", {"client": "kay_test", "fields": {}}, "kay_test",
                                       landed=True, sent="")

    # a write the relay never saw, sent while a background fill that began before it runs
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.3)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    n0 = len(client_execs(ns))
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    ns["_app_pack_kick"]("client-profiles", "kay_test", housekeeping=True)
    await asyncio.sleep(0.01)
    ns["clock"].now += 10
    ns["version"][0] = 2
    answer = await writer_read(ns, "kay_test", "50", "5000")
    got["unseen_running"] = (door_client(answer), len(client_execs(ns)) - n0)
    await asyncio.sleep(0.4)

    # the same, with a fill that began after the write was answered: it answers, and nothing more is read
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.3)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    n0 = len(client_execs(ns))
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    ns["version"][0] = 2
    ns["_app_pack_kick"]("client-profiles", "kay_test", housekeeping=True)
    await asyncio.sleep(0.01)
    ns["clock"].now += 1
    answer = await writer_read(ns, "kay_test", "20000", "25000")
    got["unseen_after"] = (door_client(answer), len(client_execs(ns)) - n0)
    await asyncio.sleep(0.4)

    # a write the relay saw land before this session sent its own does not answer for it
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.05)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    ns["clock"].now += 100
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test"}), ok)
    await asyncio.sleep(0.2)
    n0 = len(client_execs(ns))
    ns["clock"].now += 60
    ns["version"][0] = 3
    answer = await writer_read(ns, "kay_test", "50", "5000")
    got["older_seen"] = (door_client(answer), len(client_execs(ns)) - n0)
    return got


ss = asyncio.run(since_sent())
check("a medicine added in Clients (a write made elsewhere) with the background lane free: the writer's read is "
      "answered by the refill the relay began when it saw the write land — exactly one execution",
      ss["elsewhere"] == ((200, "fresh", 2), 1) and ss["elsewhere_landed"] == ((200, "fresh", 2), 1), ss)
check("the app's own write: read while its refill runs, one execution; read after it landed, none more",
      ss["own_running"] == ((200, "fresh", 2), 1) and ss["own_landed"] == ((200, "fresh", 2), 1), ss)
check("…a read that names only when the answer came back is never answered from before it: one more execution",
      ss["no_sent"] == ((200, "fresh", 2), 2), ss)
check("a write the relay never saw, sent after the fill running now began: that fill lands dirty and is read again, "
      "and the writer is answered by the second", ss["unseen_running"] == ((200, "fresh", 2), 2), ss)
check("…and a fill that began after the write was answered answers it, with nothing more read",
      ss["unseen_after"] == ((200, "fresh", 2), 1), ss)
check("a write the relay saw land before the session sent its own does not answer for the session's",
      ss["older_seen"] == ((200, "fresh", 3), 1), ss)


async def short_waits() -> dict[str, Any]:
    got: dict[str, Any] = {}
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.3)

    async def read(key: str, **more: str) -> dict[str, Any]:
        return await ns["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key=key,
                                        authorization="Bearer boss", **more)

    t0 = time.monotonic()
    first = await read("kay_test", wait="0")
    spent = time.monotonic() - t0
    await asyncio.sleep(0.01)
    got["zero"] = (first.get("status"), first.get("reason"), "data" in first, spent < 0.1, len(client_execs(ns)))
    t1 = time.monotonic()
    short = await read("kay_test", wait="0.1")
    got["short"] = (short.get("reason"), 0.08 <= time.monotonic() - t1 < 0.25, len(client_execs(ns)))
    await asyncio.sleep(0.3)
    landed = await read("kay_test", wait="0")
    got["landed"] = (door_client(landed), len(client_execs(ns)),
                     ns["_app_pack_held"][("client-profiles", "kay_test")]["lane"])
    capped = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.5, wait_s=0.15)
    t2 = time.monotonic()
    big = await capped["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key="kay_test",
                                       wait="999", authorization="Bearer boss")
    got["capped"] = (big.get("reason"), time.monotonic() - t2 < 0.3)
    plain = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.1, wait_s=1.0)
    odd = await plain["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key="kay_test",
                                      wait="soon", authorization="Bearer boss")
    got["odd"] = door_client(odd)
    await asyncio.sleep(0.6)
    return got


sw2 = asyncio.run(short_waits())
check("a read that waits 0 s on a client nobody holds is `filling` at once, with no data, and starts the one fill",
      sw2["zero"] == (503, "filling", False, True, 1), sw2)
check("…a read that waits 0.1 s gives up after about that long and shares that fill; the next read has it from "
      "memory with nothing more executed — a fill neither read waited out ran in the background",
      sw2["short"] == ("filling", True, 1) and sw2["landed"] == ((200, "fresh", 1), 1, "housekeeping"), sw2)
check("a wait past the relay's own is cut to it, and a wait that is not seconds is the relay's own",
      sw2["capped"] == ("filling", True) and sw2["odd"] == (200, "fresh", 1), sw2)


async def settled(ns: dict[str, Any], seconds: float = 6.0) -> bool:
    """True once no fill is in flight; False when one still is after `seconds`."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if all(t.done() for t in ns["_app_pack_inflight"].values()):
            await asyncio.sleep(0.02)
            return True
        await asyncio.sleep(0.02)
    return False


def lanes_left(ns: dict[str, Any]) -> tuple[int, int, int]:
    """(person's lanes held, background turns free, housekeeping tickets out) — (0, 1, 0) once every fill is done."""
    return len(ns["_app_pack_person_lane"]), ns["_app_pack_bg_sem"]._value, ns["_housekeeping_slots"].out


async def person_lanes() -> dict[str, Any]:
    got: dict[str, Any] = {}
    clients = ["kay_test", "lee_other", "norakey", "twin_a", "twin_b", "old_gone"]
    # the Clients screen's reads (wait=4) and the reads that do not wait, each on six clients nobody holds
    for wait in ("0", "4"):
        ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.25, wait_s=0.15)
        t0 = time.monotonic()
        said = await asyncio.gather(*(ns["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}),
                                                         x_app_pack_key=k, wait=wait, authorization="Bearer boss")
                                      for k in clients))
        spent = time.monotonic() - t0
        done = await settled(ns)
        got[wait] = {"said": sorted({(a.get("status"), a.get("reason")) for a in said}), "quick": spent < 0.3,
                     "peak": dict(ns["lane_peak"]), "execs": len(client_execs(ns)), "done": done,
                     "lanes": sorted({e["lane"] for e in ns["_app_pack_held"].values()}), "left": lanes_left(ns)}
    # five houses nobody holds, read at once by reads that wait 25 s
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.3, wait_s=1.0)

    async def house(code: str) -> tuple[Any, float]:
        t0 = time.monotonic()
        answer = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key=code, wait="25",
                                          authorization="Bearer boss")
        return door_said(answer)[:2] if answer.get("status") == 200 else answer.get("reason"), time.monotonic() - t0

    houses = await asyncio.gather(*(house(c) for c in HOUSES[:5]))
    done = await settled(ns)
    got["houses"] = {"said": sorted(str(a) for a, _ in houses),
                     "filling_quick": all(t < 0.15 for a, t in houses if a == "filling"),
                     "peak": dict(ns["lane_peak"]), "execs": len(execs(ns)), "done": done,
                     "lanes": sorted(e["lane"] for e in ns["_app_pack_held"].values()), "left": lanes_left(ns)}
    # a background fill still queued for its ticket is not moved to a person's lane while both are taken
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.3, wait_s=1.0)
    await hold_every_ticket(ns)
    ns["_app_pack_kick"]("locations", "ABD1305", housekeeping=True)
    busy = [asyncio.ensure_future(ns["_app_pack_get"]("locations", k)) for k in ("ABD1547", "ABD1711")]
    await asyncio.sleep(0.05)
    t0 = time.monotonic()
    full = await ns["_app_pack_get"]("locations", "ABD1305")
    got["full"] = (full.get("reason"), time.monotonic() - t0 < 0.05,
                   ns["_app_pack_promote"][("locations", "ABD1305")].is_set())
    await asyncio.gather(*busy)
    freed = await within(ns["_app_pack_get"]("locations", "ABD1305"))
    got["freed"] = (door_said(freed)[:2] if isinstance(freed, dict) else freed, lane_of(ns, "ABD1305"),
                    len(execs(ns)))
    give_tickets_back(ns)
    await settled(ns)
    got["freed_left"] = lanes_left(ns)
    # the Locations screen's read of one house nobody holds
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.05)
    one = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305", wait="25",
                                   authorization="Bearer boss")
    got["locations"] = (door_said(one), lane_of(ns, "ABD1305"), len(execs(ns)))
    return got


pl = asyncio.run(person_lanes())
for wait in ("0", "4"):
    check(f"six reads that wait {wait} s on clients nobody holds run no execution on a person's lane: each is "
          "`filling`, and their six fills run in the background one at a time, every lane given back",
          pl[wait] == {"said": [(503, "filling")], "quick": True, "peak": {"person": 0, "housekeeping": 1}, "execs": 6,
                       "done": True, "lanes": ["housekeeping"], "left": (0, 1, 0)}, pl[wait])
check("five reads that wait 25 s on houses nobody holds: two fill on a person's lane, the other three are `filling` "
      "at once and fill in the background — never more than two on a person's lane, never more than one behind",
      pl["houses"] == {"said": sorted(["filling"] * 3 + [str((200, "fresh"))] * 2), "filling_quick": True,
                       "peak": {"person": 2, "housekeeping": 1}, "execs": 5, "done": True,
                       "lanes": ["housekeeping"] * 3 + ["person"] * 2, "left": (0, 1, 0)}, pl["houses"])
check("a background fill still queued is not moved to a person's lane while both are taken: the read is `filling` at "
      "once; once one is free the next read moves it there — one execution",
      pl["full"] == ("filling", True, False) and pl["freed"] == ((200, "fresh"), "person", 3)
      and pl["freed_left"] == (0, 1, 0), pl)
check("the Locations screen's 25-second read of a house nobody holds still fills on a person's lane and is answered",
      pl["locations"] == ((200, "fresh", 1), "person", 1), pl)


async def peeks() -> dict[str, Any]:
    got: dict[str, Any] = {}
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.1)

    async def peek(key: str) -> dict[str, Any]:
        return await ns["lane_app_pack"]("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key=key,
                                        peek="1", authorization="Bearer boss")

    t0 = time.monotonic()
    cold = await peek("kay_test")
    got["cold"] = (cold.get("status"), cold.get("reason"), "data" in cold, time.monotonic() - t0 < 0.05)
    await asyncio.sleep(0.02)
    got["started"] = [(c["payload"]["client"], c["tickets_out"]) for c in client_execs(ns)]
    await asyncio.sleep(0.2)
    n = len(client_execs(ns))
    warm = await peek("kay_test")
    got["warm"] = (door_client(warm), len(client_execs(ns)) - n)
    for key in ("old_gone", "nobody_here"):
        got[key] = ((await peek(key)).get("reason"), ("client-profiles", key) in ns["_app_pack_inflight"])
    await hold_every_ticket(ns)
    ns["_app_pack_kick"]("client-profiles", "lee_other", housekeeping=True)
    ns["_app_pack_kick"]("client-profiles", "norakey", housekeeping=True)
    await asyncio.sleep(0.01)
    busy = await peek("twin_a")
    got["busy"] = (busy.get("reason"), ("client-profiles", "twin_a") in ns["_app_pack_inflight"])
    give_tickets_back(ns)
    await asyncio.sleep(0.4)
    ns["_app_pack_invalidate"]("client-profiles", "kay_test")
    dirty = await peek("kay_test")
    got["dirty"] = (dirty.get("status"), "data" in dirty)
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    await asyncio.sleep(0.3)
    n = len(client_execs(ns))
    aged = await peek("lee_other")
    await asyncio.sleep(0.02)
    got["aged"] = (door_client(aged)[:2], [(c["payload"]["client"], c["tickets_out"]) for c in client_execs(ns)[n:]])
    await asyncio.sleep(0.3)
    got["out"] = ns["_housekeeping_slots"].out
    return got


pk = asyncio.run(peeks())
check("a prefetch (peek) of a current client nobody holds is `cold` at once with no data, and starts one fill on the "
      "housekeeping lane — never a person's", pk["cold"] == (503, "cold", False, True)
      and pk["started"] == [("kay_test", 1)], pk)
check("…once it lands a peek has it from memory with nothing executed",
      pk["warm"] == ((200, "fresh", 1), 0), pk)
check("a peek of an archived or unknown client starts nothing, and neither does one while two background fills wait",
      pk["old_gone"] == ("cold", False) and pk["nobody_here"] == ("cold", False) and pk["busy"] == ("cold", False), pk)
check("a peek never serves a copy a write made dirty; one past fresh is served while a background fill reads it "
      "again", pk["dirty"] == (503, False) and pk["aged"] == ((200, "refreshing"), [("lee_other", 1)])
      and pk["out"] == 0, pk)


async def warm_order() -> list[str]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir(), delay=0.01)
    await ns["_app_pack_warm_pass"]()
    return [c["action"] for c in ns["calls"] if c["action"] in ("clientPack", "locationPack")]


wo = asyncio.run(warm_order())
check("the warm pass fills the clients before the houses: a client's screen waits on its pack, a house's slice "
      "sections draw while its pack is gathered", wo == ["clientPack"] * 5 + ["locationPack"], wo)


async def key_in_header() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=clients_dir())
    door = ns["lane_app_pack"]
    by_query = await door("client-profiles", types.SimpleNamespace(headers={}), key="kay_test",
                          authorization="Bearer boss")
    n = len(client_execs(ns))
    by_header = await door("client-profiles", types.SimpleNamespace(headers={}), x_app_pack_key="kay%5Ftest",
                           authorization="Bearer boss")
    house = await door("locations", types.SimpleNamespace(headers={}), key="abd1305", authorization="Bearer boss")
    return {"query": (by_query.get("status"), by_query.get("reason"), n), "header": door_client(by_header),
            "house": door_said(house)}


kh = asyncio.run(key_in_header())
route_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "lane_app_pack")) or ""
check("a client is named in the X-App-Pack-Key header, URI-encoded — never in the address the access logs write: a "
      "client key in the address is 400 and nothing is read",
      kh["query"] == (400, "key", 0) and kh["header"] == (200, "fresh", 1)
      and 'x_app_pack_key: str = Header(default="")' in route_src, kh)
check("…a house code may still ride the address", kh["house"] == (200, "fresh", 1), kh)


async def client_warm() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, delay=0.01, out_dir=clients_dir())
    await ns["_app_pack_get"]("client-profiles", "twin_b")
    ns["_app_pack_invalidate"]("client-profiles", "twin_b", stale=True)
    await asyncio.sleep(0.05)
    ns["_app_pack_held"][("client-profiles", "twin_b")]["stale"] = True
    before = len(client_execs(ns))
    ns["peak"][0] = 0
    filled = await ns["_app_pack_warm_pass"]()
    mine = client_execs(ns)[before:]
    return {"filled": filled, "order": [c["payload"]["client"] for c in mine], "peak": ns["peak"][0],
            "lanes": {c["tickets_out"] for c in mine}, "house": len(execs(ns))}


cwm = asyncio.run(client_warm())
check("the warm pass fills the current clients one execution at a time on the housekeeping lane, a stale one first",
      cwm["order"][0] == "twin_b" and sorted(cwm["order"]) == ["kay_test", "lee_other", "norakey", "twin_a", "twin_b"]
      and cwm["peak"] == 1 and cwm["lanes"] == {1} and cwm["house"] == 1, cwm)

print("\nan SSA's pack")
SSA_ROWS = [{"client_key": "kay_test", "name": "Kay Test", "status": "active", "ssa_name": "Dana  Reyes",
             "ssa_email": "dreyes@board.example"},
            {"client_key": "lee_other", "name": "Lee Other", "status": "", "ssa_name": "dana reyes"},
            {"client_key": "old_gone", "name": "Old Gone", "status": "inactive", "ssa_name": "Omar Pike"},
            {"client_key": "", "name": "Nora Key", "status": "Active", "ssa_name": "Bo Chen"},
            {"client_key": "twin_a", "name": "Twin Name", "status": "active", "ssa_name": ""},
            {"client_key": "ann_lee", "name": "Ann Lee", "status": "active", "ssa_name": "  --  "},
            {"client_key": "long_one", "name": "Long One", "status": "active", "ssa_name": "x" * 81}, "junk"]
SSA_WORDS = ["ssa_danareyes", "Dana Reyes", "danareyes", "ssa_bochen", "Bo Chen", "Omar Pike", "dreyes"]


def ssa_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-ssas-"))
    (tmp / "clients.json").write_text(json.dumps({"rows": SSA_ROWS}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
    return tmp


sdir = ssa_dir()
six = build(out_dir=sdir)["_app_pack_ssa_index"]()
check("the warm keys are the SSAs the clients slice's current clients name — ssa_ and the folded name, once each, in "
      "the slice's order; an SSA only an archived client names is known but not warmed; no name, no key",
      build(out_dir=sdir)["_app_pack_ssa_keys"]() == ["ssa_danareyes", "ssa_bochen"]
      and six["keys"] == {"ssa_danareyes", "ssa_bochen", "ssa_omarpike"}
      and six["of_client"] == {"kay_test": "ssa_danareyes", "lee_other": "ssa_danareyes", "old_gone": "ssa_omarpike",
                               "norakey": "ssa_bochen"}
      and build()["_app_pack_ssa_keys"]() == [], six)


async def ssa_unnamed() -> dict[str, Any]:
    # twin_a's row names no SSA: ssaPack names one from the Asa Client Database and lists twin_a among its current
    listed = {"ssa_ritamaster": [{"client_key": "twin_a", "status": "active"},
                                 {"client_key": "kay_test", "status": "active"}],
              "ssa_omarpike": [{"client_key": "twin_a", "status": "inactive"}]}

    def pack(payload: dict, ns: dict[str, Any]) -> dict:
        sk = payload["payload"]["ssa"]
        return {"status": 200, "data": {"ssa": sk, "built_at": "2026-09-28T12:00:00Z",
                                        "parts": {"overview": {"ssa": {"key": sk}, "clients": listed.get(sk, [])}},
                                        "part_status": {"overview": {"status": 200}}}}

    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir(), pack=pack)
    before = ns["_app_pack_ssa_keys"]()
    await ns["_app_pack_get"]("ssa-profiles", "ssa_omarpike")
    only_inactive = ns["_app_pack_ssa_keys"]()
    await ns["_app_pack_get"]("ssa-profiles", "ssa_ritamaster")
    index = ns["_app_pack_ssa_index"]()
    for e in ns["_app_pack_held"].values():
        e["dirty"] = e["stale"] = False
    saved = json.dumps({"status": 200, "data": {"saved": True}}).encode()
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "twin_a",
                                                                                   "fields": {"outcome": "x"}}), saved)
    return {"before": before, "only_inactive": only_inactive, "after": list(index["active"]),
            "twin": index["of_client"].get("twin_a"), "kay": index["of_client"].get("kay_test"),
            "stale": sorted(k for (a, k), e in ns["_app_pack_held"].items() if a == "ssa-profiles" and e.get("stale"))}


sun = asyncio.run(ssa_unnamed())
check("a current client whose row names no SSA: the SSA whose held pack lists it as current is warmed and named for "
      "it — never one that lists it as past, never over the SSA a row names — and a save of that client makes it stale",
      sun == {"before": ["ssa_danareyes", "ssa_bochen"], "only_inactive": ["ssa_danareyes", "ssa_bochen"],
              "after": ["ssa_danareyes", "ssa_bochen", "ssa_ritamaster"], "twin": "ssa_ritamaster",
              "kay": "ssa_danareyes", "stale": ["ssa_ritamaster"]}, sun)
sns = build(sessions=BOSS, masters=FLAGS, out_dir=sdir)
sfirst, sheaders = ask(sns, "Bearer boss", app_id="ssa-profiles", key=" ssa_danareyes ")
sagain = ask(sns, "Bearer boss", app_id="ssa-profiles", key="ssa_danareyes")[0]
check("the master reads an SSA's pack by its key as the roster gives it, once, from one service execution",
      sfirst.get("status") == 200 and sfirst["data"]["parts"]["overview"]["ssa"]["key"] == "ssa_danareyes"
      and sfirst["data"]["state"] == "fresh" and sagain["data"]["state"] == "fresh" and len(ssa_execs(sns)) == 1
      and ssa_execs(sns)[0]["payload"] == {"ssa": "ssa_danareyes"} and ssa_execs(sns)[0]["service"]
      and "write_id" not in json.dumps(ssa_execs(sns)[0]) and sheaders.get("Cache-Control") == "no-store", sfirst)
sbad = {k: ask(sns, "Bearer boss", app_id="ssa-profiles", key=k)[0].get("status")
        for k in ("Dana Reyes", "danareyes", "SSA_danareyes", "ssa_", "ssa_dana-reyes", "../x", "ssa_" + "x" * 81, "")}
check("a key that is not ssa_ and a folded name is 400", set(sbad.values()) == {400}, sbad)
sns["_acting"]["child"] = (time.time() + 600, "u-boss", "u-kid")
sshut = {who: ask(sns, who, app_id="ssa-profiles", key="ssa_danareyes")[0]
         for who in ("Bearer adm", "Bearer mia", "Bearer sam", "Bearer nobody", "Bearer child")}
check("the door is the master's alone: another admin, a manager, staff, an unknown and a switched session are 404 "
      "'Unknown lane.', a visit 403, and none of them executes anything",
      all(b == {"status": 404, "reason": "unknown", "message": "Unknown lane."} for b in sshut.values())
      and ask(sns, "Bearer boss", app_id="ssa-profiles", key="ssa_danareyes", member="m1")[0].get("status") == 403
      and len(ssa_execs(sns)) == 1, sshut)


async def ssa_key_in_header() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir())
    door = ns["lane_app_pack"]
    by_query = await door("ssa-profiles", types.SimpleNamespace(headers={}), key="ssa_danareyes",
                          authorization="Bearer boss")
    n = len(ssa_execs(ns))
    by_header = await door("ssa-profiles", types.SimpleNamespace(headers={}), x_app_pack_key="ssa%5Fdanareyes",
                           authorization="Bearer boss")
    return {"query": (by_query.get("status"), by_query.get("reason"), n), "header": door_said(by_header),
            "asked": [c["payload"] for c in ssa_execs(ns)]}


skh = asyncio.run(ssa_key_in_header())
check("an SSA is named in the X-App-Pack-Key header, URI-encoded — an SSA key in the address is 400 and nothing is "
      "read", skh["query"] == (400, "key", 0) and skh["header"] == (200, "fresh", 1)
      and skh["asked"] == [{"ssa": "ssa_danareyes"}], skh)


async def ssa_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir())
    for k in ("ssa_danareyes", "ssa_bochen", "ssa_omarpike"):
        await ns["_app_pack_get"]("ssa-profiles", k)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    await ns["_app_pack_get"]("locations", "ABD1305")

    def state() -> dict[str, str]:
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (a, k), e in ns["_app_pack_held"].items()}

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    ok = json.dumps({"status": 200, "data": {"note": {"id": "SN_1", "body": "x"}}}).encode()
    got: dict[str, Any] = {}
    n0 = len(ssa_execs(ns))
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("ssaProfileNoteAdd", form("ssaProfileNoteAdd", {"ssa": "ssa_danareyes",
                                                                                   "body": "Called back"}), ok)
    got["own"] = state()
    await asyncio.sleep(0.02)
    held = ns["_app_pack_held"][("ssa-profiles", "ssa_danareyes")]
    got["own_refill"] = (len(ssa_execs(ns)) - n0, held["lane"], held["data"]["parts"]["overview"]["v"])
    await settle()
    ns["_relay_observe_app_pack"]("ssaProfileNoteAdd", form("ssaProfileNoteAdd", {"ssa": "ssa_bochen", "body": "x"}),
                                  json.dumps({"status": 400, "message": "body: what the note says."}).encode())
    got["refused"] = state()
    await settle()
    saved = json.dumps({"status": 200, "data": {"saved": True}}).encode()
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "fields": {"outcome": "x"}}), saved)
    got["client_save"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "fields": {"ssa_name": "Bo Chen"}}),
                                  saved)
    got["moved"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "c1", "client_key": "CLI_norakey"},
                                                 resource="clients"), saved)
    got["verb"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "c1"}, resource="clients"), saved)
    ns["_relay_observe_app_pack"]("emarMedAdd", form("emarMedAdd", {"client": "Kay Test", "name": "Med"}), saved)
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}),
                                  saved)
    got["untouched"] = {k: v for k, v in state().items() if k.startswith("ssa_")}
    await settle()
    ns["_relay_observe_app_pack"]("ispContactsSweep", form("ispContactsSweep", {"redo": True}), saved)
    got["sweep"] = state()
    await settle()
    return got


sw3 = asyncio.run(ssa_writes())
S_CLEAN = {"ssa_danareyes": "clean", "ssa_bochen": "clean", "ssa_omarpike": "clean", "kay_test": "clean",
           "ABD1305": "clean"}
check("the SSA app's own note makes the SSA it names dirty, filled again at once on the person's lane with the new "
      "copy; no other SSA, client or house is touched",
      sw3["own"] == {**S_CLEAN, "ssa_danareyes": "dirty"} and sw3["own_refill"] == (1, "person", 2), sw3)
check("a refused note changes nothing", sw3["refused"] == S_CLEAN, sw3)
check("a client's record saved in Clients: that client dirty, and the SSA its record names stale",
      sw3["client_save"] == {**S_CLEAN, "kay_test": "dirty", "ssa_danareyes": "stale"}, sw3)
check("…a save that gives the client another SSA makes that SSA stale",
      sw3["moved"] == {**S_CLEAN, "kay_test": "dirty", "ssa_bochen": "stale"}, sw3)
check("a generic write to a client's record makes the SSA of the client it names stale (CLI_<key> included)",
      sw3["verb"]["ssa_bochen"] == "stale" and sw3["verb"]["ssa_danareyes"] == "clean"
      and sw3["verb"]["ssa_omarpike"] == "clean", sw3)
check("an update by id alone, the eMAR list and a house note touch no SSA",
      sw3["untouched"] == {"ssa_danareyes": "clean", "ssa_bochen": "clean", "ssa_omarpike": "clean"}, sw3)
check("the plans' contacts read again make every SSA's pack stale, and no house's",
      {k: v for k, v in sw3["sweep"].items() if k.startswith("ssa_")}
      == {"ssa_danareyes": "stale", "ssa_bochen": "stale", "ssa_omarpike": "stale"}
      and sw3["sweep"]["ABD1305"] == "clean", sw3)


async def ssa_writer_read() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir(), delay=0.2)
    await ns["_app_pack_get"]("ssa-profiles", "ssa_bochen")
    n0 = len(ssa_execs(ns))
    ns["clock"].now += 30
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("ssaProfileNoteAdd", form("ssaProfileNoteAdd", {"ssa": "ssa_bochen", "body": "x"}),
                                  json.dumps({"status": 200, "data": {"note": {"id": "SN_2"}}}).encode())
    await asyncio.sleep(0.01)
    ns["clock"].now += 0.1
    answer = await ns["lane_app_pack"]("ssa-profiles", types.SimpleNamespace(headers={}), x_app_pack_key="ssa_bochen",
                                      written_ms="50", sent_ms="5000", authorization="Bearer boss")
    await asyncio.sleep(0.3)
    return {"answer": door_said(answer), "execs": len(ssa_execs(ns)) - n0}


swr3 = asyncio.run(ssa_writer_read())
check("the note's writer reads the refill the relay began when it saw the note land — never the copy from before it, "
      "exactly one execution", swr3 == {"answer": (200, "fresh", 2), "execs": 1}, swr3)


async def ssa_swr() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir(), delay=0.05)
    await ns["_app_pack_get"]("ssa-profiles", "ssa_danareyes")
    ns["version"][0] = 2
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    served = await asyncio.gather(*(ns["_app_pack_get"]("ssa-profiles", "ssa_danareyes") for _ in range(3)))
    await asyncio.sleep(0.2)
    lane = ns["_app_pack_held"][("ssa-profiles", "ssa_danareyes")]["lane"]
    n = len(ssa_execs(ns))
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + 1
    t0 = time.monotonic()
    past = await ns["_app_pack_get"]("ssa-profiles", "ssa_danareyes", wait_s=0)
    spent = time.monotonic() - t0
    await asyncio.sleep(0.2)
    return {"served": [door_said(a) for a in served], "lane": lane, "execs": n,
            "past": (past.get("status"), past.get("reason"), "data" in past, spent < 0.05)}


sr3 = asyncio.run(ssa_swr())
check("an SSA's pack past fresh is served while one background fill reads it again; past the ceiling it is never "
      "served", sr3["served"] == [(200, "refreshing", 1)] * 3 and sr3["lane"] == "housekeeping" and sr3["execs"] == 2
      and sr3["past"] == (503, "filling", False, True), sr3)


async def ssa_warm() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=ssa_dir(), delay=0.01)
    filled = await ns["_app_pack_warm_pass"]()
    mine = ssa_execs(ns)
    return {"filled": filled, "order": [c["action"] for c in ns["calls"]
                                        if c["action"] in ("clientPack", "ssaPack", "locationPack")],
            "ssas": [c["payload"]["ssa"] for c in mine], "peak": ns["peak"][0], "lanes": {c["tickets_out"] for c in mine},
            "again": await ns["_app_pack_warm_pass"](), "out": ns["_housekeeping_slots"].out}


swm = asyncio.run(ssa_warm())
check("the warm pass fills the SSAs the current clients name after the clients and before the houses, one execution "
      "at a time on the housekeeping lane, and a second pass fills nothing",
      swm["order"] == ["clientPack"] * 6 + ["ssaPack"] * 2 + ["locationPack"]
      and swm["ssas"] == ["ssa_danareyes", "ssa_bochen"] and swm["peak"] == 1 and swm["lanes"] == {1}
      and swm["again"] == 0 and swm["out"] == 0, swm)


async def three_apps_held() -> dict[str, Any]:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-three-"))
    rows = [{"client_key": f"client_{i:02d}", "name": f"Client {i:02d}", "status": "active",
             "ssa_name": f"Coordinator {i:02d}"} for i in range(30)]
    (tmp / "clients.json").write_text(json.dumps({"rows": rows}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": c, "active": True} for c in HOUSES]}))
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=tmp)
    filled = await ns["_app_pack_warm_pass"]()
    return {"filled": filled, "held": len(ns["_app_pack_held"]), "again": await ns["_app_pack_warm_pass"]()}


th = asyncio.run(three_apps_held())
check("every app's warm keys are held together — seventeen houses, thirty clients, thirty SSAs and the families index "
      "with the member it names, past the keys one app keeps — and a second pass fills nothing, nothing let go to be "
      "filled again",
      th == {"filled": 77 + len(INDEX_WARMED), "held": 77 + len(INDEX_WARMED), "again": 0}, th)

print("\na candidate's pack")
CAN_A, CAN_B, CAN_C, CAN_D = ("CAN_9B36B4B37FD60C5097D2", "CAN_7952F2F4CA36D4245BA1", "CAN_86A1B71848306F8AA771",
                              "CAN_00A9B95F4D47496659DE")
CANDIDATE_ROWS = [{"id": CAN_A, "name": "Rae Moss", "stage": "phone-screen", "phone": "3305550101"},
                  {"id": CAN_B, "name": "Tom Vale", "stage": "onboarding", "tpCandidateId": "CAN-020"},
                  {"id": CAN_A, "name": "Rae Moss", "stage": "phone-screen"},
                  {"id": "CAN-020", "name": "Pool Only", "stage": "new"},
                  {"id": CAN_C, "name": "Ivy Stone", "stage": ""},
                  {"id": "CAN_" + "A" * 81, "name": "Long Id", "stage": "new"},
                  {"id": CAN_D, "name": "Lee Ward", "stage": "hired"}, "junk"]
CANDIDATE_WORDS = ["CAN_", "CAN-020", "Rae Moss", "Tom Vale", "Ivy Stone", "Lee Ward", "3305550101"]


def candidates_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-candidates-"))
    (tmp / "candidates.json").write_text(json.dumps({"resource": "candidates", "rows": CANDIDATE_ROWS}))
    (tmp / "clients.json").write_text(json.dumps({"rows": SSA_ROWS}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
    return tmp


def door_candidate(answer: dict[str, Any]) -> tuple[Any, Any, Any]:
    data = answer.get("data") or {}
    return answer.get("status"), data.get("state"), ((data.get("parts") or {}).get("overview") or {}).get("v")


cdir = candidates_dir()
check("the warm keys are the candidates on the hiring board — the candidates slice's ids, once each, in its order; a "
      "pool id, a row on no stage and an id past a key's length are not, and no slice is no key",
      build(out_dir=cdir)["_app_pack_candidate_keys"]() == [CAN_A, CAN_B, CAN_D]
      and build()["_app_pack_candidate_keys"]() == [], build(out_dir=cdir)["_app_pack_candidate_keys"]())
cof = build()["_app_pack_candidate_of"]
said_of = {
    "request": cof({"payload": {"candidate_id": CAN_A, "to_stage": "interview"}}, None),
    "the app's own": cof({"payload": {"candidate": f" {CAN_B} "}}, None),
    "a list of one": cof({"payload": {"candidate_ids": [CAN_A]}}, None),
    "a list of two": cof({"payload": {"candidate_ids": [CAN_A, CAN_B]}}, None),
    "the answer": cof({"payload": {"doc_id": "d1"}}, {"status": 200, "data": {"row": {"candidate_id": CAN_B}}}),
    "a pool id": cof({"payload": {"tp_candidate_id": "CAN-020"}}, None),
    "a field that is not a candidate's": cof({"payload": {"id": CAN_A, "file_id": CAN_B}}, None),
    "none": cof({}, {"status": 200, "data": "x"}),
}
check("a write names the candidate a field about a candidate holds — in the request, else in the row it answers with; "
      "a list of one is that one; a list of more, a pool id, or an id under another name is none",
      said_of == {"request": CAN_A, "the app's own": CAN_B, "a list of one": CAN_A, "a list of two": "",
                  "the answer": CAN_B, "a pool id": "", "a field that is not a candidate's": "", "none": ""}, said_of)
sspec = build()["_APP_PACKS"]["staff-team"]
check("an address saved on My Info (an own-record door, its request naming nobody) makes the staff member its answer "
      "names stale in the team's Staff pack; the master's names them in the request",
      "staffProfileAddressEdit" in sspec["elsewhere"] and "staffProfileAddressEdit" not in sspec["writes"]
      and sspec["key_of"]({"payload": {"changes": []}}, {"status": 200, "data": {"staff_key": "ann9lee"}}) == "ann9lee"
      and sspec["key_of"]({"payload": {"key": "bob9twin"}}, {"status": 200, "data": {"staff_key": "bob9twin"}}) == "bob9twin"
      and sspec["key_of"]({"payload": {}}, {"status": 200, "data": {"staff_key": "a!"}}) == ""
      and sspec["key_of"]({"payload": {}}, None) == "",
      sorted(sspec["elsewhere"]))
cspec = build()["_APP_PACKS"]["staff-candidates"]
watched = cspec["writes"] | cspec["elsewhere"] | cspec["sweeps"]
check("a write through a Hiring door keeps its exactly-once receipt (Python's own doors answer in asa-hub-app's words), "
      "and no door is both the app's own and elsewhere's",
      not (watched & listed - set(PY_DOORS)) and not (cspec["writes"] & cspec["elsewhere"])
      and not (cspec["writes"] & cspec["sweeps"]) and not (cspec["elsewhere"] & cspec["sweeps"]),
      sorted(watched & listed - set(PY_DOORS)))
CANDIDATE_SPA = ROOT / "src" / "pages" / "features" / "staffcandidates"
if CANDIDATE_SPA.is_dir():
    lanes = {name: policy_lane(block) for gs in sorted((ROOT / "apps-script").glob("*.gs"))
             for name, block in re.findall(r"HUB_POLICY\.(\w+)\s*=\s*\{(.*?)\n\};", gs.read_text(encoding="utf-8"),
                                           re.S)}
    lanes.update({a: d.get("lane") for a, d in PY_DOORS.items()})
    sent = {a for p in sorted(CANDIDATE_SPA.rglob("*.ts*"))
            for a in re.findall(r"gasAction[^(\n]*\(\s*'(\w+)'", p.read_text(encoding="utf-8"))}
    sent_writes = {a for a in sent if a not in CANDIDATE_READS and lanes.get(a) != "read"}
    # its edits are Python's own doors, kept final in Postgres
    own_edits = {a for a in sent_writes if a in PY_DOORS}
    # the Hiring doors a press opens: CND_DOOR_FIELDS' keys, each a door with its map of fields
    doors_block = re.search(r"^var CND_DOOR_FIELDS = \{(.*?)\n\};", CANDIDATE_GS.read_text(encoding="utf-8")
                            if CANDIDATE_GS.exists() else "", re.S | re.M)
    pressed = set(re.findall(r"(\w+):\s*\{", doors_block.group(1))) if doors_block else set()
    check("the app's own writes — its note, its press and its edits — are its writes, and every Hiring door a press "
          "opens is watched",
          sent_writes - own_edits == {"candidateProfileNoteAdd", "candidateProfileDoor"}
          and sent_writes <= set(cspec["writes"])
          and len(pressed) == 9 and pressed <= watched,
          {"sent": sorted(sent_writes), "declared": sorted(cspec["writes"]), "pressed": sorted(pressed),
           "unwatched": sorted(pressed - watched)})
else:
    print("  skip the Staff Candidates screens are not in this tree: their writes are not compared")
cns = build(sessions=BOSS, masters=FLAGS, out_dir=cdir)
cfirst, cheaders = ask(cns, "Bearer boss", app_id="staff-candidates", key=f" {CAN_A} ")
cagain = ask(cns, "Bearer boss", app_id="staff-candidates", key=CAN_A)[0]
check("the master reads a candidate's pack by the id the board gives, once, from one service execution",
      cfirst.get("status") == 200 and cfirst["data"]["parts"]["overview"]["candidate"]["key"] == CAN_A
      and cfirst["data"]["state"] == "fresh" and cagain["data"]["state"] == "fresh" and len(candidate_execs(cns)) == 1
      and candidate_execs(cns)[0]["payload"] == {"candidate": CAN_A} and candidate_execs(cns)[0]["service"]
      and "write_id" not in json.dumps(candidate_execs(cns)[0]) and cheaders.get("Cache-Control") == "no-store", cfirst)
cbad = {k: ask(cns, "Bearer boss", app_id="staff-candidates", key=k)[0].get("status")
        for k in ("CAN-020", "can_9b36b4b37fd60c5097d2", "CAN_abc", "CAN_" + "A" * 81, "CAN_9B36 B4B37", "Rae Moss",
                  "../x", "")}
check("a key that is not a candidate id is 400", set(cbad.values()) == {400} and len(candidate_execs(cns)) == 1, cbad)
cns["_acting"]["child"] = (time.time() + 600, "u-boss", "u-kid")
cshut = {who: ask(cns, who, app_id="staff-candidates", key=CAN_A)[0]
         for who in ("Bearer adm", "Bearer mia", "Bearer sam", "Bearer nobody", "Bearer child")}
check("the door is the master's alone: another admin, a manager, staff, an unknown and a switched session are 404 "
      "'Unknown lane.', a visit 403, and none of them executes anything",
      all(b == {"status": 404, "reason": "unknown", "message": "Unknown lane."} for b in cshut.values())
      and ask(cns, "Bearer boss", app_id="staff-candidates", key=CAN_A, member="m1")[0].get("status") == 403
      and len(candidate_execs(cns)) == 1, cshut)


async def candidate_key_in_header() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir())
    door = ns["lane_app_pack"]
    by_query = await door("staff-candidates", types.SimpleNamespace(headers={}), key=CAN_B, authorization="Bearer boss")
    n = len(candidate_execs(ns))
    by_header = await door("staff-candidates", types.SimpleNamespace(headers={}),
                           x_app_pack_key=urllib.parse.quote(CAN_B), authorization="Bearer boss")
    return {"query": (by_query.get("status"), by_query.get("reason"), n), "header": door_candidate(by_header),
            "asked": [c["payload"] for c in candidate_execs(ns)]}


ckh = asyncio.run(candidate_key_in_header())
check("a candidate is named in the X-App-Pack-Key header — a candidate key in the address is 400 and nothing is read",
      ckh["query"] == (400, "key", 0) and ckh["header"] == (200, "fresh", 1) and ckh["asked"] == [{"candidate": CAN_B}],
      ckh)


async def candidate_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir())
    for k in (CAN_A, CAN_B, CAN_D):
        await ns["_app_pack_get"]("staff-candidates", k)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    await ns["_app_pack_get"]("ssa-profiles", "ssa_danareyes")
    await ns["_app_pack_get"]("locations", "ABD1305")

    def state() -> dict[str, str]:
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (a, k), e in ns["_app_pack_held"].items()}

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    ok = json.dumps({"status": 200, "data": {"moved": True}}).encode()
    got: dict[str, Any] = {}
    n0 = len(candidate_execs(ns))
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("moveStage", form("moveStage", {"candidate_id": CAN_A, "to_stage": "interview"}), ok)
    got["own"] = state()
    await asyncio.sleep(0.02)
    held = ns["_app_pack_held"][("staff-candidates", CAN_A)]
    got["own_refill"] = (len(candidate_execs(ns)) - n0, held["lane"], held["data"]["parts"]["overview"]["v"])
    await settle()
    ns["_relay_observe_app_pack"]("moveStage", form("moveStage", {"candidate_id": CAN_B, "to_stage": "new"}),
                                  json.dumps({"status": 409, "reason": "already_at"}).encode())
    got["refused"] = state()
    await settle()
    for action in ("screenSave", "interviewInviteSend", "interviewSave"):
        ns["_relay_observe_app_pack"](action, form(action, {"candidate_id": CAN_B}), ok)
    got["elsewhere"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("candidateProfileNoteAdd",
                                  form("candidateProfileNoteAdd", {"candidate": CAN_D, "body": "Called back"}),
                                  json.dumps({"status": 200, "data": {"note": {"id": "N_1"}}}).encode())
    ns["_relay_observe_app_pack"]("packetWaive", form("packetWaive", {"candidate_id": CAN_B, "note": "In the binder"}),
                                  ok)
    got["note_and_packet"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("docReview", form("docReview", {"doc_id": "d1", "decision": "verified"}),
                                  json.dumps({"status": 200, "data": {"row": {"candidate_id": CAN_D}}}).encode())
    got["answered"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("manualContactSend", form("manualContactSend", {"tp_candidate_id": "CAN-020"}), ok)
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "fields": {"outcome": "x"}}), ok)
    ns["_relay_observe_app_pack"]("ssaProfileNoteAdd", form("ssaProfileNoteAdd", {"ssa": "ssa_danareyes",
                                                                                   "body": "x"}), ok)
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}), ok)
    ns["_relay_observe_app_pack"]("screenWatch", form("screenWatch", {"candidate_id": CAN_A}), ok)
    got["untouched"] = {k: v for k, v in state().items() if k.startswith("CAN_")}
    await settle()
    ns["_relay_observe_app_pack"]("moveStage", form("moveStage", {"to_stage": "interview"}), ok)
    got["own_unnamed"] = state()
    await settle()
    ns["_relay_observe_app_pack"]("talentArchive", form("talentArchive", {"candidate_ids": [CAN_A, CAN_B],
                                                                           "archived": True}), ok)
    got["sweep"] = state()
    await settle()
    upload = form("cjisUpload", {"candidate_id": CAN_B, "filename": "cjis.pdf", "base64": "QUJD" * 30_000})
    ns["_relay_observe_app_pack"](ns["_relay_action"](upload), upload, ok)
    got["upload"] = (len(upload) > 100_000, ns["_relay_action"](upload), state())
    await settle()
    pressed = json.dumps({"status": 200, "data": {"candidate": CAN_A, "door": "moveStage", "logged": True}}).encode()
    ns["_relay_observe_app_pack"]("candidateProfileDoor",
                                  form("candidateProfileDoor", {"candidate": CAN_A, "press": "stage", "item": "interview",
                                                                "fields": {}}), pressed)
    got["press"] = state()
    await settle()
    paper = form("candidateProfileDoor", {"candidate": CAN_D, "press": "upload", "item": "doc_drivers_id",
                                          "fields": {"filename": "id.pdf", "base64": "QUJD" * 30_000}})
    ns["_relay_observe_app_pack"](ns["_relay_action"](paper), paper, ok)
    got["press_upload"] = (len(paper) > 100_000, state())
    await settle()
    return got


cw = asyncio.run(candidate_writes())
C_CLEAN = {CAN_A: "clean", CAN_B: "clean", CAN_D: "clean", "kay_test": "clean", "ssa_danareyes": "clean",
           "ABD1305": "clean"}
C_ONLY = {CAN_A: "clean", CAN_B: "clean", CAN_D: "clean"}
check("the app's own write — a Hiring door, the stage move — makes the candidate it names dirty, filled again at once "
      "on the person's lane with the new copy; no other candidate, client, SSA or house is touched",
      cw["own"] == {**C_CLEAN, CAN_A: "dirty"} and cw["own_refill"] == (1, "person", 2), cw)
check("a refused move changes nothing", cw["refused"] == C_CLEAN, cw)
check("the app's own note, and a packet attested by hand, make the candidate each names dirty",
      cw["note_and_packet"] == {**C_CLEAN, CAN_B: "dirty", CAN_D: "dirty"}, cw)
check("a Hiring door used elsewhere — a screen saved, an invite sent, a scorecard saved — makes the candidate stale; "
      "one whose answer names the candidate does too",
      cw["elsewhere"] == {**C_CLEAN, CAN_B: "stale"} and cw["answered"] == {**C_CLEAN, CAN_D: "stale"}, cw)
check("a pool id, a client's save, an SSA's note, a house note and a screen watched touch no candidate",
      cw["untouched"] == C_ONLY, cw)
check("the app's own write that names no candidate, and an archive of several, make every candidate stale and no "
      "client, SSA or house",
      cw["own_unnamed"] == {**C_CLEAN, CAN_A: "stale", CAN_B: "stale", CAN_D: "stale"}
      and cw["sweep"] == {**C_CLEAN, CAN_A: "stale", CAN_B: "stale", CAN_D: "stale"}, cw)
check("a paper past 100 KB the relay does not parse still names its candidate from its opening bytes: that one stale",
      cw["upload"] == (True, "", {**C_CLEAN, CAN_B: "stale"}), cw["upload"])
check("the app's own press on a Hiring door makes the candidate it names dirty — a paper past 100 KB by its opening "
      "bytes too — and no other",
      cw["press"] == {**C_CLEAN, CAN_A: "dirty"} and cw["press_upload"] == (True, {**C_CLEAN, CAN_D: "dirty"}),
      {"press": cw["press"], "press_upload": cw["press_upload"]})


async def candidate_sending() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir())
    for k in (CAN_A, CAN_B):
        await ns["_app_pack_get"]("staff-candidates", k)
    before = sorted(kept_files(ns))
    ns["_app_pack_sending"]("moveStage", form("moveStage", {"candidate_id": CAN_A, "to_stage": "interview"}))
    ns["_app_pack_sending"]("screenSave", form("screenSave", {"candidate_id": CAN_B}))
    return {"before": before == sorted([kept_name("staff-candidates", CAN_A), kept_name("staff-candidates", CAN_B)]),
            "after": sorted(kept_files(ns)) == [kept_name("staff-candidates", CAN_B)],
            "names": not any(w in n for n in before for w in CANDIDATE_WORDS),
            "served": door_candidate(await ns["_app_pack_get"]("staff-candidates", CAN_B))}


cs = asyncio.run(candidate_sending())
check("a candidate's pack is kept under a hash, never its id; the app's own write takes the kept copy off the disk "
      "before it leaves, and a door used elsewhere leaves its copy served",
      cs == {"before": True, "after": True, "names": True, "served": (200, "fresh", 1)}, cs)


async def candidate_writer_read() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir(), delay=0.2)
    await ns["_app_pack_get"]("staff-candidates", CAN_B)
    n0 = len(candidate_execs(ns))
    ns["clock"].now += 30
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("onboardingManualComplete",
                                  form("onboardingManualComplete", {"candidate_id": CAN_B, "notes": "done"}),
                                  json.dumps({"status": 200, "data": {"completed": True}}).encode())
    await asyncio.sleep(0.01)
    ns["clock"].now += 0.1
    answer = await ns["lane_app_pack"]("staff-candidates", types.SimpleNamespace(headers={}), x_app_pack_key=CAN_B,
                                      written_ms="50", sent_ms="5000", authorization="Bearer boss")
    await asyncio.sleep(0.3)
    return {"answer": door_candidate(answer), "execs": len(candidate_execs(ns)) - n0}


cwr = asyncio.run(candidate_writer_read())
check("the writer of a completion reads the refill the relay began when it saw it land — never the copy from before "
      "it, exactly one execution", cwr == {"answer": (200, "fresh", 2), "execs": 1}, cwr)


async def candidate_swr() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir(), delay=0.05)
    await ns["_app_pack_get"]("staff-candidates", CAN_A)
    ns["version"][0] = 2
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    served = await asyncio.gather(*(ns["_app_pack_get"]("staff-candidates", CAN_A) for _ in range(3)))
    await asyncio.sleep(0.2)
    lane = ns["_app_pack_held"][("staff-candidates", CAN_A)]["lane"]
    n = len(candidate_execs(ns))
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + 1
    past = await ns["_app_pack_get"]("staff-candidates", CAN_A, wait_s=0)
    await asyncio.sleep(0.2)
    return {"served": [door_candidate(a) for a in served], "lane": lane, "execs": n,
            "past": (past.get("status"), past.get("reason"), "data" in past)}


csr = asyncio.run(candidate_swr())
check("a candidate's pack past fresh is served while one background fill reads it again; past the ceiling it is "
      "never served", csr["served"] == [(200, "refreshing", 1)] * 3 and csr["lane"] == "housekeeping"
      and csr["execs"] == 2 and csr["past"] == (503, "filling", False), csr)


async def candidate_warm() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=candidates_dir(), delay=0.01)
    filled = await ns["_app_pack_warm_pass"]()
    mine = candidate_execs(ns)
    return {"filled": filled, "order": [c["action"] for c in ns["calls"]
                                        if c["action"] in ("clientPack", "ssaPack", "candidatePack", "locationPack")],
            "candidates": [c["payload"]["candidate"] for c in mine], "peak": ns["peak"][0],
            "lanes": {c["tickets_out"] for c in mine}, "again": await ns["_app_pack_warm_pass"](),
            "out": ns["_housekeeping_slots"].out}


cwm2 = asyncio.run(candidate_warm())
check("the warm pass fills the candidates on the board after the clients and the SSAs and before the houses, one "
      "execution at a time on the housekeeping lane, and a second pass fills nothing",
      cwm2["order"] == ["clientPack"] * 6 + ["ssaPack"] * 2 + ["candidatePack"] * 3 + ["locationPack"]
      and cwm2["candidates"] == [CAN_A, CAN_B, CAN_D] and cwm2["peak"] == 1 and cwm2["lanes"] == {1}
      and cwm2["again"] == 0 and cwm2["out"] == 0, cwm2)


async def four_apps_held() -> dict[str, Any]:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-four-"))
    rows = [{"client_key": f"client_{i:02d}", "name": f"Client {i:02d}", "status": "active",
             "ssa_name": f"Coordinator {i:02d}"} for i in range(30)]
    (tmp / "clients.json").write_text(json.dumps({"rows": rows}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": c, "active": True} for c in HOUSES]}))
    (tmp / "candidates.json").write_text(json.dumps({"rows": [{"id": f"CAN_{i:020X}", "stage": "new"}
                                                              for i in range(20)]}))
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=tmp)
    filled = await ns["_app_pack_warm_pass"]()
    return {"filled": filled, "held": len(ns["_app_pack_held"]), "again": await ns["_app_pack_warm_pass"]()}


fh = asyncio.run(four_apps_held())
check("…and with twenty candidates on the board besides, every app's warm keys are still held together",
      fh == {"filled": 97 + len(INDEX_WARMED), "held": 97 + len(INDEX_WARMED), "again": 0}, fh)


async def candidate_restart() -> dict[str, Any]:
    folder = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "app-packs"
    folder.mkdir()
    one =build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=candidates_dir())
    await one["_app_pack_get"]("staff-candidates", CAN_A)
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=candidates_dir(), delay=0.02)
    two["clock"].now += 600
    two["version"][0] = 2
    taken = await two["_app_pack_adopt_disk"]()
    held = two["_app_pack_held"][("staff-candidates", CAN_A)]
    served = await two["_app_pack_get"]("staff-candidates", CAN_A)
    await asyncio.sleep(0.1)
    return {"taken": taken, "marks": (held["stale"], held["dirty"]), "served": door_candidate(served),
            "refills": len(candidate_execs(two))}


crs = asyncio.run(candidate_restart())
check("after a restart a kept candidate's pack is taken up stale, served while it is read again once",
      crs == {"taken": 1, "marks": (True, False), "served": (200, "refreshing", 1), "refills": 1}, crs)


print("\na referral's pack (Client Candidates)")
# each expiry is read against the test clock's own day: "Due Today" expires on it
LEAD_UUID = "3f2c9a1e-0b7d-4c2e-9f11-2a6d5e8b7c40"
LEAD_ROWS = [{"id": "LEAD_2310", "client_name": "Rosa Vega", "stage": "new", "expiration_date": "02/01/27"},
             {"id": "LEAD_2301", "client_name": "Old Scrape", "stage": "new", "expiration_date": "01/10/27"},
             {"id": "LEAD_2300", "client_name": "Moved Along", "stage": "Assessment", "expiration_date": "12/01/26"},
             {"id": "LEAD_2299", "client_name": "Won Already", "stage": "converted", "expiration_date": "03/01/27"},
             {"id": "LEAD_2298", "client_name": "Went Elsewhere", "stage": "lost", "expiration_date": ""},
             {"id": LEAD_UUID, "client_name": "Hand Added", "stage": "new", "expiration_date": ""},
             {"id": "LEAD_2297", "client_name": "Due Today", "stage": "read", "expiration_date": "2027-01-15"},
             {"id": "LEAD_2296", "client_name": "Gone Last Year", "stage": "new", "expiration_date": "2026-12-31"},
             {"id": "LEAD_2310", "client_name": "Rosa Vega", "stage": "new", "expiration_date": "02/01/27"},
             {"id": "L1", "client_name": "Too Short", "stage": "new"},
             {"id": "LEAD_2294", "client_name": "  ", "stage": "new"},
             {"id": "../x", "client_name": "Bad Id", "stage": ""},
             {"id": "LEAD_2295", "client_name": "No Day", "stage": "", "expiration_date": "soon"},
             {"id": "LEAD_2293", "client_name": "Placed Review", "stage": "Placement Review", "expiration_date": "12/01/26"},
             {"id": "LEAD_2292", "client_name": "Now Closed", "stage": "Closed", "expiration_date": "03/01/27"},
             {"id": "LEAD_2291", "client_name": "Ready Now", "stage": "Ready for Intake", "expiration_date": "03/01/27"},
             {"id": "LEAD_2290", "client_name": "Held Back", "stage": "On hold", "expiration_date": "03/01/27"},
             {"id": "LEAD_2289", "client_name": "In Discovery", "stage": "discovery", "expiration_date": "01/01/26"},
             "junk"]
LEAD_WORDS = ["LEAD_2310", "LEAD_2300", LEAD_UUID, "Rosa Vega", "Moved Along", "Hand Added"]
LEAD_ACTIVE = ["LEAD_2310", "LEAD_2300", LEAD_UUID, "LEAD_2297", "LEAD_2295", "LEAD_2293", "LEAD_2289"]


def lead_dir(houses: bool = True) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-leads-"))
    (tmp / "potentialClients.json").write_text(json.dumps({"resource": "potentialClients", "rows": LEAD_ROWS}))
    if houses:
        (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
    return tmp


def door_lead(answer: dict[str, Any]) -> tuple[Any, Any, Any]:
    data = answer.get("data") or {}
    return answer.get("status"), data.get("state"), ((data.get("parts") or {}).get("overview") or {}).get("v")


ldir = lead_dir()
check("the warm keys are the referrals still in the intake, in the potentialClients slice's order, once each: a window "
      "still open (today's included, no day or an unreadable one is not an expired one) or moved into the intake by a "
      "hand (Discovery, Assessment, Placement Review or the words rows already hold) — never one Ready for Intake, "
      "Closed, converted, lost or on hold, one whose window closed untouched, a row with no name (the roster lists "
      "none), or an id the pack cannot read",
      build(out_dir=ldir)["_app_pack_lead_keys"]() == LEAD_ACTIVE and build()["_app_pack_lead_keys"]() == [],
      build(out_dir=ldir)["_app_pack_lead_keys"]())
lday = build()["_app_pack_lead_day"]
check("a referral's expiry is read as the portal writes it (MM/DD/YY) and as ISO",
      [lday(v) for v in ("08/11/26", "8/1/2026", "8/1/2026 10:00", "2026-08-06", "2026-08-06T00:00:00Z", "", None,
                         "soon", "13", "13/01/26", "08/11/202")]
      == ["2026-08-11", "2026-08-01", "2026-08-01", "2026-08-06", "2026-08-06", "", "", "", "", "", ""])
lns = build(sessions=BOSS, masters=FLAGS, out_dir=ldir)
lfirst, lheaders = ask(lns, "Bearer boss", app_id="client-candidates", key=" LEAD_2310 ")
lagain = ask(lns, "Bearer boss", app_id="client-candidates", key="LEAD_2310")[0]
check("the master reads a referral's pack by its row id, once, from one Python fill of clientCandidatePack",
      lfirst.get("status") == 200 and lfirst["data"]["parts"]["overview"]["candidate"]["key"] == "LEAD_2310"
      and lfirst["data"]["state"] == "fresh" and lagain["data"]["state"] == "fresh" and len(lead_execs(lns)) == 1
      and lead_execs(lns)[0]["payload"] == {"candidate": "LEAD_2310"} and lead_execs(lns)[0]["service"]
      and lead_execs(lns)[0]["kw"] == {"app": "client-candidates", "pack": ""}
      and "write_id" not in json.dumps(lead_execs(lns)[0]) and lheaders.get("Cache-Control") == "no-store", lfirst)
lhand = ask(lns, "Bearer boss", app_id="client-candidates", key=LEAD_UUID)[0]
check("…and a hand-added referral's by the id its row was given", door_lead(lhand) == (200, "fresh", 1)
      and lead_execs(lns)[-1]["payload"] == {"candidate": LEAD_UUID}, lhand)
lbad = {k: ask(lns, "Bearer boss", app_id="client-candidates", key=k)[0].get("status")
        for k in ("ab", "Rosa Vega", "../x", "LEAD.2310", "LEAD_2310/1", "x" * 81, "", "LEAD_2310,LEAD_2300")}
check("a key clientCandidatePack would refuse the shape of is 400, and nothing is read",
      set(lbad.values()) == {400} and len(lead_execs(lns)) == 2, lbad)
lns["_acting"]["child"] = (time.time() + 600, "u-boss", "u-kid")
lshut = {who: ask(lns, who, app_id="client-candidates", key="LEAD_2310")[0]
         for who in ("Bearer adm", "Bearer mia", "Bearer sam", "Bearer nobody", "Bearer child")}
check("the door is the master's alone: another admin, a manager, staff, an unknown and a switched session are 404 "
      "'Unknown lane.', a visit 403, and none of them executes anything",
      all(b == {"status": 404, "reason": "unknown", "message": "Unknown lane."} for b in lshut.values())
      and ask(lns, "Bearer boss", app_id="client-candidates", key="LEAD_2310", member="m1")[0].get("status") == 403
      and len(lead_execs(lns)) == 2, lshut)


async def lead_key_in_header() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir())
    door = ns["lane_app_pack"]
    by_query = await door("client-candidates", types.SimpleNamespace(headers={}), key="LEAD_2310",
                          authorization="Bearer boss")
    n = len(lead_execs(ns))
    by_header = await door("client-candidates", types.SimpleNamespace(headers={}), x_app_pack_key="LEAD%5F2310",
                           authorization="Bearer boss")
    return {"query": (by_query.get("status"), by_query.get("reason"), n), "header": door_lead(by_header),
            "asked": [c["payload"] for c in lead_execs(ns)]}


lkh = asyncio.run(lead_key_in_header())
check("a referral is named in the X-App-Pack-Key header, URI-encoded — one in the address is 400 and nothing is read",
      lkh["query"] == (400, "key", 0) and lkh["header"] == (200, "fresh", 1)
      and lkh["asked"] == [{"candidate": "LEAD_2310"}], lkh)


async def lead_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir())
    for k in ("LEAD_2310", "LEAD_2300", LEAD_UUID):
        await ns["_app_pack_get"]("client-candidates", k)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    await ns["_app_pack_get"]("locations", "ABD1305")

    def state() -> dict[str, str]:
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (a, k), e in ns["_app_pack_held"].items()}

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    ok = json.dumps({"status": 200, "data": {"id": "LEAD_2310", "stage": "contacted"}}).encode()
    got: dict[str, Any] = {}
    n0 = len(lead_execs(ns))
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "LEAD_2310", "stage": "contacted"},
                                                 resource="potentialClients"), ok)
    got["own"] = state()
    await asyncio.sleep(0.02)
    held = ns["_app_pack_held"][("client-candidates", "LEAD_2310")]
    got["own_refill"] = (len(lead_execs(ns)) - n0, held["lane"], held["data"]["parts"]["overview"]["v"])
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "LEAD_2300", "next_step": "x"},
                                                 resource="potentialClients"),
                                  json.dumps({"status": 403, "message": "Not allowed."}).encode())
    got["refused"] = state()
    await settle()
    made = json.dumps({"status": 200, "data": {"id": LEAD_UUID, "client_name": "Hand Added"}}).encode()
    ns["_relay_observe_app_pack"]("create", form("create", {"client_name": "Hand Added", "stage": "new"},
                                                 resource="potentialClients"), made)
    got["created"] = state()
    await settle()
    read = json.dumps({"status": 200, "data": {"results": [{"id": "LEAD_2300", "stage": "read"}]}}).encode()
    ns["_relay_observe_app_pack"]("leadOpened", form("leadOpened", {"ids": ["LEAD_2300"]}), read)
    got["opened"] = state()
    await settle()
    both = json.dumps({"status": 200, "data": {"results": [{"id": "LEAD_2310", "stage": "read"},
                                                           {"id": "LEAD_2300", "stage": "read"}]}}).encode()
    ns["_relay_observe_app_pack"]("leadOpened", form("leadOpened", {"ids": ["LEAD_2310", "LEAD_2300", "LEAD_9999"]}),
                                  both)
    got["pooled"] = state()
    await settle()
    one = json.dumps({"status": 200, "data": {"results": [{"id": "LEAD_2310", "stage": "new", "unchanged": True},
                                                          {"id": LEAD_UUID, "stage": "read"}]}}).encode()
    ns["_relay_observe_app_pack"]("leadOpened", form("leadOpened", {"ids": ["LEAD_2310", LEAD_UUID]}), one)
    got["pooled_one"] = state()
    await settle()
    wrote = json.dumps({"status": 200, "data": {"entry": {"text": "Note added"}, "row": {"id": "LEAD_2300"}}}).encode()
    ns["_relay_observe_app_pack"]("clientCandidateWrite", form("clientCandidateWrite", {"candidate_id": "LEAD_2300",
                                                                                     "kind": "note", "note": "x"}), wrote)
    got["own_press"] = state()
    await asyncio.sleep(0.02)
    await settle()
    saved = json.dumps({"status": 200, "data": {"saved": True}}).encode()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "LEAD_2310"}, resource="clients"), saved)
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "x1", "stage": "lost"}, resource="potentialClients"),
                                  json.dumps({"status": 200, "data": {"id": "x1", "stage": "lost"}}).encode())
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "lead": "LEAD_2310"}), saved)
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}),
                                  saved)
    got["untouched"] = {k: v for k, v in state().items() if k.startswith("LEAD_") or k == LEAD_UUID}
    await settle()
    got["sweeps"] = {}
    for sweep in ("scraperRun", "scraperScore", "scraperNotify"):
        ns["_relay_observe_app_pack"](sweep, form(sweep, {}), ok)
        got["sweeps"][sweep] = state()
        await settle()
    return got


lw = asyncio.run(lead_writes())
L_CLEAN = {"LEAD_2310": "clean", "LEAD_2300": "clean", LEAD_UUID: "clean", "kay_test": "clean", "ABD1305": "clean"}
check("a write to a referral's row — the stage, next step, owner or notes both apps write through the Potential "
      "Clients door — makes the referral it names stale, read again at once in the background; no other referral, "
      "client or house is touched",
      lw["own"] == {**L_CLEAN, "LEAD_2310": "stale"} and lw["own_refill"] == (1, "housekeeping", 2), lw)
check("a refused write changes nothing", lw["refused"] == L_CLEAN, lw)
check("a hand-added referral is named by the row its create answers with",
      lw["created"] == {**L_CLEAN, LEAD_UUID: "stale"}, lw)
check("a lead opened in Potential Clients (new -> read) makes that referral stale",
      lw["opened"] == {**L_CLEAN, "LEAD_2300": "stale"}, lw)
check("a pooled open of several leads makes every referral its answer says moved stale — never one it left unchanged",
      lw["pooled"] == {**L_CLEAN, "LEAD_2310": "stale", "LEAD_2300": "stale"}
      and lw["pooled_one"] == {**L_CLEAN, LEAD_UUID: "stale"}, lw)
check("a press of the app itself (clientCandidateWrite, named by candidate_id) makes that referral dirty at once, and "
      "no other", lw["own_press"] == {**L_CLEAN, "LEAD_2300": "dirty"}, lw)
check("a write to another resource, one to a row that is no referral's, a client's save and a house note touch no "
      "referral",
      lw["untouched"] == {"LEAD_2310": "clean", "LEAD_2300": "clean", LEAD_UUID: "clean"}, lw)
check("the referral portal read, scored or alerted again makes every referral stale, and no client or house",
      all(s == {**L_CLEAN, "LEAD_2310": "stale", "LEAD_2300": "stale", LEAD_UUID: "stale"}
          for s in lw["sweeps"].values()) and len(lw["sweeps"]) == 3, lw["sweeps"])


async def lead_writer_read() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir(), delay=0.2)
    await ns["_app_pack_get"]("client-candidates", "LEAD_2300")
    n0 = len(lead_execs(ns))
    ns["clock"].now += 30
    ns["version"][0] = 2
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "LEAD_2300", "stage": "intake"},
                                                 resource="potentialClients"),
                                  json.dumps({"status": 200, "data": {"id": "LEAD_2300", "stage": "intake"}}).encode())
    await asyncio.sleep(0.01)
    ns["clock"].now += 0.1
    answer = await ns["lane_app_pack"]("client-candidates", types.SimpleNamespace(headers={}),
                                      x_app_pack_key="LEAD_2300", written_ms="50", sent_ms="5000",
                                      authorization="Bearer boss")
    await asyncio.sleep(0.3)
    return {"answer": door_lead(answer), "execs": len(lead_execs(ns)) - n0}


lwr = asyncio.run(lead_writer_read())
check("the writer's read (written_ms) is answered by the refill the relay began when it saw the write land — never the "
      "copy from before it, exactly one execution", lwr == {"answer": (200, "fresh", 2), "execs": 1}, lwr)


async def lead_swr() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir(), delay=0.05)
    await ns["_app_pack_get"]("client-candidates", "LEAD_2310")
    ns["version"][0] = 2
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    served = await asyncio.gather(*(ns["_app_pack_get"]("client-candidates", "LEAD_2310") for _ in range(3)))
    await asyncio.sleep(0.2)
    lane = ns["_app_pack_held"][("client-candidates", "LEAD_2310")]["lane"]
    n = len(lead_execs(ns))
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + 1
    t0 = time.monotonic()
    past = await ns["_app_pack_get"]("client-candidates", "LEAD_2310", wait_s=0)
    spent = time.monotonic() - t0
    await asyncio.sleep(0.2)
    return {"served": [door_lead(a) for a in served], "lane": lane, "execs": n,
            "past": (past.get("status"), past.get("reason"), "data" in past, spent < 0.05)}


lsr = asyncio.run(lead_swr())
check("a referral's pack past fresh is served while one background fill reads it again; past the ceiling it is never "
      "served", lsr["served"] == [(200, "refreshing", 1)] * 3 and lsr["lane"] == "housekeeping" and lsr["execs"] == 2
      and lsr["past"] == (503, "filling", False, True), lsr)


async def lead_peek() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir(), delay=0.02)
    closed = ns["_app_pack_peek"]("client-candidates", "LEAD_2301")
    await asyncio.sleep(0.05)
    n = len(lead_execs(ns))
    active = ns["_app_pack_peek"]("client-candidates", "LEAD_2310")
    await asyncio.sleep(0.05)
    return {"closed": (closed.get("status"), closed.get("reason"), n),
            "active": (active.get("status"), active.get("reason")),
            "filled": [c["payload"]["candidate"] for c in lead_execs(ns)],
            "then": door_lead(ns["_app_pack_peek"]("client-candidates", "LEAD_2310"))}


lpk = asyncio.run(lead_peek())
check("a prefetch of a referral whose window closed untouched starts nothing; one still in the intake starts one "
      "background fill, then answers from memory",
      lpk == {"closed": (503, "cold", 0), "active": (503, "cold"), "filled": ["LEAD_2310"],
              "then": (200, "fresh", 1)}, lpk)


async def lead_warm() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=lead_dir(), delay=0.01)
    filled = await ns["_app_pack_warm_pass"]()
    mine = lead_execs(ns)
    return {"filled": filled, "order": [c["action"] for c in ns["calls"]
                                        if c["action"] in ("clientPack", "ssaPack", "clientCandidatePack",
                                                           "locationPack")],
            "leads": [c["payload"]["candidate"] for c in mine], "peak": ns["peak"][0],
            "lanes": {c["tickets_out"] for c in mine},
            "again": await ns["_app_pack_warm_pass"](), "out": ns["_housekeeping_slots"].out}


lwm = asyncio.run(lead_warm())
check("the warm pass fills the referrals still in the intake before the houses, one execution at a time on the "
      "housekeeping lane, and a second pass fills nothing",
      lwm["order"] == ["clientCandidatePack"] * len(LEAD_ACTIVE) + ["locationPack"] and lwm["leads"] == LEAD_ACTIVE
      and lwm["peak"] == 1 and lwm["lanes"] == {1} and lwm["again"] == 0 and lwm["out"] == 0, lwm)


async def lead_kept() -> dict[str, Any]:
    folder = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "app-packs"
    folder.mkdir()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=lead_dir())
    await one["_app_pack_get"]("client-candidates", "LEAD_2310")
    names = sorted(kept_files(one))
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=lead_dir())
    two["clock"].now += 1200
    taken = await two["_app_pack_adopt_disk"]()
    held = two["_app_pack_held"].get(("client-candidates", "LEAD_2310")) or {}
    served = await two["_app_pack_get"]("client-candidates", "LEAD_2310", wait_s=0)
    return {"names": names == [kept_name("client-candidates", "LEAD_2310")]
            and not any(w.lower() in n.lower() for n in names for w in LEAD_WORDS + ["lead"]),
            "taken": taken, "marks": (held.get("stale"), held.get("dirty")), "served": door_lead(served)[:2]}


lkp = asyncio.run(lead_kept())
check("a referral's pack is kept under the hash of its app and key — no id, no name — and taken up stale after a "
      "restart, served as `refreshing` while it is read again",
      lkp == {"names": True, "taken": 1, "marks": (True, False), "served": (200, "refreshing")}, lkp)

print("\nkept across a restart")


def new_folder(made: bool = True) -> Path:
    """A pack folder of its own: made, as the mounted volume is, unless `made` is False."""
    folder = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "app-packs"
    if made:
        folder.mkdir()
    return folder


def modes(folder: Path) -> tuple[int, set[int]]:
    return stat.S_IMODE(folder.stat().st_mode), {stat.S_IMODE(p.stat().st_mode) for p in folder.iterdir()}


async def restart() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=clients_dir())
    await one["_app_pack_get"]("locations", "ABD1305")
    await one["_app_pack_get"]("client-profiles", "kay_test")
    slot = ("client-profiles", "kay_test")
    before = dict(one["_app_pack_held"][slot])
    got: dict[str, Any] = {"files": sorted(kept_files(one)) == sorted([kept_name("locations", "ABD1305"),
                                                                      kept_name(*slot)]),
                           "modes": modes(folder)}
    got["names"] = not any(w.lower() in n.lower() for n in kept_files(one) for w in CLIENT_WORDS + HOUSES)
    # a new process twenty minutes later, over the same folder
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=clients_dir(), delay=0.02)
    two["clock"].now += 1200
    two["version"][0] = 2
    got["cold"] = two["_app_pack_held"] == {}
    got["taken"] = await two["_app_pack_adopt_disk"]()
    held = two["_app_pack_held"][slot]
    got["same"] = all(held[k] == before[k] for k in ("filled_at", "read_at", "built_at", "data"))
    got["marks"] = (held["stale"], held["dirty"], held["engine"])
    n = len(client_execs(two))
    served = await two["_app_pack_get"](*slot)
    got["served"] = (door_client(served), round(served["data"]["age_s"]))
    await asyncio.sleep(0.15)
    got["refills"] = len(client_execs(two)) - n
    got["after"] = door_client(await two["_app_pack_get"](*slot))
    kept = json.loads(kept_files(two)[kept_name(*slot)].read_text())
    got["rewritten"] = (kept["data"]["parts"]["details"]["v"],
                        kept["filled_at"] == two["_app_pack_held"][slot]["filled_at"], kept["engine"])
    return got


async def open_folder() -> tuple[int, set[int]]:
    folder = new_folder(made=False)
    folder.mkdir(mode=0o755)
    os.chmod(folder, 0o755)
    old = os.umask(0)
    try:
        ns = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
        await ns["_app_pack_get"]("locations", "ABD1305")
    finally:
        os.umask(old)
    return modes(folder)


rs = asyncio.run(restart())
opened = asyncio.run(open_folder())
check("each filled pack is kept as one file, 0600 in a 0700 folder — a folder found open is closed, and no umask "
      "opens a file", rs["files"] and rs["modes"] == (0o700, {0o600}) and opened == (0o700, {0o600}), (rs, opened))
check("a kept file is named by the hash of its app and key alone — no client key, no name, no house code",
      rs["names"], rs)
check("a restart starts cold, then takes the kept packs up whole: the same copy, filled when it was, stale and never "
      "dirty, with the engine build it was filled under",
      rs["cold"] and rs["taken"] == 2 and rs["same"] and rs["marks"] == (True, False, "b1"), rs)
check("…served at once as `refreshing` with its real age, while exactly one background fill reads it again — and the "
      "new copy is fresh and kept over the old file",
      rs["served"] == ((200, "refreshing", 1), 1200) and rs["refills"] == 1 and rs["after"] == (200, "fresh", 2)
      and rs["rewritten"] == (2, True, "b1"), rs)


async def engines() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, engine="b1")
    await one["_app_pack_get"]("locations", "ABD1305")
    kept = kept_files(one)[kept_name("locations", "ABD1305")]
    got: dict[str, Any] = {"recorded": json.loads(kept.read_text())["engine"]}
    for engine in ("b1", "b2", ""):
        two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, engine=engine)
        await two["_app_pack_adopt_disk"]()
        held = two["_app_pack_held"][("locations", "ABD1305")]
        peek = two["_app_pack_peek"]("locations", "ABD1305")
        got[engine or "unknown"] = (held["stale"], held["engine"], (peek.get("data") or {}).get("state"))
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, engine="b2", delay=0.02)
    await two["_app_pack_adopt_disk"]()
    await two["_app_pack_get"]("locations", "ABD1305")
    await asyncio.sleep(0.1)
    got["refilled"] = json.loads(kept_files(two)[kept_name("locations", "ABD1305")].read_text())["engine"]
    return got


eg = asyncio.run(engines())
check("a pack filled under another engine build is taken up stale, never fresh — and so is one of the same build: a "
      "restart serves no kept pack as fresh; its refill records the engine it was filled under",
      eg["recorded"] == "b1" and eg["b2"] == (True, "b1", "refreshing") and eg["b1"] == (True, "b1", "refreshing")
      and eg["unknown"] == (True, "b1", "refreshing") and eg["refilled"] == "b2", eg)


async def published_over() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, engine="b1", delay=0.02)
    await ns["_app_pack_get"]("locations", "ABD1305")
    await ns["_app_pack_get"]("locations", "ABD1547")
    ns["clock"].now += 60
    got: dict[str, Any] = {"same": door_said(await ns["_app_pack_get"]("locations", "ABD1305"))[:2]}
    n = len(execs(ns))
    # a publish: the relay hears a new engine build; nothing else changed
    ns["_ENGINE_BUILD"] = "b2"
    ns["version"][0] = 2
    got["due"] = (ns["_app_pack_due"]("locations", "ABD1305"), ns["_app_pack_warm_rank"]("locations", "ABD1305"))
    got["peek"] = (ns["_app_pack_peek"]("locations", "ABD1547").get("data") or {}).get("state")
    got["read"] = door_said(await ns["_app_pack_get"]("locations", "ABD1305"))
    await asyncio.sleep(0.1)
    got["fills"] = sorted(c["payload"]["house"] for c in execs(ns)[n:])
    got["after"] = door_said(await ns["_app_pack_get"]("locations", "ABD1305"))
    got["engine"] = ns["_app_pack_held"][("locations", "ABD1305")]["engine"]
    # a build learned for the first time is no publish: a pack filled before the relay knew one stays fresh
    first = build(sessions=BOSS, masters=FLAGS, engine="")
    await first["_app_pack_get"]("locations", "ABD1305")
    first["_ENGINE_BUILD"] = "b1"
    got["first_learned"] = door_said(await first["_app_pack_get"]("locations", "ABD1305"))[:2]
    return got


po = asyncio.run(published_over())
check("a pack held in memory across a publish is stale at once: served as `refreshing` while one background fill reads "
      "it under the new engine, warmed first, and fresh again with the new build recorded",
      po["same"] == (200, "fresh") and po["due"] == (True, 0) and po["peek"] == "refreshing"
      and po["read"] == (200, "refreshing", 1) and po["fills"] == ["ABD1305"]
      and po["after"] == (200, "fresh", 2) and po["engine"] == "b2" and po["first_learned"] == (200, "fresh"), po)


async def dirty_gone() -> dict[str, Any]:
    folder = new_folder()
    ns = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, delay=0.25)
    for house in ("ABD1305", "ABD1547"):
        await ns["_app_pack_get"]("locations", house)
    name = kept_name("locations", "ABD1305")
    got: dict[str, Any] = {"before": name in kept_files(ns)}
    ns["_app_pack_invalidate"]("locations", "ABD1305")
    got["at_once"] = name not in kept_files(ns) and ns["_app_pack_held"][("locations", "ABD1305")]["dirty"]
    # a restart while its refill is still reading
    other = build(pack_dir=folder)
    await other["_app_pack_adopt_disk"]()
    got["restart"] = sorted(k for (_, k) in other["_app_pack_held"])
    await asyncio.sleep(0.4)
    got["refilled"] = (name in kept_files(ns), ns["_app_pack_held"][("locations", "ABD1305")]["dirty"])
    ns["clock"].now += 30
    ns["_app_pack_written"]("locations", "ABD1547", 1000)
    got["written"] = (ns["_app_pack_held"][("locations", "ABD1547")]["dirty"],
                      kept_name("locations", "ABD1547") in kept_files(ns))
    await asyncio.sleep(0.15)
    # a fill that lands dirty — a write named its key while it read — is never kept
    entry = dict(ns["_app_pack_held"][("locations", "ABD1305")])
    ns["_app_pack_held"][("locations", "BM4060")] = entry
    await ns["_app_pack_keep"](("locations", "BM4060"), entry)
    got["landed_dirty"] = kept_name("locations", "BM4060") in kept_files(ns)
    dirty = dict(entry, dirty=True)
    ns["_app_pack_held"][("locations", "BM4060")] = dirty
    await ns["_app_pack_keep"](("locations", "BM4060"), dirty)
    got["landed_dirty"] = (got["landed_dirty"], kept_name("locations", "BM4060") in kept_files(ns))
    return got


dg = asyncio.run(dirty_gone())
check("a write that names a key removes its kept file at once — a restart then never takes the dirty copy up — and "
      "the refill keeps the new one", dg["before"] and dg["at_once"] and dg["restart"] == ["ABD1547"]
      and dg["refilled"] == (True, False), dg)
check("a read naming the session's own write makes an older copy dirty and removes its file; a pack that lands dirty "
      "removes its file and is never kept", dg["written"] == (True, False) and dg["landed_dirty"] == (True, False), dg)


async def written_after_restart() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    await one["_app_pack_get"]("locations", "ABD1305")
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, delay=0.02)
    two["clock"].now += 120
    two["version"][0] = 2
    await two["_app_pack_adopt_disk"]()
    # this session's write was answered a minute ago: after the kept copy was read, before the restart
    answer = await two["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305",
                                       written_ms="60000", authorization="Bearer boss")
    return {"answer": door_said(answer), "execs": len(execs(two)),
            "kept": json.loads(kept_files(two)[kept_name("locations", "ABD1305")].read_text())["data"]["parts"]
            ["overview"]["v"]}


wr = asyncio.run(written_after_restart())
check("after a restart a read naming the session's own write is never answered by a kept copy read before it: it "
      "waits for the fill and the new copy is what is kept", wr == {"answer": (200, "fresh", 2), "execs": 1, "kept": 2},
      wr)


async def trimmed() -> dict[str, Any]:
    folder = new_folder()
    ns = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    ns["APP_PACK_MAX_HELD"] = 2
    for house in ("ABD1305", "ABD1547", "ABD1711"):
        await ns["_app_pack_get"]("locations", house)
        ns["clock"].now += 10
    got = {"held": sorted(k for (_, k) in ns["_app_pack_held"]), "files": sorted(kept_files(ns))}
    small = build(pack_dir=folder)
    small["APP_PACK_MAX_HELD"] = 1
    got["taken"] = (await small["_app_pack_adopt_disk"](), sorted(k for (_, k) in small["_app_pack_held"]),
                    sorted(kept_files(small)))
    return got


tr = asyncio.run(trimmed())
check("a pack trimmed past APP_PACK_MAX_HELD takes its kept file with it — when filled, and when taken up",
      tr["held"] == ["ABD1547", "ABD1711"]
      and tr["files"] == sorted(kept_name("locations", h) for h in ("ABD1547", "ABD1711"))
      and tr["taken"] == (2, ["ABD1711"], [kept_name("locations", "ABD1711")]), tr)


def house_or_refusal(payload: dict, ns: dict[str, Any]) -> dict:
    key = payload["payload"]["house"]
    said = ns.get("answer_as", {}).get(key)
    if said == "refused":
        return {"status": 404, "message": "No house is on the registry."}
    if said == "shape":
        return {"status": 200, "data": {"house": key}}
    if said == "busy":
        return {"status": 503, "message": "Service busy."}
    if said == "withdrawn":
        return {"status": 404, "message": 'Unknown action: "locationPack".'}
    return {"status": 200, "data": {"house": key, "built_at": "2026-09-28T12:00:00Z",
                                    "parts": {"overview": {"v": ns["version"][0]}}, "part_status": {}}}


REFUSAL_HOUSES = ("ABD1305", "ABD1547", "ABD1711", "ABD2005")


async def refused() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, pack_dir=new_folder(), pack=house_or_refusal)
    for house in REFUSAL_HOUSES:
        await ns["_app_pack_get"]("locations", house)
    ns["answer_as"] = {"ABD1305": "refused", "ABD1547": "shape", "ABD1711": "busy"}
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    served = [door_said(await ns["_app_pack_get"]("locations", h))[:2] for h in REFUSAL_HOUSES[:3]]
    await asyncio.sleep(0.1)
    marks = {h: ns["_app_pack_held"][("locations", h)]["dirty"] for h in REFUSAL_HOUSES}
    again = [door_said(await ns["_app_pack_get"]("locations", h))[:2] for h in REFUSAL_HOUSES[:3]]
    await asyncio.sleep(0.1)
    # a restart over the same folder takes up exactly what memory would still serve
    later = build(sessions=BOSS, masters=FLAGS, pack_dir=Path(ns["APP_PACK_DIR"]))
    await later["_app_pack_adopt_disk"]()
    return {"served": served, "marks": marks, "again": again,
            "files": sorted(kept_files(ns)), "adopted": sorted(k for (_, k) in later["_app_pack_held"])}


rf = asyncio.run(refused())
check("a refill refused about its own key makes that pack dirty — never served again — and takes its kept file; one "
      "answered in another shape or by a busy engine says nothing of the copy: memory and disk keep it alike, and a "
      "restart takes up exactly what memory still serves",
      rf["served"] == [(200, "refreshing")] * 3
      and rf["marks"] == {"ABD1305": True, "ABD1547": False, "ABD1711": False, "ABD2005": False}
      and rf["again"] == [(404, None), (200, "refreshing"), (200, "refreshing")]
      and rf["files"] == sorted(kept_name("locations", h) for h in REFUSAL_HOUSES[1:])
      and rf["adopted"] == list(REFUSAL_HOUSES[1:]), rf)


async def withdrawn() -> dict[str, Any]:
    folder = new_folder()
    # an earlier process kept a house this one never holds
    early = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, pack=house_or_refusal)
    await early["_app_pack_get"]("locations", "BM4060")
    ns = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, pack=house_or_refusal)
    ns["clock"].now += 30
    for house in REFUSAL_HOUSES:
        await ns["_app_pack_get"]("locations", house)
    # the pack action is withdrawn from the engine
    ns["answer_as"] = {h: "withdrawn" for h in REFUSAL_HOUSES}
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    first = door_said(await ns["_app_pack_get"]("locations", "ABD1305"))[:2]
    await asyncio.sleep(0.1)
    got: dict[str, Any] = {"first": first, "resting": ns["_app_pack_resting"]("locations"),
                           "dirty": sorted(k for (_, k), h in ns["_app_pack_held"].items() if h["dirty"]),
                           "others": [door_said(await ns["_app_pack_get"]("locations", h))[:2]
                                      for h in REFUSAL_HOUSES[1:]],
                           "files": sorted(kept_files(ns))}
    later = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, pack=house_or_refusal)
    later["clock"].now = ns["clock"].now + 60
    got["adopted"] = (await later["_app_pack_adopt_disk"](), sorted(kept_files(later)))
    return got


wd = asyncio.run(withdrawn())
check("an engine that stops serving the app's pack makes every held pack of it dirty — none served again, not even as "
      "`refreshing` — takes every kept file of it, and marks the app so a restart takes up none, not even a file this "
      "process never held",
      wd["first"] == (200, "refreshing") and wd["resting"] is True and wd["dirty"] == sorted(REFUSAL_HOUSES)
      and wd["others"] == [(503, None)] * 3
      and wd["files"] == sorted(["locations.void", kept_name("locations", "BM4060")])
      and wd["adopted"] == (0, ["locations.void"]), wd)


async def corrupt() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    await one["_app_pack_get"]("locations", "ABD1305")
    good = kept_files(one)[kept_name("locations", "ABD1305")]
    body = json.loads(good.read_text())
    now = one["clock"].now

    def put(name: str, text: str) -> None:
        (folder / name).write_text(text)

    put(kept_name("locations", "ABD1547"), "{not json")
    put(kept_name("locations", "ABD1711"), good.read_text())
    put(kept_name("locations", "BM4060"), json.dumps(dict(body, v=2, key="BM4060")))
    put(kept_name("ssa", "x1"), json.dumps(dict(body, app="ssa", key="x1")))
    put(kept_name("locations", "../x"), json.dumps(dict(body, key="../x")))
    put(kept_name("locations", "abd2005"), json.dumps(dict(body, key="abd2005")))
    aged = now - one["APP_PACK_CEILING_S"] - 1
    put(kept_name("locations", "BS4527"), json.dumps(dict(body, key="BS4527", read_at=aged, filled_at=aged)))
    put(kept_name("locations", "EC4048"), json.dumps(dict(body, key="EC4048", data={"house": "EC4048"})))
    put(kept_name("locations", "HF2908"), json.dumps(dict(body, key="HF2908", filled_at="soon")))
    put(kept_name("locations", "LD4048"), json.dumps([body]))
    put("." + kept_name("locations", "MF305") + ".ab12_x.tmp", "{torn")
    put(".locations.void.ab12_x.tmp", "{torn")
    for foreign in ("notes.txt", "abc.json", "README.md", ".abc.json.x.tmp"):
        put(foreign, "not ours")
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    taken = await two["_app_pack_adopt_disk"]()
    missing_at = new_folder(made=False)
    missing = build(pack_dir=missing_at)
    a_file = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "a-file"
    a_file.write_text("x")
    not_dir = build(pack_dir=a_file)
    others = (await missing["_app_pack_adopt_disk"](), await not_dir["_app_pack_adopt_disk"]())
    await missing["_app_pack_get"]("locations", "ABD1305")
    left = sorted(kept_files(two))
    # a mark that cannot be read: none of its app's packs taken up, and the mark goes with them
    three = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    three["clock"].now += 60
    put("locations.void", "{torn mark")
    return {"taken": taken, "held": sorted(two["_app_pack_held"]), "left": left,
            "others": others, "never_made": (missing_at.exists(), missing["_app_pack_dir_state"]()[1]),
            "bad_mark": (await three["_app_pack_adopt_disk"](), sorted(kept_files(three)))}


cr = asyncio.run(corrupt())
check("a corrupt kept file, one under another pack's name, another version, an app or key this relay does not serve, "
      "one past the ceiling, one without its parts and a write torn by a stop are all skipped and removed; files that "
      "are not the packs' are left alone; a missing or unusable folder starts cold — nothing raises",
      cr["taken"] == 1 and cr["held"] == [("locations", "ABD1305")]
      and cr["left"] == sorted([kept_name("locations", "ABD1305"), "notes.txt", "abc.json", "README.md",
                                ".abc.json.x.tmp"])
      and cr["others"] == (0, 0), cr)
check("a pack folder that is not there is never made: the packs are held in memory alone until the volume is mounted",
      cr["never_made"] == (False, "missing"), cr["never_made"])
check("a mark that cannot be read takes up none of its app's packs and is removed with them",
      cr["bad_mark"] == (0, sorted(["notes.txt", "abc.json", "README.md", ".abc.json.x.tmp"])), cr["bad_mark"])


async def adopt_order() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    for house in ("ABD1305", "ABD1547"):
        await one["_app_pack_get"]("locations", house)
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    two["version"][0] = 5
    await two["_app_pack_get"]("locations", "ABD1305")
    two["_app_pack_gen"][("locations", "ABD1547")] = 1
    taken = await two["_app_pack_adopt_disk"]()
    held = two["_app_pack_held"][("locations", "ABD1305")]
    return {"taken": taken, "kept": (held["stale"], held["data"]["parts"]["overview"]["v"]),
            "written_to": ("locations", "ABD1547") in two["_app_pack_held"]}


ao = asyncio.run(adopt_order())
check("taking the kept packs up never covers a copy filled since the start, nor a key written to since",
      ao == {"taken": 0, "kept": (False, 5), "written_to": False}, ao)


async def adopt_race() -> dict[str, Any]:
    folder = new_folder()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder)
    for house in ("ABD1305", "ABD1547", "ABD1711"):
        await one["_app_pack_get"]("locations", house)
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, delay=0.2)
    two["clock"].now += 120
    two["version"][0] = 2
    # while the folder is still being read: a writer's read (written_ms alone) finds nothing held and starts a fill…
    fill = asyncio.ensure_future(two["_app_pack_get"]("locations", "ABD1305", wait_s=5))
    # …and another names its write though its fill was refused before the folder was read
    two["_app_pack_written"]("locations", "ABD1547", 60_000)
    await asyncio.sleep(0.02)
    taken = await two["_app_pack_adopt_disk"]()
    got: dict[str, Any] = {"taken": taken, "held": sorted(k for (_, k) in two["_app_pack_held"]),
                           "files": sorted(kept_files(two)) == [kept_name("locations", "ABD1711")]}
    got["read"] = door_said(await fill)
    got["peek"] = two["_app_pack_peek"]("locations", "ABD1547").get("reason")
    got["after"] = sorted(kept_files(two)) == sorted(kept_name("locations", h) for h in ("ABD1305", "ABD1711"))
    return got


ar = asyncio.run(adopt_race())
check("taking the kept packs up never covers a key whose fill is on its way, nor one a read named its own write for: "
      "their old files go, the filling one is answered by its fill and the new copy is what is kept",
      ar == {"taken": 1, "held": ["ABD1711"], "files": True, "read": (200, "fresh", 2), "peek": "cold",
             "after": True}, ar)


async def sent_first() -> dict[str, Any]:
    folder = new_folder()
    cdir = clients_dir()
    one = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=cdir, delay=0.05)
    for house in ("ABD1305", "ABD1547"):
        await one["_app_pack_get"]("locations", house)
    await one["_app_pack_get"]("client-profiles", "kay_test")
    await one["_app_pack_get"]("client-profiles", "lee_other")
    one["clock"].now += 5
    got: dict[str, Any] = {}
    # a background fill of ABD1305 begins reading, then the app's own write naming it leaves; the relay then stops
    # before the answer comes back
    one["_app_pack_held"][("locations", "ABD1305")]["stale"] = True
    got["refreshing"] = door_said(await one["_app_pack_get"]("locations", "ABD1305", wait_s=0))[:2]
    await asyncio.sleep(0.01)
    one["clock"].now += 1
    one["_app_pack_sending"]("locationNoteAdd", form("locationNoteAdd", {"house": "abd1305", "details": "x"}))
    one["_app_pack_sending"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test", "fields": {}}))
    one["_app_pack_sending"]("list", form("list", {"house": "ABD1547"}, resource="people"))
    got["gone_at_once"] = sorted(kept_files(one)) == sorted([kept_name("locations", "ABD1547"),
                                                             kept_name("client-profiles", "lee_other")])
    # memory is the answer's to change: the held copy is served as it was
    got["memory"] = door_said(await one["_app_pack_get"]("locations", "ABD1547"))[:2]
    await asyncio.sleep(0.15)
    got["in_flight_not_kept"] = kept_name("locations", "ABD1305") not in kept_files(one)
    # a new process over the same folder, the observer never having run
    two = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=cdir)
    two["clock"].now = one["clock"].now + 30
    await two["_app_pack_adopt_disk"]()
    got["adopted"] = sorted(two["_app_pack_held"])
    # a write whose request names no house (its answer would): the app is marked before it leaves
    one["clock"].now += 1
    one["_app_pack_sending"]("locationNoteState", form("locationNoteState", {"id": "HN_1", "state": "resolved"}))
    three = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, out_dir=cdir)
    three["clock"].now = one["clock"].now + 30
    await three["_app_pack_adopt_disk"]()
    got["marked"] = ("locations.void" in kept_files(three), sorted(three["_app_pack_held"]))
    return got


sf = asyncio.run(sent_first())
check("a write that makes a pack dirty takes the kept file of the key its request names before it leaves — memory "
      "untouched until its answer — and a fill that was reading when it left is not kept: a stop before the answer "
      "leaves no copy from before the write to take up",
      sf["refreshing"] == (200, "refreshing") and sf["gone_at_once"] and sf["memory"] == (200, "fresh")
      and sf["in_flight_not_kept"]
      and sf["adopted"] == [("client-profiles", "lee_other"), ("locations", "ABD1547")], sf)
check("…and one whose request names no key marks its app first: a restart takes up none of its copies read before it",
      sf["marked"] == (True, [("client-profiles", "lee_other")]), sf)
gas_first = gas_src.find("_app_pack_sending(action, raw)")
check("the /gas relay takes the kept copy off the disk before the write leaves — before Python is asked, by its own "
      "door or the sign-in's",
      gas_src.count("_app_pack_sending(action, raw)") == 1
      and 0 < gas_first < gas_src.find("await _backend_answer(") and gas_first < gas_src.find("await _auth_py_answer(")
      and gas_src.find("_relay_app_access_refusal(") < gas_first, gas_first)


async def expired() -> dict[str, Any]:
    folder = new_folder()
    ns = build(sessions=BOSS, masters=FLAGS, pack_dir=folder, delay=0.1)
    for house in ("ABD1305", "ABD1547", "ABD1711"):
        await ns["_app_pack_get"]("locations", house)
        ns["clock"].now += 600
    ns["_app_pack_void"][("locations", "ZZ1000")] = ns["clock"].now
    ns["clock"].now += ns["APP_PACK_CEILING_S"] - 1200 + 1
    # ABD1305 and ABD1547 are past the ceiling; a fill for ABD1547 is on its way
    filling = asyncio.ensure_future(ns["_app_pack_get"]("locations", "ABD1547"))
    await asyncio.sleep(0.01)
    gone = ns["_app_pack_expire"]()
    got: dict[str, Any] = {"gone": gone, "held": sorted(k for (_, k) in ns["_app_pack_held"]),
                           "files": sorted(kept_files(ns)) == sorted(kept_name("locations", h)
                                                                    for h in ("ABD1547", "ABD1711"))}
    await filling
    ns["clock"].now += ns["APP_PACK_CEILING_S"] + ns["APP_PACK_CLIENT_FILL_TIMEOUT_S"]
    got["later"] = (ns["_app_pack_expire"](), sorted(kept_files(ns)), ns["_app_pack_void"])
    return got


ex = asyncio.run(expired())
check("every beat drops what is past the ceiling from memory and from disk — never a key whose fill is on its way — "
      "and forgets the voids no copy can still predate",
      ex["gone"] == 1 and ex["held"] == ["ABD1547", "ABD1711"] and ex["files"]
      and ex["later"] == (2, [], {}), ex)
loop_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_warm_loop")) or ""
check("…on the warm loop's every beat, warmed or not: without a service identity it still drops them",
      re.search(r"while True:\s+_app_pack_warm_wake\.clear\(\)\s+# [^\n]+\s+gone = _app_pack_expire\(\)", loop_src)
      is not None and "return" not in loop_src and "if warm else 0" in loop_src, loop_src[:300])


async def swept_default() -> dict[str, Any]:
    got: dict[str, Any] = {}
    for label, in_use in (("off", ""), ("moved", "other"), ("in use", "default")):
        default = new_folder()
        await build(pack_dir=default)["_app_pack_get"]("locations", "ABD1305")
        (default / "locations.void").write_text(json.dumps({"v": 1, "app": "locations", "at": 1.0}))
        for name in ("." + kept_name("locations", "ABD1547") + ".x_1.tmp", "notes.txt"):
            (default / name).write_text("{}")
        pack_dir: Any = {"": "", "other": new_folder(), "default": default}[in_use]
        ns = build(pack_dir=pack_dir)
        ns["APP_PACK_DEFAULT_DIR"] = str(default)
        await ns["_app_pack_adopt_disk"]()
        got[label] = sorted(p.name for p in default.iterdir())
    return got


sd = asyncio.run(swept_default())
check("with keeping turned off or moved, the pack files the default folder still holds are removed at start — a kept "
      "pack is never left at rest where nothing takes it up; files not the packs' stay",
      sd["off"] == sd["moved"] == ["notes.txt"]
      and sd["in use"] == sorted([kept_name("locations", "ABD1305"), "locations.void", "notes.txt"]), sd)


async def keep_off_loop() -> dict[str, Any]:
    got: dict[str, Any] = {}
    for case in ("dirty", "trimmed", "cancelled", "voided", "clean"):
        ns = build(sessions=BOSS, masters=FLAGS)
        await ns["_app_pack_get"]("locations", "ABD1305")
        slot = ("locations", "ABD1305")
        entry = dict(ns["_app_pack_held"][slot], filled_at=ns["clock"].now + 1)
        ns["_app_pack_held"][slot] = entry
        (Path(ns["APP_PACK_DIR"]) / kept_name(*slot)).unlink()
        keep = asyncio.ensure_future(ns["_app_pack_keep"](slot, entry))
        # the write is on its thread now: what memory does meanwhile decides whether its file stays
        await asyncio.sleep(0)
        if case == "dirty":
            entry["dirty"] = True
        elif case == "trimmed":
            ns["_app_pack_held"].pop(slot)
        elif case == "cancelled":
            keep.cancel()
            ns["_app_pack_held"].pop(slot)
        elif case == "voided":
            ns["_app_pack_void"][slot] = ns["clock"].now + 0.5
        try:
            await keep
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.1)
        got[case] = kept_name(*slot) in kept_files(ns)
    return got


ko = asyncio.run(keep_off_loop())
check("a kept pack is written off the event loop, and a pack made dirty, dropped or voided while it was written — even "
      "with the fill that waited on it cancelled — loses its file as the write ends",
      ko == {"dirty": False, "trimmed": False, "cancelled": False, "voided": False, "clean": True}, ko)


async def never_served_tree() -> dict[str, Any]:
    got: dict[str, Any] = {}
    for tree in ("served", "deposit"):
        root = Path(tempfile.mkdtemp(dir=KEPT_ROOT))
        (root / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
        for made in (root / "app-packs", root / "deep" / "a" / "b"):
            made.mkdir(parents=True)
        link = Path(tempfile.mkdtemp(dir=KEPT_ROOT)) / "link"
        link.symlink_to(root / "deep", target_is_directory=True)
        for label, inside in (("sub", root / "app-packs"), ("itself", root), ("deep", root / "deep" / "a" / "b"),
                              ("link", link)):
            if tree == "served":
                ns = build(sessions=BOSS, masters=FLAGS, out_dir=root, pack_dir=inside)
            else:
                ns = build(sessions=BOSS, masters=FLAGS, pack_dir=inside)
                ns["BUNDLE_DIR"] = root
            answer = await ns["_app_pack_get"]("locations", "ABD1305")
            got[f"{tree}:{label}"] = (ns["_app_pack_dir_state"]()[1], door_said(answer)[:2],
                                      await ns["_app_pack_adopt_disk"]())
        got[f"{tree}:tree"] = tree_of(root)
    live = build(out_dir=Path("/srv/snapshot"), pack_dir="/srv/snapshot/app-packs")
    live["BUNDLE_DIR"] = Path("/srv/bundles")
    got["live"] = live["_app_pack_dir_state"]()[1]
    live["APP_PACK_DIR"] = "/srv/bundles/app-packs"
    got["deposit"] = live["_app_pack_dir_state"]()[1]
    live["APP_PACK_DIR"] = live["APP_PACK_DEFAULT_DIR"] = "/srv/app-packs"
    got["default"] = live["_app_pack_dir_state"]()
    got["off"] = build(pack_dir="")["_app_pack_dir_state"]()
    return got


ns_tree = asyncio.run(never_served_tree())
check("the pack folder is never the served snapshot tree nor the bundle deposit (under /opt/docker), nor under either "
      "— named directly or through a link: the packs are then held in memory alone and not one file is written there",
      all(ns_tree[f"served:{k}"] == ("inside the served snapshot tree", (200, "fresh"), 0)
          for k in ("sub", "itself", "deep", "link"))
      and all(ns_tree[f"deposit:{k}"] == ("inside the bundle deposit", (200, "fresh"), 0)
              for k in ("sub", "itself", "deep", "link"))
      and ns_tree["served:tree"] == ns_tree["deposit:tree"] == ["app-packs", "deep", "deep/a", "deep/a/b",
                                                                "houses.json"]
      and ns_tree["live"] == "inside the served snapshot tree" and ns_tree["deposit"] == "inside the bundle deposit"
      and ns_tree["off"] == (None, "unset")
      and (ns_tree["default"] == (None, "missing") or ns_tree["default"] == (Path("/srv/app-packs"), ""))
      and 'OUT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))' in SVC
      and 'BUNDLE_DIR = Path(os.getenv("HUB_BUNDLE_DIR", "/srv/bundles"))' in SVC, ns_tree)

nodes_by_name = {node_name(n): n for n in TREE.body}
place_src = ast.get_source_segment(SVC, nodes_by_name["place_bundle"]) or ""
adopt_src = ast.get_source_segment(SVC, nodes_by_name["_bundle_adopt_disk"]) or ""
warm_src = ast.get_source_segment(SVC, nodes_by_name["_app_pack_warm_loop"]) or ""
bundle_readers = sorted(node_name(n) for n in TREE.body if "BUNDLE_DIR" in (ast.get_source_segment(SVC, n) or ""))
guard = place_src.find('if "/" in name + (member or uid):')
check("the JSON lane's /place refuses any name with a path in it before it reads the deposit, the deposit is taken up "
      "one level deep, and the packs name the bundle folder only to refuse it",
      0 < guard < place_src.find("BUNDLE_DIR /") and 'BUNDLE_DIR.glob("*.json")' in adopt_src
      and "rglob(" not in SVC and '"**' not in SVC
      and bundle_readers == ["BUNDLE_DIR", "_app_pack_dir_state", "_bundle_adopt_disk", "_bundle_deposit",
                             "_chat_cache_dir_state", "health", "place_bundle"],
      bundle_readers)
check("the kept packs are taken up as the warm loop starts, before its first pass",
      re.search(r"async def _app_pack_warm_loop\(\) -> None:\s+await _app_pack_adopt_disk\(\)", warm_src) is not None)

print("\na family member's pack")
FAMILY_CLIENTS = [
    {"client_key": "kay_test", "name": "Kay Test", "status": "active", "guardianName": "Guardian: Mary Ann Test (mother)",
     "guardian_relationship": "Mother", "guardian_phone": "330-555-0101"},
    {"client_key": "lee_other", "name": "Lee Other", "status": "", "guardianName": "Self"},
    {"client_key": "ann_more", "name": "Ann More", "status": "active", "guardian_name": "Mary Ann Test"},
    {"client_key": "old_gone", "name": "Old Gone", "status": "inactive", "guardianName": "Paul Gone"},
    {"client_key": "ned_state", "name": "Ned State", "status": "active", "guardianName": "Nora State",
     "guardian_relationship": "State Appointed"},
    {"client_key": "bo_long", "name": "Bo Long", "status": "active", "guardianName": "Rita Long, her sister, lives near"},
    {"client_key": "no_one", "name": "No One", "status": "active", "guardianName": "No guardian listed"},
    {"client_key": "cal_org", "name": "Cal Org", "status": "active",
     "guardianName": "Stark County - Probate Court, his guardian"},
    {"client_key": "jen_kid", "name": "Jen Kid", "status": "active", "guardianName": "Jen Waters/Sister"}, "junk"]
FAMILY_PEOPLE = [
    {"id": "PPL_guardian_ritalong", "name": "Rita Long", "role": "guardian", "status": "active"},
    {"id": "PPL_guardian_samuncle", "name": "Sam Uncle", "role": "guardian", "status": "active",
     "guardian_for": "Kay Test"},
    {"id": "PPL_12", "name": "Dee Aunt (aunt)", "role": "", "status": "", "guardian_for": "Bo Long"},
    {"id": "PPL_guardian_none", "name": "None", "role": "guardian", "status": ""},
    {"id": "PPL_7", "name": "Staff Person", "role": "staff", "status": "active"}, "junk"]
FAMILY_KEYS = ["fam_maryanntest", "fam_norastate", "fam_ritalong", "fam_jenwaters", "fam_samuncle", "fam_deeaunt"]
# the families index Python would build for these records and people: its roster and each client's family member
FAMILY_ROSTER = [{"key": k, "status": "active"} for k in FAMILY_KEYS]
FAMILY_RECORDS = {"kay_test": "fam_maryanntest", "ann_more": "fam_maryanntest", "old_gone": "fam_paulgone",
                  "ned_state": "fam_norastate", "bo_long": "fam_ritalong", "jen_kid": "fam_jenwaters"}
FAMILY_WORDS = ["Mary Ann", "maryann", "Rita Long", "ritalong", "Sam Uncle", "samuncle", "Stark County", "starkcounty",
                "Paul Gone", "paulgone", "Dee Aunt", "deeaunt", "Nora State", "norastate", "Jen Waters", "jenwaters"]
FAMILY_READS = ["familyProfileRoster", "familyProfileOverview", "familyProfileDocuments", "familyProfileDocFile",
                "familyProfileActivity", "familyProfileNotes"]
FAMILY_WRITES = ["familyProfileNoteAdd", "familyProfileCallSchedule", "familyProfileIncidentTie", "familyProfileSave",
                 # the person's photo replaced from the page (app/photos.py through app/family_writes.py)
                 "familyProfilePhoto"]


def family_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="app-packs-families-"))
    (tmp / "clients.json").write_text(json.dumps({"rows": FAMILY_CLIENTS}))
    (tmp / "people.json").write_text(json.dumps({"rows": FAMILY_PEOPLE}))
    (tmp / "houses.json").write_text(json.dumps({"rows": [{"code": "ABD1305", "active": True}]}))
    return tmp


def family_execs(ns: dict[str, Any]) -> list[dict]:
    return [c for c in ns["calls"] if c["action"] == "familyPack"]


fam_src = ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_exec_families")) or ""
check("a family member's pack is Python's familyPack for {family}, asking no ticket of its own",
      '_backend_pack("family", "familyPack", key)' in fam_src and "housekeeping=" not in fam_src)
listed = set(re.findall(r'"(\w+)"', receipts.group(1))) if receipts else set()
check("familyPack and every Families read are never stamped for a receipt; its writes keep exactly-once",
      {"familyPack", *FAMILY_READS} <= listed and not set(FAMILY_WRITES) & listed, sorted(listed))
fspec = limits["_APP_PACKS"].get("family-profiles") or {}
fpacks = limits["_APP_PACKS"]
check("the Families app is registered next to Clients: its key a name that rides the header, its own writes, "
      "filled after the clients and the houses (the team's Staff, filled last of all, comes after it)",
      fspec.get("query_key") is False and fspec.get("verbs") == "by_key"
      # Families' own: Apps Script's, then every write app/family_writes.py answers (New Family and a paper kept too)
      and fspec.get("writes") == set(FAMILY_WRITES) | {a for a, d in PY_DOORS.items()
                                                       if d.get("file") == "app/family_writes.py"}
      and fspec.get("warm_order", 0) > max(fpacks[a].get("warm_order", 0) for a in ("client-profiles", "locations"))
      and fpacks["staff-team"].get("warm_order", 0) > fspec.get("warm_order", 0), fspec)

fdir = family_dir()
fix = build(out_dir=fdir)
unheld = (fix["_app_pack_family_keys"](), fix["_app_pack_family_index"]())
hold_family_index(fix, families=[{"key": "fam_paulgone", "status": "inactive"}, {"key": "fam_maryanntest",
                                                                                 "status": "active"},
                                 {"key": "fam_ritalong", "status": "active"}, {"key": "Not A Key"}, "junk"],
                  records={"kay_test": "fam_maryanntest", "ann_more": "fam_maryanntest", "old_gone": "fam_paulgone",
                           "lee_other": "self"})
findex = fix["_app_pack_family_index"]()
check("the warm keys are the family members of the families index Python builds off asa-hub-db, the active first — "
      "nothing until that index is held, whatever the relay's own slices name",
      unheld == ([], {"keys": [], "clients": {}})
      and fix["_app_pack_family_keys"]() == ["fam_maryanntest", "fam_ritalong", "fam_paulgone"], [unheld, findex])
check("…and each client answers to the family member its own record names, as the index's records say",
      findex["clients"] == {"kay_test": "fam_maryanntest", "ann_more": "fam_maryanntest", "old_gone": "fam_paulgone"},
      findex["clients"])

print("\nthe one rule for a live client")
LIVE_SAID = {"": True, "active": True, " Active ": True, "ACTIVE": True, "inactive": False, " Inactive ": False,
             "archived": False, "pending": False}
live_said = {s: CLIENT_STATUS.live({"status": s}) for s in LIVE_SAID}
check("a client is live when not archived and its status is blank or 'active' (clientLive_, Locations.gs) — an "
      "archived row, a missing row and anything else are not",
      live_said == LIVE_SAID and CLIENT_STATUS.live({}) and not CLIENT_STATUS.live({"status": "active", "archived": True})
      and not CLIENT_STATUS.live({"status": "", "archived": "TRUE"}) and CLIENT_STATUS.live({"archived": False})
      and not CLIENT_STATUS.live(None) and not CLIENT_STATUS.live("junk"), live_said)
LIVE_ROWS = [{"client_key": "arc_one", "name": "Arc One", "status": "active", "archived": True, "ssa_name": "Ida Arch",
              "guardianName": "Gwen Arch"},
             {"client_key": "off_one", "name": "Off One", "status": " Inactive ", "ssa_name": "Ida Off",
              "guardianName": "Gwen Off"},
             {"client_key": "on_one", "name": "On One", "status": "", "ssa_name": "Ida On", "guardianName": "Gwen On"}]
live_dir = Path(tempfile.mkdtemp(prefix="app-packs-live-"))
(live_dir / "clients.json").write_text(json.dumps({"rows": LIVE_ROWS}))
live_ns = build(out_dir=live_dir)
check("the clients and SSAs warmed are the live clients' alone — a client set inactive or archived warms none, and "
      "still answers to its SSA",
      live_ns["_app_pack_client_keys"]() == ["on_one"] and live_ns["_app_pack_ssa_keys"]() == ["ssa_idaon"]
      and live_ns["_app_pack_ssa_index"]()["of_client"] == {"arc_one": "ssa_idaarch", "off_one": "ssa_idaoff",
                                                             "on_one": "ssa_idaon"},
      [live_ns["_app_pack_client_keys"](), live_ns["_app_pack_ssa_keys"]()])
live_uses = {name: "client_status.live(" in (
    ast.get_source_segment(SVC, next(n for n in TREE.body if node_name(n) == name)) or "")
    for name in ("_app_pack_client_index", "_app_pack_ssa_index")}
check("…each of them reads the one rule, never a status test of its own; the family members are the families "
      "index's, which reads no client row",
      all(live_uses.values()) and "client_status" not in (ast.get_source_segment(
          SVC, next(n for n in TREE.body if node_name(n) == "_app_pack_family_index")) or "client_status"), live_uses)

fns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir())
ffirst, fheaders = ask(fns, "Bearer boss", app_id="family-profiles", key=" fam_maryanntest ")
fagain = ask(fns, "Bearer boss", app_id="family-profiles", key="fam_maryanntest")[0]
check("the master reads a family member's pack by its key, once, never cached by the browser",
      ffirst.get("status") == 200 and ffirst["data"]["parts"]["overview"]["family"] == "fam_maryanntest"
      and ffirst["data"]["state"] == "fresh" and fagain["data"]["state"] == "fresh" and len(family_execs(fns)) == 1
      and family_execs(fns)[0]["payload"] == {"family": "fam_maryanntest"} and family_execs(fns)[0]["service"]
      and fheaders.get("Cache-Control") == "no-store", ffirst)


async def family_in_address() -> dict[str, Any]:
    return await fns["lane_app_pack"]("family-profiles", types.SimpleNamespace(headers={}), key="fam_ritalong",
                                     authorization="Bearer boss")


check("a family key that is not the roster's is 400, a key in the address is 400 and nothing is read; another session "
      "is 404, a visit 403",
      all(ask(fns, "Bearer boss", app_id="family-profiles", key=k)[0].get("status") == 400
          for k in ("maryanntest", "FAM_maryanntest", "fam_Mary", "fam_../x", "fam_", "fam_ab", "fam_" + "a" * 121, ""))
      and asyncio.run(family_in_address()).get("status") == 400 and len(family_execs(fns)) == 1
      and ask(fns, "Bearer adm", app_id="family-profiles", key="fam_maryanntest")[0].get("status") == 404
      and ask(fns, "Bearer boss", app_id="family-profiles", key="fam_maryanntest", member="m1")[0].get("status") == 403)


async def family_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir())
    # which family member a client's write touches is the held index's records, refilled from the same
    ns["family_roster"], ns["family_records"] = FAMILY_ROSTER, FAMILY_RECORDS
    hold_family_index(ns, FAMILY_ROSTER, FAMILY_RECORDS)
    for k in ("fam_maryanntest", "fam_ritalong", "fam_samuncle"):
        await ns["_app_pack_get"]("family-profiles", k)
    await ns["_app_pack_get"]("client-profiles", "kay_test")
    await ns["_app_pack_get"]("locations", "ABD1305")

    def state() -> dict[str, str]:
        # the Families index a write fills again is the index's own case (family_index_writes)
        return {k: "dirty" if e["dirty"] else "stale" if e.get("stale") else "clean"
                for (a, k), e in ns["_app_pack_held"].items() if a != "family-index"}

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    def only(**said: str) -> dict[str, str]:
        base = {"fam_maryanntest": "clean", "fam_ritalong": "clean", "fam_samuncle": "clean", "kay_test": "clean",
                "ABD1305": "clean"}
        return {**base, **said}

    ok = json.dumps({"status": 200, "data": {"saved": True}}).encode()
    got: dict[str, Any] = {}
    n0 = len(family_execs(ns))
    ns["_relay_observe_app_pack"]("familyProfileNoteAdd", form("familyProfileNoteAdd", {"family": "fam_maryanntest",
                                                                                         "body": "Called back"}), ok)
    got["note"] = state() == only(fam_maryanntest="dirty")
    await asyncio.sleep(0.02)
    got["note_refill"] = (len(family_execs(ns)) - n0,
                          ns["_app_pack_held"][("family-profiles", "fam_maryanntest")]["lane"])
    await settle()
    ns["_relay_observe_app_pack"]("familyProfileCallSchedule",
                                  form("familyProfileCallSchedule", {"client_key": "kay_test", "date": "2026-10-01"}),
                                  json.dumps({"status": 200, "data": {"call": {"family": "fam_ritalong"}}}).encode())
    got["call_by_answer"] = state() == only(fam_ritalong="dirty")
    await settle()
    ns["_relay_observe_app_pack"]("familyProfileIncidentTie",
                                  form("familyProfileIncidentTie", {"family": "fam_samuncle", "client_key": "kay_test",
                                                                    "incident_ts": "2026-09-28T12:00:00.000Z"}), ok)
    got["incident_tie"] = state() == only(fam_samuncle="dirty")
    await settle()
    ns["_app_pack_warm_wake"].clear()
    ns["_relay_observe_app_pack"]("familyProfileNoteAdd", form("familyProfileNoteAdd", {"body": "x"}), ok)
    got["unnamed"] = (state() == only(fam_maryanntest="stale", fam_ritalong="stale", fam_samuncle="stale"),
                      ns["_app_pack_warm_wake"].is_set())
    await settle()
    ns["_relay_observe_app_pack"]("clientProfileSave", form("clientProfileSave", {"client": "kay_test",
                                                                                   "fields": {"guardian_phone": "1"}}), ok)
    got["client_save"] = state() == only(fam_maryanntest="stale", kay_test="dirty")
    await settle()
    ns["_relay_observe_app_pack"]("create", form("create", {"client_name": "Bo Long", "summary_of_incident": "x"},
                                                 resource="uiIncidents"), ok)
    # an incident rides every house's pack too (Locations' own incidents section): the house stale as well
    got["incident"] = state() == only(fam_ritalong="stale", ABD1305="stale")
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "PPL_guardian_samuncle", "phone": "2"},
                                                 resource="people"), ok)
    got["roster_row"] = state() == only(fam_samuncle="stale")
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "t1", "column": "done"}, resource="tasks"),
                                  json.dumps({"status": 200, "data": {"id": "t1", "column": "done",
                                                                      "family_key": "fam_ritalong",
                                                                      "client_key": "kay_test"}}).encode())
    got["task_card"] = state() == only(fam_ritalong="stale")
    await settle()
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "PPL_7", "phone": "3"}, resource="people"), ok)
    ns["_relay_observe_app_pack"]("update", form("update", {"id": "r1"}, resource="clients"), ok)
    ns["_relay_observe_app_pack"]("create", form("create", {"client_name": "Lee Other"}, resource="uiIncidents"), ok)
    ns["_relay_observe_app_pack"]("locationNoteAdd", form("locationNoteAdd", {"house": "ABD1305", "details": "x"}), ok)
    got["untouched"] = state() == only(ABD1305="dirty")
    await settle()
    ns["_relay_observe_app_pack"]("familyProfileNoteAdd", form("familyProfileNoteAdd", {"family": "fam_ritalong"}),
                                  json.dumps({"status": 409, "message": "busy"}).encode())
    got["refused"] = state() == only()
    await settle()
    ns["_relay_observe_app_pack"]("guardiansToRoster", form("guardiansToRoster", {}), ok)
    got["sweep"] = state() == only(fam_maryanntest="stale", fam_ritalong="stale", fam_samuncle="stale",
                                   kay_test="stale")
    await settle()
    return got


fw = asyncio.run(family_writes())
check("a note on a family member makes that pack dirty, filled again at once on the person's lane; nothing else is "
      "touched", fw["note"] and fw["note_refill"] == (1, "person"), fw)
check("…a scheduled call is placed by the family member its answer names", fw["call_by_answer"], fw)
check("…an incident filed from Families and tied to its family member makes that pack dirty", fw["incident_tie"], fw)
check("…a Families write that names nobody makes every family pack stale and wakes the warm pass",
      fw["unnamed"] == (True, True), fw)
check("a client record saved in Clients: that client's pack dirty, and its guardian's family pack stale",
      fw["client_save"], fw)
check("an incident filed for a client makes its guardian's family pack stale (and every house's); a people-roster row "
      "of a guardian makes that family member's stale", fw["incident"] and fw["roster_row"], fw)
check("a scheduled call's task card moved on the Task Board makes the family member it carries stale — not the "
      "client's guardian", fw["task_card"], fw)
check("a staff row, an update by id alone, a client with no guardian and a house note touch no family pack",
      fw["untouched"], fw)
check("a refused Families write changes nothing", fw["refused"], fw)
check("guardians made people again: every family and every client stale, no house", fw["sweep"], fw)


def family_answer(payload: dict, ns: dict[str, Any]) -> dict:
    key = payload["payload"].get("family")
    if key is None:
        return {"status": 200, "data": {"parts": {"overview": {"v": ns["version"][0]},
                                                  "roster": {"families": ns.get("family_roster", [])},
                                                  "records": ns.get("family_records", {})}}}
    if key in ns["no_family"]:
        return {"status": 400, "message": f'No family member "{key}" is on file.'}
    key = ns.get("alias", {}).get(key, key)
    return {"status": 200, "data": {"family": key, "built_at": "2026-09-28T12:00:00Z",
                                    "parts": {"overview": {"family": key, "v": ns["version"][0]}},
                                    "part_status": {"overview": {"status": 200}}}}


async def family_rest() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir(), pack=family_answer)
    ns["family_roster"], ns["family_records"] = FAMILY_ROSTER, FAMILY_RECORDS
    # a guardianship the state holds is no family tie: the engine judges it, the relay cannot
    ns["no_family"] = {"fam_norastate"}
    got: dict[str, Any] = {}
    await ns["_app_pack_warm_pass"]()
    got["first"] = [c["payload"]["family"] for c in family_execs(ns)]
    got["keys"] = ns["_app_pack_family_keys"]()
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    n = len(family_execs(ns))
    await ns["_app_pack_warm_pass"]()
    got["second"] = sorted(c["payload"]["family"] for c in family_execs(ns)[n:])
    n = len(family_execs(ns))
    said = await ns["_app_pack_get"]("family-profiles", "fam_norastate")
    got["person"] = (said.get("status"), "No family member" in str(said.get("message")), "data" in said,
                     len(family_execs(ns)) - n, ns["_app_pack_resting"]("family-profiles"))
    ns["no_family"] = set()
    await ns["_app_pack_get"]("family-profiles", "fam_norastate")
    got["answered"] = "fam_norastate" in ns["_app_pack_family_keys"]()
    ns["_app_pack_family_refused"]["fam_norastate"] = (ns["clock"].now, "b1")
    got["held_back"] = "fam_norastate" not in ns["_app_pack_family_keys"]()
    ns["clock"].now += ns["APP_PACK_FAMILY_REST_S"] + 1
    got["aged_out"] = "fam_norastate" in ns["_app_pack_family_keys"]()
    ns["_app_pack_family_refused"]["fam_norastate"] = (ns["clock"].now, "b1")
    ns["_ENGINE_BUILD"] = "b2"
    got["new_engine"] = "fam_norastate" in ns["_app_pack_family_keys"]()
    # one person under two spellings: the engine answers the roster's key
    ns["alias"] = {"fam_samuncle": "fam_maryanntest"}
    entry = await ns["_app_pack_kick"]("family-profiles", "fam_samuncle", housekeeping=True)
    got["alias"] = (entry["data"]["family"], "fam_samuncle" in ns["_app_pack_family_keys"](),
                    "fam_maryanntest" in ns["_app_pack_family_keys"]())
    return got


fr = asyncio.run(family_rest())
check("a key the engine says is no family member is asked once by the warm pass, then rests out of it; the others are "
      "filled again", sorted(fr["first"]) == sorted(FAMILY_KEYS) and fr["keys"] == [k for k in FAMILY_KEYS
                                                                                     if k != "fam_norastate"]
      and fr["second"] == sorted(k for k in FAMILY_KEYS if k != "fam_norastate"), fr)
check("…a person's read still asks the engine and gets its words, and the app does not rest",
      fr["person"] == (400, True, False, 1, False), fr)
check("…an answer brings the key back; so do a new engine build and the end of the rest",
      fr["answered"] and fr["held_back"] and fr["aged_out"] and fr["new_engine"], fr)
check("a key the engine answers under another (one person, two spellings) is answered, then rests out of the warm "
      "pass while the roster's key stays", fr["alias"] == ("fam_maryanntest", False, True), fr)


async def family_unpublished() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir(),
               pack=lambda payload, ns: {"status": 404, "message": 'Unknown action: "familyPack".'})
    said = await ns["_app_pack_get"]("family-profiles", "fam_ritalong")
    return {"said": (said.get("status"), said.get("reason")), "resting": ns["_app_pack_resting"]("family-profiles"),
            "keys": ns["_app_pack_family_refused"], "others": ns["_app_pack_resting"]("client-profiles")}


fu = asyncio.run(family_unpublished())
check("an engine that does not publish familyPack yet rests the app, never a key, and no other app",
      fu == {"said": (503, "unpublished"), "resting": True, "keys": {}, "others": False}, fu)


async def family_warm_order() -> list[str]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir(), delay=0.01)
    ns["family_roster"], ns["family_records"] = FAMILY_ROSTER, FAMILY_RECORDS
    await ns["_app_pack_warm_pass"]()
    return [c["action"] for c in ns["calls"] if c["action"] in ("clientPack", "locationPack", "familyPack")]


fwo = asyncio.run(family_warm_order())
check("the warm pass fills the family members after the clients and the houses, one execution at a time",
      fwo == ["clientPack"] * 8 + ["locationPack"] + ["familyPack"] * len(FAMILY_KEYS), fwo)
flog = "\n".join(RECORDS.lines)
check("the log never names a family member or a family key",
      not any(w.lower() in flog.lower() for w in FAMILY_WORDS) and "fam_" not in flog, RECORDS.lines[-12:])

print("\nthe Families index")
ispec = fpacks.get("family-index") or {}
idx_src = ast.get_source_segment(SVC, next(n for n in TREE.body
                                           if node_name(n) == "_app_pack_exec_family_index")) or ""
check("the Families index is Python's familyIndexPack, asking no ticket of its own, under the one key `all`, warmed "
      "before every other app, always (it names every family member warmed), told its view, opened by whom the "
      "Families door opens to and ringing the Families screens",
      '_backend_pack("family", "familyIndexPack", key, pack=_APP_PACK_FAMILY_INDEX)' in idx_src
      and "housekeeping=" not in idx_src
      and ispec.get("key_re") == "all" and ispec.get("query_key") is False and ispec.get("view") is True
      and build(out_dir=family_dir())["_APP_PACKS"]["family-index"]["keys"]() == ["all"] and ispec.get("keys")() == ["all"]
      and limits["_APP_PACK_GATES"] == {"family-index": "family-profiles"}
      and ispec.get("warm_order", 0) < min(s.get("warm_order", 1) for a, s in fpacks.items() if a != "family-index")
      # New Family and a paper kept change the roster and the records the index holds (Families' own registry)
      and ispec.get("writes") == {"familyProfileNoteAdd", "familyProfileSave", "familyProfileNoteEdit", "familyCreate",
                                  "familyProfileDocAdd"}
      and {"clients", "people", "isps", "photos"} == set(ispec.get("resources") or ())
      and "_APP_PACK_EVENTS.update({door: _APP_PACK_EVENTS[app] for door, app in _APP_PACK_GATES.items()})" in SVC,
      ispec)
check("familyIndexPack is never stamped for a receipt", '"familyIndexPack"' in receipts.group(1))


def family_index_door() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir())
    first = ask(ns, "Bearer boss", app_id="family-index", key="all")[0]
    again = ask(ns, "Bearer boss", app_id="family-index", key="all")[0]
    wrong = [ask(ns, "Bearer boss", app_id="family-index", key=k)[0].get("status") for k in ("fam_ritalong", "", "ALL ")]
    return {"first": (first.get("status"), (first.get("data") or {}).get("view"),
                      sorted(((first.get("data") or {}).get("parts") or {}))),
            "again": (again.get("status"), (again.get("data") or {}).get("state")),
            "execs": [c["payload"] for c in ns["calls"] if c["action"] == "familyIndexPack"], "wrong": wrong,
            "visit": ask(ns, "Bearer boss", app_id="family-index", key="all", member="m1")[0].get("status"),
            "other": ask(ns, "Bearer adm", app_id="family-index", key="all")[0].get("status")}


fid = family_index_door()
check("the master reads the index through its own door, filled once and then served fresh, told it reads the master's "
      "own view; any other key is 400, a visit 403, another session 404",
      fid["first"] == (200, {"kind": "master", "notes": True}, ["aliases", "notes", "overviews", "records", "roster"])
      and fid["again"] == (200, "fresh") and fid["execs"] == [{}] and fid["wrong"] == [400, 400, 200]
      and fid["visit"] == 403 and fid["other"] == 404, fid)


async def family_index_writes() -> dict[str, Any]:
    ns = build(sessions=BOSS, masters=FLAGS, out_dir=family_dir())
    await ns["_app_pack_get"]("family-index", "all")
    ok = json.dumps({"status": 200, "data": {"saved": True}}).encode()

    def mark() -> str:
        e = ns["_app_pack_held"].get(("family-index", "all")) or {}
        return "dirty" if e.get("dirty") else "stale" if e.get("stale") else "clean"

    async def settle() -> None:
        await asyncio.sleep(0.02)
        for e in ns["_app_pack_held"].values():
            e["dirty"] = e["stale"] = False

    got: dict[str, str] = {}
    for name, action, payload, resource in (
            ("note", "familyProfileNoteAdd", {"family": "fam_ritalong", "body": "x"}, ""),
            ("save", "familyProfileSave", {"family": "fam_ritalong", "changes": []}, ""),
            ("call", "familyProfileCallSchedule", {"family": "fam_ritalong", "client_key": "bo_long"}, ""),
            ("tie", "familyProfileIncidentTie", {"family": "fam_ritalong", "client_key": "bo_long"}, ""),
            ("client_save", "clientProfileSave", {"client": "bo_long", "fields": {"guardian_phone": "1"}}, ""),
            ("plan", "clientProfileIspSections", {"client": "bo_long"}, ""),
            ("people_row", "update", {"id": "PPL_7", "phone": "3"}, "people"),
            ("photo", "create", {"personId": "p1"}, "photos"),
            ("task", "update", {"id": "t1", "column": "done"}, "tasks"),
            ("sweep", "guardiansToRoster", {}, "")):
        ns["_relay_observe_app_pack"](action, form(action, payload, resource=resource), ok)
        got[name] = mark()
        await settle()
    return got


fiw = asyncio.run(family_index_writes())
check("a family member's details or notes written make the index dirty; a call or an incident tie leaves it as it is; a "
      "client's record or plan, a people or photo row and the guardians sweep make it stale; a task card does not touch it",
      fiw == {"note": "dirty", "save": "dirty", "call": "clean", "tie": "clean", "client_save": "stale", "plan": "stale",
              "people_row": "stale", "photo": "stale", "task": "clean", "sweep": "stale"}, fiw)

print("\nreleased to a viewer nothing narrows")
sys.path.append(str(ROOT / "server"))
try:
    import psycopg2  # noqa: F401
except Exception:  # noqa: BLE001 - the gate's module loads without a database; none is ever reached here
    _pg = types.ModuleType("psycopg2")
    _pg.extras = types.ModuleType("psycopg2.extras")
    _pg.extras.RealDictCursor = object
    sys.modules["psycopg2"], sys.modules["psycopg2.extras"] = _pg, _pg.extras
import hotline_desk as DESK  # noqa: E402

ACTOR_NODE = next(n for n in TREE.body if node_name(n) == "_hotline_actor")
REFUSED_ROLES = ("client", "guardian", "onboarding", "interviewer")
VIEWERS = {f"Bearer {n}": (role, f"u-{n}") for n, role in (
    ("boss", "admin"), ("adm", "admin"), ("sam", "staff"), ("mia", "manager"), ("gwen", "staff"), ("cara", "staff"),
    ("cli", "client"), ("onb", "onboarding"), ("den", "staff"), ("off", "staff"), ("far", "staff"), ("kid", "staff"),
    ("swi", "admin"), ("nob", "staff"), ("gsa", "staff"))}


def account(uid: str, role: str, badges: str, **more: str) -> dict[str, str]:
    return {"user_id": uid, "role": role, "types": badges, "active": "TRUE", "app_denials": "", "home_tenant": "t1",
            **more}


ACCOUNTS = {a["user_id"]: a for a in (
    account("u-boss", "admin", "ADMIN"), account("u-adm", "admin", "ADMINISTRATOR"), account("u-sam", "staff", "STAFF"),
    account("u-mia", "manager", "MANAGER"), account("u-gwen", "staff", "STAFF, GUARDIAN"),
    account("u-cara", "staff", "STAFF,CLIENT"), account("u-cli", "client", "CLIENT"),
    account("u-onb", "onboarding", "ONBOARDING"), account("u-den", "staff", "STAFF", app_denials='["locations"]'),
    account("u-off", "staff", "STAFF", active="FALSE"), account("u-far", "staff", "STAFF", home_tenant="t2"),
    account("u-kid", "staff", "STAFF"), account("u-swi", "admin", "ADMINISTRATOR"),
    # GUARDIAN ticked alone on a staff role: an SSA, or family
    account("u-gsa", "staff", "GUARDIAN"), account("u-mgu", "manager", "GUARDIAN"),
    account("u-cst", "client", "CLIENT, STAFF"), account("u-svg", "staff", "SUPERVISOR, GUARDIAN"),
    # TEAMLEAD stands in for nobody (the operator's rule, 2026-10-29): a DIRECTOR row is not its row
    account("u-tlg", "staff", "TEAMLEAD, GUARDIAN"))}
RELEASED = {"locations": ["STAFF", "ADMINISTRATOR", "CLIENT", "GUARDIAN", "ONBOARDING"],
            "client-profiles": ["STAFF", "CLIENT", "GUARDIAN"], "family-profiles": ["MANAGER"]}
TENANTS = {"locations": ["t1"]}


class Core:
    """The Core book's access rows as the gate reads them: a mirror copy that is fresh, stale or unreadable, and the
    live book, readable or not; every read counted."""

    def __init__(self, rules: dict[str, list[str]] | None = None, *, mirror: str = "fresh", live: bool = True,
                 mirror_accounts: dict[str, dict[str, str]] | None = None) -> None:
        self.rules, self.state, self.live_ok = rules if rules is not None else RELEASED, mirror, live
        self.mirror_accounts = mirror_accounts if mirror_accounts is not None else ACCOUNTS
        self.reads: list[str] = []

    def mirror(self, pg_dsn: str, sheet_id: str, uid: str, app_id: str) -> dict[str, Any]:
        self.reads.append("mirror")
        if self.state == "down":
            raise RuntimeError("no mirror here")
        user = self.mirror_accounts.get(uid)
        fresh = self.state == "fresh"
        return {"source": "mirror", "user": dict(user) if user else None, "rule": list(self.rules.get(app_id, [])),
                "tenants": list(TENANTS.get(app_id, [])), "age_s": 30.0 if fresh else 99_999.0, "sync_ok": fresh}

    def live(self, sheets: Any, sheet_id: str, fresh_s: float) -> tuple[dict[str, Any] | None, str]:
        self.reads.append("live")
        if not self.live_ok:
            return None, "The Core book could not be read (test)."
        return {"users": {u: dict(a) for u, a in ACCOUNTS.items()}, "rules": dict(self.rules),
                "tenants": dict(TENANTS)}, ""


class Gate:
    """The real Core readers swapped for one Core's while a scenario runs; put back after it."""

    def __init__(self, core: Core) -> None:
        self.core = core

    def __enter__(self) -> Core:
        self.saved = (DESK._core_from_mirror, DESK._core_live, DESK._ACCESS_WRITTEN_AT[0])
        DESK._core_from_mirror, DESK._core_live, DESK._ACCESS_WRITTEN_AT[0] = self.core.mirror, self.core.live, 0.0
        return self.core

    def __exit__(self, *exc: Any) -> None:
        DESK._core_from_mirror, DESK._core_live, DESK._ACCESS_WRITTEN_AT[0] = self.saved


def released(masters: dict[str, Any] | None = None, **kw: Any) -> dict[str, Any]:
    """A relay namespace with the real access gate (_hotline_actor over hotline_desk.app_access), each ask recorded."""
    ns = build(sessions=VIEWERS, masters=masters or {"boss": True, "adm": False}, **kw)
    ns.update({"hotline_desk": DESK, "PG_DSN": "postgresql://test", "HUB_DB_SHEET_ID": "core-test",
               "MIRROR_TRUST_MAX_S": 7200.0, "badge_follows": DESK.badge_follows})
    exec(compile(ast.Module(body=[ACTOR_NODE], type_ignores=[]), "snapshot_service.py", "exec",
                 flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    real, asked = ns["_hotline_actor"], []

    async def gate(authorization: str, app_id: str = "smartcomms", **kw2: Any):
        asked.append((authorization, app_id, kw2))
        return await real(authorization, app_id, **kw2)

    ns["_hotline_actor"], ns["gate_asked"] = gate, asked
    return ns


def status_of(answer: dict[str, Any]) -> Any:
    return answer.get("status") if answer != dict(_REFUSED) else "refused"


_REFUSED = {"status": 404, "reason": "unknown", "message": "Unknown lane."}
WHO = ("boss", "sam", "adm", "mia", "gwen", "cara", "cli", "onb", "den", "off", "far", "nob", "gsa")
with Gate(Core()):
    rns = released()
    by_who = {w: status_of(ask(rns, f"Bearer {w}")[0]) for w in WHO}
    sam_again = door_said(ask(rns, "Bearer sam")[0])
check("a house's pack opens to the master, and past the master to a session whose badge the app's App Control row "
      "names and who wears none that narrows it: staff by STAFF, an administrator by a badge in `types`",
      by_who["boss"] == 200 and by_who["sam"] == 200 and by_who["adm"] == 200, by_who)
check("…and to a staff account that ticks STAFF beside GUARDIAN or CLIENT: the widest released badge it ticked wins",
      by_who["gwen"] == 200 and by_who["cara"] == 200, by_who)
check("…and it is refused, as the door refuses an unknown lane, to a badge the row does not name, a staff account that "
      "ticks GUARDIAN alone (family, or an SSA) though the row names STAFF, the client, onboarding and interviewer "
      "roles even when the row names them, an account's own denial, an inactive account, another home tenant, and an "
      "account not on record",
      all(by_who[w] == "refused" for w in ("mia", "gsa", "cli", "onb", "den", "off", "far", "nob")), by_who)
check("the gate is App Control's own (hotline_desk.app_access) for the door's app, asked with the client, guardian, "
      "onboarding and interviewer roles refused and never on the admin floor; the master's session never asks it",
      rns["gate_asked"] and all(a[1] == "locations" and a[2].get("refuse_roles") == REFUSED_ROLES
                                and a[2].get("floor") is False for a in rns["gate_asked"])
      and "Bearer boss" not in {a[0] for a in rns["gate_asked"]}
      and ast.get_source_segment(SVC, ACTOR_NODE).count("hotline_desk.app_access") == 1, rns["gate_asked"])
check("authMe is still spent on admin sessions alone",
      len([c for c in rns["calls"] if c["action"] == "authMe"]) == 2
      and rns["_auth_master"] == {"boss": True, "adm": False}, rns["calls"])
check("…and a released viewer reads the one pack the master reads: one execution for the house, served fresh",
      len(execs(rns)) == 1 and sam_again == (200, "fresh", 1), [execs(rns), sam_again])

with Gate(Core()):
    cdns = released(out_dir=clients_dir())
    cl = {w: door_client(ask(cdns, f"Bearer {w}", app_id="client-profiles", key="kay_test")[0])
          for w in ("sam", "gwen", "gsa", "cli")}
    unreleased = ask(cdns, "Bearer sam", app_id="ssa-profiles", key="ssa_bochen")[0]
    shut_family = ask(cdns, "Bearer sam", app_id="family-profiles", key="fam_ritalong")[0]
check("a client's pack opens the same way to staff and to staff ticking GUARDIAN beside STAFF, and never to a family "
      "member or an SSA ticking GUARDIAN alone, or the client",
      cl["sam"] == (200, "fresh", 1) and cl["gwen"] == cl["sam"] and cl["gsa"][0] == 404 and cl["cli"][0] == 404
      and len(client_execs(cdns)) == 1, cl)
check("an app with no App Control row is the master's alone, and an app whose row names none of the badges is shut",
      unreleased == _REFUSED and shut_family == _REFUSED and not ssa_execs(cdns)
      and {a[1] for a in cdns["gate_asked"]} >= {"ssa-profiles", "family-profiles"}, [unreleased, shut_family])

with Gate(Core()):
    ins = released(out_dir=family_dir())
    by_idx = {w: ask(ins, f"Bearer {w}", app_id="family-index", key="all")[0] for w in ("boss", "mia", "sam", "gsa", "cli")}
check("the Families index opens as the Families door does — to the master, told the master's view, and to a viewer "
      "App Control's Families row releases whom nothing narrows, told it sees everything; never to staff the row does "
      "not name, GUARDIAN ticked alone or a client — and the gate asked is the Families row's own",
      status_of(by_idx["boss"]) == 200 and by_idx["boss"]["data"]["view"] == {"kind": "master", "notes": True}
      and status_of(by_idx["mia"]) == 200 and by_idx["mia"]["data"]["view"] == {"kind": "all", "notes": True}
      and all(status_of(by_idx[w]) == "refused" for w in ("sam", "gsa", "cli"))
      and {a[1] for a in ins["gate_asked"]} == {"family-profiles"}
      and len([c for c in ins["calls"] if c["action"] == "familyIndexPack"]) == 1,
      {w: status_of(a) for w, a in by_idx.items()})

with Gate(Core({"locations": ["MANAGER"]})):
    mns = released()
    mgr = {w: status_of(ask(mns, f"Bearer {w}")[0]) for w in ("mia", "sam")}
check("the row decides, not the role list: a row naming MANAGER opens to the manager and shuts staff",
      mgr == {"mia": 200, "sam": "refused"}, mgr)

with Gate(Core()):
    vns = released(masters={"boss": True, "adm": False, "swi": {"status": 200, "data": {
        "user": {"id": "u-kid", "is_master": True},
        "be_another": {"acting": {"id": "u-kid", "until": "2099-01-01T00:00:00Z"}, "real": {"id": "u-swi"}}}}})
    vns["_acting"]["kid"] = (time.time() + 600, "u-boss", "u-kid")
    in_visit = ask(vns, "Bearer sam", member="mem_1")[0]
    acting = ask(vns, "Bearer kid")[0]
    switched_now = ask(vns, "Bearer swi")[0]
check("a visit is 403, a switched session 404, and one authMe has just called switched 404 — none of them asks the "
      "gate, however the visited account is released",
      in_visit.get("reason") == "visit" and acting == _REFUSED and switched_now == _REFUSED
      and not vns["gate_asked"] and "swi" in vns["_acting"], [in_visit, acting, switched_now, vns["gate_asked"]])

with Gate(Core()):
    uns = released()
    odd_app = ask(uns, "Bearer sam", app_id="clients")[0]
check("an app with no pack is refused before the gate is asked", odd_app == _REFUSED and not uns["gate_asked"], odd_app)

stale: dict[str, Any] = {}
for name, core in (("stale, live", Core(mirror="stale")), ("stale, no live", Core(mirror="stale", live=False)),
                   ("no mirror, live", Core(mirror="down")), ("nothing", Core(mirror="down", live=False)),
                   ("stale guardian", Core(mirror="stale", mirror_accounts={
                       **ACCOUNTS, "u-sam": account("u-sam", "staff", "GUARDIAN")}))):
    with Gate(core):
        sns = released()
        stale[name] = (status_of(ask(sns, "Bearer sam")[0]), "live" in core.reads)
check("a copy too old to vouch is checked live and opens on what the book says; with no live answer, or no copy and "
      "no book, the door stays shut",
      stale["stale, live"] == (200, True) and stale["stale, no live"][0] == "refused"
      and stale["no mirror, live"] == (200, True) and stale["nothing"][0] == "refused", stale)
check("…and a narrowing badge on any copy, however old, with no released badge ticked beside it that does not narrow, "
      "shuts it though the book no longer shows it",
      stale["stale guardian"][0] == "refused", stale)

wide: dict[str, Any] = {}
with Gate(Core()) as fresh_core:
    wns = released()
    wide_fn = wns["_app_pack_wide_types"]
    wide["staff"] = wide_fn("u-sam", "locations")
    wide["staff beside guardian"] = wide_fn("u-gwen", "locations")
    wide["staff beside client"] = wide_fn("u-cara", "locations")
    wide["fresh reads"] = list(fresh_core.reads)
    wide["guardian alone"] = wide_fn("u-gsa", "locations")
    wide["client role wearing staff"] = wide_fn("u-cst", "locations")
    wide["ticked, not named"] = wide_fn("u-gwen", "family-profiles")
    wide["role word named"] = wide_fn("u-mgu", "family-profiles")
    wide["blank"] = wide_fn("", "locations")
with Gate(Core({"locations": ["DIRECTOR"]})):
    dns = released()["_app_pack_wide_types"]
    wide["follower beside guardian"] = dns("u-svg", "locations")
    wide["team lead beside guardian"] = dns("u-tlg", "locations")
    wide["guardian, row names another"] = dns("u-gsa", "locations")
with Gate(Core(mirror="stale", live=False)):
    wide["stale, no live"] = released()["_app_pack_wide_types"]("u-sam", "locations")
    wide["stale beside guardian, no live"] = released()["_app_pack_wide_types"]("u-gwen", "locations")
with Gate(Core(mirror="stale")) as stale_core:
    wide["stale beside guardian, live"] = released()["_app_pack_wide_types"]("u-gwen", "locations")
    wide["stale beside guardian, live read"] = "live" in stale_core.reads
with Gate(Core(mirror="stale", mirror_accounts={**ACCOUNTS, "u-gwen": account("u-gwen", "staff", "GUARDIAN")})):
    wide["stale narrows, live widens"] = released()["_app_pack_wide_types"]("u-gwen", "locations")
with Gate(Core(live=False)):
    wns = released()
    DESK._ACCESS_WRITTEN_AT[0] = wns["clock"].now
    wide["written after the copy, no live"] = wns["_app_pack_wide_types"]("u-gwen", "locations")
with Gate(Core()) as written_core:
    wns = released()
    DESK._ACCESS_WRITTEN_AT[0] = wns["clock"].now
    wide["written after the copy, live"] = wns["_app_pack_wide_types"]("u-gwen", "locations")
    wide["written after the copy, live read"] = "live" in written_core.reads
with Gate(Core(mirror="down")):
    wide["no mirror, not in the book"] = released()["_app_pack_wide_types"]("u-ghost", "locations")
bare = build()
wide["no desk"] = bare["_app_pack_wide_types"]("u-sam", "locations")
check("the badge check: wide for STAFF on a fresh copy (read once, never live), and for STAFF ticked beside GUARDIAN or "
      "CLIENT; shut for no account, a copy that cannot vouch with no book, an account the book does not hold, and no "
      "gate module",
      {k: wide[k] for k in ("staff", "staff beside guardian", "staff beside client", "fresh reads", "blank",
                            "stale, no live", "no mirror, not in the book", "no desk")}
      == {"staff": True, "staff beside guardian": True, "staff beside client": True, "fresh reads": ["mirror"] * 3,
          "blank": False, "stale, no live": False, "no mirror, not in the book": False, "no desk": False}, wide)
check("…narrowed when no badge the account ticked is both named by the app's row and not narrowing: GUARDIAN ticked "
      "alone, a client role wearing STAFF, STAFF ticked where the row names only MANAGER, and a GUARDIAN whose role "
      "word alone the row names; a follower counts as the badge it follows, and a team lead, which follows nobody, "
      "does not count as a director",
      wide["guardian alone"] is False and wide["client role wearing staff"] is False
      and wide["ticked, not named"] is False and wide["role word named"] is False
      and wide["follower beside guardian"] is True and wide["team lead beside guardian"] is False
      and wide["guardian, row names another"] is False, wide)
check("…a widening beside a narrowing badge is read only from a copy that vouches: a stale copy, or one read before App "
      "Control's last change, is checked live and shut with no live answer; a stale copy that narrows is honoured "
      "though the book would widen",
      wide["stale beside guardian, no live"] is False and wide["stale beside guardian, live"] is True
      and wide["stale beside guardian, live read"] is True and wide["stale narrows, live widens"] is False
      and wide["written after the copy, no live"] is False and wide["written after the copy, live"] is True
      and wide["written after the copy, live read"] is True, wide)

viewer_gs = ROOT / "apps-script" / "ViewerScope.gs"
if viewer_gs.exists():
    said = re.search(r"var HUB_VIEWER_NARROW = \[([^\]]*)\];", viewer_gs.read_text(encoding="utf-8"))
    check("the badges that narrow are the backend's (ViewerScope.gs HUB_VIEWER_NARROW)",
          said is not None and set(re.findall(r"'(\w+)'", said.group(1))) == set(bare["_APP_PACK_NARROW_TYPES"]),
          said.group(0) if said else None)
else:
    print("  skip ViewerScope.gs is not in this tree: the narrowing badges are not compared")


async def gate_throws() -> dict[str, Any]:
    ns = build(sessions=VIEWERS, masters={"boss": True})
    ns["hotline_desk"] = DESK

    async def broken(*a: Any, **k: Any):
        raise RuntimeError("gate down")
    ns["_hotline_actor"] = broken
    before = len(RECORDS.lines)
    answer = await ns["lane_app_pack"]("locations", types.SimpleNamespace(headers={}), key="ABD1305",
                                      authorization="Bearer sam")
    return {"answer": answer, "said": RECORDS.lines[before:], "execs": len(execs(ns))}


gt = asyncio.run(gate_throws())
check("a gate that throws keeps the door shut and says only what failed",
      gt["answer"] == _REFUSED and gt["execs"] == 0
      and gt["said"] == ["app pack: the access check failed (RuntimeError)"], gt)

print("\na client's own view")
OWN_HOUSE, OWN_OTHER, OWN_SSA = "NW4045", "BW1001", "ssa_denisealvarez"
OWN_APPS = ("locations", "client-profiles", "ssa-profiles", "staff-profiles")
# what no client is ever handed: the house's notes and guidebook, the office's parts, the notes-bearing trail, another
# client of the house or the SSA
OWN_FORBIDDEN = ["HOUSE-NOTES", "GUIDEBOOK-FILES", "REFILLS-ROWS", "BILLING-ROWS", "WHOLE-ACTIVITY", "OFFICE-FLEET",
                 "MAR-ERRORS", "SSA-NOTES", "SSA-ACTIVITY", "VIEW-EXTRA", "lee_near", "Lee Near"]
OWN_WORDS = ["kay_own", "Kay Own", "lia_nohouse", "lee_near", "Lee Near", "denisealvarez", "Denise Alvarez"]
OWN_CLIENT_ROWS = [
    {"client_key": "kay_own", "name": "Kay Own", "house": OWN_HOUSE, "status": "active", "ssa_name": "Denise Alvarez"},
    {"client_key": "lee_near", "name": "Lee Near", "house": OWN_HOUSE, "status": "active", "ssa_name": "Denise Alvarez"},
    {"client_key": "lia_nohouse", "name": "Lia Nohouse", "house": "", "status": "active", "ssa_name": "Denise Alvarez"}]
OWN_ACCOUNTS = {a["user_id"]: a for a in (
    account("u-boss", "admin", "ADMIN"), account("u-sam", "staff", "STAFF"), account("u-gsa", "staff", "GUARDIAN"),
    account("u-kay", "client", "CLIENT", client_key="kay_own"),
    account("u-kgu", "client", "CLIENT, GUARDIAN", client_key="kay_own"),
    account("u-nok", "client", "CLIENT"),
    account("u-oldk", "client", "CLIENT", client_key="kay_own", active="FALSE"),
    account("u-cden", "client", "CLIENT", client_key="kay_own", app_denials='["locations"]'),
    account("u-lia", "client", "CLIENT", client_key="lia_nohouse"))}
OWN_RULES = {app: ["STAFF", "CLIENT", "GUARDIAN"] for app in OWN_APPS}
OWN_VIEWERS = {"Bearer boss": ("admin", "u-boss"), "Bearer sam": ("staff", "u-sam"), "Bearer gsa": ("staff", "u-gsa"),
               "Bearer kay": ("client", "u-kay"), "Bearer kgu": ("client", "u-kgu"), "Bearer nok": ("client", "u-nok"),
               "Bearer oldk": ("client", "u-oldk"), "Bearer cden": ("client", "u-cden"),
               "Bearer lia": ("client", "u-lia"),
               # a switched session answers as the account it is switched to
               "Bearer kid2": ("client", "u-kay"), "Bearer odd2": ("client", "u-kay")}


class OwnCore(Core):
    """The Core book with the own-view accounts, in the mirror copy and live alike."""

    def __init__(self, **kw: Any) -> None:
        super().__init__(OWN_RULES, mirror_accounts=OWN_ACCOUNTS, **kw)

    def live(self, sheets: Any, sheet_id: str, fresh_s: float) -> tuple[dict[str, Any] | None, str]:
        self.reads.append("live")
        if not self.live_ok:
            return None, "The Core book could not be read (test)."
        return {"users": {u: dict(a) for u, a in OWN_ACCOUNTS.items()}, "rules": dict(self.rules),
                "tenants": dict(TENANTS)}, ""


def own_view_of(client: str, house: str) -> dict[str, Any]:
    return {"scope": {"kind": "client", "houses": [{"code": house, "clients": [{"client_key": client}]}]},
            "overview": {"clients": [client], "v": 1}, "staff": {"staff": [{"key": "annlee"}], "for": client},
            "incidents": {"rows": [{"client_key": client}]}, "documents": {"isps": [{"client_key": client}]},
            "notes": "VIEW-EXTRA"}


def own_pack(payload: dict, ns: dict[str, Any]) -> dict[str, Any]:
    """The engine's packs as the new parts carry them, or before the publish (`own_published` False)."""
    action, said = payload.get("action"), payload.get("payload") or {}
    new = ns["own_published"]
    if action == "locationPack":
        house = said["house"]
        parts: dict[str, Any] = {"overview": {"clients": ["Kay Own", "Lee Near"]}, "staff": {"staff": []},
                                 "notes": {"notes": ["HOUSE-NOTES"]}, "supplies": {"items": ["gloves"]},
                                 "guidebook": {"files": ["GUIDEBOOK-FILES"]}}
        if new:
            parts.update({"repairs": {"rows": [{"id": "w1"}]}, "incidents": {"rows": [{"client_key": "lee_near"}]},
                          "client_views": {c: own_view_of(c, house) for c in ns["own_listing"].get(house, [])}})
        return {"status": 200, "data": {"house": house, "parts": parts,
                                        "part_status": {n: {"status": 200} for n in parts}}}
    if action == "clientPack":
        client = said["client"]
        parts = {"details": {"client_key": client}, "meds": {"rows": []}, "reviews": {"reviews": {}},
                 "activity": {"rows": ["WHOLE-ACTIVITY"]}, "appointments": {"rows": []},
                 "transport": {"tabs": {"vehicles": "OFFICE-FLEET"}}, "mar": {"tabs": {"errors": "MAR-ERRORS"}},
                 "refills": {"rows": ["REFILLS-ROWS"]}, "funds": {"rows": []}, "billing": {"rows": ["BILLING-ROWS"]},
                 **{f"care_{t}": {"tab": t} for t in ("plans", "team", "daily", "health", "goals", "home")}}
        if new:
            parts.update({"roster_own": {"clients": [{"client_key": client}], "viewer": "client"},
                          "incidents": {"rows": []}, "activity_own": {"rows": ["own trail"]},
                          "transport_own": {"tabs": {"calendar": []}, "today": "2027-01-15"},
                          "mar_own": {"tabs": {"papers": []}}})
        return {"status": 200, "data": {"client": client, "parts": parts,
                                        "part_status": {n: {"status": 200} for n in parts}}}
    if action == "ssaPack":
        ssa = said["ssa"]
        parts = {"overview": {"ssa": {"key": ssa}, "clients": ["Kay Own", "Lee Near"]}, "documents": {"docs": []},
                 "activity": {"items": ["SSA-ACTIVITY"]}, "notes": {"notes": ["SSA-NOTES"]}}
        if new:
            parts["client_views"] = {c: {"roster": {"ssas": [{"key": ssa, "clients": 1}], "viewer": "client"},
                                         "overview": {"clients": [c]}, "documents": {"docs": [{"client_key": c}]},
                                         "notes": "VIEW-EXTRA"} for c in ("kay_own", "lee_near", "lia_nohouse")}
        return {"status": 200, "data": {"ssa": ssa, "parts": parts,
                                        "part_status": {n: {"status": 200} for n in parts}}}
    if action == "staffClientPack":
        if not new:
            return {"status": 404, "message": "Unknown action."}
        client = said["client"]
        parts = {"roster": {"staff": [{"key": "annlee"}], "view": "basic"}, "profile_annlee": {"view": "basic"},
                 "notes_extra": {"x": "VIEW-EXTRA"}}
        return {"status": 200, "data": {"client": client, "week": ns["own_week"] or ns["_app_pack_this_week"](),
                                        "parts": parts, "part_status": {n: {"status": 200} for n in parts}}}
    return {"status": 404, "message": "Unknown action."}


def own_dir() -> Path:
    folder = Path(tempfile.mkdtemp(dir=KEPT_ROOT))
    (folder / "clients.json").write_text(json.dumps({"rows": OWN_CLIENT_ROWS}))
    (folder / "houses.json").write_text(json.dumps({"rows": [{"code": c, "active": True}
                                                             for c in (OWN_HOUSE, OWN_OTHER, "ABD1305")]}))
    return folder


def own_ns(**kw: Any) -> dict[str, Any]:
    """A relay namespace with the real access gate over the own-view accounts, the new packs, and the Core users copy."""
    ns = build(sessions=OWN_VIEWERS, masters={"boss": True}, pack=own_pack, out_dir=own_dir(), **kw)
    ns.update({"hotline_desk": DESK, "PG_DSN": "postgresql://test", "HUB_DB_SHEET_ID": "core-test",
               "MIRROR_TRUST_MAX_S": 7200.0, "badge_follows": DESK.badge_follows, "own_published": True,
               "own_week": "", "own_listing": {OWN_HOUSE: ["kay_own", "lee_near", "lia_nohouse"]},
               "_app_pack_client_account_rows": lambda: [dict(a) for a in OWN_ACCOUNTS.values()]})
    exec(compile(ast.Module(body=[ACTOR_NODE], type_ignores=[]), "snapshot_service.py", "exec",
                 flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    real, asked = ns["_hotline_actor"], []

    async def gate(authorization: str, app_id: str = "smartcomms", **kw2: Any):
        asked.append((authorization, app_id, kw2))
        return await real(authorization, app_id, **kw2)

    ns["_hotline_actor"], ns["gate_asked"] = gate, asked
    ns["_acting"]["kid2"] = (ns["clock"].now + 600, "u-boss", "u-kay")
    ns["_acting"]["odd2"] = (ns["clock"].now + 600, "u-boss", "u-sam")
    return ns


async def own_door(ns: dict[str, Any], who: str, app_id: str, **kw: Any) -> dict[str, Any]:
    resp = types.SimpleNamespace(headers={})
    answer = await ns["lane_app_pack_own"](app_id, resp, authorization=f"Bearer {who}" if who else "", **kw)
    return {**answer, "_cache": resp.headers.get("Cache-Control")}


def pack_asks(ns: dict[str, Any]) -> list[tuple[str, Any]]:
    return [(c["action"], c["payload"]) for c in ns["calls"] if c["action"] != "authMe"]


async def own_reads() -> dict[str, Any]:
    ns = own_ns()
    got = {app: await own_door(ns, "kay", app) for app in OWN_APPS}
    asks = pack_asks(ns)
    again = {app: await own_door(ns, "kay", app, peek="1") for app in OWN_APPS}
    return {"ns": ns, "got": got, "asks": asks, "again": again, "execs_after": len(pack_asks(ns))}


with Gate(OwnCore()):
    orr = asyncio.run(own_reads())
og = orr["got"]
own_body = json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "_cache"} for k, v in og.items()})
week_now = orr["ns"]["_app_pack_this_week"]()
check("a client-role session reads its own view of each of the four apps: the packs asked are its own client's, its "
      "house's and its SSA's alone, one execution each, and the views are served from memory after",
      all(og[a]["status"] == 200 for a in OWN_APPS)
      and sorted(orr["asks"], key=str) == sorted([("locationPack", {"house": OWN_HOUSE}),
                                                  ("clientPack", {"client": "kay_own"}),
                                                  ("ssaPack", {"ssa": OWN_SSA}),
                                                  ("staffClientPack", {"client": "kay_own"})], key=str)
      and all(orr["again"][a]["status"] == 200 and orr["again"][a]["data"]["state"] == "fresh" for a in OWN_APPS)
      and orr["execs_after"] == 4 and all(og[a]["_cache"] == "no-store" for a in OWN_APPS),
      [orr["asks"], {a: og[a].get("status") for a in OWN_APPS}])
loc, cli, ssa_v, stf = (og[a].get("data") or {} for a in OWN_APPS)
check("…each in the client's narrowed shape: the house's own client view and its supplies and repairs; the client's "
      "own roster, activity, transport and administration under the names its sections read, with the record, care, "
      "medications, incidents, appointments and funds; the SSA's view of the client; this week's Staff",
      loc.get("house") == OWN_HOUSE and set(loc.get("parts") or {}) == {"scope", "overview", "staff", "incidents",
                                                                          "documents", "supplies", "repairs"}
      and loc["parts"]["overview"] == {"clients": ["kay_own"], "v": 1} and loc["part_status"]["overview"] == {"status": 200}
      and cli.get("client") == "kay_own"
      and set(cli.get("parts") or {}) == set(orr["ns"]["_APP_PACK_OWN_CLIENT_PARTS"])
      and cli["parts"]["activity"] == {"rows": ["own trail"]} and cli["parts"]["roster"]["viewer"] == "client"
      and cli["parts"]["transport"]["today"] == "2027-01-15"
      and ssa_v.get("ssa") == OWN_SSA and set(ssa_v.get("parts") or {}) == {"roster", "overview", "documents"}
      and ssa_v["parts"]["overview"] == {"clients": ["kay_own"]}
      and stf.get("client") == "kay_own" and stf.get("week") == week_now
      and set(stf.get("parts") or {}) == {"roster", "profile_annlee"}
      and all(isinstance(d.get("age_s"), float) and d.get("built_at") for d in (loc, cli, ssa_v, stf)),
      [loc, cli, ssa_v, stf])
check("…and no answer ever carries the house's notes or guidebook, refills, billing, the whole activity, the fleet, the "
      "errors audit, the SSA's notes or activity, a view's other fields, or another client of the house or the SSA",
      not [w for w in OWN_FORBIDDEN if w in own_body], [w for w in OWN_FORBIDDEN if w in own_body])


async def ssa_documents_switch() -> dict[str, Any]:
    """Settings › My Work hides SSA's Documents: a client's own view of its SSA drops it, an unanswered switch too."""
    out: dict[str, Any] = {}
    for mode in ("hidden", "unanswered", "shown"):
        ns = own_ns()
        ns["ssa_docs"] = mode
        got = await own_door(ns, "kay", "ssa-profiles")
        out[mode] = sorted((got.get("data") or {}).get("parts") or {})
        out[mode + "_asked"] = [a[1] for a in ns["hides_asked"]]
        out[mode + "_other"] = sorted(((await own_door(ns, "kay", "locations")).get("data") or {}).get("parts") or {})
    ns = own_ns()
    ns["ssa_docs"] = "hidden"
    resp = types.SimpleNamespace(headers={})
    boss = await ns["lane_app_pack"]("ssa-profiles", resp, authorization="Bearer boss", x_app_pack_key=OWN_SSA)
    out["boss"] = (boss.get("status"), ns["hides_asked"])
    pack = {"status": 200, "data": {"ssa": "ssa_x", "parts": {"overview": {"v": 1}, "documents": {"docs": ["d"]},
                                                              "client_views": {"kay": {"overview": {}, "documents": {}},
                                                                               "lee": "odd"}},
                                    "part_status": {"overview": {"status": 200}, "documents": {"status": 200}}}}
    out["cut"] = ns["_app_pack_ssa_docs_out"](pack)
    out["untouched"] = ns["_app_pack_ssa_docs_out"]({"status": 503, "message": "x"})
    return out


with Gate(OwnCore()):
    sds = asyncio.run(ssa_documents_switch())
check("Settings › My Work hides SSA's Documents: a client's own view of its SSA carries no documents, and neither does "
      "one whose switch could not be read; shown, it carries them; the switch is asked of Python as myWorkHidesMine and "
      "never touches another app's view",
      sds["hidden"] == ["overview", "roster"] and sds["unanswered"] == ["overview", "roster"]
      and sds["shown"] == ["documents", "overview", "roster"]
      and all(sds[m + "_asked"] == ["myWorkHidesMine"] for m in ("hidden", "unanswered", "shown"))
      and sds["hidden_other"] == sds["shown_other"] and "documents" in sds["hidden_other"], sds)
check("…the master's own read of an SSA pack never asks the switch; the cut drops the part, its state and each "
      "client's view of it, and leaves an answer with no parts as it is",
      sds["boss"][1] == []
      and sds["cut"]["data"]["parts"] == {"overview": {"v": 1}, "client_views": {"kay": {"overview": {}}, "lee": "odd"}}
      and sds["cut"]["data"]["part_status"] == {"overview": {"status": 200}}
      and sds["untouched"] == {"status": 503, "message": "x"}, sds)


async def hidden_parts_switches() -> dict[str, Any]:
    """Settings › My Work keeps Clients' Medication and Billing and Locations' House Supplies to the master: every other
    session's pack and a client's own view drop their parts; a switch shown, they stay."""
    out: dict[str, Any] = {}
    for mode, hidden in (("hidden", {"client_medication", "client_billing", "client_care_home", "location_supplies"}),
                         ("shown", set()), ("meds_only", {"client_medication"})):
        ns = own_ns()
        ns["hidden_parts"] = hidden
        cli = await own_door(ns, "kay", "client-profiles")
        loc = await own_door(ns, "kay", "locations")
        out[mode] = {"client": sorted((cli.get("data") or {}).get("parts") or {}),
                     "client_status": sorted((cli.get("data") or {}).get("part_status") or {}),
                     "house": sorted((loc.get("data") or {}).get("parts") or {}),
                     "asked": [a[1] for a in ns["hides_asked"]],
                     "staff_cut": await ns["_app_pack_hidden_parts"]("Bearer kay", "staff-profiles")}
    ns = own_ns()
    ns["ssa_docs"] = "unanswered"
    out["unanswered"] = sorted(await ns["_app_pack_hidden_parts"]("Bearer kay", "client-profiles"))
    ns = own_ns()
    ns["hidden_parts"] = {"client_medication"}
    resp = types.SimpleNamespace(headers={})
    await ns["lane_app_pack"]("client-profiles", resp, authorization="Bearer boss", x_app_pack_key="kay_own")
    out["boss"] = ns["hides_asked"]
    pack = {"status": 200, "data": {"client": "c", "parts": {"meds": {"rows": []}, "billing": {"rows": []},
                                                             "details": {"v": 1}},
                                    "part_status": {"meds": {"status": 200}, "billing": {"status": 200},
                                                    "details": {"status": 200}}}}
    out["cut"] = ns["_app_pack_parts_out"](pack, ("meds", "billing"))
    out["none"] = ns["_app_pack_parts_out"](pack, ())
    return out


with Gate(OwnCore()):
    hps = asyncio.run(hidden_parts_switches())
MEDS_PARTS = {"meds", "mar"}
check("Settings › My Work keeps Clients' Medication and Billing and Locations' House Supplies to the master: a client's "
      "own view of its record carries no medication and its house no supplies while hidden; shown, they come back; "
      "the switches are asked once per account and a pack no switch names never asks",
      not (set(hps["hidden"]["client"]) & MEDS_PARTS) and not (set(hps["hidden"]["client_status"]) & MEDS_PARTS)
      and "supplies" not in hps["hidden"]["house"]
      and MEDS_PARTS <= set(hps["shown"]["client"]) and "supplies" in hps["shown"]["house"]
      and not (set(hps["meds_only"]["client"]) & MEDS_PARTS) and "supplies" in hps["meds_only"]["house"]
      and all(hps[m]["asked"] == ["myWorkHidesMine"] for m in ("hidden", "shown", "meds_only"))
      and all(hps[m]["staff_cut"] == () for m in ("hidden", "shown", "meds_only")), hps)
check("…a switch that cannot be read withholds every part it guards; the master's own read never asks; the cut drops "
      "the parts and their states and leaves the rest, and an empty cut leaves the pack as it was",
      hps["unanswered"] == ["billing", "care_home", "mar", "mar_own", "meds", "refills"] and hps["boss"] == []
      and hps["cut"]["data"]["parts"] == {"details": {"v": 1}}
      and hps["cut"]["data"]["part_status"] == {"details": {"status": 200}}
      and hps["none"]["data"]["parts"] == {"meds": {"rows": []}, "billing": {"rows": []}, "details": {"v": 1}}, hps)


async def own_refused() -> dict[str, Any]:
    ns = own_ns()
    out: dict[str, Any] = {}
    for who in ("kgu", "gsa", "sam", "boss", "nok", "oldk", "odd2"):
        out[who] = {app: (await own_door(ns, who, app)).get("reason") for app in OWN_APPS}
    out["asks"] = pack_asks(ns)
    out["cden"] = {app: (await own_door(ns, "cden", app)).get("status") for app in OWN_APPS}
    out["gate"] = [(a[1], a[2].get("refuse_roles"), a[2].get("floor")) for a in ns["gate_asked"]]
    out["visit"] = await own_door(ns, "kay", "locations", member="m1")
    out["no_token"] = await own_door(ns, "", "locations")
    out["odd_app"] = await own_door(ns, "kay", "family-profiles")
    out["switched"] = {app: (await own_door(ns, "kid2", app)).get("status") for app in OWN_APPS}
    resp = types.SimpleNamespace(headers={})
    out["old_kay"] = await ns["lane_app_pack"]("client-profiles", resp, authorization="Bearer kay",
                                              x_app_pack_key="kay_own")
    out["old_kid2"] = await ns["lane_app_pack"]("locations", resp, authorization="Bearer kid2", x_app_pack_key=OWN_HOUSE)
    out["old_staff_app"] = await ns["lane_app_pack"]("staff-profiles", resp, authorization="Bearer boss",
                                                    x_app_pack_key="kay_own")
    out["old_sam"] = await ns["lane_app_pack"]("locations", resp, authorization="Bearer sam", x_app_pack_key=OWN_HOUSE)
    return out


with Gate(OwnCore()):
    ore = asyncio.run(own_refused())
unknown = {app: "unknown" for app in OWN_APPS}
check("a family member wearing CLIENT beside GUARDIAN, an SSA, staff, the master, a client account linked to no client, "
      "an inactive one, and a switched session judged as another account are refused on every own view as an unknown "
      "lane, and none of them starts an execution; an account's own denial shuts that app alone",
      all(ore[w] == unknown for w in ("kgu", "gsa", "sam", "boss", "nok", "oldk", "odd2")) and ore["asks"] == []
      and ore["cden"]["locations"] == 404 and ore["cden"]["client-profiles"] == 200,
      {w: ore[w] for w in ("kgu", "gsa", "sam", "boss", "nok", "oldk", "odd2", "cden")})
check("the gate asked is App Control's own for the view's app, with the guardian, onboarding and interviewer roles "
      "refused and never on the admin floor",
      ore["gate"] and all(r == ("guardian", "onboarding", "interviewer") and f is False for _a, r, f in ore["gate"])
      and {a for a, _r, _f in ore["gate"]} <= set(OWN_APPS), ore["gate"][:4])
check("a visit is 403, no session 401, an app with no own view an unknown lane; the door takes no key of any kind — "
      "not in the address, not in a header",
      ore["visit"].get("status") == 403 and ore["no_token"].get("status") == 401 and ore["odd_app"] == {
          **_REFUSED, "_cache": "no-store"}
      and not {"key", "x_app_pack_key", "written_ms"} & set(
          __import__("inspect").signature(orr["ns"]["lane_app_pack_own"]).parameters), ore["visit"])
check("a switched session as a client reads the view of the account it is switched to",
      ore["switched"] == {app: 200 for app in OWN_APPS}, ore["switched"])
check("the app door behaves as before: a client and a switched session are refused, staff released on Locations reads "
      "the whole house, and the own Staff pack is never served there — the master's own session included",
      ore["old_kay"] == _REFUSED and ore["old_kid2"] == _REFUSED
      and ore["old_staff_app"].get("status") in (400, 404) and "data" not in ore["old_staff_app"]
      and (ore["old_sam"].get("data") or {}).get("house") == OWN_HOUSE,
      [ore["old_kay"], ore["old_kid2"], ore["old_staff_app"], ore["old_sam"].get("status")])


async def own_moved() -> dict[str, Any]:
    ns = own_ns()
    out: dict[str, Any] = {"nohouse_cold": await own_door(ns, "lia", "locations")}
    await ns["_app_pack_get"]("locations", OWN_HOUSE)
    out["nohouse"] = await own_door(ns, "lia", "locations")
    ns["own_listing"][OWN_OTHER] = ["kay_own"]
    await ns["_app_pack_get"]("locations", OWN_OTHER)
    out["moved"] = await own_door(ns, "kay", "locations")
    out["execs"] = pack_asks(ns)
    return out


with Gate(OwnCore()):
    om = asyncio.run(own_moved())
check("a client whose slice row names no house reads the one held house pack that lists it, and none while no held "
      "pack does; a client two held house packs list (moved) is not served one — each section reads its action",
      om["nohouse_cold"] == {**_REFUSED, "_cache": "no-store"}
      and om["nohouse"].get("status") == 200 and (om["nohouse"].get("data") or {}).get("house") == OWN_HOUSE
      and om["nohouse"]["data"]["parts"]["overview"] == {"clients": ["lia_nohouse"], "v": 1}
      and om["moved"].get("reason") == "unlisted" and om["moved"].get("status") == 503
      and "data" not in om["moved"]
      and om["execs"] == [("locationPack", {"house": OWN_HOUSE}), ("locationPack", {"house": OWN_OTHER})], om)


async def own_unpublished() -> dict[str, Any]:
    ns = own_ns()
    ns["own_published"] = False
    return {app: await own_door(ns, "kay", app) for app in OWN_APPS}


with Gate(OwnCore()):
    ou = asyncio.run(own_unpublished())
check("a pack from before the publish answers `unpublished` on every own view, carrying nothing",
      all(ou[a].get("reason") == "unpublished" and ou[a].get("status") == 503 and "data" not in ou[a] for a in OWN_APPS),
      {a: ou[a].get("reason") for a in OWN_APPS})


async def own_last_week() -> dict[str, Any]:
    ns = own_ns()
    ns["own_week"] = "2020-01-06"
    out: dict[str, Any] = {"first": await own_door(ns, "kay", "staff-profiles")}
    held = ns["_app_pack_held"][("staff-profiles", "kay_own")]
    out["due"] = ns["_app_pack_due"]("staff-profiles", "kay_own")
    out["held_week"] = held["data"]["week"]
    ns["own_week"] = ""
    out["second"] = await own_door(ns, "kay", "staff-profiles")
    out["due_after"] = ns["_app_pack_due"]("staff-profiles", "kay_own")
    out["execs"] = [a for a, _p in pack_asks(ns)]
    return out


with Gate(OwnCore()):
    olw = asyncio.run(own_last_week())
check("a Staff pack gathered for a week that is over is never served — it is due, and the next read waits on this "
      "week's",
      olw["first"].get("reason") == "filling" and "data" not in olw["first"] and olw["due"] is True
      and olw["held_week"] == "2020-01-06" and olw["second"].get("status") == 200
      and olw["second"]["data"]["week"] == week_now and olw["due_after"] is False
      and olw["execs"] == ["staffClientPack", "staffClientPack"], olw)


async def own_warm() -> dict[str, Any]:
    ns = own_ns()
    out: dict[str, Any] = {}
    await ns["_app_pack_warm_pass"]()
    out["accounts"] = list(ns["_app_pack_client_accounts"])
    out["slots"] = ns["_app_pack_client_slots"]()
    out["order"] = pack_asks(ns)[:6]
    out["staff_keys"] = ns["_app_pack_staff_keys"]()
    before = len(pack_asks(ns))
    out["peeked"] = {app: (await own_door(ns, "kay", app, peek="1")).get("status") for app in OWN_APPS}
    out["peek_execs"] = len(pack_asks(ns)) - before
    ns["clock"].now += ns["APP_PACK_FRESH_S"] + 1
    before = len(pack_asks(ns))
    out["refilled"] = await ns["_app_pack_warm_clients"](out["slots"])
    out["refill_asks"] = pack_asks(ns)[before:]
    return out


with Gate(OwnCore()):
    ow = asyncio.run(own_warm())
check("the warm pass keeps the client accounts the Core users copy holds — an active client-role account linked to a "
      "client and wearing no GUARDIAN — and fills each one's own slots first: its record, its Staff, its house, its SSA",
      ow["accounts"] == ["kay_own", "lia_nohouse"] and ow["staff_keys"] == ["kay_own", "lia_nohouse"]
      and ow["slots"][:4] == [("client-profiles", "kay_own"), ("staff-profiles", "kay_own"), ("locations", OWN_HOUSE),
                              ("ssa-profiles", OWN_SSA)]
      and ow["order"][:4] == [("clientPack", {"client": "kay_own"}), ("staffClientPack", {"client": "kay_own"}),
                              ("locationPack", {"house": OWN_HOUSE}), ("ssaPack", {"ssa": OWN_SSA})], ow)
check("…so the client's four own views are held before it signs in: its boot prefetch is answered from memory with no "
      "execution; and once past fresh its slots are filled again between the pass's other fills, one execution each",
      ow["peeked"] == {app: 200 for app in OWN_APPS} and ow["peek_execs"] == 0
      and ow["refilled"] == len(ow["slots"])
      and sorted(ow["refill_asks"], key=str) == sorted(
          [("clientPack", {"client": "kay_own"}), ("staffClientPack", {"client": "kay_own"}),
           ("locationPack", {"house": OWN_HOUSE}), ("ssaPack", {"ssa": OWN_SSA}),
           ("clientPack", {"client": "lia_nohouse"}), ("staffClientPack", {"client": "lia_nohouse"})], key=str), ow)
bare_row = build()["_app_pack_own_key"]
check("the account's own key: only an active, unmerged client-role row wearing no GUARDIAN (however the cell is "
      "written) with a well-formed key",
      bare_row({"role": "client", "types": "CLIENT", "client_key": "kay_own", "active": "TRUE"}) == "kay_own"
      and bare_row({"Role": "Client", "Types": "", "Client Key": "kay_own"}) == "kay_own"
      and bare_row({"role": "client", "types": '["CLIENT","GUARDIAN"]', "client_key": "kay_own"}) == ""
      and bare_row({"role": "client", "types": "guardian", "client_key": "kay_own"}) == ""
      and bare_row({"role": "client", "types": "CLIENT", "client_key": "kay_own", "active": "no"}) == ""
      and bare_row({"role": "client", "types": "CLIENT", "client_key": "kay_own", "merged_into": "u-x"}) == ""
      and bare_row({"role": "staff", "types": "CLIENT", "client_key": "kay_own"}) == ""
      and bare_row({"role": "client", "types": "CLIENT", "client_key": "../kay"}) == ""
      and bare_row(None) == "")

print("\nthe log")
text = "\n".join(RECORDS.lines)
codes = re.findall(r"\b[A-Z]{2,4}\d{3,6}\b", text)
check("the log says counts and durations: no house code, no client, no SSA, no candidate, no referral, no person, no "
      "identity control",
      RECORDS.lines and not codes and not re.search(r"LEAD_\d", text)
      and not any(n in text for n in NAMES + CLIENT_WORDS + SSA_WORDS + CANDIDATE_WORDS + LEAD_WORDS + OWN_WORDS
                  + ["oordinator"])
      and not re.search(r"master|acting|be another|switched|impersonat", text, re.I), RECORDS.lines[:12])

pkg = json.loads((ROOT / "package.json").read_text())
check("`npm run check` runs this file", "npm run test:app-packs" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:app-packs") == "python3 tools/test-app-packs.py")

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
