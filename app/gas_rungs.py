"""The /gas rungs gas_relay answered ahead of Python's own doors, answered here as front door rungs (front_door.RUNGS)
in the relay's own words, on the front door's session verdict: Settings › Editions, a person's own editions and My
Work's switches (_editions_python), Staff Performance (_performance), a house's documents (_location_meds), Staff's
audited reads (_staff_audited), Settings' platform health and the master's overview (_settings_tools), a Google Form's
import and the hiring walk (_python_tool_door), the public forms and the hiring links (_public_door), the alerts
config save, a candidate's record, and IST Records' doors that are handed the roster and the declaration. The words,
sets and maps are the relay's, read off its source (front_door_routes.json `rungs`).

Every answer is then observed for this app's own state as one the relay carried was (live_finish.carried). A service
call never reaches a rung (front_door.route carries it). A candidate's paper is still the relay's: it is read with
Tesseract and the relay's digest engine, and filed in Drive there. The IST roster is read off the house calendars kept
in asa-hub-db (shift_slices.roster), never asa_schedules."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import urllib.parse
from datetime import date, timedelta
from typing import Any, Awaitable, Callable

from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import front_door as FD
import live_finish as LF

log = logging.getLogger("asa-hub-app.gas-rungs")

T: dict[str, Any] = FD.ROUTES["rungs"]
# _relay_envelope's cap, and _cert_papers_envelope's for a door read whole
ENVELOPE_MAX = 100_000
WHOLE_MAX = 32 * 1024 * 1024
UNREADABLE = {"status": 400, "message": "The request could not be read."}
AUTH_REQUIRED: dict[str, Any] = T["AUTH_ENDED"]
UNKNOWN: dict[str, Any] = T["RELAY_UNKNOWN_ACTION"]
UNWRITTEN = {"status": 503, "message": T["BACKEND_FINAL_UNWRITTEN"]}
AWAY: dict[str, Any] = T["LOCATION_MEDS_AWAY"]
TOOL_UNANSWERED: dict[str, Any] = T["PYTHON_TOOL_UNANSWERED"]
HIRING_APP = str(T["HIRING_APP"])
EDITIONS_APP = "editions"
STAFF_APP = "staff"
ALERTS_CONFIG_SAVE = "hiringAlertsSet"
CANDIDATE_DOOR = "candidateProfileDoor"
EDITIONS_KEY = "mywork_editions"
PUBLIC_APPS: dict[str, str] = {a: app_id for app_id, spec in T["PUBLIC_DOORS_BY_APP"].items()
                               for a in list(spec["reads"]) + list(spec["writes"])}
_IST_ROSTER: dict[str, Any] = {"at": 0.0, "rows": None}

Rung = Callable[[dict[str, Any], bytes, Any], Awaitable[Response]]


# ---- what every rung shares ------------------------------------------------------------------------------------------

def said(env: dict[str, Any], default: Any = None) -> Response:
    """The relay's own answer, its JSON as json.dumps writes it, with the phase every answer says."""
    return answered(json.dumps(env, default=default).encode())


def answered(content: bytes) -> Response:
    phase = LF.SLICES.PHASE.get("phase") if LF.SLICES is not None else None
    return Response(content=content, media_type="application/json",
                    headers={"X-Hub-Phase": str(phase)} if phase is not None else None)


def relay_form(env: dict[str, Any], raw: bytes) -> bytes:
    """What gas_relay reads (_relay_form): a raw-JSON envelope as the form field `body`, any other body as it came."""
    return FD.form_raw(env) if raw[:64].lstrip().startswith(b"{") else raw


def stamped(env: dict[str, Any], raw: bytes) -> str:
    """The envelope's write id, else one stamped as the relay stamps it."""
    wid = str(env.get("write_id") or "")
    return wid if FD.WRITE_ID.fullmatch(wid) else "W" + hashlib.sha256(raw + str(time.time_ns()).encode()).hexdigest()[:24]


async def person(env: dict[str, Any]) -> FD.Session | None:
    """_session_actor: the live session's verdict; None for none, one ended or one that cannot be read."""
    token = str(env.get("token") or "")
    s = await FD.session(token) if token else None
    return s if s is not None and s.ok else None


