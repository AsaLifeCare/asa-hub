"""The scheduling lanes, answered here as the relay answered them (server/snapshot_service.py): House Calendars
(/hub-lanes/housecal…), a client's own house (/hub-lanes/houses/mine), transfers (/hub-lanes/shift-handoff…), Requests
(/hub-lanes/shift-requests…), Calendar Builder's houses (/hub-lanes/calendar-builder/house…) and Time Off
(/hub-lanes/time-off…). The modules behind them are the relay's, translated beside this one (shift_requests,
shift_handoff, time_off, calendar_builder_*, house_cal_live, effective_roster…), on the app's connections (lanes_pg) and
asa-hub-db's sheets (lanes_sheets); the doors' words, statuses and envelopes are the relay's own. The session is the
front door's verdict. What a write changed is told to the relay's clocks and streams (live_notify.tell) until they
live here; the situations those writes owe are still raised by the relay's clocks from the same tables."""
from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import Response

import calendar_builder_houses
import effective_roster
import front_door
import house_cal_live
import hubdb
import lanes_pg
import lanes_sheets
import live_notify
import shift_handoff
import shift_requests
import shift_slices
import time_off

log = logging.getLogger("asa-hub-app.sched-lanes")

# the token the translated lanes take where the relay handed its DSN: every connection is lanes_pg's
PG_DSN = "asa-hub-db"
HUB_DB_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
SNAPSHOT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
PEOPLE_PATH = Path(os.getenv("HUB_HOTLINE_PEOPLE", str(SNAPSHOT_DIR / "people.json")))
SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
LANE_THREADS = max(1, int(os.getenv("HUB_LANES_THREADS", "6")))
KEEPER_WAIT_S = 60.0
TIME_OFF_APP = "timeoff"

_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=LANE_THREADS, thread_name_prefix="sched-lanes")
_KEEP_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="sched-lanes-keep")
M: Any = None


