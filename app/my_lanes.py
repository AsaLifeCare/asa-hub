"""The My apps' lanes the relay answered (GET /hub-lanes/my-work, /my-profile, /my-calendar, /my-calendar/check),
answered here: the relay's own wrapper — the visit refused first, App Control's gate in its words, whose rows a session
reads decided here and never by the screen (`mass` only for the master's own session), a client-role session handed
to its family view, and Python's door (myWorkView, myProfileView, myCalendarView, myCalendarCheck) asked in-process
with what the relay handed it (test mode, the cells just published, the Time Off gate). An answer that does not keep
the scope or the shape decided here is never served."""
from __future__ import annotations

import logging
import re
import time
from datetime import date, datetime
from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import lane_gate as LG
import slice_gate

log = logging.getLogger("asa-hub-app.lanes")

MODE_MASS, MODE_OWN = "mass", "own"
ROLES_REFUSED = ("onboarding", "interviewer")
FAMILY_WORDS = {"calendar": "calendar", "work": "work", "inbox": "alerts"}

WORK_DOWN = {"status": 503, "reason": "unreadable", "message": "My Work is not available on this server right now."}
WORK_VISIT = "My Work reads the signed-in account's own record; it is not drawn inside a visit."
WORK_OWN_ONLY = "My Work shows only your own rows."
WORK_PERSON = r"[a-z0-9]{1,80}"
WORK_MASS_WHY = "Signed in as the master account: every person's rows, each naming its person."
WORK_KEYS = ("scope", "me", "actions", "requests", "totals", "read_at")

PROFILE_DOWN = {"status": 503, "reason": "unreadable",
                "message": "My Profile is not available on this server right now."}
PROFILE_VISIT = "My Profile reads the signed-in account's own record; it is not drawn inside a visit."
PROFILE_OWN_ONLY = "My Profile shows only your own profile."
PROFILE_MASS_WHY = "Signed in as the master account: your own profile, or any person's you choose."
PROFILE_KEYS = ("scope", "person", "details", "requirements", "read_at")
PERSON_RE = re.compile(r"[\w .:@'’-]{1,120}")
CLIENT_RE = re.compile(r"[\w .:@'’-]{1,120}")

CALENDAR_DOWN = {"status": 503, "reason": "unreadable",
                 "message": "My Calendar is not available on this server right now."}
CALENDAR_NO_REQUESTS = {"status": 403, "reason": "restricted",
                        "message": "Time off requests are the staff's; this account files none."}
CALENDAR_VISIT = "My Calendar reads the signed-in account's own record; it is not drawn inside a visit."
CALENDAR_OWN_ONLY = "My Calendar shows only your own calendar."
CALENDAR_DAY = r"\d{4}-\d{2}-\d{2}"
CALENDAR_MASS_WHY = ("Signed in as the master account: your own calendar, or any person's you choose; a request you "
                     "add there is filed for them, by you.")
CALENDAR_KEYS = ("scope", "person", "today", "week", "requests", "form", "test_mode", "read_at")
CALENDAR_CHECK_KEYS = ("ref", "start", "end", "days", "dates", "ok", "refusals")
CALENDAR_EDITIONS = frozenset({"myCalendar.anyone"})
CALENDAR_EDITION_REFUSALS = (400, 403, 404)
CALENDAR_UNCHECKED = {"status": 503, "reason": "unavailable",
                      "message": "Whether you may open another person's calendar could not be checked just now. "
                                 "Try again."}
TIME_OFF_ROLES_REFUSED = ("client", "guardian", "onboarding", "interviewer")
TIME_OFF_FILERS = (("my-calendar", "My Calendar"),)
REF_RE = re.compile(r"\bTO[0-9A-F]{10}\b")
# the cells just published or held by test mode, as last read: held a few seconds
PUBLISHED_HOLD_S = 5.0
_PUBLISHED: dict[str, Any] = {"at": 0.0, "rows": None}


def _fold(name: Any) -> str:
    import my_work as MW  # noqa: PLC0415 - the fold's one home
    return MW.fold(name)


def _scope(s: Any, mass_why: str) -> dict[str, str]:
    """{mode, why}: `mass` only for the master's own session."""
    mode = MODE_MASS if LG.is_master(s) else MODE_OWN
    return {"mode": mode, "why": mass_why if mode == MODE_MASS else ""}


