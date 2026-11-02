"""The 5558 hotline's fast path and its inbox pass (the relay's _quo_hotline_event, _hotline_python_file and
_hotline_python_inbox), in the app: a hotline-signed Quo event is screened, answered at once and filed behind — the
call kept (hotlineCallKeep), the sweep's orders asked of the model (hotlineShadowAsk, hotlineShadowModel, then the
analyze door's upstreams), the time clock's own PSI check beside it (app/psi_anywhere.py, in this process), and every
row and page filed in one write (hotlineFile) — and
laid on the desk's index meanwhile (app/hotline_calls.py). The staff beat's inbox pass files what nobody filed yet
the same way, and its beat is kept in asa-hub-db (app.loop_cadence) for the desk to read back. Every page goes
through Smart Comms inside hotlineFile; nothing here sends."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

from fastapi.responses import Response

import clocks
import hotline_calls as HCALLS
import live_notify

log = logging.getLogger("asa-hub-app.hotline")

APP_ID = "hotline"
LANE_MIRROR_APP = "lane-mirror"
# Quo stamps every delivery and every retry afresh: an older stamp is a replay
FRESH_S = 300.0
# the same call inside this window is a second delivery, unless the first one gave up (`failed`)
DEDUPE_S = 6 * 3600.0
# the lanes a filing writes rows into, rebuilt so the call's panel shows them
SLICES = ("supportQueue", "uiIncidents", "callOffs")
RING = "hotline:calls"
CALL_ID = re.compile(r"AC[0-9A-Za-z]{32}")
SWEEP_LOOP = "hub.hotline_sweep"
CADENCE_TABLE = "app.loop_cadence"
CADENCE_TTL_S = 60.0
SHEET_SYNC = "sheet-sync"
# call_id -> {at, stage}: filing | filed | blocked | dropped | failed
_FAST: dict[str, dict[str, Any]] = {}
_FAILURES = [0]
_LAST: dict[str, Any] = {"at": 0.0}
_CADENCE_HELD: dict[str, Any] = {"at": 0.0, "row": None}
_MIRROR: dict[str, Any] = {"task": None, "again": False}

# ── the model's other doors, after the app's own Groq keys: the analyze pool, then the local cortex ────────────────
ANALYZE_KEYS = [k for k in (os.getenv("LLM_API_KEY", ""), os.getenv("OPENAI_API_KEY", "")) if k]
ANALYZE_URL = os.getenv("HUB_ANALYZE_URL", "https://api.openai.com/v1/chat/completions")
ANALYZE_MODEL = os.getenv("HUB_ANALYZE_MODEL", "gpt-4o-mini")
ANALYZE_LOCAL_URL = os.getenv("HUB_ANALYZE_LOCAL_URL", "http://local-cortex:8080/v1/chat/completions")
ANALYZE_LOCAL_MODEL = os.getenv("HUB_ANALYZE_LOCAL_MODEL", "qwen2.5-7b-instruct")
ANALYZE_BUDGET_S = float(os.getenv("HUB_ANALYZE_BUDGET_S", "45"))


def _answer(status: int, **fields: Any) -> Response:
    return Response(content=json.dumps({"status": status, **fields}), status_code=status,
                    media_type="application/json")


def armed() -> bool:
    """Would a signed 5558 event be filed as it lands?"""
    return bool(clocks.hotline_keys())


def _wid(key: str) -> str:
    return "W" + hashlib.sha256(key.encode()).hexdigest()[:24]


def _prune(now: float) -> None:
    for cid in [c for c, e in _FAST.items() if now - e["at"] >= DEDUPE_S]:
        _FAST.pop(cid, None)
    while len(_FAST) > 5000:
        _FAST.pop(next(iter(_FAST)))


# ── the webhook ──────────────────────────────────────────────────────────────────────────────────────────────────────

async def event(raw: bytes, header: str) -> Response:
    """An event the hotline key signed: screened, answered at once, filed behind."""
    now = time.time()
    age = clocks.stamp_age_s(header, now)
    if age is None or abs(age) > FRESH_S:
        log.warning("quo hotline: refused a stale event (%s)", "no stamp" if age is None else f"stamped {age:.0f}s ago")
        return _answer(401, reason="stale", message="Stale.")
    try:
        ev = json.loads(raw.decode() or "{}")
    except Exception:  # noqa: BLE001
        return _answer(400, message="Not JSON.")
    data = ev.get("data") if isinstance(ev, dict) else None
    obj = data.get("object") if isinstance(data, dict) else None
    obj = obj if isinstance(obj, dict) else {}
    call_id = str(obj.get("callId") or "")
    dialogue = obj.get("dialogue")
    turns = [{"identifier": t.get("identifier"), "userId": t.get("userId"), "content": t.get("content"),
              "start": t.get("start")} for t in (dialogue if isinstance(dialogue, list) else []) if isinstance(t, dict)]
    why = ""
    if not isinstance(ev, dict) or ev.get("type") != "call.transcript.completed":
        why = "type"
    elif not CALL_ID.fullmatch(call_id):
        why = "call_id"
    elif not turns:
        why = "no_turns"
    elif not HCALLS.is_hotline(turns):
        why = "not_this_line"
    elif HCALLS.link_names_another_line(data.get("deepLink") if isinstance(data, dict) else None):
        # the 5558's agent spoke, but the event's own signed link opens another number's inbox
        why = "not_this_line"
    if why:
        return _answer(200, ignored=why)
    _prune(now)
    prior = _FAST.get(call_id)
    if prior and now - prior["at"] < DEDUPE_S and prior.get("stage") != "failed":
        return _answer(200, duplicate=call_id)
    event_at = str(ev.get("createdAt") or "")
    duration = obj.get("duration")
    duration = duration if isinstance(duration, (int, float)) and not isinstance(duration, bool) else None
    kept = {"call_id": call_id, "event_at": event_at, "created": str(obj.get("createdAt") or ""),
            "duration": obj.get("duration"), "dialogue": turns, "caller_phones": HCALLS.caller_phones(turns),
            "team": HCALLS.team_phones(turns)}
    _FAST[call_id] = {"at": now, "stage": "filing"}
    HCALLS.overlay_put(call_id, at=event_at, duration=duration, dialogue=turns, now=now)
    clocks.spawn(file_call(kept))
    live_notify.dirty([RING])
    return _answer(200, accepted=call_id)


# ── one call filed ───────────────────────────────────────────────────────────────────────────────────────────────────

async def keep(call: dict[str, Any]) -> bool:
    """The call kept in app.hotline_calls under one write id per call, so a second delivery keeps nothing."""
    env, why = await clocks.call(APP_ID, "hotlineCallKeep", call, _wid("hotline|" + call["call_id"]), clocks.PACK_S)
    if env is None or env.get("status") != 200:
        log.warning("quo hotline: %s not kept in Postgres (%s)", call["call_id"], why if env is None else
                    env.get("status"))
        return False
    return True


async def file_once(call_id: str, content: str, via: str, psi: dict[str, Any] | None
                    ) -> tuple[dict[str, Any] | None, bool]:
    """hotlineFile under one write id per call: (its answer, whether a missing answer may still have been kept). A
    deferral kept nothing; a timeout is asked once more under the same id, and its receipt says what was kept."""
    wid = _wid("hotline-file|" + call_id)
    payload = {"call_id": call_id, "content": content, "via": via, "psi": psi}
    unsure = False
    for _ in (1, 2):
        env, why = await clocks.call(APP_ID, "hotlineFile", payload, wid, clocks.PACK_S)
        if env is not None:
            env = dict(env)
            env.pop("_write", None)
            return env, False
        if why.startswith("it deferred"):
            return None, unsure
        unsure = True
    return None, unsure


async def settle(call_id: str, how: str, why: str) -> dict[str, Any]:
    """hotlineFile's settling of a call no model is asked about (no_words) or none would answer (blocked, one pass
    counted per call): its answer's data, or {} when it was not answered."""
    key = f"hotline-settle|{call_id}|{how}" + (f"|{time.time()}" if how == "blocked" else "")
    env, said = await clocks.call(APP_ID, "hotlineFile", {"call_id": call_id, "settle": how, "why": why}, _wid(key),
                                  clocks.PACK_S)
    if env is None or env.get("status") != 200:
        log.warning("hotline file: %s not settled (%s)", call_id, said if env is None else env.get("message"))
        return {}
    return env.get("data") or {}