def user_of(s: FD.Session) -> dict[str, Any]:
    """The relay's word to Python on the session it verified, _acting_user over it."""
    user: dict[str, Any] = {"uid": s.uid, "role": s.role.strip().lower(), "is_master": s.master}
    return {**user, "acting": True, "unlogged": True, "is_master": False} if s.acting else user


def away(env: dict[str, Any]) -> bool:
    return any(env.get(k) for k in ("world", "tenant", "member"))


def payload_of(env: dict[str, Any]) -> dict[str, Any]:
    return env.get("payload") if isinstance(env.get("payload"), dict) else {}


def traffic() -> None:
    if LF.SLICES is not None:
        LF.SLICES.traffic_note("backend_python")


def observed(env: dict[str, Any], raw: bytes, resp: Response) -> Response:
    """This app's own state kept off the answer, as for an answer the relay carried (front_door.proxy)."""
    if FD.CARRIED is not None:
        try:
            FD.CARRIED(str(env.get("action") or ""), raw, bytes(resp.body or b""))
        except Exception:  # noqa: BLE001 - never in the answer's way
            pass
    return resp


async def ask(app_id: str, action: str, user: dict[str, Any], payload: dict[str, Any], write_id: str = "",
              at: float = 0.0) -> tuple[tuple[bytes, float, dict[str, Any], frozenset[str] | None, float] | None, str]:
    """_backend_call in-process (main.py's act): (the answer, how old its copy is, its JSON, the own writes it holds,
    when it read the kept edits), or None and why there was none."""
    M = FD.M
    module, deciding = M.APPS.get(app_id), M.WRITES.get(app_id)
    write = deciding is not None and action in deciding.ACTIONS
    if module is None or (action not in module.ACTIONS and not write):
        return None, "it deferred 404: not ported"
    if user.get("public") is True and (user.get("is_service") is True
                                       or action not in getattr(M, "PUBLIC_DOORS", frozenset())
                                       or action not in getattr(M, "PUBLIC_DOORS_BY_APP", {}).get(app_id, ())):
        return None, "it deferred 403: not a public door"
    try:
        if write:
            resp = await run_in_threadpool(M._run_write, deciding, action, user, payload, write_id, at)
        else:
            resp = await run_in_threadpool(M._run, module, action, user, payload, at)
    except Exception as exc:  # noqa: BLE001 - said by the caller, never another engine's to answer
        return None, type(exc).__name__
    body = bytes(resp.body or b"")
    if resp.status_code != 200:
        try:
            why = str((json.loads(body) or {}).get("defer") or "")
        except Exception:  # noqa: BLE001
            why = ""
        return None, f"it deferred {resp.status_code}: {why[:120]}"
    try:
        env = json.loads(body)
    except ValueError:
        env = None
    if not isinstance(env, dict) or not isinstance(env.get("status"), int):
        return None, "another shape"
    as_of = float(FD.header(resp, "X-Hub-As-Of") or 0.0) or time.time()
    named = FD.header(resp, "X-Hub-Own")
    held = None if named is None else frozenset(w for w in named.split(",") if w)
    edits = FD.header(resp, "X-Hub-Edits-At") or ""
    edits_at = float(edits) if re.fullmatch(r"\d{1,12}(\.\d{1,6})?", edits) else 0.0
    return (body, as_of, env, held, edits_at), ""


# ---- Settings › Editions, a person's own, and My Work's switches (_editions_python) ---------------------------------

