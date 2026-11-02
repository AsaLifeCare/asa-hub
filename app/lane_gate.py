"""The relay's gates for its /hub-lanes doors, on Python's own verdicts: the session (front_door.session), the master,
App Control's access to one app worded as the relay's access gate words it (server/hotline_desk.py app_access, read
off asa-hub-db, the record), the reader the Requests lanes are cut for (shift_requests.viewer, app/my_work.who_of),
test mode as the relay resolves it, and Python's own doors asked in-process (front_door.call_app)."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Any, Callable

from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import front_door as FD
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc

log = logging.getLogger("asa-hub-app.lanes")

SIGN_IN = {"status": 401, "reason": "session", "message": "sign in first"}
UNKNOWN_LANE = {"status": 404, "reason": "unknown", "message": "Unknown lane."}
NO_STORE = {"Cache-Control": "no-store"}

# server/hotline_desk.py: the labels it names an app by, the roles kept to their own allow-list, the apps a place
# always operates
APP_LABELS = {"smartcomms": "Smart Comms", "clients": "Client Care"}
CONTAINED_ROLES = frozenset({"client", "onboarding", "interviewer"})
TENANT_BASIC_APPS = frozenset({"myasa", "users", "chat", "suggestions", "teamboard", "calendar", "playground"})
# snapshot_service._daily_refusal
REFUSAL_REASONS = ("session", "badge", "stale", "unreadable", "restricted")


# ---- the answer ------------------------------------------------------------------------------------------------------

def answer(env: Any, *, no_store: bool = False) -> Response:
    """A relay lane's answer: its envelope as FastAPI renders a returned dict, always HTTP 200."""
    body = json.dumps(env, ensure_ascii=False, allow_nan=False, separators=(",", ":"), default=str).encode("utf-8")
    return Response(content=body, media_type="application/json", headers=dict(NO_STORE) if no_store else None)


INVALID = object()


async def body_json(request: Any) -> Any:
    """request.json(), INVALID when the body is not JSON."""
    try:
        raw = await request.body()
        return json.loads(raw) if raw else INVALID
    except ValueError:
        return INVALID


def query(request: Any, name: str) -> str:
    try:
        return str(request.query_params.get(name) or "")
    except Exception:  # noqa: BLE001 - a request without a query string
        return ""


# ---- the session -----------------------------------------------------------------------------------------------------

def token_of(request: Any) -> str:
    """_hotline_token: the bearer the Authorization header carries."""
    authorization = str(request.headers.get("authorization") or "")
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


async def session(token: str) -> FD.Session | None:
    """The front door's verdict on this token, held as it holds it; None when it could not be read."""
    return await FD.session(token) if token else None


def actor(s: FD.Session | None) -> tuple[str, str] | None:
    """_session_actor: (role, uid) for a live session."""
    return (s.role, s.uid) if s is not None and s.ok else None


def is_master(s: FD.Session | None) -> bool:
    """_app_pack_master: the master's own session, never one minted from it."""
    return s is not None and s.master


def user_of(s: FD.Session, action: str = "", *, is_master: bool | None = None) -> dict[str, Any]:
    """The identity Python's doors are told (front_door.said), the relay's own flag in place of the master's when
    it named one."""
    user = FD.said(s, {}, action)
    if is_master is not None and not user.get("acting"):
        user["is_master"] = bool(is_master) and s.master
    return user


def write_id(*parts: Any) -> str:
    return "W" + hashlib.sha256("|".join([*(str(p) for p in parts), str(time.time_ns())]).encode()).hexdigest()[:24]


async def python(app_id: str, action: str, user: dict[str, Any], payload: dict[str, Any], *,
                 write: str = "") -> dict[str, Any] | None:
    """Python's own door asked in-process, as the relay's _backend_call asked it over HTTP: its envelope, or None
    when it deferred. A write it did not answer is let go whole."""
    try:
        got = await FD.call_app(app_id, action, user, payload, write, FD.people_at())
    except Exception as exc:  # noqa: BLE001 - said by the caller, as a door that did not answer
        log.warning("lanes: %s not answered by Python (%s)", action, type(exc).__name__)
        got = None
    if got is None:
        if write:
            FD.settle_void_soon(app_id, write)
        return None
    env = dict(got[2])
    env.pop("_write", None)
    return env


def in_reads(fn: Callable[[L.Reads], Any]) -> Any:
    """Blocking: fn over one request's reads of asa-hub-db, every write Python accepted and every edit it keeps laid,
    as main.py's doors read."""
    M = FD.M
    books: set[str] = set()
    token = hubdb.READ_BOOKS.set(books)
    own_token = None
    try:
        own_token = hubdb.OWN.set(M._own())
        return fn(L.Reads(M.DB, M.DRIVE))
    finally:
        if own_token is not None:
            hubdb.OWN.reset(own_token)
        hubdb.READ_BOOKS.reset(token)