async def _run(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """asyncio.to_thread on the lanes' own threads; each call leaves nothing open on its connections."""
    def call() -> Any:
        try:
            return fn(*args, **kwargs)
        finally:
            lanes_pg.finish()
    return await asyncio.get_running_loop().run_in_executor(_POOL, call)


def _jsonable(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Timestamps as strings. A datetime in a JSON body is a 500 nobody reads."""
    out = []
    for r in rows:
        out.append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()})
    return out


async def _body(request: Request) -> Any:
    try:
        return await request.json()
    except Exception:  # noqa: BLE001
        return None


def _q(request: Request, name: str) -> str:
    return str(request.query_params.get(name) or "")


# ---- what a write changed, told ------------------------------------------------------------------------------------

def _notices_wake() -> None:
    live_notify.tell(wake=["notices"])


def _housecal_rang() -> None:
    live_notify.tell(events=["housecal"])


def _time_off_changed() -> None:
    """A write owes the Builder's Requests slice, the bell and the calendars a look now."""
    live_notify.tell(resources=["calendarRequests"], wake=["notices"], events=["housecal"], forget=["time_off"])


def _roster_published(event: dict[str, Any]) -> None:
    """A publish landed: this process's shift readers read again, and the roster signal is raised (_roster_moved)."""
    shift_slices.forget()
    shift_requests.forget_estate()
    live_notify.tell(roster={k: event.get(k) for k in ("location", "house", "cells", "via", "actor", "at")})


def _roster_moved(event: dict[str, Any]) -> None:
    """roster:published, as the relay answered it: the shift slices rebuilt, the attendance loop's roster read again."""
    import comm_when_slices  # noqa: PLC0415

    live_notify.dirty(list(shift_slices.RESOURCES) + list(comm_when_slices.RESOURCES))
    moved = live_notify.LOCAL_WAKES.get("attendance")
    if moved is not None:
        moved()
    log.info("roster: %d published cell(s) at %s (%s, by %s) reach every reader", len(event.get("cells") or []),
             event.get("location") or event.get("house") or "?", event.get("via") or "?", event.get("actor") or "?")


def _held_roster(location: str, cells: list[dict[str, Any]], *, via: str, actor: str, act: str,
                 switch: dict[str, Any]) -> bool:
    """Test mode's mockup row for roster cells it held (roster:held, _held_kept); whether it was kept."""
    got = live_notify.tell_now(held_roster={"location": location, "cells": cells, "via": via, "actor": actor,
                                            "act": act, "switch": switch})
    return bool((got or {}).get("held_kept"))


def _held_kept(held: dict[str, Any]) -> bool:
    """roster:held, as the relay kept it: one mock row per held act in the mock ledger (app/web_gate.py)."""
    import web_gate  # noqa: PLC0415

    switch = held.get("switch") if isinstance(held.get("switch"), dict) else _test_switch()
    web_gate.record(web_gate.roster_rows(
        str(held.get("location") or ""), [c for c in held.get("cells") or [] if isinstance(c, dict)],
        via=str(held.get("via") or ""), actor=str(held.get("actor") or ""), act=str(held.get("act") or ""),
        switch=switch))
    return True


live_notify.LOCAL_SIGNALS.update(roster=_roster_moved, held_roster=_held_kept)


_SWITCH: dict[str, Any] = {"at": 0.0, "said": None}
_SWITCH_LOCK = threading.Lock()
SWITCH_TTL_S = 10.0


def _test_switch() -> dict[str, Any]:
    """The resolved test mode (config_lane.test_mode over Settings), as the relay's web_gate.switch_from says it."""
    with _SWITCH_LOCK:
        if _SWITCH["said"] is not None and time.time() - _SWITCH["at"] < SWITCH_TTL_S:
            return dict(_SWITCH["said"])
    try:
        import config_lane  # noqa: PLC0415
        import locations  # noqa: PLC0415
        tm = config_lane.test_mode(locations.Reads(hubdb.shared()).config())
    except Exception as exc:  # noqa: BLE001 - an unread switch holds
        return {"on": True, "readable": False, "word": "unreadable",
                "why": f"test mode could not be read ({type(exc).__name__})"}
    if tm.get("unreadable"):
        said = {"on": True, "readable": False, "word": "unreadable",
                "why": f"the platform could not read test mode ({str(tm.get('unreadable'))[:120]})"}
    elif tm.get("on") is not True and tm.get("on") is not False:
        said = {"on": True, "readable": False, "word": "unreadable",
                "why": f"test mode came back as {tm.get('on')!r}, which is neither on nor off"}
    else:
        on = bool(tm["on"])
        said = {"on": on, "readable": True, "word": str(tm.get("word") or ("on" if on else "off")), "why": ""}
    with _SWITCH_LOCK:
        _SWITCH.update(at=time.time(), said=said)
    return dict(said)


def _keeper(door: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """time_off's door to the app, as the relay's _time_off_keeper: the app's own timeoff door, on a thread of its
    own (never the lane's connection); None when it gave no answer."""
    write_id = "W" + hashlib.sha256(f"{door}|{time.time_ns()}".encode()).hexdigest()[:24]
    said = {"is_service": True}

    def call() -> Any:
        deciding = M.WRITES.get(TIME_OFF_APP)
        if deciding is not None and door in deciding.ACTIONS:
            return M._run_write(deciding, door, said, payload, write_id)  # noqa: SLF001
        return M._run(M.APPS[TIME_OFF_APP], door, said, payload)  # noqa: SLF001

    try:
        resp = _KEEP_POOL.submit(call).result(KEEPER_WAIT_S)
    except Exception as exc:  # noqa: BLE001 - unanswered: the caller says nothing was written
        log.warning("time off: %s not answered by the app (%s)", door, type(exc).__name__)
        return None
    if getattr(resp, "status_code", 0) != 200:
        return None
    try:
        env = json.loads(resp.body)
    except Exception:  # noqa: BLE001
        return None
    return env if isinstance(env, dict) and isinstance(env.get("status"), int) else None


# ---- who is reading ------------------------------------------------------------------------------------------------

def _token(request: Request) -> str:
    a = str(request.headers.get("authorization") or "")
    return a[7:].strip() if a.lower().startswith("bearer ") else ""


async def _session(request: Request) -> Any:
    """The front door's verdict on the bearer, None when it is no live session."""
    s = await front_door.session(_token(request))
    return s if s is not None and s.ok else None


async def _session_actor(request: Request) -> tuple[str, str] | None:
    s = await _session(request)
    return (str(s.role), str(s.uid)) if s is not None else None


def _text(v: Any) -> str:
    return lanes_sheets.text(v)


def _roster_name_from(me: dict[str, Any] | None, namesakes: list[dict[str, Any]], uid: str) -> str:
    """The roster name a users-tab row gives its account, or '' — pure; a live namesake makes it nobody."""
    def live(row: dict[str, Any]) -> bool:
        return (str(row.get("active") or "").strip().upper() not in ("FALSE", "0", "NO")
                and not str(row.get("merged_into") or "").strip())

    if not isinstance(me, dict) or not live(me):
        return ""
    name = str(me.get("display_name") or "").strip()
    if not shift_requests.fold(name):
        return ""
    others = {str(r.get("user_id") or "") for r in namesakes
              if isinstance(r, dict) and live(r) and str(r.get("user_id") or "") != str(uid)}
    return "" if others - {""} else name


def _roster_name_of(uid: str, *, strict: bool = False) -> str:
    """This account's roster name from the Core users tab, or '' when ambiguous; `strict` raises on a failed read."""
    if not uid:
        return ""
    try:
        rows = lanes_sheets.data(HUB_DB_SHEET_ID, "users")
        me = next((r for r in rows if _text(r.get("user_id")) == str(uid)), None)
        key = shift_requests.fold((me or {}).get("display_name"))
        namesakes = [r for r in rows if shift_requests.fold(_text(r.get("display_name"))) == key] if key else []
    except Exception:  # noqa: BLE001
        if strict:
            raise
        return ""
    return _roster_name_from(me, namesakes, uid)


def _user_badges(uid: str) -> str:
    """The badge column of this person's row."""
    if not uid:
        return ""
    try:
        return _text((lanes_sheets.user_row(HUB_DB_SHEET_ID, uid) or {}).get("types"))
    except Exception as exc:  # noqa: BLE001 — the role still answers
        log.warning("badge column unavailable for %s: %s", uid, type(exc).__name__)
        return ""


_REQUESTS_REFUSED = "Requests is the staff's screen"


async def _requests_viewer(request: Request) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    """(who is reading, the session) or a refusal envelope."""
    s = await _session(request)
    if s is None:
        return {"status": 401, "message": "sign in first"}
    actor = (str(s.role), str(s.uid))
    try:
        name = await _run(_roster_name_of, actor[1], strict=True)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the roster name could not be read (%s)", type(exc).__name__)
        return {"status": 502, "message": f"your roster name could not be read ({type(exc).__name__})"}
    badges = await _run(_user_badges, actor[1])
    who = await _run(shift_requests.viewer, PG_DSN, name=name, role=actor[0], types=badges,
                     is_master=s.is_master is True)
    return who, actor


async def _housecal_viewer(request: Request) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    if not shift_requests.may_view_calendars(who):
        return {"status": 403,
                "message": ("Calendar Builder → Live is the company's staff screen — your own shifts "
                            "are on Calendar Builder → Requests")}
    return who, actor


# ---- App Control's gate (the relay's hotline_desk.app_access, on asa-hub-db) ----------------------------------------

_APP_LABELS = {"smartcomms": "Smart Comms", "clients": "Client Care"}
CONTAINED_ROLES = frozenset({"client", "onboarding", "interviewer"})
TENANT_BASIC_APPS = frozenset({"myasa", "users", "chat", "suggestions", "teamboard", "calendar", "playground"})


def _words(cell: Any) -> list[str]:
    return [b.strip().upper() for b in re.split(r"[,;|\n]+", str(cell if cell is not None else "")) if b.strip()]


def _list_cell(cell: Any) -> list[str]:
    if isinstance(cell, list):
        return [str(x).strip() for x in cell if str(x).strip()]
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        if isinstance(got, list):
            return [str(x).strip() for x in got if str(x).strip()]
    except ValueError:
        pass
    return [x.strip() for x in re.split(r"[,;|\n]+", text) if x.strip()]


def _cut_lists() -> tuple[frozenset[str], frozenset[str]]:
    """Settings › My Work's app list and who still sees it; FAIL-OPEN: an unread list cuts nothing."""
    try:
        import locations  # noqa: PLC0415
        import scope as sc  # noqa: PLC0415
        cfg = locations.Reads(hubdb.shared()).config()
        return (frozenset(sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY))),
                frozenset(sc.list_cell(cfg.get(sc.MYWORK_APPS_SEEN_KEY))))
    except Exception:  # noqa: BLE001
        return frozenset(), frozenset()


def app_access(uid: str, role: str, app_id: str, *, is_master: bool,
               refuse_roles: tuple[str, ...] = (), app_label: str = "") -> dict[str, Any]:
    """{open, reason, why, via}: lib/badgeAccess.ts badgeAllowsApp plus the containment, as the relay decides it."""
    import badge_follows  # noqa: PLC0415
    import scope as sc  # noqa: PLC0415
    label = app_label or _APP_LABELS.get(app_id) or app_id

    def closed(reason: str, why: str) -> dict[str, Any]:
        return {"open": False, "reason": reason, "why": why, "via": ""}

    session_role = str(role or "").strip().lower()
    refused = {str(r).strip().lower() for r in refuse_roles if str(r).strip()}
    if not uid and not session_role:
        return closed("session", "This session carries no account.")
    if session_role in refused:
        return closed("restricted", f"{label} is not served to the {session_role} role here.")
    if is_master is True:
        return {"open": True, "reason": "", "why": "the master's view is never narrowed", "via": "master"}
    if not str(uid or "").strip():
        return closed("session", "This session carries no account id, so the door stays closed.")
    cut, seen = _cut_lists()
    if app_id in cut and str(uid).strip() not in seen:
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    try:
        user = lanes_sheets.user_row(HUB_DB_SHEET_ID, uid)
        rule: list[str] = []
        for r in lanes_sheets.data(HUB_DB_SHEET_ID, "app_badge_access"):
            if _text(r.get("app_id")) == app_id:
                rule = _words(r.get("badges"))
        tenants: list[str] = []
        for r in lanes_sheets.data(HUB_DB_SHEET_ID, "app_tenant_access"):
            if _text(r.get("app_id")) == app_id:
                tenants = _list_cell(r.get("tenants"))
    except Exception as exc:  # noqa: BLE001
        return closed("unreadable", f"The access record could not be read ({type(exc).__name__}). "
                                    "So the door stays closed.")
    if user is None:
        return closed("session", "This account is not in the access record, so the door stays closed.")
    if str(user.get("active") or "").strip().lower() == "false":
        return closed("restricted", "This account is not active.")
    if app_id in _list_cell(user.get("app_denials")):
        return closed("badge", f"{label} was removed from this account in App Access.")
    account_role = str(user.get("role") or "").strip().lower()
    if account_role in refused:
        return closed("restricted", f"{label} is not served to the {account_role} role here.")
    for word in sorted({session_role, account_role} & CONTAINED_ROLES):
        if word.upper() not in rule:
            return closed("restricted", f"{label} is not open to {word} accounts unless App Access "
                          "names that role.")
    home = str(user.get("home_tenant") or "").strip()
    if home and tenants and app_id not in TENANT_BASIC_APPS and home not in tenants:
        return closed("restricted", f"{label} is not installed for this account's home tenant.")
    if not rule:
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    worn = set(_words(user.get("types")))
    # the role word counts as a badge, but not one a family account wears for another column (scope.role_counts)
    for word in (session_role, account_role):
        if word and sc.role_counts(user.get("types"), word):
            worn.add(word.upper())
    if badge_follows.with_followed(worn) & set(rule):
        return {"open": True, "reason": "", "why": "badge", "via": "mirror"}
    return closed("badge", f"{label} is not open to this account's badges.")


async def _app_gate(request: Request, app_id: str, *, refuse_roles: tuple[str, ...] = (),
                    app_label: str = "") -> tuple[str, str] | dict[str, Any]:
    """(role, uid) when the session may open `app_id`, else the refusal envelope (the relay's _hotline_actor)."""
    s = await _session(request)
    if s is None:
        return {"status": 401, "reason": "session", "message": "sign in first"}
    actor = (str(s.role), str(s.uid))
    try:
        verdict = await _run(app_access, actor[1], actor[0], app_id, is_master=s.is_master is True,
                             refuse_roles=refuse_roles, app_label=app_label)
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        log.warning("access check failed: %s", type(exc).__name__)
        return {"status": 403, "reason": "unreadable",
                "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."}
    if not verdict.get("open"):
        return {"status": 403, "reason": str(verdict.get("reason") or "badge"),
                "message": str(verdict.get("why") or "This app is not open to you.")}
    return actor


_DAILY_REASONS = ("session", "badge", "stale", "unreadable", "restricted")


def _daily_refusal(envelope: dict[str, Any]) -> dict[str, Any]:
    """A gate's refusal with its `reason`, named here when the gate did not."""
    if envelope.get("reason") in _DAILY_REASONS:
        return envelope
    status = envelope.get("status")
    if status == 401:
        reason = "session"
    elif status == 403:
        text = str(envelope.get("message") or "").lower()
        reason = ("session" if "no account" in text else "stale" if "too old" in text
                  else "unreadable" if ("could not be read" in text or "cannot be read" in text)
                  else "badge")
    else:
        reason = "unreadable"
    return {**envelope, "reason": reason}


# ---- House Calendars -----------------------------------------------------------------------------------------------

_HOUSECAL_EDIT_REFUSED = ("only this house's manager edits its calendar — the hotline "
                          f"calendar's ** row for it — and {shift_requests.deciders_all()}")


def _live_grids() -> list[dict[str, Any]]:
    with lanes_pg.connect(PG_DSN) as conn, conn.cursor(cursor_factory=lanes_pg.extras.RealDictCursor) as cur:
        cur.execute("SELECT location, grid, updated_at FROM asa_house_calendar_live ORDER BY location")
        return list(cur.fetchall())


def _grid_of(r: dict[str, Any]) -> dict[str, Any]:
    g = r.get("grid") or {}
    if isinstance(g, str):
        try:
            g = json.loads(g)
        except Exception:  # noqa: BLE001
            g = {}
    return g


async def lane_housecal_list(request: Request) -> dict[str, Any]:
    """Houses with a live grid, each with may-edit and its manager."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        rows = await _run(_live_grids)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"calendar mirror unreadable ({type(exc).__name__})"}
    managers = await _run(shift_requests.house_managers, PG_DSN)
    houses = []
    for r in rows:
        g = _grid_of(r)
        location = str(r.get("location") or "")
        access = shift_requests.calendar_access(who, location, managers)
        houses.append({"location": location,
                       "staff": sum(1 for row in g.get("rows", []) or []
                                    if not house_cal_live.not_a_person(
                                        (row or {}).get("employee"), location)),
                       "updated_at": str(r.get("updated_at") or ""),
                       "may_edit": access["edit"],
                       "manager": access["house_manager"]["name"],
                       "managers": access["house_manager"]["names"]})
    drafts: dict[str, int] | None = {}
    if any(h["may_edit"] for h in houses):
        try:
            drafts = await _run(calendar_builder_houses.draft_counts, PG_DSN)
        except Exception as exc:  # noqa: BLE001
            log.warning("housecal rail: the draft counts could not be read (%s)", type(exc).__name__)
            drafts = None
    calendar_builder_houses.lay_draft_pills(houses, drafts)
    return {"status": 200, "data": {
        "houses": houses, "me": str(who.get("name") or ""),
        "manages": who.get("manages") or [],
        "managers_readable": bool(managers.get("readable")),
        "managers_why": str(managers.get("why") or ""),
        "drafts_readable": drafts is not None}}


# a client or guardian's own house, cut from the houses slice the relay builds (house_slices.client_view)
MASTER_QUIET_S = 2 * 3600.0
CLIENT_SOURCES = {"client_db": "the residents", "calendar": "the house manager",
                  "registry": "the street", "people": "the house manager's phone"}


def _epoch(text: Any) -> float:
    from datetime import datetime  # noqa: PLC0415
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def client_view(rows: list[dict], client_key: Any) -> tuple[dict | None, str]:
    """Matched by the exact client key, never a name or a street."""
    key = str(client_key or "").strip()
    if not key:
        return None, "this account carries no client key"
    hits = []
    for h in rows:
        if not h.get("active"):
            continue
        mine = [c for c in h.get("clients") or [] if str(c.get("client_key") or "").strip() == key]
        if mine:
            hits.append((h, mine))
    if not hits:
        return None, "no active house in the Asa Client Database lists this account's client"
    if len(hits) > 1:
        return None, "this account's client is listed in more than one house"
    h, mine = hits[0]
    cal_read = all(s.get("state") != "unreadable" for s in h.get("sources") or [] if s.get("key") == "calendar")
    return {
        "code": h.get("code"), "title": h.get("title"), "label": h.get("label"),
        "city": h.get("city"), "address": h.get("address"), "photo": h.get("photo"),
        "managers": [{"name": m.get("name"), "phone": m.get("phone"), "last_day": m.get("last_day"),
                      "phone_known": m.get("phone_known", True)}
                     for m in h.get("managers") or []],
        "managers_why": ("" if h.get("managers") else "none is on the calendar" if cal_read
                         else "the calendar could not be read just now"),
        "you": [{"name": c.get("name"), "avatar": c.get("avatar")} for c in mine],
        "resident_count": int(h.get("client_count") or 0),
        "policies": [p for p in h.get("policies") or [] if p.get("audience") == "all"],
        "sources": [{"key": s.get("key"), "label": CLIENT_SOURCES[s.get("key")], "state": s.get("state")}
                    for s in h.get("sources") or [] if s.get("key") in CLIENT_SOURCES],
    }, ""


def client_answer(held: dict, build_error: str, client_key: Any, now: float | None = None) -> dict:
    now = time.time() if now is None else float(now)
    view, why = client_view(held.get("rows") or [], client_key)
    built = _epoch(held.get("built_at"))
    if view is not None and (build_error or not built or now - built > MASTER_QUIET_S):
        view["sources"] = [*view["sources"], {"key": "build", "label": "this page", "state": "stale"}]
    return {"house": view, "why": why, "built_at": held.get("built_at")}


def _badges_of(role: str, types: Any) -> set[str]:
    import badge_follows  # noqa: PLC0415
    worn = set()
    if isinstance(types, str):
        worn |= {t.strip().upper() for t in types.split(",") if t.strip()}
    elif isinstance(types, list):
        worn |= {str(t).strip().upper() for t in types if str(t).strip()}
    if role:
        worn.add(str(role).strip().upper())
    return badge_follows.with_followed(worn)


def _badge_rules() -> dict[str, list[str]]:
    """appId -> the badges that may open it, from the master's own matrix; none read narrows nothing."""
    out: dict[str, list[str]] = {}
    try:
        for r in lanes_sheets.data(HUB_DB_SHEET_ID, "app_badge_access"):
            app_id = str(r.get("app_id") or "").strip()
            if app_id:
                out[app_id] = [b.strip().upper() for b in str(r.get("badges") or "").split(",") if b.strip()]
    except Exception as exc:  # noqa: BLE001 — no matrix means no narrowing
        log.warning("badge matrix unavailable: %s", type(exc).__name__)
        return {}
    return out


async def lane_houses_mine(request: Request) -> dict[str, Any]:
    """A client or guardian's own house, keyed on the session's client_key and cut here."""
    actor = await _session_actor(request)
    if not actor:
        return {"status": 401, "message": "sign in first"}
    role, uid = actor
    if role in ("onboarding", "interviewer"):
        return {"status": 403, "message": "not for this account"}
    if role != "client":
        return {"status": 400, "message": "employees read every house from the houses slice"}
    try:
        row = await _run(lanes_sheets.user_row, HUB_DB_SHEET_ID, uid) or {}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the accounts mirror could not be read ({type(exc).__name__})"}
    account = {"k": _text(row.get("client_key")), "t": _text(row.get("types"))}
    rules = await _run(_badge_rules)
    if not rules:
        return {"status": 503, "message": "the App Control matrix could not be read"}
    rule = rules.get("houses")
    if not (rule and any(b in _badges_of(role, account["t"]) for b in rule)):
        return {"status": 403, "message": "the Houses app is not open to this account in App Control"}
    try:
        held = json.loads((SNAPSHOT_DIR / "houses.json").read_text())
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the houses slice could not be read ({type(exc).__name__})"}
    try:
        entry = (json.loads((SNAPSHOT_DIR / "index.json").read_text()).get("slices") or {}).get("houses") or {}
        build_error = str(entry.get("error") or "")
    except Exception as exc:  # noqa: BLE001
        build_error = f"the build record could not be read ({type(exc).__name__})"
    return {"status": 200, "data": client_answer(held, build_error, str(account.get("k") or ""))}


async def lane_housecal_open(request: Request) -> dict[str, Any]:
    """Every open shift in the estate — the Desk's red card and the grid's red cells reading the SAME fact."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        got_open = await _run(shift_requests.calendar_open_shifts, PG_DSN, who)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"open shifts unreadable ({type(exc).__name__})"}
    shifts = got_open["shifts"]
    unclaimed = [s for s in shifts if not s.get("claimed_by")]
    return {"status": 200, "data": {"shifts": shifts, "open": len(unclaimed),
                                    "claimed": len(shifts) - len(unclaimed),
                                    "pool": got_open["pool"]}}


async def lane_housecal_ref(ref: str, request: Request) -> dict[str, Any]:
    """The house and day of one pooled shift by its ref, and nothing else."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    try:
        found = await _run(shift_requests.by_ref, PG_DSN, ref)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the shift pool could not be read ({type(exc).__name__})"}
    if not found:
        return {"status": 404,
                "message": ("that shift is not on the house calendars — it may not have reached "
                            "them yet, or it is no longer open")}
    location, _row, col_iso = found
    return {"status": 200, "data": {"ref": str(ref).strip().upper(), "location": location,
                                    "col_iso": col_iso}}


async def _housecal_grid_for(who: dict[str, Any] | None, location: str) -> dict[str, Any] | None:
    """One house's grid as this reader may see it, with `access`; None without a calendar."""
    grid = await _run(shift_requests.calendar_grid, PG_DSN, location, who)
    if grid is None:
        return None
    managers = await _run(shift_requests.house_managers, PG_DSN)
    access = shift_requests.calendar_access(who or {}, location, managers)
    grid["access"] = {k: access[k] for k in ("view", "edit", "why", "me")}
    grid["house_manager"] = access["house_manager"]
    grid["test_mode"] = effective_roster.test_mode_said()
    try:
        grid["handoffs"] = await _run(shift_handoff.for_house, PG_DSN, location, who or {})
        grid["handoffs_why"] = ""
    except Exception as exc:  # noqa: BLE001
        grid["handoffs"] = []
        grid["handoffs_why"] = f"the transfers waiting here could not be read ({type(exc).__name__})"
    return grid


async def _housecal_after(location: str, who: dict[str, Any] | None) -> dict[str, Any]:
    """{computed, grid} — the whole house re-read after a write; None for both means only the re-read failed."""
    try:
        grid = await _housecal_grid_for(who, location)
    except Exception as exc:  # noqa: BLE001
        log.warning("housecal: the house could not be re-read after a write (%s)", type(exc).__name__)
        return {"computed": None, "grid": None}
    return {"computed": (grid or {}).get("computed"), "grid": grid}


async def lane_housecal_claim(request: Request) -> dict[str, Any]:
    """Take an open shift through shift_requests.take_open_shift: the house manager assigns, anybody else is told…"""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    ref = str(body.get("ref") or "").strip()
    location = str(body.get("location") or "").strip()
    open_row = str(body.get("open_row") or "OPEN").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    if ref:
        found = await _run(shift_requests.by_ref, PG_DSN, ref)
        if not found:
            return {"status": 404, "message": "that shift is not in the pool"}
        location, open_row, col_iso = found
    elif open_row.startswith(shift_requests.CALL_OFF_ROW):
        return {"status": 400, "message": "a called-off shift is named by its ref"}
    if not location or not col_iso:
        return {"status": 400, "message": "location and col_iso are required"}
    may = shift_requests.may_edit_calendar(who, location)
    mine = str(who.get("name") or "")
    wanted = str(body.get("claimed_by") or "").strip()
    if may:
        claimed_by = wanted or mine
        if not claimed_by:
            return {"status": 400, "message": "name the person taking the shift"}
    else:
        if not mine:
            return {"status": 403, "message": "this account is not on a roster — ask your manager"}
        if wanted and wanted.casefold() != mine.casefold():
            return {"status": 403, "message": "you can only take a shift for yourself"}
        claimed_by = mine
    try:
        claimed = await _run(shift_requests.take_open_shift, PG_DSN, location=location, open_row=open_row,
                             col_iso=col_iso, person=claimed_by, by=mine or actor[1], may_decide=may, via="app")
    except shift_requests.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    except LookupError as exc:
        return {"status": 404, "message": str(exc)}
    except ValueError as exc:
        return {"status": 400, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"claim failed ({type(exc).__name__})"}
    log.info("hub-lanes: housecal claim %s / %s / %s → %s (%s, %s)%s", location, open_row,
             col_iso, claimed_by, "assigned" if claimed.get("decided") else "claimed", actor[1],
             " — TEST MODE: the cell was recorded on the platform, not written to the workbook"
             if (claimed.get("published") or {}).get("test_mode") else "")
    _notices_wake()
    _housecal_rang()
    if not shift_requests.sees_callers(who, location):
        claimed = {k: v for k, v in claimed.items() if k != "open_row"}
    return {"status": 200, "data": {**claimed, **await _housecal_after(location, who)}}


async def lane_housecal_claim_release(request: Request) -> dict[str, Any]:
    """Put an open shift back — the correction of whoever edits that house."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    open_row = str(body.get("open_row") or "OPEN").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    if not location or not col_iso:
        return {"status": 400, "message": "location and col_iso are required"}
    if not shift_requests.may_edit_calendar(who, location):
        return {"status": 403, "message": _HOUSECAL_EDIT_REFUSED}
    try:
        gone = await _run(house_cal_live.release_claim, PG_DSN, location, open_row, col_iso)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"release failed ({type(exc).__name__})"}
    log.info("hub-lanes: housecal claim %s %s / %s / %s by %s",
             "released" if gone else "release found nothing at", location, open_row, col_iso, actor[1])
    if gone:
        _housecal_rang()
    return {"status": 200, "data": {"released": gone, **await _housecal_after(location, who)}}


async def lane_housecal_grid(location: str, request: Request) -> dict[str, Any]:
    """One house's grid with its arithmetic and call-off line; any staff may look, `access` says who edits."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        grid = await _housecal_grid_for(who, location)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"calendar mirror unreadable ({type(exc).__name__})"}
    if grid is None:
        return {"status": 404, "message": "no calendar for that house"}
    return {"status": 200, "data": grid}


_HOUSECAL_EDITS_MOVED = (
    "Calendar Builder → Live no longer changes a roster — calendars are created and edited in "
    "Calendar Builder → Builder, as a draft the house's manager publishes to the workbook. "
    "Open the house there to make this change.")


def _housecal_edits_moved(location: str, col_iso: str = "") -> dict[str, Any]:
    return {"status": 410, "reason": "moved_to_builder", "message": _HOUSECAL_EDITS_MOVED,
            "data": {"path": (calendar_builder_houses.builder_link(location, col_iso) if location else "")}}


async def lane_housecal_cell(request: Request) -> dict[str, Any]:
    """A typed cell: a closed door that says where the edit is made; who may look is asked first."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    body = await _body(request)
    body = body if isinstance(body, dict) else {}
    return _housecal_edits_moved(str(body.get("location") or "").strip(), str(body.get("col_iso") or "").strip())


async def lane_housecal_move(request: Request) -> dict[str, Any]:
    """Drag and drop on House Calendars: a closed door; moving a shift is Calendar Builder's."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    body = await _body(request)
    body = body if isinstance(body, dict) else {}
    dst = body.get("to") or {}
    return _housecal_edits_moved(str(body.get("location") or "").strip(),
                                 str((dst if isinstance(dst, dict) else {}).get("col_iso") or "").strip())


# ---- transfers -----------------------------------------------------------------------------------------------------

_ROSTER: dict[str, Any] = {"at": 0.0, "keys": None, "why": ""}
_ROSTER_LOCK = threading.Lock()
CONTACTS_TTL_S = float(os.getenv("HUB_SMS_EARS_CONTACTS_TTL_S", "300"))
_NOT_STAFF_ROLES = frozenset({"client", "onboarding", "interviewer"})


def _digits(value: Any) -> str:
    d = re.sub(r"\D+", "", str(value if value is not None else ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def _phone_entries(cell: Any) -> list[Any]:
    if isinstance(cell, list):
        return cell
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        return got if isinstance(got, list) else []
    except ValueError:
        parts = [p for p in re.split(r"\s*[;,]\s*", text) if p]
        return [p.split(":", 1)[1].strip() if ":" in p else p.strip() for p in parts]


def _phone_of(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("number") or entry.get("value") or "")
    return str(entry if entry is not None else "")


def _read_roster() -> set[str]:
    """The name keys with a phone on file (hotline_desk._read_roster): the people slice and the accounts."""
    data = json.loads(PEOPLE_PATH.read_text(encoding="utf-8"))
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("The staff roster file carries no rows.")
    accounts = lanes_sheets.data(HUB_DB_SHEET_ID, "users")
    if not accounts:
        raise ValueError("The staff accounts copy holds no rows, so no caller is named.")
    out: set[str] = set()

    def add(name_cell: Any, phone: Any) -> None:
        d = _digits(_phone_of(phone))
        key = re.sub(r"[^a-z0-9]", "", " ".join(str(name_cell or "").split()).lower())
        if d and key:
            out.add(key)

    for r in rows:
        if not isinstance(r, dict):
            continue
        add(r.get("name"), r.get("phone"))
        for entry in _phone_entries(r.get("phones")):
            add(r.get("name"), entry)
    for u in accounts:
        if str(u.get("role") or "").strip().lower() in _NOT_STAFF_ROLES or str(u.get("system_type") or "").strip():
            continue
        add(u.get("display_name"), u.get("phone"))
        for entry in _phone_entries(u.get("phones")):
            add(u.get("display_name"), entry)
    return out


def _reachable_names() -> tuple[set[str] | None, str]:
    """(name keys with a phone on file, why not); None when unreadable, and nobody is refused for it."""
    with _ROSTER_LOCK:
        if _ROSTER["keys"] is not None and time.time() - _ROSTER["at"] < CONTACTS_TTL_S:
            return set(_ROSTER["keys"]), ""
    try:
        keys = _read_roster()
    except Exception as exc:  # noqa: BLE001
        return None, f"who can be reached could not be read ({type(exc).__name__})"
    with _ROSTER_LOCK:
        _ROSTER.update(at=time.time(), keys=keys)
    return set(keys), ""


async def _handoff_may_open(who: dict[str, Any], location: str, giver: str, not_yours: str) -> dict[str, Any] | None:
    try:
        allowed = await _run(shift_handoff.may_open, PG_DSN, who, location=location, giver=giver)
    except shift_handoff.Refused as exc:
        return {"status": 503, "reason": exc.code, "message": exc.why}
    return None if allowed else {"status": 403, "message": not_yours}


def _handoff_refusal(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, shift_handoff.Refused):
        return {"status": 409, "reason": exc.code, "message": exc.why,
                "data": _jsonable([exc.extra])[0] if exc.extra else {}}
    if isinstance(exc, LookupError):
        return {"status": 404, "message": str(exc)}
    if isinstance(exc, ValueError):
        return {"status": 400, "message": str(exc)}
    return {"status": 502, "message": f"the transfer failed ({type(exc).__name__})"}


async def lane_handoff_list(request: Request) -> dict[str, Any]:
    """The transfers still waiting, as this reader may see them."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        data = await _run(shift_handoff.board, PG_DSN, who, location=_q(request, "location"))
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"handoffs unreadable ({type(exc).__name__})"}
    return {"status": 200, "data": {**data, "me": str(who.get("name") or "")}}


async def lane_handoff_swaps(request: Request) -> dict[str, Any]:
    """Calendar Builder → Swaps: the shifts to pick from, the directors list and the company's history."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    if not shift_requests.may_read_requests(who):
        return {"status": 403, "message": _REQUESTS_REFUSED}
    try:
        data = await _run(shift_handoff.swaps_feed, PG_DSN, who)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the swaps could not be read ({type(exc).__name__})"}
    return {"status": 200, "data": _jsonable([data])[0]}


async def lane_handoff_candidates(request: Request) -> dict[str, Any]:
    """The transfer picker's names (shift_handoff.candidates), weighed as the offer will weigh them."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    location, col_iso = _q(request, "location").strip(), _q(request, "col_iso").strip()
    if not location or not col_iso:
        return {"status": 400, "message": "location and col_iso are required"}
    me = str(who.get("name") or "")
    giver = _q(request, "from_staff").strip() or me
    if not giver:
        return {"status": 403, "message": "this account is not on a roster — ask your manager"}
    refused_open = await _handoff_may_open(who, location, giver,
                                           "you can transfer your own shifts — somebody else's is "
                                           "opened by the manager of THAT house, and by nobody else")
    if refused_open:
        return refused_open
    reachable, why = await _run(_reachable_names)
    try:
        data = await _run(shift_handoff.candidates, PG_DSN, location=location, col_iso=col_iso, giver=giver,
                          reachable=reachable, reachable_why=why,
                          detail=shift_requests.may_edit_calendar(who, location), offered_by=me)
    except Exception as exc:  # noqa: BLE001
        return _handoff_refusal(exc)
    return {"status": 200, "data": data}


async def lane_handoff_offer(request: Request) -> dict[str, Any]:
    """Offer a shift to somebody else; nothing moves until all three approve."""
    got = await _housecal_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    to_staff = str(body.get("to_staff") or "").strip()
    if not location or not col_iso or not to_staff:
        return {"status": 400, "message": "location, col_iso and to_staff are required"}
    me = str(who.get("name") or "")
    giver = str(body.get("from_staff") or "").strip() or me
    if not giver:
        return {"status": 403, "message": "this account is not on a roster — ask your manager"}
    refused_open = await _handoff_may_open(who, location, giver,
                                           "you can only transfer your own shift — a colleague's is "
                                           "opened by the manager of that house")
    if refused_open:
        return refused_open
    reachable, _why = await _run(_reachable_names)
    try:
        row = await _run(shift_handoff.offer, PG_DSN, location=location, col_iso=col_iso,
                         from_staff=giver, to_staff=to_staff, offered_by=me or f"account {actor[1]}",
                         created_by=str(actor[1]), reachable=reachable)
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, shift_handoff.Refused) and exc.code in ("overlap", "time_off") \
                and not shift_requests.may_edit_calendar(who, location):
            return {"status": 409, "reason": "unavailable", "data": {},
                    "message": f"{to_staff} cannot take this shift — they are not free then"}
        return _handoff_refusal(exc)
    log.info("hub-lanes: handoff %s offered %s -> %s by %s (%s)", row["id"], giver,
             row["to_staff"], actor[1], row.get("approval_why") or "")
    _notices_wake()
    _housecal_rang()
    return {"status": 200, "data": _jsonable([shift_handoff.describe(row, who)])[0]}


async def lane_handoff_answer(request: Request) -> dict[str, Any]:
    """Answer a transfer from the app, through the same function as SMS replies; the side is the session's."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    hid = str(body.get("handoff_id") or "").strip()
    word = shift_handoff.read_word(body.get("word") or body.get("answer") or "")
    if not hid or word not in ("yes", "no"):
        return {"status": 400, "message": "handoff_id and a yes or no are required"}
    try:
        row = await _run(shift_handoff.handoff, PG_DSN, hid)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"handoff unreadable ({type(exc).__name__})"}
    if not row:
        return {"status": 404, "message": "no such handoff"}
    side = shift_handoff.side_for(who, row)
    if not side:
        return {"status": 403, "message": ("that transfer is not waiting on you — only the person "
                                           "offered the shift accepts it, and its house manager "
                                           "and director each approve it")}
    try:
        res = await _run(shift_handoff.answer, PG_DSN, row["id"], side=side, word=word, via="app",
                         by=str(who.get("name") or f"account {actor[1]}"), master=who.get("is_master") is True)
    except Exception as exc:  # noqa: BLE001
        return _handoff_refusal(exc)
    log.info("hub-lanes: handoff %s %s said %s by %s -> %s", row["id"], side, word, actor[1], res.get("state"))
    _notices_wake()
    _housecal_rang()
    after = await _housecal_after(str(res["location"]), who)
    return {"status": 200, "data": {**_jsonable([shift_handoff.describe(res, who)])[0],
                                    "changed": bool(res.get("changed")),
                                    "computed": after["computed"]}}


async def lane_handoff_withdraw(request: Request) -> dict[str, Any]:
    """Withdraw a transfer; its cell, receiver and training approval are released."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    hid = str(body.get("handoff_id") or "").strip()
    if not hid:
        return {"status": 400, "message": "handoff_id is required"}
    try:
        row = await _run(shift_handoff.handoff, PG_DSN, hid)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"handoff unreadable ({type(exc).__name__})"}
    if not row:
        return {"status": 404, "message": "no such handoff"}
    if not shift_handoff.may_withdraw(who, row):
        return {"status": 403, "message": ("only the person giving the shift, and this house's "
                                           "manager and those above, withdraw a transfer")}
    name = str(who.get("name") or f"account {actor[1]}")
    try:
        res = await _run(shift_handoff.withdraw, PG_DSN, row["id"], by=name)
    except Exception as exc:  # noqa: BLE001
        return _handoff_refusal(exc)
    log.info("hub-lanes: handoff %s withdrawn by %s", row["id"], actor[1])
    _notices_wake()
    _housecal_rang()
    return {"status": 200, "data": _jsonable([shift_handoff.describe(res, who)])[0]}


# ---- Requests ------------------------------------------------------------------------------------------------------

async def _rehearsal_open(request: Request) -> bool:
    """The rehearsal doors' own gate (shift_rehearsal.may_drive): the master's own session alone."""
    s = await _session(request)
    return s is not None and s.is_master is True and not s.acting


async def lane_shift_requests(request: Request) -> dict[str, Any]:
    """The Requests screen, whole. Every panel on it is decided here."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    if not shift_requests.may_read_requests(who):
        return {"status": 403, "message": _REQUESTS_REFUSED}
    try:
        data = await _run(shift_requests.feed, PG_DSN, who=who)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the feed failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"requests unreadable ({type(exc).__name__})"}
    data["rehearsal"] = await _rehearsal_open(request)
    return {"status": 200, "data": data}


async def lane_shift_requests_detail(request: Request) -> dict[str, Any]:
    """One pooled shift as the Requests panel opens it, cut for the reader."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    if not shift_requests.may_read_requests(who):
        return {"status": 403, "message": _REQUESTS_REFUSED}
    ref = _q(request, "ref").strip()
    if not shift_requests.REF_RE.fullmatch(ref):
        return {"status": 400, "message": "ref is required"}
    try:
        data = await _run(shift_requests.shift_detail, PG_DSN, who=who, ref=ref)
    except shift_requests.Refused as exc:
        return {"status": 404 if exc.code == "no_such_shift" else 403, "message": exc.why, "code": exc.code}
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the detail failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"this shift could not be read ({type(exc).__name__})"}
    return {"status": 200, "data": data}


async def lane_shift_requests_apply(request: Request) -> dict[str, Any]:
    """Put a name down for an open or a called-off shift."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    ref = str(body.get("ref") or "").strip()
    location = str(body.get("location") or "").strip()
    open_row = str(body.get("open_row") or "OPEN").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    if ref:
        found = await _run(shift_requests.by_ref, PG_DSN, ref)
        if not found:
            return {"status": 404, "message": "that shift is not open"}
        location, open_row, col_iso = found
    if not location or not col_iso:
        return {"status": 400, "message": "location and col_iso are required"}
    mine = str(who.get("name") or "")
    wanted = str(body.get("person") or "").strip()
    desk = shift_requests.may_decide(who, location)
    if wanted and not desk and wanted.casefold() != mine.casefold():
        return {"status": 403, "message": "you can only apply for yourself"}
    person = wanted or mine
    if not person:
        return {"status": 403, "message": "this account is not on a roster — ask your manager"}
    try:
        row = await _run(shift_requests.apply_for, PG_DSN, location=location, open_row=open_row,
                         col_iso=col_iso, person=person, via="app")
    except shift_requests.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the application failed ({type(exc).__name__})"}
    log.info("hub-lanes: shift request %s / %s / %s by %s (%s) — %s", location, open_row, col_iso, person,
             actor[1], "applied" if row.get("applied") else "already applied")
    if row.get("applied"):
        _notices_wake()
        _housecal_rang()
    if not shift_requests.sees_callers(who, location):
        row = {k: v for k, v in row.items() if k != "open_row"}
    return {"status": 200, "data": _jsonable([row])[0]}


async def lane_shift_requests_withdraw(request: Request) -> dict[str, Any]:
    """Take a name back off. The row stays on the list, as history."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    rid = str(body.get("request_id") or "").strip()
    if not rid:
        return {"status": 400, "message": "request_id is required"}
    owner = await _run(shift_requests.request_row, PG_DSN, rid)
    desk = bool(owner) and shift_requests.may_decide(who, str(owner.get("location") or ""))
    try:
        row = await _run(shift_requests.withdraw, PG_DSN, request_id_=rid,
                         person="" if desk else str(who.get("name") or ""))
    except shift_requests.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the withdrawal failed ({type(exc).__name__})"}
    log.info("hub-lanes: shift request %s withdrawn (%s)", rid, actor[1])
    _notices_wake()
    _housecal_rang()
    if not shift_requests.sees_callers(who, str(row.get("location") or "")):
        row = {k: v for k, v in row.items() if k != "open_row"}
    return {"status": 200, "data": _jsonable([row])[0]}


async def lane_shift_requests_decide(request: Request) -> dict[str, Any]:
    """The house manager's word: this person takes the shift."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    ref = str(body.get("ref") or "").strip()
    location = str(body.get("location") or "").strip()
    open_row = str(body.get("open_row") or "OPEN").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    person = str(body.get("person") or "").strip()
    how = "assigned" if body.get("assign") else "approved"
    if ref:
        found = await _run(shift_requests.by_ref, PG_DSN, ref)
        if not found:
            return {"status": 404, "message": "that shift is not in the pool"}
        location, open_row, col_iso = found
    if not location or not col_iso or not person:
        return {"status": 400, "message": "location, col_iso and person are required"}
    if not shift_requests.may_decide(who, location):
        return {"status": 403,
                "message": ("only this house's manager decides who takes its shifts — the "
                            "hotline calendar's ** row for it, and the administrators")}
    try:
        out = await _run(shift_requests.decide, PG_DSN, location=location, open_row=open_row, col_iso=col_iso,
                         person=person, by=str(who.get("name") or actor[1]), how=how)
    except shift_requests.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the decision failed ({type(exc).__name__})"}
    log.info("hub-lanes: shift request decided %s / %s / %s → %s (%s) by %s", location, open_row, col_iso,
             person, how, actor[1])
    _notices_wake()
    _housecal_rang()
    return {"status": 200, "data": {**out, **await _housecal_after(location, who)}}


async def lane_shift_requests_training(request: Request) -> dict[str, Any]:
    """A house manager takes the training on or not."""
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    body = await _body(request)
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    rid = str(body.get("request_id") or "").strip()
    word = "yes" if str(body.get("word") or "yes").strip().lower() in ("yes", "y", "approve") else "no"
    if not rid:
        return {"status": 400, "message": "request_id is required"}
    owner = await _run(shift_requests.request_row, PG_DSN, rid)
    if not owner:
        return {"status": 404, "message": "that training approval is not waiting"}
    location = str(owner.get("location") or "")
    if not shift_requests.may_decide(who, location):
        return {"status": 403, "message": "only this house's manager may take its training on"}
    try:
        row = await _run(shift_requests.approve_training, PG_DSN, request_id_=rid,
                         by=str(who.get("name") or actor[1]), word=word, location=location)
    except shift_requests.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the approval failed ({type(exc).__name__})"}
    trains = str((row.get("trainer") or {}).get("name") or "")
    log.info("hub-lanes: training approval %s said %s by %s%s", rid, word, actor[1],
             f" — {trains} trains" if trains else "")
    swap = None
    if str(owner.get("ref") or "") == shift_requests.KIND_SWAP:
        try:
            got_swap = await _run(shift_handoff.training_answered, PG_DSN, rid, who=who, word=word)
            swap = _jsonable([shift_handoff.describe(got_swap, who)])[0] if got_swap else None
        except Exception as exc:  # noqa: BLE001 — the training answer itself stands
            log.warning("hub-lanes: the swap behind training %s could not be moved on (%s)", rid,
                        type(exc).__name__)
            swap = {"unreadable": True, "why": f"the training is approved, but the transfer "
                                               f"itself could not be moved on "
                                               f"({type(exc).__name__}) — approve it on its own "
                                               f"row"}
    _notices_wake()
    _housecal_rang()
    return {"status": 200, "data": {**_jsonable([row])[0], "swap": swap}}


# ---- Calendar Builder: the houses ----------------------------------------------------------------------------------

_BUILDER_EDIT_REFUSED = ("only this house's manager builds its calendar — the hotline "
                         f"calendar's ** row for it — and {shift_requests.deciders_all()}")


async def _builder_viewer(request: Request) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    if not shift_requests.may_view_calendars(who):
        return {"status": 403,
                "message": ("The Builder is the house managers' screen — your own shifts "
                            "are on Calendar Builder → Requests")}
    return who, actor


async def _builder_house(request: Request, location: str) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    got = await _builder_viewer(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    if not location:
        return {"status": 400, "message": "name the house"}
    if not shift_requests.may_edit_calendar(who, location):
        return {"status": 403, "message": _BUILDER_EDIT_REFUSED}
    return who, actor


def _builder_name(who: dict[str, Any], actor: tuple[str, str]) -> str:
    return str(who.get("name") or actor[1])


async def _builder_grid_for(who: dict[str, Any], location: str) -> dict[str, Any] | None:
    grid = await _run(calendar_builder_houses.draft_grid, PG_DSN, location, who)
    if grid is None:
        return None
    managers = await _run(shift_requests.house_managers, PG_DSN)
    access = shift_requests.calendar_access(who, location, managers)
    grid["access"] = {k: access[k] for k in ("view", "edit", "why", "me")}
    grid["house_manager"] = access["house_manager"]
    return grid


async def _builder_after(location: str, who: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"grid": await _builder_grid_for(who, location)}
    except Exception as exc:  # noqa: BLE001
        log.warning("calendar-builder: the house could not be re-read after a write (%s)", type(exc).__name__)
        return {"grid": None}


def _builder_refusal(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, house_cal_live.Occupied):
        return {"status": 409, "reason": "occupied", "message": str(exc),
                "data": {"employee": exc.employee, "col_iso": exc.col_iso, "value": exc.value}}
    if isinstance(exc, house_cal_live.OpenShiftCell):
        return {"status": 409, "reason": "open_shift", "message": str(exc)}
    if isinstance(exc, shift_requests.Refused):
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    if isinstance(exc, house_cal_live.WorkbookRefused):
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": {"blocked": exc.blocked}}
    if isinstance(exc, LookupError):
        return {"status": 404, "message": str(exc)}
    if isinstance(exc, ValueError):
        return {"status": 400, "message": str(exc)}
    return {"status": 502, "message": f"the calendar could not be changed ({type(exc).__name__})"}


async def _builder_body(request: Request) -> dict[str, Any] | None:
    body = await _body(request)
    return body if isinstance(body, dict) else None


def _builder_houses_read() -> tuple[list[dict[str, Any]], dict[str, int]]:
    calendar_builder_houses.ensure_tables(PG_DSN)
    rows = _live_grids()
    with lanes_pg.own_connect(PG_DSN) as conn, conn.cursor() as cur:
        counts = calendar_builder_houses.draft_counts_in(cur)
    return rows, counts


async def lane_cal_builder_houses(request: Request) -> dict[str, Any]:
    """The houses this reader builds, or why none."""
    got = await _builder_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        rows, counts = await _run(_builder_houses_read)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the house calendars are unreadable ({type(exc).__name__})"}
    managers = await _run(shift_requests.house_managers, PG_DSN)
    houses = []
    for r in rows:
        location = str(r.get("location") or "")
        access = shift_requests.calendar_access(who, location, managers)
        if not access["edit"]:
            continue
        g = _grid_of(r)
        houses.append({"location": location,
                       "staff": sum(1 for row in g.get("rows", []) or []
                                    if not house_cal_live.not_a_person((row or {}).get("employee"), location)),
                       "updated_at": str(r.get("updated_at") or ""),
                       "may_edit": True, "drafts": counts.get(location, 0),
                       "manager": access["house_manager"]["name"],
                       "managers": access["house_manager"]["names"]})
    if not houses:
        why = ("You manage no house, so there is no calendar here for you to build — a house's "
               f"manager (the hotline calendar's ** row for it) and {shift_requests.deciders_all()} "
               "build calendars")
        if not managers.get("readable"):
            reason = managers.get("why") or "no reason given"
            why += (f"; who manages each house could not be read ({reason}), so a house "
                    f"manager is not recognised until it can")
        return {"status": 403, "message": why}
    return {"status": 200, "data": {
        "houses": houses, "me": str(who.get("name") or ""),
        "edits_every_house": shift_requests.edits_every_house(who),
        "managers_readable": bool(managers.get("readable")),
        "managers_why": str(managers.get("why") or "")}}


async def lane_cal_builder_house(request: Request) -> dict[str, Any]:
    """One house with its draft laid on and every total recomputed."""
    location = _q(request, "location").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    who, _actor = got
    try:
        grid = await _builder_grid_for(who, location)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the house calendar is unreadable ({type(exc).__name__})"}
    if grid is None:
        return {"status": 404, "message": "no calendar for that house"}
    return {"status": 200, "data": grid}


async def lane_cal_builder_staff(request: Request) -> dict[str, Any]:
    """Everybody a house manager may place; the Builder takes a new name from here only."""
    got = await _builder_viewer(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    if not (shift_requests.edits_every_house(who) or who.get("manages")):
        return {"status": 403, "message": _BUILDER_EDIT_REFUSED}
    try:
        return {"status": 200, "data": await _run(calendar_builder_houses.staff_directory, PG_DSN)}
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the staff list is unreadable ({type(exc).__name__})"}


async def lane_cal_builder_history(request: Request) -> dict[str, Any]:
    """One cell's history, newest first."""
    location = _q(request, "location").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    employee, col_iso = _q(request, "employee"), _q(request, "col_iso")
    if not employee.strip() or not col_iso.strip():
        return {"status": 400, "message": "employee and col_iso are required"}
    try:
        rows = await _run(calendar_builder_houses.history, PG_DSN, location, employee.strip(), col_iso.strip(),
                          sees_reasons=bool(got[0].get("sees_reasons")))
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the history is unreadable ({type(exc).__name__})"}
    return {"status": 200, "data": {"history": rows}}


_BUILDER_CELL_VIA = frozenset({"cell", "times", "delete", "add"})


async def lane_cal_builder_house_cell(request: Request) -> dict[str, Any]:
    """Draft one cell; `start`/`end` become the estate's code here, refused if it would read as other hours."""
    body = await _builder_body(request)
    if body is None:
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    who, actor = got
    employee = str(body.get("employee") or "").strip()
    col_iso = str(body.get("col_iso") or "").strip()
    if not employee or not col_iso:
        return {"status": 400, "message": "employee and col_iso are required"}
    via = str(body.get("via") or "cell").strip()
    via = via if via in _BUILDER_CELL_VIA else "cell"
    try:
        if body.get("start") not in (None, "") or body.get("end") not in (None, ""):
            value = calendar_builder_houses.value_from_times(body.get("start"), body.get("end"),
                                                             keep_star=bool(body.get("keep_star")))
            via = "times" if via == "cell" else via
        else:
            value = str(body.get("value") if body.get("value") is not None else "")
        admits = await _run(calendar_builder_houses.admits, PG_DSN)
        out = await _run(calendar_builder_houses.stage_cell, PG_DSN, location=location, employee=employee,
                         col_iso=col_iso, value=value, actor=_builder_name(who, actor),
                         note=str(body.get("note") or ""), via=via, admits=admits)
    except Exception as exc:  # noqa: BLE001 — every refusal said in its own words
        return _builder_refusal(exc)
    if out.get("changed"):
        log.info("calendar-builder: draft %s / %s / %s %r (was %r) by %s", location, out["employee"], col_iso,
                 out["value"], out["was"], actor[1])
        _housecal_rang()
    return {"status": 200, "data": {**out, **await _builder_after(location, who)}}


async def lane_cal_builder_house_move(request: Request) -> dict[str, Any]:
    """Move a shift as one draft act (both cells or neither)."""
    body = await _builder_body(request)
    if body is None:
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    who, actor = got
    src, dst = body.get("from") or {}, body.get("to") or {}
    src_emp, src_iso = str(src.get("employee") or "").strip(), str(src.get("col_iso") or "").strip()
    dst_emp, dst_iso = str(dst.get("employee") or "").strip(), str(dst.get("col_iso") or "").strip()
    if not src_emp or not src_iso or not dst_emp or not dst_iso:
        return {"status": 400, "message": "from and to are required"}
    swap = bool(body.get("swap"))
    try:
        value = None
        if body.get("start") not in (None, "") or body.get("end") not in (None, ""):
            value = calendar_builder_houses.value_from_times(body.get("start"), body.get("end"),
                                                             keep_star=bool(body.get("keep_star")))
        elif body.get("value") is not None:
            value = str(body.get("value"))
        admits = await _run(calendar_builder_houses.admits, PG_DSN)
        out = await _run(calendar_builder_houses.stage_move, PG_DSN, location=location,
                         src_employee=src_emp, src_iso=src_iso, dst_employee=dst_emp, dst_iso=dst_iso,
                         actor=_builder_name(who, actor), swap=swap,
                         replace=bool(body.get("replace")) and not swap, value=value,
                         note=str(body.get("note") or ""), admits=admits)
    except Exception as exc:  # noqa: BLE001
        return _builder_refusal(exc)
    log.info("calendar-builder: draft %s %s / %s %s → %s %s by %s", "swap" if swap else "move", location,
             src_emp, src_iso, dst_emp, dst_iso, actor[1])
    _housecal_rang()
    return {"status": 200, "data": {**out, **await _builder_after(location, who)}}


async def _builder_act(request: Request, run: Callable[[dict[str, Any], dict[str, Any], tuple[str, str]], Any],
                       after: Callable[[dict[str, Any], tuple[str, str], str], None]) -> dict[str, Any]:
    body = await _builder_body(request)
    if body is None:
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    who, actor = got
    try:
        out = await _run(run, body, who, actor)
    except Exception as exc:  # noqa: BLE001
        return _builder_refusal(exc)
    after(out, actor, location)
    return {"status": 200, "data": {**out, **await _builder_after(location, who)}}


async def lane_cal_builder_request_off(request: Request) -> dict[str, Any]:
    """Request Off as a draft: R/O, the shift moved to the first free OPEN row."""
    return await _builder_act(request, lambda b, who, actor: calendar_builder_houses.request_off(
        PG_DSN, location=str(b.get("location") or "").strip(), employee=str(b.get("employee") or ""),
        col_iso=str(b.get("col_iso") or ""), actor=_builder_name(who, actor), note=str(b.get("note") or "")),
        lambda out, actor, location: _housecal_rang())


def _called_off(out: dict[str, Any], actor: tuple[str, str], location: str) -> None:
    # attendance re-reads, a new call-off is a notice to everybody it reaches, and the road is filed now
    live_notify.tell(wake=["attendance", "notices", "calloff_road"], events=["housecal"])


async def lane_cal_builder_call_off(request: Request) -> dict[str, Any]:
    """Mark Call-Off at once: opens the pool's call-off shift and hands the rest to the call-off road."""
    return await _builder_act(request, lambda b, who, actor: calendar_builder_houses.mark_call_off(
        PG_DSN, location=str(b.get("location") or "").strip(), employee=str(b.get("employee") or ""),
        col_iso=str(b.get("col_iso") or ""), actor=_builder_name(who, actor), note=str(b.get("note") or "")),
        _called_off)


async def lane_cal_builder_undo(request: Request) -> dict[str, Any]:
    """Undo this reader's last draft act on the house, whole."""
    return await _builder_act(request, lambda b, who, actor: calendar_builder_houses.undo(
        PG_DSN, location=str(b.get("location") or "").strip(), actor=_builder_name(who, actor)),
        lambda out, actor, location: _housecal_rang())


async def lane_cal_builder_discard(request: Request) -> dict[str, Any]:
    """Throw the house's whole draft away."""
    return await _builder_act(request, lambda b, who, actor: calendar_builder_houses.discard(
        PG_DSN, location=str(b.get("location") or "").strip(), actor=_builder_name(who, actor)),
        lambda out, actor, location: _housecal_rang())


def _published(out: dict[str, Any], actor: tuple[str, str], location: str) -> None:
    if out.get("test_mode"):
        log.info("calendar-builder: %s published in TEST MODE — %d cell(s) recorded on the platform, the "
                 "workbook was NOT written (%d already there), by %s", location, out.get("written", 0),
                 out.get("already", 0), actor[1])
    else:
        log.info("calendar-builder: %s published — %d cell(s) written, %d already there, %d row(s) added, by %s",
                 location, out.get("written", 0), out.get("already", 0), len(out.get("rows_added") or []),
                 actor[1])
    _notices_wake()
    _housecal_rang()


async def lane_cal_builder_house_publish(request: Request) -> dict[str, Any]:
    """Publish one house's draft through the one fail-closed writer; 409 with the cells, nothing half-lands."""
    def run(b: dict[str, Any], who: dict[str, Any], actor: tuple[str, str]) -> Any:
        location = str(b.get("location") or "").strip()
        try:
            return calendar_builder_houses.publish_house(PG_DSN, location=location, actor=_builder_name(who, actor))
        except Exception as exc:
            if not isinstance(exc, (shift_requests.Refused, house_cal_live.WorkbookRefused, LookupError, ValueError)):
                log.warning("calendar-builder: publish of %s failed (%s)", location, type(exc).__name__)
            raise
    return await _builder_act(request, run, _published)


def _held_published(out: dict[str, Any], actor: tuple[str, str], location: str) -> None:
    log.info("calendar-builder: %s — what test mode held published now: %d cell(s) written, %d already there, "
             "by %s", location, out.get("written", 0), out.get("already", 0), actor[1])
    _notices_wake()
    _housecal_rang()


async def lane_cal_builder_held_publish(request: Request) -> dict[str, Any]:
    """Publish what test mode held at this house; refused while test mode is on, nothing half-lands."""
    def run(b: dict[str, Any], who: dict[str, Any], actor: tuple[str, str]) -> Any:
        location = str(b.get("location") or "").strip()
        try:
            return calendar_builder_houses.publish_held(PG_DSN, location=location, actor=_builder_name(who, actor))
        except Exception as exc:
            if not isinstance(exc, (shift_requests.Refused, house_cal_live.WorkbookRefused, LookupError, ValueError)):
                log.warning("calendar-builder: publishing what test mode held at %s failed (%s)", location,
                            type(exc).__name__)
            raise
    return await _builder_act(request, run, _held_published)


async def lane_cal_builder_held_discard(request: Request) -> dict[str, Any]:
    """Discard what test mode held at this house (or only `cells`)."""
    body = await _builder_body(request)
    if body is None:
        return {"status": 400, "message": "invalid body"}
    location = str(body.get("location") or "").strip()
    got = await _builder_house(request, location)
    if isinstance(got, dict):
        return got
    who, actor = got
    cells = body.get("cells")
    if cells is not None and not isinstance(cells, list):
        return {"status": 400, "message": "cells must be a list of {employee, col_iso}"}
    try:
        out = await _run(calendar_builder_houses.discard_held, PG_DSN, location=location,
                         actor=_builder_name(who, actor),
                         cells=[c for c in cells if isinstance(c, dict)] if cells is not None else None)
    except Exception as exc:  # noqa: BLE001
        return _builder_refusal(exc)
    log.info("calendar-builder: %s — %d cell(s) test mode held discarded by %s", location,
             out.get("discarded", 0), actor[1])
    _notices_wake()
    _housecal_rang()
    return {"status": 200, "data": {**out, **await _builder_after(location, who)}}


# ---- Time Off ------------------------------------------------------------------------------------------------------

_TIME_OFF_ROLES_REFUSED = ("client", "guardian", "onboarding", "interviewer")
_TIME_OFF_STATUS = {"not_minted": 503, "unwritable": 503, "unreadable": 503, "missing": 404,
                    "not_allowed": 403, "invalid": 400, "words_needed": 400, "word": 400,
                    "action": 400, "into": 400, "dates": 400, "person": 400, "empty": 400,
                    "unresolved": 400}
_TIME_OFF_FILERS = (("my-calendar", "My Calendar"),)
_TIME_OFF_DECIDERS = (("my-work", "My Work"),)
# the screens that open a request in Time Off's own panel, in place (time_off.detail still shows only what the reader
# may see)
_TIME_OFF_PANEL_HOSTS = _TIME_OFF_FILERS + _TIME_OFF_DECIDERS


async def _time_off_gate(request: Request, hosts: tuple[tuple[str, str], ...] = ()
                         ) -> tuple[str, str] | dict[str, Any]:
    """(role, uid) when Time Off's own gate, or a screen in `hosts`, opens to the session; else Time Off's refusal."""
    actor = await _app_gate(request, "timeoff", refuse_roles=_TIME_OFF_ROLES_REFUSED, app_label="Time Off")
    if not isinstance(actor, dict) or actor.get("status") != 403:
        return actor
    for app_id, label in hosts:
        via = await _app_gate(request, app_id, refuse_roles=_TIME_OFF_ROLES_REFUSED, app_label=label)
        if not isinstance(via, dict):
            return via
    return actor


async def _time_off_reader(request: Request, hosts: tuple[tuple[str, str], ...] = ()
                           ) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    actor = await _time_off_gate(request, hosts)
    if isinstance(actor, dict):
        return _daily_refusal(actor)
    got = await _requests_viewer(request)
    if isinstance(got, dict):
        return {**got, "reason": got.get("reason") or "unreadable"}
    who, session = got
    if time_off.refused_reader(who):
        return {"status": 403, "reason": "badge", "message": "Time Off is the staff's screen."}
    return who, session


def _time_off_answer(exc: Exception, what: str) -> dict[str, Any]:
    if isinstance(exc, time_off.Refused):
        data = {k: v for k, v in (exc.extra or {}).items() if k in ("refusals", "preview", "names")}
        return {"status": _TIME_OFF_STATUS.get(exc.code, 409), "reason": exc.code, "message": exc.why, "data": data}
    if isinstance(exc, time_off.Unreadable):
        return {"status": 503, "reason": "unreadable", "message": f"{str(exc)} — {what}."}
    log.warning("time off: %s failed (%s)", what, type(exc).__name__)
    return {"status": 503, "reason": "unreadable", "message": f"{what} could not be done ({type(exc).__name__})."}


async def _time_off_body(request: Request) -> dict[str, Any] | None:
    body = await _body(request)
    return body if isinstance(body, dict) else None


async def lane_time_off(request: Request, response: Response) -> dict[str, Any]:
    """The app's feed: the black band, the rows and the reader's own reach, cut per reader."""
    response.headers["Cache-Control"] = "no-store"
    got = await _time_off_reader(request)
    if isinstance(got, dict):
        return got
    who, _session_ = got
    try:
        data = await _run(time_off.feed, PG_DSN, who, house=_q(request, "house")[:40])
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "time off could not be shown")
    return {"status": 200, "data": data}


async def lane_time_off_detail(request: Request, response: Response) -> dict[str, Any]:
    """One request, opened: the timeline, the legs, what approving does; the reason only to its readers."""
    response.headers["Cache-Control"] = "no-store"
    got = await _time_off_reader(request, _TIME_OFF_PANEL_HOSTS)
    if isinstance(got, dict):
        return got
    who, _session_ = got
    ref = _q(request, "ref").strip().upper()
    if not time_off.REF_RE.fullmatch(ref):
        return {"status": 400, "reason": "request", "message": "ref is required (TO…)"}
    try:
        data = await _run(time_off.detail, PG_DSN, who, ref)
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "this request could not be read")
    if data.get("status"):
        # the operator's panel, whatever the request's status: its shifts on Scheduling's calendars and the person's
        # approved days that year
        import time_off_approved  # noqa: PLC0415 - Scheduling's reads load with the first approved panel
        try:
            data["approved"] = await _run(time_off_approved.of_detail, data)
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said on the panel, the request still opens
            why = f"the Scheduling calendars could not be read ({type(exc).__name__})"
            data["approved"] = {"year": None, "year_days": None, "year_why": why, "shifts": None, "shifts_why": why}
    return {"status": 200, "data": data}


async def lane_time_off_request(request: Request, response: Response) -> dict[str, Any]:
    """File time off (or preview it with dry_run); every refusal is said before anything is written."""
    response.headers["Cache-Control"] = "no-store"
    got = await _time_off_reader(request, _TIME_OFF_FILERS)
    if isinstance(got, dict):
        return got
    who, session = got
    body = await _time_off_body(request)
    if body is None:
        return {"status": 400, "reason": "request", "message": "invalid body"}
    try:
        if body.get("dry_run"):
            data = await _run(time_off.preview, PG_DSN, who, body)
            return {"status": 200, "data": data}
        filed = await _run(time_off.request, PG_DSN, who, body)
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "the request could not be filed")
    log.info("time off: %s filed by %s", filed["ref"], session[1])
    _time_off_changed()
    return {"status": 200, "data": {"ref": filed["ref"], "asked": filed["asked"],
                                    "row": time_off.shape(filed["row"], who, [], None)}}