def _family(who: tuple[str, str]) -> bool:
    """A client-role session: handed to its family view instead of computed."""
    return str(who[0] or "").strip().lower() == "client"


async def _family_of(s: Any, who: tuple[str, str]) -> bool:
    """A client-role session, or an SSA's or a FAMILY's whatever its role says (slice_gate.slice_role): handed to its
    family view instead of computed."""
    return _family(who) or await run_in_threadpool(slice_gate.slice_role, s) == slice_gate.FAMILY_ROLE


def _shown(env: dict[str, Any]) -> dict[str, Any]:
    """Python's own refusal, as its door worded it."""
    return {k: env[k] for k in ("status", "reason", "message") if k in env}


async def family(s: Any, part: str, week: str = "") -> dict[str, Any]:
    """_my_family_forward: the family view's `myFamily` answer for this session; what Python cannot answer is its 503."""
    words = FAMILY_WORDS.get(part)
    if not words:
        return {"status": 400, "reason": "part", "message": "That part cannot be read."}
    if LG.actor(s) is None:
        return dict(LG.SIGN_IN)
    payload: dict[str, Any] = {"part": part}
    if week:
        payload["week"] = week
    env = await LG.python("my-family", "myFamily", LG.user_of(s, "myFamily"), payload)
    if env is None:
        log.warning("my family: Python did not answer — said 503")
        return {"status": 503, "reason": "unreadable",
                "message": f"Your {words} could not be read just now. Try again in a moment."}
    try:
        status = int(env.get("status") or 0)
    except (TypeError, ValueError):
        status = 0
    if status != 200:
        status = status if 400 <= status < 600 else 502
        return {"status": status, "reason": str(env.get("reason") or ("restricted" if status == 403 else "unreadable")),
                "message": str(env.get("message") or "") or f"Your {words} could not be read."}
    data = env.get("data")
    if not isinstance(data, dict) or data.get("family") is not True or data.get("part") != part:
        return {"status": 502, "reason": "unreadable",
                "message": f"Your {words} could not be read: the backend answered something else."}
    return env


# ---- My Work ---------------------------------------------------------------------------------------------------------

async def my_work(request: Request) -> Response:
    """What is asked of a person and what they have asked."""
    return LG.answer(await _my_work(request), no_store=True)


async def _my_work(request: Request) -> dict[str, Any]:
    if LG.query(request, "member").strip():
        return {"status": 403, "reason": "visit", "message": WORK_VISIT}
    s = await LG.session(LG.token_of(request))
    who = await LG.gate(s, "my-work", refuse_roles=ROLES_REFUSED, app_label="My Work")
    if isinstance(who, dict):
        return LG.refusal(who)
    scope = _scope(s, WORK_MASS_WHY)
    person = LG.query(request, "person").strip()
    if person and scope["mode"] != MODE_MASS:
        return {"status": 403, "reason": "scope", "message": WORK_OWN_ONLY}
    if person and not re.fullmatch(WORK_PERSON, person):
        return {"status": 400, "reason": "person", "message": "That person key cannot be read."}
    if await _family_of(s, who):
        return await family(s, "work")
    mass = scope["mode"] == MODE_MASS
    env = await LG.python("my-work", "myWorkView", LG.user_of(s, "myWorkView", is_master=mass),
                          {"mode": scope["mode"], "why": scope["why"], "person": person})
    if env is None:
        return dict(WORK_DOWN)
    if env.get("status") != 200:
        return _shown(env)
    data = env.get("data")
    said = data.get("scope") if isinstance(data, dict) else None
    if (not isinstance(said, dict) or any(k not in data for k in WORK_KEYS) or not isinstance(data.get("display"), dict)
            or said.get("mode") != scope["mode"] or said.get("person") != (_fold(person) if mass else "")):
        log.warning("my work: Python's board did not keep the scope or shape decided here — not served")
        return dict(WORK_DOWN)
    return {"status": 200, "data": data}


# ---- My Profile ------------------------------------------------------------------------------------------------------

async def my_profile(request: Request) -> Response:
    """One person's details and requirements — whose, decided here."""
    return LG.answer(await _my_profile(request), no_store=True)


