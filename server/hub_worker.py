"""asa-hub-worker: the six keepers (hub_sheet_sync, form_digest, mar_papers, call_prefs, resume_texts, cert_reads),
each its own process under this supervisor, and the Decoder lab's Try, which reads with tesseract. It runs on the
backend network only, with no port published. The keepers run here alone: they start as soon as the worker is armed.

    uvicorn hub_worker:app --host 0.0.0.0 --port 8091      (HUB_WORKER_KEEPERS=1 arms the keepers)
"""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import os
import signal
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("hub.worker")

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
PG_DSN = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL", "")
# as the relay's _start spawned them: the name each is logged by, its script beside this file
KEEPERS = (("sheet-sync", "hub_sheet_sync.py"), ("form-digest", "form_digest.py"), ("mar-papers", "mar_papers.py"),
           ("call-prefs", "call_prefs.py"), ("resume-texts", "resume_texts.py"), ("cert-reads", "cert_reads.py"))
RESPAWN_S = 60.0
# a keeper this young may not hear a wake yet (the relay's SHEET_SYNC_WAKE_AFTER_S)
WAKE_AFTER_S = 15.0
# what the keepers cannot work without; they are held, said by name, while one is empty
# (the old platform's database, HUB_SNAPSHOT_PG_DSN, is no longer one of them: the sheet keeper's mirror left with the
# old platform, and every keeper reads and writes asa-hub-db; hub_sheet_sync.MIRROR_ON alone would ask for it again)
NEEDS = (("GOOGLE_SERVICE_ACCOUNT_JSON", lambda: os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")),
         ("HUB_RELAY_DB_DSN", lambda: os.getenv("HUB_RELAY_DB_DSN", "")))
LAB_SIGN_IN = {"status": 401, "message": "sign in again"}


def _on(name: str, default: str) -> bool:
    return (os.getenv(name) or default).strip().lower() in ("1", "on", "true", "yes")


ARMED = _on("HUB_WORKER_KEEPERS", "0")


def _token() -> str:
    """The relay's machine token: the env first, else the private file beside the code (server/.hub-app-token)."""
    held = HERE / ".hub-app-token"
    return os.getenv("HUB_APP_TOKEN", "") or (held.read_text().strip() if held.is_file() else "")


TOKEN = _token()
# name -> [the process, when it was spawned]
PROCS: dict[str, list[Any]] = {name: [None, 0.0] for name, _script in KEEPERS}
STATE: dict[str, Any] = {"free": None, "why": ""}


def stop_all() -> int:
    """Every keeper running here ended (SIGTERM); their supervisors wait to be let go again."""
    stopped = 0
    for _name, (proc, _at) in PROCS.items():
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
                stopped += 1
    return stopped


def wake() -> bool:
    """The sheet-sync keeper's next pass now (SIGUSR1), as the relay woke it; one not up long enough keeps its clock."""
    proc, spawned = PROCS["sheet-sync"]
    try:
        if proc is not None and proc.returncode is None and time.time() - spawned >= WAKE_AFTER_S:
            proc.send_signal(signal.SIGUSR1)
            log.info("sheet-sync keeper woken — who reads what changed past Drive's margin")
            return True
    except Exception:  # noqa: BLE001 - its own clock reads the change a little later
        pass
    return False


async def keep(name: str, script: str, free: asyncio.Event) -> None:
    """One keeper as the relay kept it: spawned, waited on, said when it exits, spawned again a minute later."""
    path = str(HERE / script)
    env = dict(os.environ, HUB_PG_DSN=PG_DSN)
    while True:
        await free.wait()
        try:
            proc = await asyncio.create_subprocess_exec(sys.executable, path, env=env)
            log.info("%s keeper spawned (pid %s)", name, proc.pid)
            PROCS[name][:] = [proc, time.time()]
            if not free.is_set():  # held while it was being spawned
                proc.terminate()
            rc = await proc.wait()
            log.warning("%s keeper exited rc=%s — respawn in %.0fs", name, rc, RESPAWN_S)
        except Exception as exc:  # noqa: BLE001 — what it keeps stands; the next spawn tries again
            log.warning("%s keeper failed to spawn: %s", name, exc)
        await asyncio.sleep(RESPAWN_S)


def start() -> list[asyncio.Task]:
    """The supervisors, when armed and given what they need: the keepers run here, the only place they run; nothing
    otherwise, said why."""
    missing = [name for name, value in NEEDS if not value()]
    if not ARMED:
        STATE["why"] = "not armed (HUB_WORKER_KEEPERS is not 1)"
    elif missing:
        STATE["why"] = "the keepers' env is not here: " + ", ".join(missing) + " empty"
    else:
        STATE["why"] = ""
        free = asyncio.Event()
        free.set()
        STATE["free"] = True
        log.info("keepers: armed — %s started", ", ".join(n for n, _s in KEEPERS))
        return [asyncio.create_task(keep(n, s, free)) for n, s in KEEPERS]
    log.warning("keepers: none started here — %s; only the lab's Try is served", STATE["why"])
    return []


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    tasks = start()
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        stop_all()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def machine(request: Request) -> bool:
    return bool(TOKEN) and hmac.compare_digest(request.headers.get("x-hub-token", ""), TOKEN)


@app.get("/health")
async def health() -> dict[str, Any]:
    now = time.time()
    return {"ok": True, "armed": ARMED, "held_why": STATE["why"], "free": bool(STATE["free"]),
            "keepers": {name: {"pid": proc.pid if proc is not None else None,
                               "up": proc is not None and proc.returncode is None,
                               "for_s": round(now - at) if proc is not None else None}
                        for name, (proc, at) in PROCS.items()}}


@app.post("/sheet-sync/wake")
async def sheet_sync_wake(request: Request) -> JSONResponse:
    """The relay's wake, carried here over the backend network (snapshot_service._sheet_sync_wake)."""
    if not machine(request):
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    return JSONResponse({"status": 200, "woken": wake()})


# Scheduling › House calendars' reload (the master's, asked by asa-hub-app's /hub-lanes/scheduling-sheet-reload): the
# house calendars' workbook read now in a process of its own (hub_sheet_sync.py --live-now), only when it moved past
# the copy kept; never two at once, and never beside the clock's own pass (hub_sheet_sync.one_reader)
LIVE_NOW_S = float(os.getenv("HUB_CALENDARS_LIVE_NOW_S", "75"))
_LIVE_NOW: dict[str, Any] = {"lock": None}
LIVE_NOW_BUSY = {"status": 409, "message": "The house calendars are being read right now — try again in a minute."}
LIVE_NOW_UNREAD = {"status": 503, "message": "The house calendars could not be read just now — try again in a minute."}


@app.post("/calendars/live-now")
async def calendars_live_now(request: Request) -> JSONResponse:
    """The house calendars' live copy read again now when the workbook is newer; its answer, or why not."""
    if not machine(request):
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    lock = _LIVE_NOW["lock"] = _LIVE_NOW["lock"] or asyncio.Lock()
    if lock.locked():
        return JSONResponse(LIVE_NOW_BUSY)
    async with lock:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(HERE / "hub_sheet_sync.py"), "--live-now", env=dict(os.environ, HUB_PG_DSN=PG_DSN),
            stdout=asyncio.subprocess.PIPE)
        try:
            out, _err = await asyncio.wait_for(proc.communicate(), LIVE_NOW_S)
        except asyncio.TimeoutError:
            # killed whole: the copy is kept in one commit, so it stands as it was or as read
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            log.warning("calendars: the master's reload passed %.0fs and was stopped", LIVE_NOW_S)
            return JSONResponse(LIVE_NOW_UNREAD)
    lines = [ln for ln in out.decode("utf-8", "replace").splitlines() if ln.strip()]
    try:
        said = json.loads(lines[-1]) if lines else None
    except ValueError:
        said = None
    if not isinstance(said, dict) or "status" not in said:
        log.warning("calendars: the master's reload gave no answer (rc=%s)", proc.returncode)
        return JSONResponse(LIVE_NOW_UNREAD)
    data = said.get("data") or {}
    log.info("calendars: the master's reload — status %s, sheet ahead %s, %s house(s) read", said.get("status"),
             bool(data.get("ahead")), data.get("live_houses", 0))
    return JSONResponse(said)