async def _time_off_act(request: Request, what: str, run: Callable[..., Any],
                        hosts: tuple[tuple[str, str], ...] = ()) -> dict[str, Any]:
    got = await _time_off_reader(request, hosts)
    if isinstance(got, dict):
        return got
    who, session = got
    body = await _time_off_body(request)
    if body is None:
        return {"status": 400, "reason": "request", "message": "invalid body"}
    ref = str(body.get("ref") or "").strip().upper()
    if not time_off.REF_RE.fullmatch(ref):
        return {"status": 400, "reason": "request", "message": "ref is required (TO…)"}
    try:
        row = await _run(run, who, ref, body)
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, what)
    log.info("time off: %s %s by %s → %s", ref, what, session[1], row.get("status"))
    _time_off_changed()
    return {"status": 200, "data": time_off.shape(row, who, [], None)}


async def lane_time_off_decide(request: Request) -> dict[str, Any]:
    """Approve or deny the half this reader may decide — the leg is the server's choice, never the body's."""
    def run(who: dict[str, Any], ref: str, body: dict[str, Any]) -> dict[str, Any]:
        via = "email" if str(body.get("via") or "") == "email" else "platform"
        return time_off.decide(PG_DSN, who, ref, str(body.get("word") or ""), str(body.get("note") or ""), via)
    return await _time_off_act(request, "the decision", run, _TIME_OFF_DECIDERS)


