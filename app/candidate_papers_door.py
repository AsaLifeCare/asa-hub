"""A paper filed on a Hiring record (candidateProfileDoor: Add document, Upload, a step's upload), the relay's
_candidate_papers in its words, answered here. The session is judged and the press planned, decided and kept by
Python's own doors in-process (gas_rungs.ask). The paper is read, filed in Drive as asatech and scored on
asa-hub-worker, which holds Tesseract, the digest engine and the platform's Drive token (server/hub_worker.py
/candidate/*). Nothing is filed before the plan and the verdict, and Python not answering is the press's 503."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import urllib.parse
from typing import Any

from fastapi.responses import Response

import front_door as FD
import gas_rungs as GR
import live_finish as LF

log = logging.getLogger("asa-hub-app.candidate-papers")

APP = "candidates"
WORKER_URL = (os.getenv("HUB_WORKER_URL") or "http://asa-hub-worker:8091").rstrip("/")
WORKER_TOKEN = os.getenv("HUB_APP_TOKEN", "")
READ_TIMEOUT_S = float(os.getenv("HUB_CANDIDATE_READ_TIMEOUT_S", "300"))
REFUSED_SERVICE = {"status": 403, "message": "Requires an admin or manager account"}
SIGN_IN = {"status": 401, "message": "Authentication required."}
AWAY = {"status": 409, "message": "This is read from your own workspace — not on a visit, in a world or at another "
                                  "place."}
UNFILED = {"status": 503, "message": "The document could not be filed just now — try again in a minute. Nothing was "
                                     "written."}
UNREAD = {"status": 503, "message": "The paper could not be read just now — try again in a minute. Nothing was "
                                    "written."}
UNKEPT = {"status": 503, "message": "The document reached Drive, but its Hiring record could not be kept just now — "
                                    "file it again in a minute."}
NO_OWNER = {"status": 503, "message": "Documents cannot be filed just now: the platform's own Drive account is not "
                                      "given to this server. Nothing was filed."}


def said(env: dict[str, Any]) -> Response:
    return Response(json.dumps(env), media_type="application/json")


async def worker(step: str, body: dict[str, Any], timeout: float = READ_TIMEOUT_S) -> dict[str, Any] | None:
    """One of the worker's paper steps; None when it was not reached or gave no envelope."""
    import httpx  # noqa: PLC0415

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0)) as client:
            res = await client.post(f"{WORKER_URL}/candidate/{step}", json=body, headers={"X-Hub-Token": WORKER_TOKEN})
        env = res.json() if res.status_code == 200 else None
    except Exception as exc:  # noqa: BLE001 - the type only
        log.warning("candidate papers: the worker's %s was not reached (%s)", step, type(exc).__name__)
        return None
    return env if isinstance(env, dict) else None


async def python(action: str, user: dict[str, Any], payload: dict[str, Any], write_id: str = "") -> dict[str, Any] | None:
    got, why = await GR.ask(APP, action, user, payload, write_id)
    if got is None:
        log.warning("candidate papers: %s not answered by Python (%s)", action, why)
        return None
    return got[2]


def landed(answer: dict[str, Any], token: str, key: str) -> None:
    """A paper's records kept in Postgres: that candidate's copies are read again (the bytes never ride the ring)."""
    raw = urllib.parse.urlencode({"body": json.dumps({"token": token, "action": GR.CANDIDATE_DOOR,
                                                      "payload": {"candidate": key}})}).encode()
    LF.final_landed(GR.CANDIDATE_DOOR, raw, json.dumps({**answer, "status": 200}).encode())
    GR.traffic()


async def resume_score(text: str, owed: dict[str, Any], user: dict[str, Any], file_id: str, token: str,
                       key: str) -> None:
    """The scorecard rides the upload, off the answer's path: never a gate."""
    got = await worker("score", {"text": text, "owed": owed})
    card = (got or {}).get("card") if (got or {}).get("status") == 200 else None
    if not isinstance(card, dict) or card.get("status") != "ok":
        log.info("candidate papers: %s not scored — %s", key,
                 "the worker did not answer" if not isinstance(card, dict)
                 else (str(card.get("status")) + (" — " + str(card.get("error")) if card.get("error") else ""))[:200])
        return
    write_id = "W" + hashlib.sha256(f"score|{key}|{file_id}|{time.time_ns()}".encode()).hexdigest()[:24]
    answer = await python("candidateResumeScore", user,
                          {"candidate": key, "fields": card.get("fields"), "hash": card.get("hash"),
                           "raw": card.get("raw"), "error": card.get("error"), "source_asset_id": file_id}, write_id)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            FD.settle_void_soon(APP, write_id)
        log.info("candidate papers: %s scored, the scorecard not kept (%s)", key,
                 "Python did not answer" if answer is None else answer.get("status"))
        return
    answer.pop("_write", None)
    log.info("candidate papers: %s scored (%s)", key, (answer.get("data") or {}).get("reason"))
    landed(answer, token, key)