@app.get("/vitals")
async def vitals(request: Request) -> JSONResponse:
    """The sheet keeper's and the digester's vitals for asa-hub-app's /health (keeper_vitals.py)."""
    if not machine(request):
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    import keeper_vitals  # noqa: PLC0415
    return JSONResponse(await asyncio.to_thread(keeper_vitals.vitals))


# ---- a paper filed on a Hiring record (candidateProfileDoor): asa-hub-app judges the session, plans, decides and
# keeps the records; the paper is read (Tesseract, the digest engine), filed in Drive as asatech and scored here,
# as the relay did (candidate_papers.py)
CANDIDATE_UNREAD = {"status": 503, "message": "The paper could not be read just now — try again in a minute. "
                                              "Nothing was written."}
CANDIDATE_UNFILED = {"status": 503, "message": "The document could not be filed just now — try again in a minute. "
                                               "Nothing was written."}
CANDIDATE_NO_OWNER = {"status": 503, "reason": "no_owner",
                      "message": "Documents cannot be filed just now: the platform's own Drive account is not given "
                                 "to this server. Nothing was filed."}


async def _candidate_body(request: Request) -> dict[str, Any] | None:
    if not machine(request):
        return None
    try:
        body = await request.json()
    except ValueError:
        body = None
    return body if isinstance(body, dict) else {}


def _candidate_blob(body: dict[str, Any]) -> bytes:
    import candidate_papers  # noqa: PLC0415
    import cert_papers  # noqa: PLC0415
    b64 = body.get("b64") if isinstance(body.get("b64"), str) else ""
    return candidate_papers.decode(b64, cert_papers.MAX_BYTES)