def _upstreams() -> list[dict[str, Any]]:
    ups: list[dict[str, Any]] = []
    if ANALYZE_URL:
        ups.append({"name": "pool", "url": ANALYZE_URL, "model": ANALYZE_MODEL, "keys": list(ANALYZE_KEYS)})
    if ANALYZE_LOCAL_URL:
        ups.append({"name": "local-cortex", "url": ANALYZE_LOCAL_URL, "model": ANALYZE_LOCAL_MODEL, "keys": [""]})
    return ups


def _complete(url: str, key: str, model: str, text: str, timeout: float) -> tuple[int, str]:
    import requests  # noqa: PLC0415 - loaded where the model is asked

    headers = {"Authorization": f"Bearer {key}"} if key else {}
    r = requests.post(url, headers=headers, timeout=timeout,
                      json={"model": model, "temperature": 0.1, "messages": [{"role": "user", "content": text}]})
    if r.status_code >= 400:
        return r.status_code, ""
    return r.status_code, str((((r.json().get("choices") or [{}])[0].get("message") or {}).get("content")) or "")


async def model(text: str) -> tuple[str, str]:
    """One completion for the hotline's orders: the app's Groq keys first, then the analyze door's upstreams;
    (content, via) or ('', why)."""
    refusals: list[str] = []
    env, why = await clocks.call(APP_ID, "hotlineShadowModel", {"text": text}, wait=clocks.PACK_S)
    if env is not None and env.get("status") == 200 and (env.get("data") or {}).get("content"):
        return str(env["data"]["content"]), str(env["data"].get("via") or "groq")
    refusals.append("app " + str(why if env is None else env.get("message") or env.get("status")))
    deadline = time.monotonic() + ANALYZE_BUDGET_S
    for up in _upstreams():
        for key in up["keys"] or []:
            left = deadline - time.monotonic()
            if left <= 1.0:
                return "", "the model's time ran out"
            try:
                status, content = await asyncio.to_thread(_complete, up["url"], key, up["model"], text,
                                                          min(90.0, left))
            except Exception as exc:  # noqa: BLE001 - the next upstream is asked
                refusals.append(f"{up['name']} {type(exc).__name__}")
                continue
            if status >= 400:
                refusals.append(f"{up['name']} {status}")
                continue
            if content:
                return content, f"{up['name']}/{up['model']}"
            refusals.append(f"{up['name']} empty")
        if not up["keys"]:
            refusals.append(f"{up['name']} has no key")
    return "", " | ".join(refusals) or "no upstream"