async def editions(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """The master's access settings and a person's own reading of them, answered by Python alone."""
    action = str(env.get("action") or "")
    mine_none = T["EDITIONS_MINE_NONE"]
    saves = action in T["EDITIONS_SAVES"]
    none = {"status": 200, "data": mine_none[action]} if action in mine_none else UNKNOWN
    failed = {"status": 503, "message": T["BACKEND_FINAL_UNWRITTEN"] if saves else T["EDITIONS_UNREAD"][action]}
    form = relay_form(env, raw)
    if len(form) > ENVELOPE_MAX:
        return said(UNREADABLE)
    s = await person(env)
    if s is None:
        return said(AUTH_REQUIRED)
    master = s.master
    # an edition answers at home alone: a visit makes none; in a world or a place away from home, the master's own
    elsewhere = bool(env.get("world") or env.get("tenant"))
    if env.get("member") or (elsewhere and (action not in mine_none or not master)):
        return said(none)
    write_id = stamped(env, form) if saves else ""
    got, why = await ask(EDITIONS_APP, action, user_of(s), payload_of(env), write_id)
    if got is None:
        if write_id:
            FD.settle_void_soon(EDITIONS_APP, write_id)
        if not s.acting:
            log.warning("editions: %s not answered by Python (%s) — said 503", action, why)
        return said(failed)
    answer = got[2]
    answer.pop("_write", None)
    traffic()
    if action == "editionsMine":
        return answered(LF.editions_cut(action, json.dumps(answer).encode()))
    return said(answer)


# ---- Staff Performance (_performance) --------------------------------------------------------------------------------

async def performance(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    action = str(env.get("action") or "")
    app_id = str(T["PERFORMANCE_APP"])
    form = relay_form(env, raw)
    if len(form) > ENVELOPE_MAX:
        return said(UNREADABLE)
    s = await person(env)
    if s is None:
        return said(AUTH_REQUIRED)
    if away(env):
        return said(T["PERFORMANCE_AWAY"])
    user = user_of(s)
    read = action in T["PERFORMANCE_READS"]
    write_id = "" if read else stamped(env, form)
    got, why = await ask(app_id, action, user, payload_of(env), write_id)
    if got is None:
        if write_id:
            FD.settle_void_soon(app_id, write_id)
        if not s.acting:
            log.warning("staff performance: %s not answered by Python (%s) — said 503", action, why)
        return said(T["PERFORMANCE_UNREAD"] if read else UNWRITTEN)
    answer = got[2]
    answer.pop("_write", None)
    keep = answer.pop("_keep", None)
    if action == T["PERFORMANCE_EVALUATE"] and isinstance(keep, dict):
        kid = "W" + hashlib.sha256(form + b"keep" + str(time.time_ns()).encode()).hexdigest()[:24]
        kept, _why = await ask(app_id, str(T["PERFORMANCE_KEEP"]), user, keep, kid)
        if kept is None:
            FD.settle_void_soon(app_id, kid)
        if (kept is None or (kept[2] or {}).get("status") != 200) and not s.acting:
            # the paragraph is still this answer; the record's next evaluation asks the model again
            log.warning("staff performance: the new paragraph was not kept (%s)",
                        "no answer" if kept is None else (kept[2] or {}).get("status"))
    traffic()
    return said(answer)


# ---- a house's documents and Staff's audited reads (_location_meds, _staff_audited) ---------------------------------

def own_read(app_of: Callable[[str], str], label: str) -> Rung:
    """A read of the session's own workspace, answered by one Python app."""
    async def rung(env: dict[str, Any], raw: bytes, request: Any) -> Response:
        action = str(env.get("action") or "")
        if len(relay_form(env, raw)) > ENVELOPE_MAX:
            return said(UNREADABLE)
        s = await person(env)
        if s is None:
            return said(AUTH_REQUIRED)
        if away(env):
            return said(AWAY)
        got, why = await ask(app_of(action), action, user_of(s), payload_of(env))
        if got is None:
            if not s.acting:
                log.warning("%s: %s not answered by Python (%s) — said 503", label, action, why)
            return said(T["LOCATION_MEDS_UNREAD"])
        answer = got[2]
        answer.pop("_write", None)
        traffic()
        return said(answer)
    return rung


# ---- Settings' platform health and the master's overview (_settings_tools) ------------------------------------------

async def resolver_maps() -> dict[str, Any]:
    """_resolver_relay_maps, as this app routes now: each route's app and door, the lane the resolver manifest declares
    for each action, every app's switch (all Python) and the traffic as measured here."""
    import live_slices  # noqa: PLC0415
    import other_lanes  # noqa: PLC0415

    composed = frozenset(T["resolver"]["composed"])
    return {"reads": {a: p for a, p in FD.READS.items() if a not in composed},
            "writes": {a: p for a, p in FD.WRITES.items() if a not in composed},
            "tools": dict(T["resolver"]["tools"]),
            "slices": {r: list(pair) for r, pair in live_slices.SLICE_DOORS.items()},
            "lanes": {a: str(p.get("lane") or "") for a, p in LF.resolver_table().items() if isinstance(p, dict)},
            "switch": {r["id"]: "python" for r in other_lanes.BACKENDS},
            "traffic": live_slices.traffic_snapshot()}


async def settings_tool(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    door = str(env.get("action") or "")
    if len(relay_form(env, raw)) > ENVELOPE_MAX:
        return said(UNREADABLE)
    # away from home an action not declared safe there is the unknown action (Tenant.gs), as doPost answers it
    if env.get("tenant"):
        return said(UNKNOWN)
    if env.get("member") or env.get("world"):
        return said(T["SETTINGS_TOOLS_NOT_HERE"].get(door) or T["SETTINGS_TOOLS_AWAY"])
    payload = payload_of(env)
    s = await person(env)
    if s is None:
        return said(AUTH_REQUIRED)
    if door in T["RESOLVER_RELAYED"]:
        payload = {**payload, "relay": await resolver_maps()}
    app_id = str(T["SETTINGS_TOOLS_APP_OF"].get(door, T["SETTINGS_TOOLS_APP"]))
    got, why = await ask(app_id, door, user_of(s), payload, "", FD.people_at())
    if got is None:
        if not s.acting:
            log.warning("settings tools: %s not answered by Python (%s) — said 503", door, why)
        return said(T["SETTINGS_TOOLS_UNREAD"])
    answer = got[2]
    answer.pop("_write", None)
    traffic()
    return said(answer)


# ---- a Google Form's import and the hiring walk (_python_tool_door) -------------------------------------------------

async def python_tool(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    action = str(env.get("action") or "")
    form = relay_form(env, raw)
    if len(form) > ENVELOPE_MAX:
        return said(UNREADABLE, str)
    s = await person(env)
    if s is None:
        return said(AUTH_REQUIRED, str)
    if away(env):
        return said(AWAY, str)
    user = user_of(s)
    # what the relay alone hands Python is never taken from the browser
    payload = {k: v for k, v in payload_of(env).items() if k not in ("prepared", "walk")}
    app_id, prepare, field = T["PYTHON_TOOL_DOORS"][action]
    if action == "hiringWalkRun":
        traffic()
        return said(await hiring_walk(payload, user), str)
    if prepare and (not field or payload.get(field)):
        got, why = await ask(app_id, prepare, user, payload)
        if got is None:
            if not s.acting:
                log.warning("%s: its prepare not answered by Python (%s) — said 503", action, why)
            return said(TOOL_UNANSWERED, str)
        ready = got[2]
        if ready.get("status") != 200 or not isinstance(ready.get("data"), dict):
            return said({k: v for k, v in ready.items() if k in ("status", "message", "data")}, str)
        payload = {**{k: v for k, v in payload.items() if k != field}, "prepared": ready["data"]}
        if field:
            payload[field] = "kept"
    write_id = stamped(env, form[:4096])
    got, why = await ask(app_id, action, user, payload, write_id)
    if got is None:
        if not s.acting:
            log.warning("%s: not answered by Python (%s) — said 503", action, why)
        return said(TOOL_UNANSWERED, str)
    answer = got[2]
    answer.pop("_write", None)
    if answer.get("status") == 200:
        LF.final_landed(action, form, json.dumps(answer).encode())
    traffic()
    return said(answer, str)


def hiring_reads() -> frozenset[str]:
    import other_lanes  # noqa: PLC0415

    return frozenset(next((r["reads"] for r in other_lanes.BACKENDS if r["id"] == HIRING_APP), ()))


async def hiring_walk(opts: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """_hiring_walk: Python checks each step's answer and names the next press (hiringWalkNext), each press made here
    through its own door as the caller, the report raised to Smart Comms by hiringWalkRun; the walk's envelope."""
    walk: dict[str, Any] = {"budget_ms": int(float(T["HIRING_WALK_BUDGET_S"]) * 1000)}
    data: dict[str, Any] = {}
    for _ in range(int(T["HIRING_WALK_TURNS"])):
        got, why = await ask(HIRING_APP, "hiringWalkNext", user, {**opts, "walk": walk})
        if got is None:
            if not user.get("acting"):
                log.warning("hiring walk: not answered by Python (%s) — said 503", why)
            return dict(TOOL_UNANSWERED)
        env = got[2]
        data = env.get("data") if env.get("status") == 200 and isinstance(env.get("data"), dict) else {}
        if not isinstance(data.get("walk"), dict):
            return {k: v for k, v in env.items() if k in ("status", "message", "data")}
        walk = data["walk"]
        if not isinstance(data.get("press"), dict):
            break
        walk["last"] = await walk_press(data["press"], user)
    else:
        return dict(TOOL_UNANSWERED)
    out = data.get("out") if isinstance(data.get("out"), dict) else {}
    if data.get("report") is not True:
        return {"status": 200, "data": out}
    write_id = "W" + hashlib.sha256(f"hiringWalkRun|{time.time_ns()}".encode()).hexdigest()[:24]
    got, why = await ask(HIRING_APP, "hiringWalkRun", user, {**opts, "prepared": out}, write_id)
    told = dict(got[2]) if got is not None else {}
    told.pop("_write", None)
    if told.get("status") != 200:
        # the walk stands as it ran; its report did not leave
        if not user.get("acting"):
            log.warning("hiring walk: the report was not raised (%s)", str(told.get("message") or why)[:160])
        return {"status": 200, "data": {**out, "reported_to": ""}}
    return told


async def walk_press(press: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """_hiring_walk_press: one step pressed through its own Python door as the caller, its prepare read first; what
    the door answered ({status, message, data}), else why nothing answered (error), and how long it took (ms)."""
    action = str(press.get("action") or "")
    payload = press.get("payload") if isinstance(press.get("payload"), dict) else {}
    started = time.monotonic()

    def took(env: dict[str, Any]) -> dict[str, Any]:
        return {**env, "ms": int((time.monotonic() - started) * 1000)}

    read = action in hiring_reads()
    try:
        if read:
            got, why = await ask(HIRING_APP, action, user, payload)
        else:
            prepare = (LF.TABLES.get("write_prepare") or {}).get(action)
            if prepare is not None and (not prepare[1] or payload.get(prepare[1])):
                got, why = await ask(HIRING_APP, prepare[0], user, payload)
                ready = got[2] if got is not None else None
                if ready is None:
                    return took({"error": f"its preparation was not done ({why or 'unsaid'})"})
                if ready.get("status") != 200 or not isinstance(ready.get("data"), dict):
                    return took({k: ready.get(k) for k in ("status", "message", "data")})
                payload = {**{k: v for k, v in payload.items() if k != prepare[1]}, "prepared": ready["data"]}
            write_id = "W" + hashlib.sha256(f"walk|{action}|{time.time_ns()}".encode()).hexdigest()[:24]
            got, why = await ask(HIRING_APP, action, user, payload, write_id)
        if got is None:
            return took({"error": f"Python did not answer ({why or 'unsaid'})"})
        env = dict(got[2])
        env.pop("_write", None)
        if env.get("status") == 200 and not read:
            asked = urllib.parse.urlencode({"body": json.dumps({"action": action, "payload": press.get("payload")})})
            LF.final_landed(action, asked.encode(), json.dumps(env).encode())
        return took({k: env.get(k) for k in ("status", "message", "data")})
    except Exception as exc:  # noqa: BLE001 - said as this step's own failure
        return took({"error": type(exc).__name__})


# ---- an app's public doors (_public_door): the link's own token their gate, never a session -------------------------

async def final(app_id: str, action: str, raw: bytes, write_id: str, answer: dict[str, Any], key: str, as_of: float,
                held: frozenset[str] | None, edits_at: float, replay: bool) -> bytes:
    """_backend_final: a write Python kept in Postgres, taken back (409) when decided on an older copy, else every copy
    and pack it changes read again."""
    if not replay and LF.written_after(app_id, key, as_of, held, any_key=not key, edits_at=edits_at):
        if await run_in_threadpool(LF.settle_void, app_id, write_id):
            log.info("backend: %s taken back — a write landed after Python's copy was read", action)
            return json.dumps(LF.TAKEN_BACK).encode()
        log.warning("backend: %s stands in Postgres although a write landed after its copy (not taken back)", action)
    content = json.dumps(answer)
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    if not replay and (answer.get("status") == 200 or data.get("written")):
        LF.final_landed(action, raw, json.dumps({**answer, "status": 200}).encode())
        if action in set(LF.TABLES.get("app_control_writes") or ()):
            LF.app_control_landed(action, raw, content.encode())
    traffic()
    log.info("backend: %s kept by Python in Postgres (%s)%s", action, answer.get("status"),
             " — replayed" if replay else "")
    return content.encode()


async def forms_claim(files: list[Any]) -> None:
    """A kept answer's files lose their pending__ names, off the answer's path; the rows are the record."""
    got, why = await ask(str(T["FORMS_APP"]), str(T["FORMS_PUBLIC_CLAIM"]), {"is_service": True}, {"files": files})
    env = got[2] if got is not None else None
    if env is None or env.get("status") != 200:
        log.info("forms public: an answer's files keep their pending names (%s)",
                 why if env is None else env.get("status"))


def forms_after(after: Any, content: bytes) -> None:
    files = after.get("files") if isinstance(after, dict) else None
    if isinstance(files, list) and files and json.loads(content).get("status") == 200:
        LF.keep_task(forms_claim(files))


AFTER: dict[str, Callable[[Any, bytes], None]] = {"_forms_public_after": forms_after}


async def public(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """An app's public door answered by Python as nobody, at that app's own door alone, or its 503 in the door's
    words."""
    action = str(env.get("action") or "")
    app_id = PUBLIC_APPS[action]
    spec = T["PUBLIC_DOORS_BY_APP"][app_id]
    caller = dict(T["PUBLIC_CALLER"])

    def unanswered(why: str) -> Response:
        log.info("%s: %s said 503 (%s)", spec["label"], action, why)
        return said(T["PUBLIC_UNREAD"] if action in spec["reads"] else T["PUBLIC_UNSAVED"])

    form = relay_form(env, raw)
    # a file over the envelope's 100 KB is read whole, as doPost reads it
    if len(form) > (WHOLE_MAX if action in spec["whole"] else ENVELOPE_MAX):
        return unanswered("an unreadable envelope")
    payload = payload_of(env)
    if action in spec["reads"]:
        got, why = await ask(app_id, action, caller, payload)
        if got is None:
            return unanswered(why or "Python did not answer")
        _content, as_of, answer, held, edits_at = got
        if LF.written_after(app_id, "", as_of, held, edits_at=edits_at):
            return unanswered("a write of the app landed after Python's copy was read")
        answer.pop("_write", None)
        traffic()
        return said(answer)
    body = payload
    prepare = spec["prepare"].get(action)
    if prepare:
        # the heavy half first (a file filed, an answer's files read, a model asked), never inside the write's budget
        got, why = await ask(app_id, prepare, caller, payload)
        if got is None:
            return unanswered(why or "its preparation was not answered")
        _content, as_of, prepared, held, edits_at = got
        if prepared.get("status") != 200 or not isinstance(prepared.get("data"), dict):
            if LF.written_after(app_id, "", as_of, held, edits_at=edits_at):
                return unanswered("a write of the app landed after Python's copy was read")
            # the door's own refusal: a throttle, a link that is not valid, a closed form, a file it will not take
            traffic()
            return said({k: v for k, v in prepared.items() if k in ("status", "message", "data")})
        body = {**{k: v for k, v in payload.items() if k != spec["bytes"]}, "prepared": prepared["data"]}
        if action in spec["kept"]:
            body[spec["bytes"]] = "kept"
    write_id = stamped(env, form)
    got, why = await ask(app_id, action, caller, body, write_id)
    if got is None:
        # whatever Python may have kept under this id is taken back, or the answer could be filed twice
        await run_in_threadpool(LF.settle_void, app_id, write_id)
        return unanswered(why or "Python did not answer")
    _content, as_of, answer, held, edits_at = got
    plan = answer.pop("_write", None)
    after = answer.pop("_after", None)
    replay = isinstance(plan, dict) and bool(plan.get("replay"))
    stale = not replay and LF.written_after(app_id, "", as_of, held, any_key=True, edits_at=edits_at)
    if not isinstance(plan, dict) or not plan.get("final"):
        if stale or isinstance(plan, dict):
            # decided on a copy older than a write of the app seen land, or a plan these doors never make
            await run_in_threadpool(LF.settle_void, app_id, write_id)
            return unanswered("decided on an older copy" if stale else "a plan these doors never make")
        # a refusal, or a file found filed before: the door's own words, nothing kept
        traffic()
        return said(answer)
    if stale and await run_in_threadpool(LF.settle_void, app_id, write_id):
        # taken back: asked again, it is decided on the copy that holds the newer write
        return unanswered("decided on an older copy")
    key = LF.backend_key(app_id, {"house": plan.get("house")})
    content = await final(app_id, action, form, write_id, answer, key, as_of, held, edits_at, replay)
    then = AFTER.get(str(spec.get("after") or ""))
    if then is not None:
        then(after, content)
    return answered(content)


# ---- the writes gas_relay tests before Python's own door decides them -----------------------------------------------

async def write_here(env: dict[str, Any], form: bytes) -> Response:
    """Python's own final door, as the front door decides one (front_door.write)."""
    action = str(env.get("action") or "")
    token = str(env.get("token") or "")
    s = await FD.session(token) if token else None
    return await FD.write(action, FD.WRITES[action], env, form, s)


def editions_in_config_save(env: dict[str, Any], form: bytes) -> bool:
    """_editions_in_config_save: a config save that names the editions list."""
    payload = env.get("payload") if len(form) <= ENVELOPE_MAX else None
    values = payload.get("values") if isinstance(payload, dict) else None
    return isinstance(values, dict) and EDITIONS_KEY in values


async def alerts_config_save(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """hiringAlertsSet: the editions list is Settings › Editions' alone, every other value Python's final write."""
    form = relay_form(env, raw)
    if editions_in_config_save(env, form):
        return said(T["EDITIONS_CONFIG_REFUSED"])
    return await write_here(env, form)


def files_a_paper(env: dict[str, Any], form: bytes) -> bool:
    """_candidate_paper_env: a press that files a paper (Add document, Upload, or any press carrying a file)."""
    if len(form) > WHOLE_MAX or env.get("action") != CANDIDATE_DOOR:
        return False
    p = payload_of(env)
    f = p.get("fields") if isinstance(p.get("fields"), dict) else {}
    return str(p.get("press") or "") in ("document", "upload") or (isinstance(f.get("base64"), str) and bool(f["base64"]))


async def candidate_record(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """candidateProfileDoor: Python's final write; a press that files a paper is read, filed and scored on
    asa-hub-worker (app/candidate_papers_door.py)."""
    form = relay_form(env, raw)
    if files_a_paper(env, form):
        import candidate_papers_door  # noqa: PLC0415 - it builds on this module

        return await candidate_papers_door.file_paper(env, form)
    return await write_here(env, form)


# ---- IST Records' doors that are handed the roster and the declaration ----------------------------------------------

def ist_roster_read() -> list[dict[str, str]]:
    """Blocking, read-only: each house and person on the house calendars with their first and last shift — the
    published cells laid in, the IST lane's look-back applied (istStaffByHouse_)."""
    import ist_config  # noqa: PLC0415
    import shift_slices  # noqa: PLC0415

    days = ist_config.int_of(ist_config.current(), "ist_roster_lookback_days")
    today = date.today()
    lo, hi = (today - timedelta(days=days) if days > 0 else date(2000, 1, 1)), today + timedelta(days=3650)
    spans: dict[tuple[str, str], list[str]] = {}
    for r in shift_slices.roster(lo, hi):
        house, staff = str(r.get("house") or "").strip(), str(r.get("staff_name") or "").strip()
        day = str(r.get("shift_date") or "")[:10]
        if not house or not staff or not day:
            continue
        at = spans.get((house, staff))
        if at is None:
            spans[(house, staff)] = [day, day]
        else:
            at[0], at[1] = min(at[0], day), max(at[1], day)
    return [{"house": h, "staff": s, "first": f, "last": t} for (h, s), (f, t) in spans.items()]


async def ist_roster() -> list[dict[str, str]] | None:
    """The roster for an IST door, held IST_ROSTER_HOLD_S; None when it could not be read (the door then says so)."""
    if _IST_ROSTER["rows"] is not None and time.time() - _IST_ROSTER["at"] < float(T["IST_ROSTER_HOLD_S"]):
        return _IST_ROSTER["rows"]
    try:
        rows = await run_in_threadpool(ist_roster_read)
    except Exception as exc:  # noqa: BLE001 - said by the door
        log.warning("ist: the roster was not read (%s)", type(exc).__name__)
        return None
    _IST_ROSTER.update(at=time.time(), rows=rows)
    return rows


async def ist_handed(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    if action in T["IST_ROSTER_ACTIONS"]:
        payload = {**payload, "roster": await ist_roster()}
    if action in T["IST_DECLARATION_ACTIONS"]:
        import ist_config  # noqa: PLC0415

        payload = {**payload, "declaration": ist_config.DECLARATION}
    return payload


async def ist(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """istConfigGet, istHouseState, istConfigSet and istRebuild: the front door's read or write, the payload handed
    what the relay handed it."""
    action = str(env.get("action") or "")
    form = relay_form(env, raw)
    token = str(env.get("token") or "")
    s = await FD.session(token) if token else None
    if action in FD.READS:
        if s is None:
            if not FD._quiet(action):  # noqa: SLF001
                log.info("front door: %s not read — %s", action,
                         "no session" if not token else "the session could not be read")
            return said(FD.AUTH_ENDED if not token else FD.UNREAD)
        if not s.ok:
            return said(FD.AUTH_ENDED)
        return await FD.read(action, FD.READS[action], {**env, "payload": await ist_handed(action, payload_of(env))},
                             form, s)
    payload = env.get("payload")
    write_id = str(env.get("write_id") or "")
    if isinstance(payload, dict) and token and s is not None and s.ok and (not write_id
                                                                          or FD.WRITE_ID.fullmatch(write_id)):
        if not write_id:
            # stamped first, as the relay stamps it: the envelope the finish reads carries no roster
            env = {**env, "write_id": "W" + hashlib.sha256(form + str(time.time_ns()).encode()).hexdigest()[:24]}
            form = FD.form_raw(env)
        env = {**env, "payload": await ist_handed(action, payload)}
    return await FD.write(action, FD.WRITES[action], env, form, s)


# ---- the table -------------------------------------------------------------------------------------------------------

def rungs() -> dict[str, Rung]:
    out: dict[str, Rung] = {}
    out.update({a: editions for a in T["EDITIONS_PYTHON_ACTIONS"]})
    out.update({a: performance for a in list(T["PERFORMANCE_READS"]) + list(T["PERFORMANCE_WRITES"])})
    out["locationDocsWhere"] = own_read(lambda a: str(T["LOCATION_MEDS_APP_OF"].get(a, T["HOUSE_MEDS_APP"])),
                                        "house meds")
    out.update({a: own_read(lambda _a: STAFF_APP, "staff") for a in T["STAFF_AUDITED_ACTIONS"]})
    out.update({a: settings_tool for a in ("rpcAbilities", "resolverAudit", "resolverHealth", "masterOverview")})
    out.update({a: python_tool for a in ("formImportGoogle", "hiringWalkRun")})
    out.update({a: public for a in PUBLIC_APPS})
    out[ALERTS_CONFIG_SAVE] = alerts_config_save
    out[CANDIDATE_DOOR] = candidate_record
    out.update({a: ist for a in list(T["IST_ROSTER_ACTIONS"]) + list(T["IST_DECLARATION_ACTIONS"])})
    return out


def _observing(rung: Rung) -> Rung:
    async def answer(env: dict[str, Any], raw: bytes, request: Any) -> Response:
        return observed(env, raw, await rung(env, raw, request))
    return answer


# the rungs whose answer the front door's own read, write or carry already finishes
FINISHED = frozenset({ALERTS_CONFIG_SAVE, CANDIDATE_DOOR}) | frozenset(T["IST_ROSTER_ACTIONS"]) | frozenset(
    T["IST_DECLARATION_ACTIONS"])


def install() -> None:
    """Every rung on the front door, ahead of the relay's /gas."""
    table = rungs()
    for action, rung in table.items():
        FD.RUNGS[action] = rung if action in FINISHED else _observing(rung)
    log.info("gas rungs: %d answered here (%s)", len(table), ", ".join(sorted(table)))
