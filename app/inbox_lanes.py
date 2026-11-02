"""The bell and My Inbox, answered here as the relay answered them (server/snapshot_service.py lane_notices,
lane_notices_read, lane_my_inbox, lane_my_inbox_read): GET /hub-lanes/notices, POST /hub-lanes/notices/read,
GET /hub-lanes/my-inbox and POST /hub-lanes/my-inbox/read, with the same statuses, envelopes and words.

- The bell is web_notices (the relay's module, on its own tables in asa-hub-db) cut by the Requests lanes' reader
  (sched_lanes._requests_viewer); test mode holds it, and the alerts a person turned off for themselves are obeyed.
- My Inbox is Python's door (myInboxView, myInboxRead) asked in-process with what the relay used to hand it: test
  mode, the punch board, the relay's own read marks and first sightings, and the bell's notices for the subject. A
  client-role session gets its family view (inbox_family), as the relay built it.
- The session is the front door's verdict; a session minted from the master's own is refused every write here, as
  the relay's write guard refused it, and its inbox is read-only.
- A mark that landed rings `my-inbox` to the open browsers, as the relay's lane keep rang it."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import lane_gate as LG
import live_notify

log = logging.getLogger("asa-hub-app.inbox")

APP_ID = "my-inbox"
EVENT = "my-inbox"
MODE_MASS, MODE_OWN = "mass", "own"
ROLES_REFUSED = ("onboarding", "interviewer")
VISIT = "My Inbox reads the signed-in account's own alerts; it is not drawn inside a visit."
OWN_ONLY = "My Inbox shows only your own alerts."
MASS_WHY = "Signed in as the master account: your own alerts, or any person's you choose, read-only."
DOWN = {"status": 503, "reason": "unreadable", "message": "My Inbox is not available on this server right now."}
UNSIGNED = {"status": 503, "reason": "unavailable",
            "message": "My Inbox could not open: the sign-in check could not be made (the backend could not answer). "
                       "Try again."}
SWITCHED = {"status": 409, "code": "be_another_refused", "reason": "acting",
            "message": "Not in a switched session: read marks are not kept. Press Be Back to do this as yourself."}
UNCHECKED = {"status": 503, "reason": "unavailable",
             "message": "Whether you may open another person's alerts could not be checked just now. Try again."}
UNMARKED = {"status": 503, "reason": "unavailable",
            "message": "This change could not be saved just now, and nothing was written. Try again in a moment."}
KEYS = ("subject", "heads", "items", "unread", "capped", "marks", "read_at", "scope")
EDITIONS = frozenset({"myInbox.anyone"})
EDITION_REFUSALS = (400, 403, 404)
READ_MAX = 500
# under the proxy's 30-second read timeout, counted from the request's arrival
BUDGET_S = 24.0
FAMILY_FRESH_S = 300.0
FAMILY_CEILING_S = 1800.0
FAMILY_HELD_MAX = 500
FAMILY_REFUSED = (400, 401, 403, 404)
FAMILY_SLOW = "the backend is still reading this account's alerts; they are listed on the next read"
# the alerts each account turned off (configLane alert_receive_off), held as the relay held its lane
OFF_TTL_S = 10.0

_FAMILY_HELD: dict[str, tuple[float, dict[str, Any]]] = {}
_FAMILY_ASKING: dict[str, asyncio.Task] = {}
_OFF: dict[str, Any] = {"at": 0.0, "map": None}


def _SL() -> Any:
    import sched_lanes  # noqa: PLC0415 - the scheduling lanes' threads, reader and switch
    return sched_lanes


def _held_words(switch: dict[str, Any]) -> str:
    return ("test mode" + ("" if switch.get("readable") else " (unreadable, so treated as on)")
            if switch["on"] else "")


def _iso(v: Any) -> Any:
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _jsonable(v: Any) -> Any:
    """As FastAPI renders a returned dict: a stamp as ISO text."""
    return json.loads(json.dumps(v, default=_iso))


def alerts_off(uid: str) -> list[str]:
    """Blocking, FAIL-OPEN: _lane_alerts_off, the alerts this account turned off for itself in Settings > Alerts I
    receive."""
    uid = str(uid or "").strip()
    if not uid:
        return []
    held = _OFF
    if held["map"] is None or time.time() - float(held["at"]) >= OFF_TTL_S:
        try:
            import config_lane  # noqa: PLC0415
            got = LG.in_reads(config_lane.alert_receive_off)
            held.update(at=time.time(), map=got if isinstance(got, dict) else {})
        except Exception as exc:  # noqa: BLE001 - nobody is cut
            log.info("notices: the alerts turned off could not be read (%s)", type(exc).__name__)
            return []
    raw = (held["map"] or {}).get(uid)
    if not isinstance(raw, list):
        return []
    return sorted({str(x).strip() for x in raw if str(x or "").strip()})


async def _switch() -> dict[str, Any]:
    SL = _SL()
    return await SL._run(SL._test_switch)  # noqa: SLF001


async def _ringing(env: dict[str, Any]) -> Response:
    if env.get("status") == 200:
        live_notify.dirty([EVENT])
    return LG.answer(env)


async def _seen(request: Request) -> None:
    """The bell's reader noted for the notices' pushes (notice_clock.seen), as the relay noted it; never a switched
    session."""
    s = await LG.session(LG.token_of(request))
    if s is not None and s.ok and not s.acting:
        import notice_clock  # noqa: PLC0415
        notice_clock.seen(s.uid, s.role, bool(s.is_master))


async def _write_refused(request: Request) -> Response | None:
    import service_doors as SD  # noqa: PLC0415 - the relay's write guard, ported once
    return await SD.write_refusal(request)


# ---- the bell ------------------------------------------------------------------------------------------------------

async def notices(request: Request, since: int = 0, limit: int = 60) -> Response:
    """{notices, unread, seq}; `since` returns only newer ids."""
    return LG.answer(await _notices(request, since, limit))


async def _notices(request: Request, since: int, limit: int) -> dict[str, Any]:
    import web_notices as WN  # noqa: PLC0415

    SL = _SL()
    got = await SL._requests_viewer(request)  # noqa: SLF001
    if isinstance(got, dict):
        return got
    who, actor = got
    await _seen(request)
    # test mode holds the bell too
    held = _held_words(await _switch())

    def read() -> dict[str, Any]:
        return WN.inbox(SL.PG_DSN, who={**who, "alerts_off": alerts_off(actor[1])}, uid=actor[1], since=since,
                        limit=limit, held=held)

    try:
        data = await SL._run(read)  # noqa: SLF001
    except Exception as exc:  # noqa: BLE001
        log.warning("notices: the inbox could not be read (%s)", type(exc).__name__)
        return {"status": 502, "message": f"notices unreadable ({type(exc).__name__})"}
    return {"status": 200, "data": _jsonable(data)}


async def notices_read(request: Request) -> Response:
    """Mark this account's notices read, or dismissed."""
    refused = await _write_refused(request)
    if refused is not None:
        return refused
    return await _ringing(await _notices_read(request))