async def _my_profile(request: Request) -> dict[str, Any]:
    if LG.query(request, "member").strip():
        return {"status": 403, "reason": "visit", "message": PROFILE_VISIT}
    s = await LG.session(LG.token_of(request))
    who = await LG.gate(s, "my-profile", refuse_roles=ROLES_REFUSED, app_label="My Profile")
    if isinstance(who, dict):
        return LG.refusal(who)
    scope = _scope(s, PROFILE_MASS_WHY)
    person = LG.query(request, "person").strip()
    client = LG.query(request, "client").strip()
    if (person or client) and scope["mode"] != MODE_MASS:
        return {"status": 403, "reason": "scope", "message": PROFILE_OWN_ONLY}
    if person and client:
        return {"status": 400, "reason": "person", "message": "Choose a person or a client, not both."}
    if person and not PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    if client and not CLIENT_RE.fullmatch(client):
        return {"status": 400, "reason": "person", "message": "That client cannot be read."}
    mass = scope["mode"] == MODE_MASS
    env = await LG.python("my-profile", "myProfileView", LG.user_of(s, "myProfileView", is_master=mass),
                          {"mode": scope["mode"], "why": scope["why"], "person": person, "client": client})
    if env is None:
        return dict(PROFILE_DOWN)
    if env.get("status") != 200:
        return _shown(env)
    data = env.get("data")
    said = data.get("scope") if isinstance(data, dict) else None
    whose = data.get("person") if isinstance(data, dict) else None
    # own: the caller's own profile alone; mass: exactly the person or client the master chose
    if (not isinstance(said, dict) or not isinstance(whose, dict) or any(k not in data for k in PROFILE_KEYS)
            or said.get("mode") != scope["mode"] or said.get("person") != (person if mass else "")
            or (mass and said.get("client") != ("" if person else client))
            or (not mass and whose.get("own") is not True)):
        log.warning("my profile: Python's answer did not keep the scope or shape decided here — not served")
        return dict(PROFILE_DOWN)
    return {"status": 200, "data": data}


# ---- My Calendar -----------------------------------------------------------------------------------------------------

async def _calendar_gate(request: Request, person: str) -> tuple[Any, dict[str, str], tuple[str, str]] | dict:
    """(session, scope, actor) for a session My Calendar serves, or the refusal: a visit before anything, then the
    session, the gate, and another person's calendar outside the master's scope."""
    if LG.query(request, "member").strip():
        return {"status": 403, "reason": "visit", "message": CALENDAR_VISIT}
    token = LG.token_of(request)
    s = await LG.session(token)
    if token and s is None:
        return {"status": 503, "reason": "unavailable",
                "message": "My Calendar could not open: the sign-in check could not be made (the backend could not "
                           "answer). Try again."}
    who = await LG.gate(s, "my-calendar", refuse_roles=ROLES_REFUSED, app_label="My Calendar")
    if isinstance(who, dict):
        return LG.refusal(who)
    scope = _scope(s, CALENDAR_MASS_WHY)
    # another person's calendar outside the master's scope: only My Calendar's edition opens it, on Python
    if person and scope["mode"] != MODE_MASS and await _family_of(s, who):
        return {"status": 403, "reason": "scope", "message": CALENDAR_OWN_ONLY}
    if person and not PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    return s, scope, who


async def time_off_gate(s: Any, hosts: tuple[tuple[str, str], ...] = ()) -> tuple[str, str] | dict[str, Any]:
    """_time_off_gate: (role, uid) when Time Off's own gate, or a screen in `hosts`, opens to the session."""
    got = await LG.gate(s, "timeoff", refuse_roles=TIME_OFF_ROLES_REFUSED, app_label="Time Off")
    if not isinstance(got, dict) or got.get("status") != 403:
        return got
    for app_id, label in hosts:
        via = await LG.gate(s, app_id, refuse_roles=TIME_OFF_ROLES_REFUSED, app_label=label)
        if not isinstance(via, dict):
            return via
    return got