def _psi_wait_s() -> float:
    import psi_anywhere  # noqa: PLC0415

    return float(getattr(psi_anywhere, "PSI_FAST_WAIT_S", 2.0))


async def _psi_verdict() -> dict[str, Any] | None:
    """Was PsiAnywhere up when this call landed? The time clock's own check, in this process (app/psi_anywhere.py,
    held and rationed there), never a second checker."""
    import psi_anywhere  # noqa: PLC0415

    try:
        return await psi_anywhere.verdict()
    except Exception as exc:  # noqa: BLE001 - the call files without a verdict, as it always did
        log.warning("quo hotline: the PsiAnywhere check did not run: %s", type(exc).__name__)
        return None


def psi_start(call: dict[str, Any]) -> asyncio.Task | None:
    """The check begun beside the filing, or None when this call is not about PsiAnywhere."""
    try:
        import psi_anywhere  # noqa: PLC0415

        if not psi_anywhere.armed() or not psi_anywhere.sniff(psi_anywhere.dialogue_text(call.get("dialogue"))):
            return None
    except Exception:  # noqa: BLE001 - a sniff that throws is not a PSI call
        return None
    return clocks.spawn(_psi_verdict())


async def psi_within(task: asyncio.Task | None, deadline: float) -> dict[str, Any] | None:
    """The verdict if it is ready by `deadline` (a monotonic stamp), else None."""
    if task is None:
        return None
    if not task.done():
        left = deadline - time.monotonic()
        if left <= 0:
            return None
        await asyncio.wait({task}, timeout=left)
    if not task.done() or task.cancelled():
        return None
    try:
        got = task.result()
    except Exception:  # noqa: BLE001
        return None
    return got if isinstance(got, dict) else None