async def _notices_read(request: Request) -> dict[str, Any]:
    import web_notices as WN  # noqa: PLC0415

    SL = _SL()
    actor = LG.actor(await LG.session(LG.token_of(request)))
    if not actor:
        return {"status": 401, "message": "sign in first"}
    if not actor[1]:
        return {"status": 403, "message": "this session carries no account to keep the reads for"}
    await _seen(request)
    body = await LG.body_json(request)
    if body is LG.INVALID:
        return {"status": 400, "message": "invalid body"}
    ids = body.get("ids") if isinstance(body, dict) else None
    if not isinstance(ids, list) or not ids:
        return {"status": 400, "message": "ids is required"}
    try:
        marked = await SL._run(WN.mark_read, SL.PG_DSN, uid=actor[1], ids=ids,  # noqa: SLF001
                               dismiss=bool(body.get("dismiss")))
    except Exception as exc:  # noqa: BLE001
        log.warning("notices: the reads could not be written (%s)", type(exc).__name__)
        return {"status": 502, "message": f"not marked ({type(exc).__name__})"}
    return {"status": 200, "data": {"marked": marked}}


# ---- My Inbox: the gate ----------------------------------------------------------------------------------------------

def _family(actor: tuple[str, str]) -> bool:
    """A client-role session: its family view instead of the staff sources."""
    return str(actor[0] or "").strip().lower() == "client"