def _published_cells(held: bool) -> list[dict[str, Any]]:
    """Blocking, read-only: every house's cells just published or held by test mode (effective_roster.published,
    its pending and test-mode rows), each stamp as ISO text — the edit trail in asa-hub-db, the live copy's stamps
    where the relay keeps them."""
    import mw_relay_state  # noqa: PLC0415 - the live copy's one reader
    import mw_roster  # noqa: PLC0415

    er = mw_roster.effective_roster
    stamps = mw_relay_state.rows(er.LIVE, columns=("location", "updated_at"))
    if not stamps:
        return []
    sql = ("SELECT p.*, CASE WHEN p.stage = %s THEN EXISTS (SELECT 1 "
           "FROM app.asa_house_calendar_edits r WHERE r.location = p.location "
           "AND r.employee = p.employee AND r.col_iso = p.col_iso AND r.stage = %s "
           "AND r.undone_at IS NULL AND r.via LIKE %s AND NOT EXISTS (SELECT 1 "
           "FROM app.asa_house_calendar_edits q WHERE q.location = r.location "
           "AND q.employee = r.employee AND q.col_iso = r.col_iso AND q.stage = %s "
           "AND q.id > r.id)) ELSE FALSE END AS rehearsed FROM ("
           "SELECT DISTINCT ON (e.location, e.employee, e.col_iso) "
           "e.id, e.location, e.employee, e.col_iso, e.new_value, e.at, e.actor, e.via, "
           "e.stage, l.updated_at AS mirror_at, "
           "(e.stage = %s OR e.at > l.updated_at - make_interval(secs => %s)) AS pending "
           "FROM app.asa_house_calendar_edits e "
           "JOIN unnest(%s::text[], %s::timestamptz[]) AS l(location, updated_at) ON l.location = e.location "
           "WHERE (e.stage = %s OR (%s AND e.stage = %s AND e.undone_at IS NULL)) "
           "ORDER BY e.location, e.employee, e.col_iso, e.id DESC) p "
           "ORDER BY p.location, p.employee, p.col_iso")
    args = (er._TEST_MODE, er._TEST_MODE, er.REHEARSAL_VIA + "%", er._PUBLISHED, er._TEST_MODE,
            int(mw_roster.house_cal_live.PUBLISH_SETTLE_S), [str(r["location"]) for r in stamps],
            [r["updated_at"] for r in stamps], er._PUBLISHED, bool(held), er._TEST_MODE)
    cur = _store().conn().cursor()
    cur.execute(sql, args)
    names = [d[0] for d in cur.description]
    out = []
    for raw in cur.fetchall():
        r = dict(zip(names, raw))
        if not (r.get("pending") or r.get("stage") == er._TEST_MODE):
            continue
        cell = {"id": int(r["id"]), "location": str(r["location"]), "employee": str(r["employee"]),
                "col_iso": str(r["col_iso"]), "value": str(r["new_value"] or "").strip(), "at": r["at"],
                "actor": str(r["actor"] or ""), "via": str(r["via"] or ""), "mirror_at": r["mirror_at"],
                "pending": bool(r["pending"]), "test_mode": str(r.get("stage") or "") == er._TEST_MODE,
                er.REHEARSAL: bool(r.get("rehearsed"))}
        out.append({k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in cell.items()})
    return out


_STORE: list[Any] = []


def _store() -> Any:
    """The writer role's shared connection (writes.Store): the edit trail is the relay's own table in schema app."""
    if not _STORE:
        import writes  # noqa: PLC0415
        _STORE.append(writes.Store(kind="lanes", label="the lanes"))
    return _STORE[0]


async def _handed() -> dict[str, Any]:
    """_my_calendar_handed: the test mode switch, and the cells just published or held by it; cells that cannot be
    read are left out, and Python's door defers."""
    switch = await run_in_threadpool(LG.in_reads, LG.switch)
    out: dict[str, Any] = {"test_mode": {"on": bool(switch.get("on")), "readable": bool(switch.get("readable")),
                                         "why": str(switch.get("why") or "")}}
    held = _PUBLISHED
    if held["rows"] is not None and time.time() - float(held["at"]) < PUBLISHED_HOLD_S:
        out["published"] = held["rows"]
        return out
    try:
        rows = await run_in_threadpool(_published_cells, bool(switch.get("on")))
        held.update(at=time.time(), rows=rows)
        out["published"] = rows
    except Exception as exc:  # noqa: BLE001 - Python reads none and defers
        log.info("my calendar: the published cells were not read (%s)", type(exc).__name__)
    return out