async def lane_time_off_withdraw(request: Request) -> dict[str, Any]:
    def run(who: dict[str, Any], ref: str, body: dict[str, Any]) -> dict[str, Any]:
        return time_off.withdraw(PG_DSN, who, ref, str(body.get("note") or ""))
    return await _time_off_act(request, "the withdrawal", run, _TIME_OFF_FILERS)


async def lane_time_off_cancel(request: Request) -> dict[str, Any]:
    def run(who: dict[str, Any], ref: str, body: dict[str, Any]) -> dict[str, Any]:
        return time_off.cancel(PG_DSN, who, ref, str(body.get("note") or ""))
    return await _time_off_act(request, "the cancellation", run)


async def lane_time_off_review(request: Request) -> dict[str, Any]:
    def run(who: dict[str, Any], ref: str, body: dict[str, Any]) -> dict[str, Any]:
        return time_off.review(PG_DSN, who, ref, str(body.get("action") or ""),
                               person=str(body.get("person") or ""), start=str(body.get("start") or ""),
                               end=str(body.get("end") or ""), into=str(body.get("into") or ""),
                               note=str(body.get("note") or ""))
    return await _time_off_act(request, "the review", run)


def _time_off_admin(who: dict[str, Any]) -> bool:
    # Settings › Time Off is the master's and the Platform Lead's (the operator, 10-30: hidden for the directors down)
    worn = {str(b).strip().upper() for b in who.get("badges") or []}
    return "MASTER" in worn or (str(who.get("role") or "").strip().lower() == "admin" and "PLATFORMLEAD" in worn)