async def file_paper(env: dict[str, Any], form: bytes) -> Response:
    """candidateProfileDoor's papers: every refusal from Python's plan before the paper is read, its verdict before
    Drive, the paper filed by the worker as asatech, its records kept by Python."""
    if FD.is_service(form):
        return said(REFUSED_SERVICE)
    s = await GR.person(env)
    if s is None:
        return said(SIGN_IN)
    # a visit, a world or a place away from home files on another account's record: never as this session's own
    if GR.away(env):
        return said(AWAY)
    token = str(env.get("token") or "")
    user = GR.user_of(s)
    payload = GR.payload_of(env)
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    b64 = fields.get("base64") if isinstance(fields.get("base64"), str) else ""
    ask = {"candidate": payload.get("candidate"), "press": payload.get("press"), "item": payload.get("item"),
           "fields": {k: v for k, v in fields.items() if k != "base64"}, "b64_chars": len(b64)}
    plan = await python("candidatePaperPlan", user, ask)
    if plan is None:
        return said(UNFILED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    key = str(data.get("candidate") or "")
    carried = {k: v for k, v in data.items() if k != "vocab"}
    text, reading = "", None
    if data.get("press") == "document":
        got = await worker("read", {"plan": data, "press": "document", "b64": b64})
        if got is None:
            return said(UNREAD)
        if got.get("status") != 200:
            return said(got)
        reading, text = got.get("reading"), str(got.get("text") or "")
        verdict = await python("candidatePaperDecide", user, {**ask, "plan": carried, "reading": reading})
        if verdict is None:
            return said(UNFILED)
        if verdict.get("status") != 200 or not isinstance(verdict.get("data"), dict):
            return said(verdict)
        if "done" in verdict["data"]:
            # a read only, or a paper not taken as the step's: nothing was filed
            return said({"status": 200, "data": verdict["data"]["done"]})
        placements = verdict["data"].get("placements") or []
    else:
        placements = data.get("placements") or []
        if data.get("read"):
            got = await worker("read", {"plan": data, "press": str(data.get("press") or ""), "b64": b64})
            if got is not None and got.get("status") == 400:
                return said(got)
            text = str((got or {}).get("text") or "")
    got = await worker("file", {"placements": placements, "b64": b64})
    if got is None:
        return said(UNFILED)
    if got.get("status") != 200:
        return said(NO_OWNER if got.get("reason") == "no_owner" else got)
    filed = got.get("filed") or []
    write_id = str(env.get("write_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_.:\-]{8,80}", write_id):
        first = filed[0]["file_id"] if filed else key
        write_id = "W" + hashlib.sha256(f"{first}|{time.time_ns()}".encode()).hexdigest()[:24]
    body: dict[str, Any] = {**ask, "plan": carried, "filed": filed}
    if reading is not None:
        body["reading"] = reading
    answer = None
    for _attempt in (1, 2):
        answer = await python("candidatePaperKeep", user, body, write_id)
        # the platform's write lock held a moment: asked once more under the same id
        if not (answer and answer.get("status") == 409 and "in progress" in str(answer.get("message") or "")):
            break
        await asyncio.sleep(1.0)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            FD.settle_void_soon(APP, write_id)
        log.warning("candidate papers: %d Drive file(s) filed but the Hiring records not kept (%s) — orphan files: %s",
                    len(filed), "Python did not answer" if answer is None else answer.get("status"),
                    ", ".join(str(f.get("file_id")) for f in filed))
        return said(UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    out = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    owed = out.pop("score_owed", None)
    landed(answer, token, key)
    spot = next((f for f, p in zip(filed, placements) if p.get("door") == "resumeUpload"), None)
    resume = str(spot["file_id"]) if spot else ""
    if text and resume:
        # the résumé's words, already read, kept for Staff Candidates › Resume (never read twice)
        LF.keep_task(worker("resume-text", {"resume": resume, "modified_time": str(spot.get("modified_time") or ""),
                                            "key": key, "text": text}))
    if isinstance(owed, dict) and text and resume:
        LF.keep_task(resume_score(text, owed, user, resume, token, key))
    log.info("candidate papers: %s press filed %d paper(s) as asatech, its records kept by Python", data.get("press"),
             len(filed))
    return said(answer)