async def _calendar_python(s: Any, scope: dict[str, str], action: str, ask: dict[str, Any]) -> dict[str, Any] | None:
    """Python's envelope for the scope and subject decided here; None when it gave none this door serves."""
    mass = scope["mode"] == MODE_MASS
    person = str(ask.get("person") or "")
    # a person outside the master's scope: the edition Python alone holds decides
    edition = bool(person) and not mass
    env = await LG.python("my-calendar", action, LG.user_of(s, action, is_master=mass),
                          {"mode": scope["mode"], "why": scope["why"], **ask})
    if env is None:
        return None
    if env.get("status") != 200:
        return _shown(env)
    data = env.get("data")
    if not isinstance(data, dict):
        data = None
    elif action == "myCalendarCheck":
        if any(k not in data for k in CALENDAR_CHECK_KEYS) or data.get("ref") != ask.get("ref"):
            data = None
    else:
        said, whose = data.get("scope"), data.get("person")
        said = said if isinstance(said, dict) else {}
        # an edition's holder is answered as Python widened the scope: any person, said under the edition
        widened = (not mass and said.get("mode") == MODE_MASS
                   and str(said.get("edition") or "") in CALENDAR_EDITIONS)
        if (not said or not isinstance(whose, dict) or any(k not in data for k in CALENDAR_KEYS)
                or (said.get("mode") != scope["mode"] and not widened)
                or said.get("person") != (person if mass or widened else "")
                or (not mass and not widened and whose.get("own") is not True)
                or (edition and not widened)):
            data = None
    if data is None:
        log.warning("my calendar: Python's answer did not keep the scope or shape decided here — not served")
        return None
    return {"status": 200, "data": data}


def _today() -> date:
    import my_calendar as MC  # noqa: PLC0415 - the lane's own Ohio day
    return MC.today()


async def my_calendar(request: Request) -> Response:
    """One person's week of shifts and their own time off requests — whose, decided here."""
    return LG.answer(await _my_calendar(request), no_store=True)


async def _my_calendar(request: Request) -> dict[str, Any]:
    import my_calendar as MC  # noqa: PLC0415 - the week's own reading

    person = LG.query(request, "person").strip()
    got = await _calendar_gate(request, person)
    if isinstance(got, dict):
        return got
    s, scope, who = got
    week = LG.query(request, "week").strip()
    if await _family_of(s, who):
        if week and not re.fullmatch(CALENDAR_DAY, week):
            return {"status": 400, "reason": "week", "message": "A week is asked for by a day written YYYY-MM-DD."}
        return await family(s, "calendar", week)
    on = _today()
    try:
        mon = MC.parse_week(week, on)
    except MC.BadWeek as exc:
        return {"status": 400, "reason": "week", "message": str(exc)}
    edition = bool(person) and scope["mode"] != MODE_MASS
    ask: dict[str, Any] = {"person": person, "week": mon.isoformat(), "today": on.isoformat(), **await _handed()}
    gate = await time_off_gate(s, TIME_OFF_FILERS)
    ask["time_off_open"] = ({"open": False, "why": str(gate.get("message") or "Time Off is not open to you.")}
                            if isinstance(gate, dict) else {"open": True, "why": ""})
    env = await _calendar_python(s, scope, "myCalendarView", ask)
    if env is not None:
        return env
    return dict(CALENDAR_UNCHECKED) if edition else dict(CALENDAR_DOWN)


async def my_calendar_check(request: Request) -> Response:
    """Would new dates for one of the reader's requests file?"""
    return LG.answer(await _my_calendar_check(request), no_store=True)


async def _my_calendar_check(request: Request) -> dict[str, Any]:
    person = LG.query(request, "person").strip()
    got = await _calendar_gate(request, person)
    if isinstance(got, dict):
        return got
    s, scope, who = got
    if await _family_of(s, who):
        return dict(CALENDAR_NO_REQUESTS)
    ref = LG.query(request, "ref").strip().upper()
    if not REF_RE.fullmatch(ref):
        return {"status": 400, "reason": "request", "message": "ref is required (TO…)"}
    start, end = LG.query(request, "start").strip(), LG.query(request, "end").strip()
    if any(d and not re.fullmatch(CALENDAR_DAY, d) for d in (start, end)):
        return {"status": 400, "reason": "dates", "message": "A day is written YYYY-MM-DD."}
    env = await _calendar_python(s, scope, "myCalendarCheck",
                                 {"person": person, "ref": ref, "start": start, "end": end,
                                  "today": _today().isoformat(), **await _handed()})
    if env is not None:
        return env
    return dict(CALENDAR_UNCHECKED) if person and scope["mode"] != MODE_MASS else dict(CALENDAR_DOWN)


def install(app: Any) -> None:
    app.get("/hub-lanes/my-work")(my_work)
    app.get("/hub-lanes/my-profile")(my_profile)
    app.get("/hub-lanes/my-calendar")(my_calendar)
    app.get("/hub-lanes/my-calendar/check")(my_calendar_check)