async def lane_time_off_settings(request: Request) -> dict[str, Any]:
    got = await _time_off_reader(request)
    if isinstance(got, dict):
        return got
    who, _session_ = got
    if not _time_off_admin(who):
        return {"status": 403, "reason": "badge", "message": "The Time Off settings are the administrators'."}
    try:
        data = await _run(time_off.settings_state, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "the settings could not be read")
    return {"status": 200, "data": data}


async def lane_time_off_discard_test(request: Request) -> dict[str, Any]:
    """Close every open request filed in test mode, at go-live; the administrators' door."""
    got = await _time_off_reader(request)
    if isinstance(got, dict):
        return got
    who, session = got
    if not _time_off_admin(who):
        return {"status": 403, "reason": "badge", "message": "Discarding the test rows is the administrators'."}
    body = await _time_off_body(request) or {}
    try:
        data = await _run(time_off.discard_test_rows, PG_DSN, {**who, "decides_everywhere": True},
                          str(body.get("note") or "")[:300])
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "the test rows could not be discarded")
    log.info("time off: %s test row(s) discarded by %s", len(data["discarded"]), session[1])
    if data["discarded"]:
        _time_off_changed()
    return {"status": 200, "data": data}


async def lane_time_off_settings_save(request: Request) -> dict[str, Any]:
    got = await _time_off_reader(request)
    if isinstance(got, dict):
        return got
    who, session = got
    if not _time_off_admin(who):
        return {"status": 403, "reason": "badge", "message": "The Time Off settings are the administrators'."}
    body = await _time_off_body(request)
    if body is None:
        return {"status": 400, "reason": "request", "message": "invalid body"}
    try:
        data = await _run(time_off.save_settings, PG_DSN, {**who, "decides_everywhere": True}, body)
    except Exception as exc:  # noqa: BLE001
        return _time_off_answer(exc, "the settings could not be saved")
    log.info("time off: settings saved by %s", session[1])
    return {"status": 200, "data": data}