def _shown(env: dict[str, Any]) -> dict[str, Any]:
    return {k: env[k] for k in ("status", "reason", "message") if k in env}


async def _gate(request: Request) -> tuple[Any, dict[str, str], tuple[str, str]] | dict[str, Any]:
    """(session, scope, actor) for a session My Inbox serves, or the refusal: a visit before anything, then the
    session and App Control's gate; `mass` only for the master's own session."""
    if LG.query(request, "member").strip():
        return {"status": 403, "reason": "visit", "message": VISIT}
    token = LG.token_of(request)
    s = await LG.session(token)
    if token and s is None:
        return dict(UNSIGNED)
    who = await LG.gate(s, APP_ID, refuse_roles=ROLES_REFUSED, app_label="My Inbox")
    if isinstance(who, dict):
        return LG.refusal(who)
    mass = LG.is_master(s)
    return s, {"mode": MODE_MASS if mass else MODE_OWN, "why": MASS_WHY if mass else ""}, who


def _display(mode: str) -> dict[str, Any]:
    """Blocking: Settings > My Work as this session is shown it (my_work.display_for)."""
    import my_work as MW  # noqa: PLC0415
    try:
        return LG.in_reads(lambda reads: MW.display_for(mode, MW.hide_from_lane(MW.hide_lane(reads))))
    except Exception as exc:  # noqa: BLE001 - said on the display, nothing hidden by a guess
        log.info("my inbox: the display settings could not be read (%s)", type(exc).__name__)
        return MW.display_for(mode, MW.hide_from_lane(None))


# ---- My Inbox: what the relay handed Python --------------------------------------------------------------------------

def _punch_board() -> dict[str, Any]:
    """The punch board the attendance lane wrote: {punch_board} or {punch_board_error} ("missing")."""
    import punch_board_slices as PB  # noqa: PLC0415
    try:
        return {"punch_board": json.loads(PB.BOARD_FILE.read_text(encoding="utf-8") or "null")}
    except FileNotFoundError:
        return {"punch_board_error": "missing"}
    except Exception as exc:  # noqa: BLE001 - said on the punch head, as the builder says it
        return {"punch_board_error": type(exc).__name__}


def _accounts() -> list[dict[str, str]]:
    import my_inbox as MI  # noqa: PLC0415
    import my_work as MW  # noqa: PLC0415
    return LG.in_reads(lambda reads: MI.accounts(MW.HubBooks(reads)))


async def _handed(s: Any, actor: tuple[str, str], person: str) -> dict[str, Any] | None:
    """The subject's read marks and every first sighting, test mode, the punch board and the bell's notices for the
    subject (none while test mode holds them); None when the subject cannot be read."""
    import inbox_family as IF  # noqa: PLC0415
    import shift_requests  # noqa: PLC0415
    import web_notices as WN  # noqa: PLC0415

    SL = _SL()
    known = True
    if person:
        try:
            accounts = await run_in_threadpool(_accounts)
        except Exception as exc:  # noqa: BLE001 - a chosen person is Python's to refuse
            log.info("my inbox: the accounts were not read (%s)", type(exc).__name__)
            return None
        acc = next((a for a in accounts if a.get("uid") == person), None)
        known = acc is not None
        subject = {"uid": person, "role": (acc or {}).get("role") or "", "types": (acc or {}).get("types") or "",
                   "is_master": False}
    else:
        subject = {"uid": str(actor[1] or ""), "role": str(actor[0] or ""), "types": None,
                   "is_master": s.is_master is True}
    switch = await _switch()
    out: dict[str, Any] = {"test_mode": switch, **await run_in_threadpool(_punch_board)}
    try:
        out["inbox_marks"] = await SL._run(IF.handed_marks, SL.PG_DSN, subject["uid"])  # noqa: SLF001
        if switch.get("on") or not known:
            return out
        name = await SL._run(SL._roster_name_of, subject["uid"], strict=True)  # noqa: SLF001
        if subject["types"] is None:
            subject["types"] = await SL._run(SL._user_badges, subject["uid"])  # noqa: SLF001
        who = await SL._run(shift_requests.viewer, SL.PG_DSN, name=name, role=subject["role"],  # noqa: SLF001
                            types=subject["types"], is_master=subject["is_master"])
    except Exception as exc:  # noqa: BLE001 - nothing is drawn for a subject that could not be read
        log.info("my inbox: the subject's state could not be read (%s)", type(exc).__name__)
        return None

    def bell() -> dict[str, Any]:
        return WN.inbox(SL.PG_DSN, who={**who, "alerts_off": alerts_off(subject["uid"])}, uid=subject["uid"],
                        limit=200, held="")

    try:
        out["notices"] = json.loads(json.dumps(await SL._run(bell), default=str))  # noqa: SLF001
    except Exception as exc:  # noqa: BLE001 - said on the notices head
        out["notices_error"] = type(exc).__name__
    return out