@app.post("/candidate/read")
async def candidate_read(request: Request) -> JSONResponse:
    """{plan, press, b64}: a document press's reading and words, or an upload's words when its plan asks; a paper
    that will not read is its 503, said by type alone (a message may carry the paper's words)."""
    body = await _candidate_body(request)
    if body is None:
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    import candidate_papers  # noqa: PLC0415
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else {}
    try:
        blob = await asyncio.to_thread(_candidate_blob, body)
    except candidate_papers.Refused as why:
        return JSONResponse({"status": 400, "message": str(why)})
    if str(body.get("press") or "") == "document":
        try:
            reading, text = await asyncio.to_thread(candidate_papers.read_paper, plan, blob)
        except Exception as exc:  # noqa: BLE001 — the type only
            log.warning("candidate papers: the paper was not read (%s) — nothing filed", type(exc).__name__)
            return JSONResponse(dict(CANDIDATE_UNREAD))
        return JSONResponse({"status": 200, "reading": reading, "text": text})
    file = plan.get("file") if isinstance(plan.get("file"), dict) else {}
    try:
        text = await asyncio.to_thread(candidate_papers.words, blob, str(file.get("name") or ""),
                                       str(file.get("mime") or ""))
    except Exception as exc:  # noqa: BLE001 — a résumé that does not read is filed unscored
        log.info("candidate papers: the résumé's words were not read (%s)", type(exc).__name__)
        text = ""
    return JSONResponse({"status": 200, "text": text})


@app.post("/candidate/file")
async def candidate_file(request: Request) -> JSONResponse:
    """{placements, b64}: the paper filed in Drive as asatech at every placement; nothing filed on any refusal."""
    body = await _candidate_body(request)
    if body is None:
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    import candidate_papers  # noqa: PLC0415
    import cert_papers  # noqa: PLC0415
    placements = body.get("placements") if isinstance(body.get("placements"), list) else []
    try:
        blob = await asyncio.to_thread(_candidate_blob, body)
        filed = await asyncio.to_thread(candidate_papers.file_all, placements, blob)
    except candidate_papers.Refused as why:
        return JSONResponse({"status": 400, "message": str(why)})
    except cert_papers.NoOwner as why:
        log.warning("candidate papers: nothing filed — no Drive client acts as the platform's own account (%s)", why)
        return JSONResponse(dict(CANDIDATE_NO_OWNER))
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("candidate papers: nothing filed — Drive did not take the paper (%s)", type(exc).__name__)
        return JSONResponse(dict(CANDIDATE_UNFILED))
    log.info("candidate papers: %d paper(s) filed as asatech", len(filed))
    return JSONResponse({"status": 200, "filed": filed})


@app.post("/candidate/score")
async def candidate_score(request: Request) -> JSONResponse:
    """{text, owed}: the résumé's scorecard (never a gate: a model that does not answer leaves it pending)."""
    body = await _candidate_body(request)
    if body is None:
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    import candidate_papers  # noqa: PLC0415
    owed = body.get("owed") if isinstance(body.get("owed"), dict) else {}
    try:
        card = await asyncio.to_thread(candidate_papers.scorecard, str(body.get("text") or ""), owed)
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the résumé's words
        return JSONResponse({"status": 503, "message": type(exc).__name__})
    return JSONResponse({"status": 200, "card": card})


@app.post("/candidate/resume-text")
async def candidate_resume_text(request: Request) -> JSONResponse:
    """{resume, modified_time, key, text}: the résumé's words, already read, kept for Staff Candidates › Resume."""
    body = await _candidate_body(request)
    if body is None:
        return JSONResponse({"status": 401, "message": "machine token required"}, status_code=401)
    import resume_texts  # noqa: PLC0415
    try:
        await asyncio.to_thread(resume_texts.keep_read, str(body.get("resume") or ""),
                                str(body.get("modified_time") or ""), str(body.get("key") or ""),
                                str(body.get("text") or ""))
    except Exception as exc:  # noqa: BLE001 — its own keeper reads it later
        return JSONResponse({"status": 503, "message": type(exc).__name__})
    return JSONResponse({"status": 200})


@app.post("/digest/try")
async def digest_try(request: Request) -> JSONResponse:
    """The lab's Try for asa-hub-app, which judged the session and the lab's door before forwarding it here."""
    if not machine(request):
        return JSONResponse(dict(LAB_SIGN_IN), status_code=401)
    try:
        body = await request.json()
    except ValueError:
        body = None
    body = body if isinstance(body, dict) else {}
    file_id = str(body.get("file_id") or "").strip()
    name = str(body.get("file_name") or "document").strip()
    if not file_id:
        return JSONResponse({"status": 400, "message": "file_id is required"})
    started = time.monotonic()
    try:
        import lab_try  # noqa: PLC0415
        out = await asyncio.to_thread(lab_try.read, file_id, name)
    except Exception as exc:  # noqa: BLE001 — a lab that throws says why
        log.warning("digest/try failed on %s (%s)", file_id, type(exc).__name__)
        return JSONResponse({"status": 500, "message": f"{type(exc).__name__}: {str(exc)[:200]}"})
    log.info("digest/try: %s read in %.1fs", file_id, time.monotonic() - started)
    return JSONResponse(out)