def _service_ok(body: dict[str, Any]) -> bool:
    given = str(body.get("service_secret") or "")
    return bool(SERVICE_SECRET) and hmac.compare_digest(given, SERVICE_SECRET)


async def lane_time_off_away(request: Request) -> dict[str, Any]:
    """Who is on scheduled time off in a range — the URGENT blast's one question; service identity only."""
    body = await _time_off_body(request) or {}
    if not _service_ok(body):
        return {"status": 401, "message": "service identity required"}
    lo = time_off.day_of(body.get("from"))
    hi = time_off.day_of(body.get("to")) or lo
    if lo is None or hi is None or hi < lo:
        return {"status": 400, "message": "from and to (YYYY-MM-DD) are required"}
    try:
        away = await _run(time_off.away, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"who is on approved time off could not be read ({type(exc).__name__})"}
    keys, names = [], []
    for key, spans in away.items():
        for i in spans:
            a, b = time_off.day_of(i["col_iso"]), time_off.day_of(i["until"])
            if a and b and a <= hi and lo <= b:
                keys.append(key)
                names.append(i["employee"])
                break
    return {"status": 200, "data": {"readable": True, "keys": sorted(set(keys)), "names": sorted(set(names))}}


# ---- the doors -----------------------------------------------------------------------------------------------------