def _books_moved() -> None:
    """A filing wrote rows: the desk's index and the three lanes' held copies are old, the books' keeper wakes."""
    HCALLS.invalidate()
    try:
        import hotline_lanes  # noqa: PLC0415

        hotline_lanes.invalidate()
    except Exception as exc:  # noqa: BLE001 - the screen's own poll carries on
        log.warning("hotline lanes: the held copies were not dropped: %s", type(exc).__name__)
    live_notify.told(wake=[SHEET_SYNC])


async def _lane_mirror_after_filing() -> None:
    """laneMirrorAfterFiling_: what a filing just wrote, mirrored into the three houses at once — again when another
    filing landed meanwhile. Never raises."""
    while True:
        _MIRROR["again"] = False
        try:
            env = await clocks.one_pass(LANE_MIRROR_APP, "laneMirrorAfterFiling", {})
            if env.get("status") != 200:
                log.warning("lane mirror after filing: %s", str(env.get("message") or env.get("status"))[:160])
            elif (env.get("data") or {}).get("rewrites"):
                log.info("lane mirror after filing: %s rewritten", ",".join(env["data"]["rewrites"]))
        except Exception as exc:  # noqa: BLE001 - the clock's next turn catches up
            log.warning("lane mirror after filing: %s", type(exc).__name__)
        if not _MIRROR["again"]:
            return


def _lane_mirror_kick() -> None:
    task = _MIRROR["task"]
    if task is not None and not task.done():
        _MIRROR["again"] = True
        return
    _MIRROR["task"] = clocks.spawn(_lane_mirror_after_filing())


async def file_call(kept: dict[str, Any]) -> None:
    """Hotline filing: the call kept, the sweep's orders asked of the model, the PSI check beside it, and hotlineFile
    files every row and page in one write. A call not kept, a filing refused or a model that would not answer is
    left to the inbox pass. Never raises."""
    call_id = kept["call_id"]
    stage = "failed"
    try:
        if not await keep(kept):
            log.warning("hotline file: %s not kept by Python — left to the inbox pass", call_id)
            return
        psi_task = psi_start(kept)
        psi_by = time.monotonic() + (_psi_wait_s() if psi_task is not None else 0.0)
        env, why = await clocks.call(APP_ID, "hotlineShadowAsk", {"call_id": call_id}, wait=clocks.PACK_S)
        asked = env.get("data") if env is not None and env.get("status") == 200 else None
        if asked is None:
            log.warning("hotline file: %s — the orders could not be built (%s)", call_id,
                        why if env is None else env.get("message") or env.get("status"))
        elif not asked.get("enabled"):
            stage = "dropped"
            HCALLS.overlay_drop(call_id)
            return
        if asked and asked.get("no_words"):
            if (await settle(call_id, "no_words", "")).get("state") == "nothing_to_file":
                stage = "filed"
                HCALLS.overlay_stage(call_id, "filed", kinds=[], items=0)
                _books_moved()
                log.info("hotline file: %s has no words past a greeting — filed with nothing, no model asked", call_id)
            return
        content, via = (await model(str(asked.get("ask") or ""))) if asked else ("", "no orders")
        if not content:
            stage = "blocked"
            HCALLS.overlay_stage(call_id, "blocked", why="The model would not answer: " + via)
            settled = await settle(call_id, "blocked", via) if asked else {}
            if settled.get("state") == "blocked":
                _books_moved()
                log.warning("hotline file: %s blocked — %s; left blocked after %s passes", call_id, via,
                            settled.get("tries"))
            else:
                log.warning("hotline file: %s blocked — %s; kept for the inbox pass (pass %s)", call_id, via,
                            settled.get("tries") or "?")
            return
        psi = await psi_within(psi_task, psi_by)
        env, unsure = await file_once(call_id, content, via, psi)
        if env is None:
            log.warning("hotline file: %s %s — the inbox pass reads it again", call_id,
                        "not known to be kept" if unsure else "deferred")
            return
        data = env.get("data") or {}
        if env.get("status") != 200:
            log.warning("hotline file: %s refused %s (%s) — the inbox pass reads it again", call_id, env.get("status"),
                        str(env.get("message"))[:160])
            return
        stage = "filed"
        told = data.get("state") == "filed"
        HCALLS.overlay_stage(call_id, "filed", kinds=data.get("kinds") if told else None,
                             items=data.get("items") if told else None)
        live_notify.dirty(SLICES)
        _books_moved()
        if told and data.get("kinds"):
            _lane_mirror_kick()
        log.info("hotline file: %s %s by Python (%s, %s)", call_id, data.get("state"),
                 ",".join(data.get("kinds") or []) or "no items", via)
    except Exception as exc:  # noqa: BLE001 - the call stays kept; the inbox pass reads it again
        log.warning("hotline file: %s not filed (%s)", call_id, type(exc).__name__)
    finally:
        entry = _FAST.get(call_id)
        if entry is not None:
            entry["stage"] = stage
        live_notify.dirty([RING])