async def _python(s: Any, actor: tuple[str, str], scope: dict[str, str], person: str) -> dict[str, Any] | None:
    """Python's envelope for the scope and subject decided here; None when it gave none this door serves."""
    import my_inbox as MI  # noqa: PLC0415

    mass = scope["mode"] == MODE_MASS
    # a person outside the master's scope: the edition Python alone holds decides
    edition = bool(person) and not mass
    handed = await _handed(s, actor, person)
    if handed is None:
        return None
    payload: dict[str, Any] = {"mode": scope["mode"], "why": scope["why"], "person": person, **handed}
    env = await LG.python(APP_ID, "myInboxView", LG.user_of(s, "myInboxView", is_master=mass), payload)
    if env is None:
        return None
    if env.get("status") != 200:
        if edition and env.get("status") not in EDITION_REFUSALS:
            return None
        return _shown(env)
    data = env.get("data")
    said = data.get("scope") if isinstance(data, dict) else None
    said = said if isinstance(said, dict) else {}
    # an edition's holder is answered as Python widened the scope: any person, said under the edition
    widened = (not mass and said.get("mode") == MODE_MASS and str(said.get("edition") or "") in EDITIONS)
    readonly = bool(person) or bool(s.acting)
    if (not said or any(k not in data for k in KEYS)
            or (said.get("mode") != scope["mode"] and not widened)
            or said.get("person") != person or said.get("readonly") is not readonly
            or (edition and not widened)):
        log.warning("my inbox: Python's answer did not keep the scope or shape decided here — not served")
        return None
    if not isinstance(data.get("display"), dict):
        MI.apply_display(data, await run_in_threadpool(_display, scope["mode"]))
    return {"status": 200, "data": data}


# ---- My Inbox: a client-role account ---------------------------------------------------------------------------------

async def _family_fill(s: Any, uid: str) -> dict[str, Any]:
    """The family view's inbox answer for this account: held on a 200, and a refusal lets the held one go."""
    import my_lanes as ML  # noqa: PLC0415
    env = await ML.family(s, "inbox")
    status = env.get("status")
    if status == 200:
        _FAMILY_HELD.pop(uid, None)
        _FAMILY_HELD[uid] = (time.time(), env["data"])
        while len(_FAMILY_HELD) > FAMILY_HELD_MAX:
            _FAMILY_HELD.pop(next(iter(_FAMILY_HELD)))
    elif status in FAMILY_REFUSED:
        _FAMILY_HELD.pop(uid, None)
    return env


async def _family_read(s: Any, uid: str, arrived: float
                       ) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str]:
    """(the family view's answer, its refusal, why neither came)."""
    held = _FAMILY_HELD.get(uid)
    age = time.time() - held[0] if held else 0.0
    if held and age < FAMILY_FRESH_S:
        return held[1], None, ""
    task = _FAMILY_ASKING.get(uid)
    if task is None:
        task = asyncio.ensure_future(_family_fill(s, uid))
        _FAMILY_ASKING[uid] = task

        def done(t: asyncio.Future, u: str = uid) -> None:
            if _FAMILY_ASKING.get(u) is t:
                _FAMILY_ASKING.pop(u, None)

        task.add_done_callback(done)
    if held and age < FAMILY_CEILING_S:
        return held[1], None, ""
    try:
        env = await asyncio.wait_for(asyncio.shield(task),
                                     timeout=max(0.0, BUDGET_S - (time.monotonic() - arrived)))
    except asyncio.TimeoutError:
        return None, None, FAMILY_SLOW
    except Exception as exc:  # noqa: BLE001 - said on the heads, never an empty list
        return None, None, f"the backend could not be asked ({type(exc).__name__})"
    if env.get("status") == 200:
        return env["data"], None, ""
    if env.get("status") in FAMILY_REFUSED:
        return None, env, ""
    return None, None, str(env.get("message") or "the backend did not answer")