ROUTES: tuple[tuple[str, str, Callable[..., Any]], ...] = (
    ("GET", "/hub-lanes/housecal", lane_housecal_list),
    ("GET", "/hub-lanes/houses/mine", lane_houses_mine),
    ("GET", "/hub-lanes/housecal/open", lane_housecal_open),
    ("GET", "/hub-lanes/housecal/ref/{ref}", lane_housecal_ref),
    ("POST", "/hub-lanes/housecal/claim", lane_housecal_claim),
    ("POST", "/hub-lanes/housecal/claim/release", lane_housecal_claim_release),
    ("GET", "/hub-lanes/shift-handoff", lane_handoff_list),
    ("GET", "/hub-lanes/shift-handoff/swaps", lane_handoff_swaps),
    ("GET", "/hub-lanes/shift-handoff/candidates", lane_handoff_candidates),
    ("POST", "/hub-lanes/shift-handoff", lane_handoff_offer),
    ("POST", "/hub-lanes/shift-handoff/answer", lane_handoff_answer),
    ("POST", "/hub-lanes/shift-handoff/withdraw", lane_handoff_withdraw),
    ("GET", "/hub-lanes/shift-requests", lane_shift_requests),
    ("GET", "/hub-lanes/shift-requests/detail", lane_shift_requests_detail),
    ("POST", "/hub-lanes/shift-requests/apply", lane_shift_requests_apply),
    ("POST", "/hub-lanes/shift-requests/withdraw", lane_shift_requests_withdraw),
    ("POST", "/hub-lanes/shift-requests/decide", lane_shift_requests_decide),
    ("POST", "/hub-lanes/shift-requests/training", lane_shift_requests_training),
    ("GET", "/hub-lanes/housecal/{location}", lane_housecal_grid),
    ("POST", "/hub-lanes/housecal/cell", lane_housecal_cell),
    ("POST", "/hub-lanes/housecal/move", lane_housecal_move),
    ("GET", "/hub-lanes/calendar-builder/houses", lane_cal_builder_houses),
    ("GET", "/hub-lanes/calendar-builder/house", lane_cal_builder_house),
    ("GET", "/hub-lanes/calendar-builder/staff", lane_cal_builder_staff),
    ("GET", "/hub-lanes/calendar-builder/house-history", lane_cal_builder_history),
    ("POST", "/hub-lanes/calendar-builder/house/cell", lane_cal_builder_house_cell),
    ("POST", "/hub-lanes/calendar-builder/house/move", lane_cal_builder_house_move),
    ("POST", "/hub-lanes/calendar-builder/house/request-off", lane_cal_builder_request_off),
    ("POST", "/hub-lanes/calendar-builder/house/call-off", lane_cal_builder_call_off),
    ("POST", "/hub-lanes/calendar-builder/house/undo", lane_cal_builder_undo),
    ("POST", "/hub-lanes/calendar-builder/house/discard", lane_cal_builder_discard),
    ("POST", "/hub-lanes/calendar-builder/house/publish", lane_cal_builder_house_publish),
    ("POST", "/hub-lanes/calendar-builder/house/held/publish", lane_cal_builder_held_publish),
    ("POST", "/hub-lanes/calendar-builder/house/held/discard", lane_cal_builder_held_discard),
    ("GET", "/hub-lanes/time-off", lane_time_off),
    ("GET", "/hub-lanes/time-off/detail", lane_time_off_detail),
    ("POST", "/hub-lanes/time-off/request", lane_time_off_request),
    ("POST", "/hub-lanes/time-off/decide", lane_time_off_decide),
    ("POST", "/hub-lanes/time-off/withdraw", lane_time_off_withdraw),
    ("POST", "/hub-lanes/time-off/cancel", lane_time_off_cancel),
    ("POST", "/hub-lanes/time-off/review", lane_time_off_review),
    ("GET", "/hub-lanes/time-off/settings", lane_time_off_settings),
    ("POST", "/hub-lanes/time-off/discard-test", lane_time_off_discard_test),
    ("POST", "/hub-lanes/time-off/settings", lane_time_off_settings_save),
    ("POST", "/hub-lanes/time-off/away", lane_time_off_away),
)


def wire(main: Any) -> None:
    """The translated lanes' hooks, as the relay hands them at start: the test mode switch, the roster's listeners,
    time off's door to the app and test mode's mockup keeper."""
    global M
    M = main
    effective_roster.use_switch(_test_switch)
    effective_roster.on_change(_roster_published)
    time_off.KEEPER[0] = _keeper
    calendar_builder_houses.HELD_ROSTER[0] = _held_roster
    time_off.NOTICES[0] = _notices_wake


def install(app: Any, main: Any) -> None:
    """Every scheduling lane on main.py's app, before the relay carrier."""
    wire(main)
    for method, path, fn in ROUTES:
        (app.get if method == "GET" else app.post)(path)(fn)
