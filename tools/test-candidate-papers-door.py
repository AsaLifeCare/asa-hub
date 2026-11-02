#!/usr/bin/env python3
"""A paper filed on a Hiring record, answered in asa-hub-app with its reading on asa-hub-worker
(app/candidate_papers_door.py), and /health's vitals from their new owners (app/live_health.py). Everything runs here
on stand-ins: Python's doors, the worker, the session and the finish.
- A document press goes plan → read → decide → file → keep → landed, in that order.
- An upload is filed without a verdict.
- The service identity, no session and a visit are refused before the plan.
- A refused plan or verdict is answered in Python's words, with nothing read or filed.
- An unread paper files nothing.
- A record not kept voids its write.
- /health has a provider for every vital, so the retired relay is never asked, and the worker's vitals are read with
  the machine token.

    python3 tools/test-candidate-papers-door.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import types
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:220]}"


class Response:
    def __init__(self, content=b"", media_type=None, status_code=200, headers=None):
        self.body = content.encode() if isinstance(content, str) else content
        self.status_code = status_code


sys.modules["fastapi"] = types.SimpleNamespace(Request=object)
sys.modules["fastapi.responses"] = types.SimpleNamespace(Response=Response, JSONResponse=Response)
steps: list[str] = []
landed: list = []
voided: list = []
SESSION = types.SimpleNamespace(uid="u1", role="Manager", master=False, acting=False, ok=True)
ANSWERS: dict[str, dict] = {}


async def ask(app_id, action, user, payload, write_id=""):
    steps.append(action)
    env = ANSWERS.get(action)
    return ((b"", 0.0, json.loads(json.dumps(env)), None, 0.0), "") if env is not None else (None, "stand-in: none")


async def person(env):
    return SESSION if env.get("token") == "good" else None


sys.modules["front_door"] = types.SimpleNamespace(is_service=lambda raw: b"service_secret" in raw[:4096],
                                                  settle_void_soon=lambda app, wid: voided.append(wid))
sys.modules["gas_rungs"] = types.SimpleNamespace(
    ask=ask, person=person, CANDIDATE_DOOR="candidateProfileDoor", traffic=lambda: None,
    away=lambda env: any(env.get(k) for k in ("world", "tenant", "member")),
    payload_of=lambda env: env.get("payload") if isinstance(env.get("payload"), dict) else {},
    user_of=lambda s: {"uid": s.uid, "role": s.role.lower(), "is_master": s.master})
sys.modules["live_finish"] = types.SimpleNamespace(final_landed=lambda action, raw, content: landed.append(action),
                                                   keep_task=lambda coro: coro.close())
import candidate_papers_door as CP  # noqa: E402

WORKER: dict[str, dict | None] = {}


async def worker(step, body, timeout=0.0):
    steps.append("worker:" + step)
    return WORKER.get(step)


CP.worker = worker


def run(env: dict, form: bytes = b"body=x") -> dict:
    steps.clear()
    return json.loads(asyncio.run(CP.file_paper(env, form)).body)


doc = {"token": "good", "action": "candidateProfileDoor",
       "payload": {"candidate": "c1", "press": "document", "fields": {"base64": "QUJD", "name": "a.pdf"}}}
ANSWERS.update(candidatePaperPlan={"status": 200, "data": {"candidate": "c1", "press": "document", "vocab": ["x"]}},
               candidatePaperDecide={"status": 200, "data": {"placements": [{"door": "stepUpload"}]}},
               candidatePaperKeep={"status": 200, "data": {"kept": 1}})
WORKER.update(read={"status": 200, "reading": {"kind": "id"}, "text": "words"},
              file={"status": 200, "filed": [{"file_id": "F1"}]})
got = run(doc)
check("a document press: plan, read, decide, file, keep, in that order",
      steps == ["candidatePaperPlan", "worker:read", "candidatePaperDecide", "worker:file", "candidatePaperKeep"]
      and got == {"status": 200, "data": {"kept": 1}} and landed == ["candidateProfileDoor"], (steps, got))

up = {**doc, "payload": {**doc["payload"], "press": "upload"}}
ANSWERS["candidatePaperPlan"] = {"status": 200, "data": {"candidate": "c1", "press": "upload",
                                                         "placements": [{"door": "resumeUpload"}]}}
got = run(up)
check("an upload is filed without a verdict", steps == ["candidatePaperPlan", "worker:file", "candidatePaperKeep"]
      and got["status"] == 200, steps)

check("the service identity is refused before the plan",
      run(doc, b"body=service_secret") == CP.REFUSED_SERVICE and not steps)
check("no session is refused before the plan", run({**doc, "token": "bad"}) == CP.SIGN_IN and not steps)
check("a visit is refused before the plan", run({**doc, "member": "m"}) == CP.AWAY and not steps)

ANSWERS["candidatePaperPlan"] = {"status": 403, "message": "Not yours"}
check("a refused plan is said in Python's words, nothing read or filed",
      run(doc) == {"status": 403, "message": "Not yours"} and steps == ["candidatePaperPlan"])
ANSWERS["candidatePaperPlan"] = {"status": 200, "data": {"candidate": "c1", "press": "document"}}
WORKER["read"] = None
check("a paper the worker did not read files nothing", run(doc) == CP.UNREAD and "worker:file" not in steps, steps)
WORKER["read"] = {"status": 200, "reading": {}, "text": ""}
ANSWERS["candidatePaperDecide"] = {"status": 200, "data": {"done": {"read": True}}}
check("a read only files nothing", run(doc) == {"status": 200, "data": {"read": True}} and "worker:file" not in steps)
ANSWERS["candidatePaperDecide"] = {"status": 200, "data": {"placements": [{"door": "x"}]}}
WORKER["file"] = {"status": 503, "reason": "no_owner"}
check("no Drive owner is said as such, nothing kept", run(doc) == CP.NO_OWNER and "candidatePaperKeep" not in steps)
WORKER["file"] = {"status": 200, "filed": [{"file_id": "F2"}]}
del ANSWERS["candidatePaperKeep"]
voided.clear()
check("a record not kept is the 503, its write voided", run(doc) == CP.UNKEPT and len(voided) == 1, voided)

# ---- /health's vitals ---------------------------------------------------------------------------------------------
import live_health as LH  # noqa: E402

check("every vital has its provider, so the relay is never asked", all(k in LH.PROVIDERS for k in LH.RELAY_KEYS),
      [k for k in LH.RELAY_KEYS if k not in LH.PROVIDERS])
asked: list = []


class _Res:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(req, *a, **k):
    asked.append((req.full_url, req.get_header("X-hub-token")))
    return _Res(json.dumps({"sheet_sync": {"last_pass_age_s": 5}, "form_digest": {"counts": {"done": 3}}}).encode())


urllib.request.urlopen = _urlopen
LH.WORKER_TOKEN = "machine"
check("the keepers' vitals come from the worker with the machine token",
      LH.PROVIDERS["sheet_sync"]() == {"last_pass_age_s": 5} and LH.PROVIDERS["form_digest"]() == {"counts": {"done": 3}}
      and asked == [("http://asa-hub-worker:8091/vitals", "machine")], asked)

failed = [k for k, v in results.items() if v != "ok"]
print(json.dumps({"results": results, "failed": failed}, indent=1))
sys.exit(1 if failed else 0)