# ── the inbox pass, on the staff beat ────────────────────────────────────────────────────────────────────────────────

async def inbox_pass() -> None:
    """hotlineSweep's inbox pass: the calls the inbox holds that nobody filed, each filed as the webhook's are; then
    its beat. Never raises."""
    try:
        env, why = await clocks.call(APP_ID, "hotlineInboxDue", {}, wait=clocks.PACK_S)
        data = env.get("data") if env is not None and env.get("status") == 200 else None
        if data is None:
            _FAILURES[0] += 1
            log.warning("hotline inbox: not read (%s)", why if env is None else env.get("message") or env.get("status"))
        else:
            _FAILURES[0] = 0
            for call in data.get("calls") or []:
                await file_call(call)
    except Exception as exc:  # noqa: BLE001 - the next tick reads it again
        _FAILURES[0] += 1
        log.warning("hotline inbox: %s", type(exc).__name__)
    await beat()


def _detail() -> dict[str, Any]:
    return {"envelope_status": None, "reason": None, "refused_in_a_row": _FAILURES[0], "refusing_since": None,
            "message": None, "census": {}}


async def beat() -> None:
    """The pass ran: its beat kept in asa-hub-db (app.loop_cadence, clocks.beat), where the desk reads it back. Never
    raises."""
    status = "degraded" if _FAILURES[0] else "ok"
    detail = _detail()
    _LAST.update(at=time.time(), detail=detail)
    await clocks.beat(SWEEP_LOOP, clocks.STAFF_EVERY_S, status, **detail)


def _kept_row() -> dict[str, Any] | None:
    import hubdb  # noqa: PLC0415

    got = hubdb.shared().query(f"select last_run_at, detail from {CADENCE_TABLE} where loop_name = %s",
                               (SWEEP_LOOP,))
    if not got:
        return None
    detail = got[0][1]
    return {"last_run_at": got[0][0], "detail": json.loads(detail) if isinstance(detail, str) else detail}


def _clock_of(at: datetime | None, detail: Any) -> dict[str, Any]:
    empty = {"at": "", "status": "", "reason": "", "message": "", "refused_in_a_row": None, "from": ""}
    if at is None:
        return empty
    detail = detail if isinstance(detail, dict) else {}
    refused = detail.get("refused_in_a_row")
    try:
        refused = int(refused) if refused is not None else None
    except (TypeError, ValueError):
        refused = None
    return {"at": HCALLS.iso_utc(at), "status": str(detail.get("envelope_status") or ""),
            "reason": str(detail.get("reason") or ""), "message": str(detail.get("message") or ""),
            "refused_in_a_row": refused, "from": "cadence"}


async def sweep_clock() -> dict[str, Any]:
    """{at, status, reason, message, refused_in_a_row, from}: the sweep's last pass, this process's own when it ran
    one, else the beat kept in asa-hub-db."""
    if _LAST.get("at"):
        return _clock_of(datetime.fromtimestamp(float(_LAST["at"]), timezone.utc), _LAST.get("detail"))
    now = time.time()
    if now - _CADENCE_HELD["at"] < CADENCE_TTL_S:
        row = _CADENCE_HELD["row"]
    else:
        try:
            row = await asyncio.to_thread(_kept_row)
        except Exception as exc:  # noqa: BLE001 - the clock is blank, never invented
            log.warning("hotline desk: the sweep's kept beat could not be read: %s", type(exc).__name__)
            row = None
        _CADENCE_HELD.update(at=now, row=row)
    if not row or row.get("last_run_at") is None:
        return _clock_of(None, None)
    return _clock_of(row["last_run_at"], row.get("detail"))