def in_session(s: FD.Session, fn: Callable[[L.Session], Any], action: str = "") -> Any:
    """Blocking: fn over a session built as main.py builds a door's caller (main.caller) from the verdict."""
    M = FD.M

    def run(reads: L.Reads) -> Any:
        return fn(L.Session(reads, M.caller(user_of(s, action), reads)))
    return in_reads(run)


# ---- the access gate: server/hotline_desk.py app_access on asa-hub-db ------------------------------------------------

def _words(cell: Any) -> list[str]:
    """A badge cell ("ADMIN, MANAGER") as its words, upper-cased."""
    if isinstance(cell, list):
        cell = ",".join(str(x) for x in cell)
    return [b.strip().upper() for b in re.split(r"[,;|\n]+", str(cell if cell is not None else "")) if b.strip()]


def _list_cell(cell: Any) -> list[str]:
    """A list written into a cell — JSON text, a real list, or comma separated."""
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


def _inactive(v: Any) -> bool:
    return v is False or str(v if v is not None else "").strip().lower() == "false"


def _with_followed(worn: set[str]) -> set[str]:
    out = {str(w).strip().upper() for w in worn if str(w).strip()}
    for word in list(out):
        stands = sc.BADGE_FOLLOWS.get(word)
        if stands:
            out.add(stands)
    return out


def _cut(reads: L.Reads, uid: str, app_id: str) -> bool:
    """Settings › My Work's app list keeps this app to the master's own session, and this account is not on its seen
    list; FAIL-OPEN, as the relay's _lane_app_cut."""
    try:
        cfg = reads.config()
    except Exception:  # noqa: BLE001 - an unread list cuts nothing
        return False
    return app_id in sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY)) and uid not in sc.list_cell(
        cfg.get(sc.MYWORK_APPS_SEEN_KEY))


def _last_of(reads: L.Reads, tab: str, app_id: str, column: str) -> Any:
    """The cell of the last row of `tab` naming this app (the last row wins, as on the rest of the shelf)."""
    res = HT.where(reads, tab)
    if res.ref is None:
        if tab == "app_badge_access":
            raise hubdb.Unreadable("App Control's badge rows are not in asa-hub-db")
        return None
    got = None
    for row in reads.db.normalized_rows(res.ref):
        if gsjs.str_(row.get("appid")) == app_id:
            got = row.get(column)
    return got


def app_access(reads: L.Reads, uid: str, role: str, app_id: str, *, master: bool,
               refuse_roles: tuple[str, ...] | list[str] | frozenset[str] = (),
               app_label: str = "") -> dict[str, Any]:
    """{open, reason, why}: App Control's verdict on one app for this account, in the relay's access gate's words."""
    label = app_label or APP_LABELS.get(app_id) or app_id

    def closed(reason: str, why: str) -> dict[str, Any]:
        return {"open": False, "reason": reason, "why": why}

    def opened(why: str) -> dict[str, Any]:
        return {"open": True, "reason": "", "why": why}

    uid = str(uid or "").strip()
    session_role = str(role or "").strip().lower()
    refused = {str(r).strip().lower() for r in refuse_roles if str(r).strip()}
    if not uid and not session_role:
        return closed("session", "This session carries no account.")
    if session_role in refused:
        return closed("restricted", f"{label} is not served to the {session_role} role here.")
    if master:
        return opened("the master's view is never narrowed")
    if not uid:
        return closed("session", "This session carries no account id, so the door stays closed.")
    if _cut(reads, uid, app_id):
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    try:
        user = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid), None)
        rule = _words(_last_of(reads, "app_badge_access", app_id, "badges"))
        tenants = _list_cell(_last_of(reads, "app_tenant_access", app_id, "tenants"))
    except Exception as exc:  # noqa: BLE001 - a gate that cannot read stays shut, and says so
        return closed("unreadable", f"The access record could not be read ({type(exc).__name__}). "
                                    "So the door stays closed.")
    if user is None:
        return closed("session", "This account is not in the access record, so the door stays closed.")
    rule = [sc.BADGE_RENAMED.get(w, w) for w in rule]
    if _inactive(user.get("active")):
        return closed("restricted", "This account is not active.")
    if app_id in _list_cell(user.get("appdenials")):
        return closed("badge", f"{label} was removed from this account in App Access.")
    account_role = gsjs.str_(user.get("role")).strip().lower()
    if account_role in refused:
        return closed("restricted", f"{label} is not served to the {account_role} role here.")
    worn = {sc.BADGE_RENAMED.get(w, w) for w in _words(user.get("types"))}
    for word in sorted({session_role, account_role} & CONTAINED_ROLES):
        # a client-role SSA or FAMILY is contained by its own badge where the row names it (the FIX BADGES sheet)
        if word.upper() not in rule and not worn & set(sc.FAMILY_TICKS) & set(rule):
            return closed("restricted", f"{label} is not open to {word} accounts unless App Access names that role.")
    home = gsjs.str_(user.get("hometenant")).strip()
    if home and tenants and app_id not in TENANT_BASIC_APPS and home not in tenants:
        return closed("restricted", f"{label} is not installed for this account's home tenant.")
    if not rule:
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    # the role word counts as a badge, but not one a family account wears for another column (scope.role_counts)
    for word in (session_role, account_role):
        if word and sc.role_counts(user.get("types"), word):
            worn.add(word.upper())
    if _with_followed(worn) & set(rule):
        return opened("badge")
    return closed("badge", f"{label} is not open to this account's badges.")