def _access(uid: str, role: str, apps: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Blocking, FAIL-CLOSED: {app: {open, why}}, App Control's verdict on each app for this account."""
    def one(reads: Any, app_id: str) -> dict[str, Any]:
        try:
            verdict = LG.app_access(reads, uid, role, app_id, master=False)
        except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
            log.warning("my inbox: an access check failed (%s)", type(exc).__name__)
            return {"open": False, "why": f"The access check failed ({type(exc).__name__})."}
        return {"open": verdict.get("open") is True, "why": str(verdict.get("why") or "")}

    try:
        return LG.in_reads(lambda reads: {a: one(reads, a) for a in apps})
    except Exception as exc:  # noqa: BLE001
        log.warning("my inbox: an access check failed (%s)", type(exc).__name__)
        return {a: {"open": False, "why": f"The access check failed ({type(exc).__name__})."} for a in apps}


async def _family_board(s: Any, actor: tuple[str, str], scope: dict[str, str], arrived: float) -> dict[str, Any]:
    """A client-role session's alerts: New staff from the family view, the company notices at the houses it names."""
    import inbox_family as IF  # noqa: PLC0415
    import my_inbox as MI  # noqa: PLC0415
    import web_notices as WN  # noqa: PLC0415

    SL = _SL()
    uid = str(actor[1] or "")
    family, refused, family_why = await _family_read(s, uid, arrived)
    if refused is not None:
        return refused
    switched = bool(s.acting)
    subject = {"uid": uid, "role": str(actor[0] or ""), "types": "", "is_master": False, "label": ""}
    access = await run_in_threadpool(_access, subject["uid"], subject["role"], IF.FAMILY_APPS)
    # test mode holds the company notices, as for everybody
    held = _held_words(await _switch())

    def notices_at(houses: list[str]) -> dict[str, Any]:
        return WN.house_news(SL.PG_DSN, houses=houses, uid=uid, held=held)

    try:
        data = await SL._run(IF.family_board, SL.PG_DSN, subject=subject, family=family,  # noqa: SLF001
                             family_why=family_why, access=access, notices=notices_at, held=held,
                             readonly=switched, readonly_why=IF.KEPT_WHY_ACTING)
    except Exception as exc:  # noqa: BLE001
        log.warning("my inbox: the family board failed (%s)", type(exc).__name__)
        return {"status": 503, "reason": "unreadable",
                "message": f"My Inbox could not be put together ({type(exc).__name__})."}
    MI.apply_display(data, await run_in_threadpool(_display, scope["mode"]))
    data["scope"] = {"mode": scope["mode"], "why": scope["why"], "person": "", "readonly": switched}
    return {"status": 200, "data": data}


# ---- My Inbox: the doors ---------------------------------------------------------------------------------------------

async def my_inbox(request: Request) -> Response:
    """One person's alerts — whose, decided here, never by the screen."""
    return LG.answer(await _my_inbox(request), no_store=True)


async def _my_inbox(request: Request) -> dict[str, Any]:
    import my_inbox as MI  # noqa: PLC0415

    arrived = time.monotonic()
    got = await _gate(request)
    if isinstance(got, dict):
        return got
    s, scope, actor = got
    mass = scope["mode"] == MODE_MASS
    person = LG.query(request, "person").strip()
    # another person's alerts outside the master's scope: only My Inbox's edition opens them, on Python
    if person and not mass and _family(actor):
        return {"status": 403, "reason": "scope", "message": OWN_ONLY}
    if person and not MI.PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    if _family(actor):
        return await _family_board(s, actor, scope, arrived)
    edition = bool(person) and not mass
    if edition and s.acting:
        return {"status": 403, "reason": "scope", "message": OWN_ONLY}
    env = await _python(s, actor, scope, person)
    if env is not None:
        return env
    return dict(UNCHECKED) if edition else dict(DOWN)


async def my_inbox_read(request: Request) -> Response:
    """Mark the SESSION's own alerts read, or cleared."""
    refused = await _write_refused(request)
    if refused is not None:
        return refused
    return await _ringing(await _my_inbox_read(request))


async def _mark_python(s: Any, scope: dict[str, str], keys: list[str], dismiss: bool) -> dict[str, Any]:
    """The session's own alert marks, kept final by Python (app.inbox_reads): its answer, or 503 when it gave none."""
    wid = LG.write_id(s.uid, dismiss, ",".join(keys))
    env = await LG.python(APP_ID, "myInboxRead", LG.user_of(s, "myInboxRead", is_master=scope["mode"] == MODE_MASS),
                          {"keys": list(keys), "dismiss": dismiss}, write=wid)
    if env is None:
        log.warning("my inbox: the marks were not kept by Python — said 503")
        return dict(UNMARKED)
    if env.get("status") == 200 and not isinstance((env.get("data") or {}).get("marked"), int):
        log.warning("my inbox: Python's mark answer carried no count — said 503")
        return dict(UNMARKED)
    return env


async def _my_inbox_read(request: Request) -> dict[str, Any]:
    import inbox_family as IF  # noqa: PLC0415
    import inbox_state as IS  # noqa: PLC0415
    import web_notices as WN  # noqa: PLC0415

    SL = _SL()
    got = await _gate(request)
    if isinstance(got, dict):
        return got
    s, scope, actor = got
    if s.acting:
        return dict(SWITCHED)
    uid = str(actor[1] or "").strip()
    if not uid:
        return {"status": 403, "reason": "session", "message": "This session carries no account to keep the reads for."}
    body = await LG.body_json(request)
    if body is LG.INVALID or not isinstance(body, dict):
        return {"status": 400, "reason": "body", "message": "The body could not be read."}
    if str(body.get("member") or "").strip():
        return {"status": 403, "reason": "visit", "message": VISIT}
    keys = body.get("keys")
    if not isinstance(keys, list) or not keys:
        return {"status": 400, "reason": "keys", "message": "keys is required."}
    if len(keys) > READ_MAX:
        return {"status": 400, "reason": "keys", "message": f"At most {READ_MAX} keys at once."}
    notice_ids, alert_keys, ignored = IS.split_keys(keys)
    if not notice_ids and not alert_keys:
        return {"status": 400, "reason": "keys", "message": "None of those keys is an alert."}
    dismiss = body.get("dismiss") is True
    marked = 0
    # the alert marks are Python's (app.inbox_reads); a notice's stay the bell's, a client-role board's the relay's table
    python = bool(alert_keys) and not _family(actor)
    if python:
        kept = await _mark_python(s, scope, alert_keys, dismiss)
        if kept.get("status") != 200:
            return kept
        marked += int(kept["data"]["marked"])
    try:
        if notice_ids:
            marked += await SL._run(WN.mark_read, SL.PG_DSN, uid=uid, ids=notice_ids,  # noqa: SLF001
                                    dismiss=dismiss)
        if alert_keys and not python:
            marked += await SL._run(IF.mark_read, SL.PG_DSN, uid=uid, keys=alert_keys,  # noqa: SLF001
                                    dismiss=dismiss)
    except Exception as exc:  # noqa: BLE001
        log.warning("my inbox: the read marks could not be written (%s)", type(exc).__name__)
        return {"status": 502, "reason": "unreadable", "message": f"Not marked ({type(exc).__name__})."}
    return {"status": 200, "data": {"marked": marked, "ignored": ignored}}


def install(app: Any) -> None:
    app.get("/hub-lanes/notices")(notices)
    app.post("/hub-lanes/notices/read")(notices_read)
    app.get("/hub-lanes/my-inbox")(my_inbox)
    app.post("/hub-lanes/my-inbox/read")(my_inbox_read)
    log.info("inbox lanes: the bell (notices, notices/read) and My Inbox (my-inbox, my-inbox/read) answered here")
