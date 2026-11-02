"""People's photos and house photos (app/person_photos.py, app/house_images.py): their five doors on this app, on its
own gates. The session is the front door's verdict (front_door.session) and the master is that verdict's; App
Control's access and release are lane_gate's; the houses a session sees are Locations' own locationScope, and the
houses list is the registry (locations Reads.homes); a person's photo is planned by photoPlan and named by the
record's own <app>Photo write, both asked in-process (front_door.call_app), final in app.photos."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import urllib.parse
from typing import Any

from starlette.concurrency import run_in_threadpool

import front_door as FD
import house_images
import lane_gate as LG
import live_finish as LF
import locations as L
import person_photos
import scope as sc

log = logging.getLogger("asa-hub-app.photos")

PHOTOS_APP = "photos"
PLAN = "photoPlan"
SCOPE = "locationScope"
HOUSE_SAVE = "locationHouseSave"
SIGN_IN = {"status": 401, "message": "Authentication required."}
UNKEPT = {"status": 503, "message": "The photo could not be saved just now — try again in a minute. Nothing was changed."}
HOLD_S = 300.0
HELD_MAX = 5000
_house_scopes: dict[str, tuple[float, frozenset[str] | None]] = {}
_person_seen: dict[tuple[str, str], tuple[float, bool]] = {}


def token_of(authorization: str) -> str:
    authorization = str(authorization or "")
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


async def live(authorization: str) -> tuple[str, FD.Session] | None:
    """(token, the session's verdict) for a live session; None for none, one ended or one that cannot be read."""
    token = token_of(authorization)
    s = await LG.session(token) if token else None
    return (token, s) if s is not None and LG.actor(s) is not None else None


async def python(app_id: str, action: str, user: dict[str, Any], payload: dict[str, Any], write_id: str = "",
                 at: float = 0.0) -> dict[str, Any] | None:
    """Python's own door in-process: its envelope, or None when it deferred or did not answer."""
    try:
        got = await FD.call_app(app_id, action, user, payload, write_id, at)
    except Exception as exc:  # noqa: BLE001 - said by the caller, as a door that did not answer
        log.warning("photos: %s not answered by Python (%s)", action, type(exc).__name__)
        return None
    return dict(got[2]) if got is not None else None


def _forget(_uids: Any = None) -> None:
    _house_scopes.clear()
    _person_seen.clear()


# ---- the house photo -------------------------------------------------------------------------------------------------

async def house_writer(authorization: str) -> dict[str, Any] | None:
    """FAIL-CLOSED: the master, or a person the house edition names who reads every house uncut."""
    got = await live(authorization)
    if got is None:
        return None
    s = got[1]
    if LG.is_master(s):
        return {"uid": s.uid, "master": True}
    if s.role.strip().lower() not in sc.EDITION_ROLES or not s.uid:
        return None

    def holds(sess: L.Session) -> bool:
        return sc.edition_allows(L.EDITION["house"], sess.user or {}, sess.reads.config())

    try:
        allowed = await run_in_threadpool(LG.in_session, s, holds, HOUSE_SAVE)
        if allowed is not True or not await LG.released(s, L.APP_ID):
            return None
    except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
        log.warning("house images: the house edition was not checked (%s)", type(exc).__name__)
        return None
    return {"uid": s.uid, "master": False}


async def house_scope(token: str, s: FD.Session) -> frozenset[str] | None:
    """The houses the session's own locationScope names; None for every house. Unanswered raises, asked again next
    time."""
    held = _house_scopes.get(token)
    if held is not None and time.time() - held[0] < HOLD_S:
        return held[1]
    env = await python(L.APP_ID, SCOPE, LG.user_of(s, SCOPE), {}, at=FD.people_at())
    if env is None:
        raise RuntimeError(f"{SCOPE}: Python did not answer")
    status = env.get("status")
    data = env.get("data") if status == 200 and isinstance(env.get("data"), dict) else None
    if data is None and status != 404:
        raise RuntimeError(f"{SCOPE} answered {status}")
    houses = (data or {}).get("houses")
    if data is not None and houses is None and str(data.get("kind") or "") in ("master", "all"):
        seen: frozenset[str] | None = None
    else:
        seen = frozenset(str((h or {}).get("code") or "").strip().upper()
                         for h in (houses if isinstance(houses, list) else []) if isinstance(h, dict))
    if len(_house_scopes) > HELD_MAX:
        _house_scopes.clear()
    _house_scopes[token] = (time.time(), seen)
    return seen


async def house_reader(authorization: str, code: str) -> bool | None:
    """FAIL-CLOSED: the session sees the house — the master, Locations released uncut, else its own scope; None:
    unsure."""
    got = await live(authorization)
    if got is None:
        return False
    token, s = got
    try:
        if LG.is_master(s) or await LG.released(s, L.APP_ID):
            return True
        houses = await house_scope(token, s)
    except Exception as exc:  # noqa: BLE001 - unanswered is not a refusal: asked again next time
        log.warning("house images: who sees %s was not checked (%s)", code, type(exc).__name__)
        return None
    return houses is None or code in houses


async def house_known(code: str) -> bool | None:
    """The house is on the registry: a code that names no house gets no folder; None when the registry was not read."""
    try:
        return await run_in_threadpool(LG.in_reads, lambda reads: any(h.get("code") == code for h in reads.homes()))
    except Exception as exc:  # noqa: BLE001 - an unread list is not a house that is not on it
        log.warning("house images: the houses list was not read (%s)", type(exc).__name__)
        return None


# ---- people's photos -------------------------------------------------------------------------------------------------

async def person_plan(authorization: str, app_id: str, key: str) -> Any:
    """(photoPlan's plan, the user) when this session may replace the record's photo; else the refusal to say."""
    got = await live(authorization)
    if got is None:
        return dict(SIGN_IN)
    user = LG.user_of(got[1], PLAN)
    env = await python(PHOTOS_APP, PLAN, user, {"app": app_id, "key": key})
    if env is None:
        log.warning("people's photos: the plan not answered by Python — nothing kept")
        return dict(UNKEPT)
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        return env
    return env["data"], user


async def person_keep(authorization: str, user: dict[str, Any], plan: dict[str, Any],
                      kept: dict[str, Any]) -> dict[str, Any]:
    """The kept picture named as the record's photo by its app's own write; then that app's pack and roster rung."""
    action, field, app_id = str(plan["action"]), str(plan["field"]), str(plan["app"])
    write_id = "W" + hashlib.sha256(f"{kept['path']}|{time.time_ns()}".encode()).hexdigest()[:24]
    body = {field: plan["key"], "path": kept["path"], "bytes": kept["bytes"]}
    who = {**user, "asked": action}
    answer = None
    for _attempt in (1, 2):
        answer = await python(app_id, action, who, body, write_id)
        # the platform's write lock held a moment: asked once more under the same id
        if not (answer and answer.get("status") == 409 and "in progress" in str(answer.get("message") or "")):
            break
        await asyncio.sleep(1.0)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            FD.settle_void_soon(app_id, write_id)
        log.warning("people's photos: %s was kept but not named (%s) — it stays on disk, unshown", kept["path"],
                    "Python did not answer" if answer is None else answer.get("status"))
        return dict(UNKEPT) if answer is None or int(answer.get("status") or 500) >= 500 else answer
    answer.pop("_write", None)
    rung = urllib.parse.urlencode({"body": json.dumps({"token": token_of(authorization), "action": action,
                                                       "payload": {field: plan["key"]}})}).encode()
    LF.final_landed(action, rung, json.dumps({**answer, "status": 200}).encode())
    if LF.SLICES is not None:
        LF.SLICES.traffic_note("backend_python")
    log.info("people's photos: %s named for %s %s by Python", kept["name"], app_id, plan["key"])
    return answer


async def person_reader(authorization: str, folder: str) -> bool | None:
    """FAIL-CLOSED: the master, or a session one of the apps that show these people is open to; None: unsure."""
    got = await live(authorization)
    if got is None:
        return False
    token, s = got
    held = _person_seen.get((token, folder))
    if held is not None and time.time() - held[0] < HOLD_S:
        return held[1]
    seen = LG.is_master(s)
    for hub_app in () if seen else person_photos.APPS[folder]["seen_in"]:
        verdict = await LG.gate(s, hub_app)
        if not isinstance(verdict, dict):
            seen = True
            break
        if verdict.get("reason") == "unreadable":
            return None
    if len(_person_seen) > HELD_MAX:
        _person_seen.clear()
    _person_seen[(token, folder)] = (time.time(), seen)
    return seen


async def person_master(authorization: str) -> bool:
    got = await live(authorization)
    return got is not None and LG.is_master(got[1])


def install(app: Any) -> list[str]:
    """The five doors on main.py's app, matched before the relay carrier."""
    house_images.mount(app, reader=house_reader, writer=house_writer, known=house_known, log=log)
    person_photos.mount(app, plan=person_plan, keep=person_keep, reader=person_reader, master=person_master, log=log)
    FD.SESSIONS_FORGOTTEN.append(_forget)
    taken = ["locations/image/{code}", "locations/image/{code}/{name}", "photos/where", "photos/{folder}/{key}",
             "photos/{folder}/{key}/{name}"]
    why = house_images.problem()
    log.info("photo doors: answered here: %s — images at %s%s", ", ".join(taken), house_images.ROOT,
             f" ({why})" if why else "")
    return taken