async def gate(s: FD.Session | None, app_id: str, *, refuse_roles: tuple[str, ...] = (),
               app_label: str = "") -> tuple[str, str] | dict[str, Any]:
    """_hotline_actor: (role, uid) when the session may open `app_id`, else the refusal envelope."""
    who = actor(s)
    if who is None:
        return dict(SIGN_IN)
    try:
        verdict = await run_in_threadpool(in_reads, lambda reads: app_access(
            reads, who[1], who[0], app_id, master=is_master(s), refuse_roles=refuse_roles, app_label=app_label))
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        log.warning("lanes: access check failed: %s", type(exc).__name__)
        return {"status": 403, "reason": "unreadable",
                "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."}
    if not verdict.get("open"):
        return {"status": 403, "reason": str(verdict.get("reason") or "badge"),
                "message": str(verdict.get("why") or "This app is not open to you.")}
    return who


# snapshot_service._APP_PACK_ROLES_REFUSED and _APP_PACK_NARROW_TYPES
RELEASE_ROLES_REFUSED = ("client", "guardian", "onboarding", "interviewer")
NARROW_TYPES = frozenset({"CLIENT", "FAMILY", "SSA"})


def wide_types(reads: L.Reads, uid: str, app_id: str) -> bool:
    """FAIL-CLOSED: the account's recorded badges hold none that narrows it, or one besides is released to the app."""
    user = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == str(uid or "").strip()), None)
    if user is None:
        return False
    role = gsjs.str_(user.get("role")).strip().lower()
    if role in RELEASE_ROLES_REFUSED:
        return False
    ticked = _with_followed({sc.BADGE_RENAMED.get(w, w) for w in _words(user.get("types"))})
    if not ticked & NARROW_TYPES:
        return True
    released = set(_words(_last_of(reads, "app_badge_access", app_id, "badges")))
    return bool((ticked - NARROW_TYPES) & released)


async def released(s: FD.Session | None, app_id: str) -> bool:
    """_app_pack_released: App Control releases `app_id` to one of the session's badges, and none of them narrows
    what it reads; FAIL-CLOSED."""
    try:
        who = await gate(s, app_id, refuse_roles=RELEASE_ROLES_REFUSED)
        if isinstance(who, dict):
            return False
        return await run_in_threadpool(in_reads, lambda reads: wide_types(reads, who[1], app_id)) is True
    except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
        log.warning("lanes: the release check failed (%s)", type(exc).__name__)
        return False


def refusal(env: dict[str, Any]) -> dict[str, Any]:
    """_daily_refusal: a gate's refusal with its `reason`, named here when the gate did not."""
    if env.get("reason") in REFUSAL_REASONS:
        return env
    status = env.get("status")
    if status == 401:
        reason = "session"
    elif status == 403:
        text = str(env.get("message") or "").lower()
        reason = ("session" if "no account" in text else "stale" if "too old" in text
                  else "unreadable" if ("could not be read" in text or "cannot be read" in text)
                  else "badge")
    else:
        reason = "unreadable"
    return {**env, "reason": reason}


# ---- the Requests lanes' reader --------------------------------------------------------------------------------------

async def viewer(s: FD.Session | None) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    """_requests_viewer: (who is reading, the session) or a refusal envelope."""
    who = actor(s)
    if who is None:
        return {"status": 401, "message": "sign in first"}
    import my_work as MW  # noqa: PLC0415 - the reader's one home

    def read(sess: L.Session) -> dict[str, Any]:
        return MW.who_of(MW.HubBooks(sess.reads), sess.user or {})

    try:
        got = await run_in_threadpool(in_session, s, read)
    except MW.Refused as exc:
        return {k: v for k, v in exc.env.items() if k != "reason"}
    except Exception as exc:  # noqa: BLE001 - an unreadable name is not "not on a roster"
        log.warning("lanes: the roster name could not be read (%s)", type(exc).__name__)
        return {"status": 502, "message": f"your roster name could not be read ({type(exc).__name__})"}
    return got, who


# ---- test mode -------------------------------------------------------------------------------------------------------

def switch(reads: L.Reads) -> dict[str, Any]:
    """_web_switch: {on, readable, word, why}, `on` unless the configuration plainly says off."""
    import mw_roster  # noqa: PLC0415 - the switch's one reading of the config

    er = mw_roster.effective_roster
    try:
        return er.switch_from_lane(er.lane_test_mode(reads.config()))
    except Exception as exc:  # noqa: BLE001 - an unread switch holds
        return {"on": True, "readable": False, "word": "unreadable",
                "why": f"the switch could not be read ({type(exc).__name__})"}
