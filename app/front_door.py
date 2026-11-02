"""asa-hub-app's own front door: the browser's /gas and nginx's slice gate (/auth), answered here.

Ports the relay's gas_relay (server/snapshot_service.py) up to Python's doors: its guards in its order
(_relay_app_access_refusal, _master_sign_in_refusal, _acting_refusal, _master_account_refusal) with its answers, its
session gate (_session_actor) on Python's own verdict, the identity it hands Python (_backend_user, _acting_user) built
here in-process, and the tails of _backend_answer, _backend_write and _auth_py_answer with their receipts, write ids,
settles and voids. What the relay still does once Python has answered (its kept copies, packs, rings and sign-in
tables) is asked of it at /front-door/finish (server/front_door_finish.py). Everything this door does not own yet goes
to the relay's /gas unchanged and comes back as the relay answered it. And GET /auth is the relay's, on the same
verdicts.

What is answered here is front_door_routes.json (tools/emit-front-door-routes.py, read off the relay) less the rungs
the relay keeps (`relay_first`, `relay_shaped` but the writes a preparation or a preread alone shapes, prepared here)
and HOLD; to answer one more here, port its rung into RUNGS or take it out of HOLD."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import tempfile
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import app_control
import auth_doors
import gsjs
import hubdb
import locations as L
import scope as sc
import slice_gate
import smart_comms
import sys_log

log = logging.getLogger("asa-hub-app.front-door")

ROUTES = json.loads(Path(os.getenv("HUB_FRONT_DOOR_ROUTES") or Path(__file__).resolve().parent /
                         "front_door_routes.json").read_text(encoding="utf-8"))
# a session's verdict held this long here (the relay held its own 300 s); one minted from the master's own never past
# its own end, and every one a sign-out, a release or an account write may have changed let go at once
SESSION_TTL_S = float(os.getenv("HUB_FRONT_DOOR_SESSION_TTL_S", "60"))
# the slice gate's brief refusal when no verdict could be read (the relay's _validate placeholder)
GATE_UNSURE_S = 20.0
SESSIONS_MAX = 5000
# the relay's files beside its kept packs: who reads what last changed, and the places the master signed in from
PACKS_DIR = Path(os.getenv("HUB_APP_PACK_DIR", "/srv/app-packs"))
PEOPLE_FILE = "who-reads-what.json"
SETTLE_S = float(os.getenv("HUB_APP_SETTLE_S", "900"))
MASTER_SIGN_IN_PATH = Path(os.getenv("HUB_MASTER_SIGN_IN_PATH", str(PACKS_DIR / "master-sign-in.json")))
# the relay's own key for an address (_master_sign_in_addr), so both read one file
SIGN_IN_KEY = (os.getenv("HUB_SERVICE_SECRET", "") or "hub-relay").encode()
MANIFEST_PATH = Path(os.getenv("HUB_SNAPSHOT_MANIFEST", "/srv/manifests/snapshot-manifest.json"))
# doPost's cap on an envelope read whole (the relay's CERT_PAPERS_MAX_BODY); past it the relay decides
WHOLE_MAX = 32 * 1024 * 1024
HEAD_BYTES = 4096
MASTER_IDS_TTL_S = 300.0
AC_WRITERS_TTL_S = 180.0

# ---- the relay's own words ------------------------------------------------------------------------------------------
UNKNOWN_ACTION = {"status": 404, "message": "Unknown action."}
ACCOUNTS_UNREAD = {"status": 503, "message": "The accounts could not be read — try again."}
UNWRITTEN = {"status": 503, "message": "This change could not be saved just now, and nothing was written. Try again in "
                                       "a moment."}
UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
AUTH_UNAVAILABLE = {"status": 503, "message": "Signing in is not available just now. Try again in a moment."}
AUTH_ENDED = {"status": 401, "message": "Authentication required."}
FORGOT_SENT = {"status": 200, "data": {"sent": True}}
# an action no door here answers, as every app says it
NO_DOOR = {"status": 404, "message": "Unknown action."}
HAND_BACK = 409
WRITE_ID = re.compile(r"[A-Za-z0-9_.:\-]{8,80}")

# ---- the routes, read off the relay ---------------------------------------------------------------------------------
GUARDS = ROUTES["guards"]
MASTER_ACCOUNT = str(GUARDS["master_account"])
MASTER_ROW_TARGETS: dict[str, tuple[str, ...]] = {k: tuple(v) for k, v in GUARDS["master_row_targets"].items()}
MASTER_ASK_REFUSED: dict[str, Any] = GUARDS["master_ask_refused"]
APP_ACCESS_ACTIONS = frozenset(GUARDS["app_access_actions"])
CHAT_ACTIONS = frozenset(GUARDS["chat_actions"])
SWITCHED_REFUSED: dict[str, str] = GUARDS["switched_refused"]
SWITCHED_REFUSED_RESOURCES: dict[str, str] = GUARDS["switched_refused_resources"]
SIGN_IN = GUARDS["sign_in"]
READS: dict[str, str] = ROUTES["reads"]
WRITES: dict[str, str] = ROUTES["writes"]
FINAL = frozenset(ROUTES["final"])
AUTH_DOORS = frozenset(ROUTES["auth"])
GENERIC_VERBS = frozenset(ROUTES["generic"]["verbs"])
GENERIC_DOORS: dict[tuple[str, str], str] = {(r, v): d for r, v, d in ROUTES["generic"]["doors"]}
WORLD_DOORS: dict[str, str] = ROUTES["generic"]["world"]
ROUTE_NAMES = frozenset(ROUTES["generic"]["routes"])
BUILDER_DOORS = frozenset(ROUTES["generic"]["builder"])
SETTINGS_TOOLS_RESOURCE = str(ROUTES["settings_tools"]["resource"])
RELAY_FIRST = frozenset(ROUTES["relay_first"])
RELAY_SHAPED = frozenset(ROUTES["relay_shaped"])
# the writes a preparation alone shapes (BACKEND_WRITE_PREPARE): its door asked here first, then the write
PREPARE: dict[str, tuple[str, str]] = {a: (d, f) for a, (d, f) in ROUTES["prepare"].items()}
# the writes a preread alone shapes (BACKEND_WRITE_PREREAD): the receipt the envelope carries kept by its door first
PREREAD: dict[str, str] = dict(ROUTES.get("preread") or {})
# the payload's field the relay's preread reads, and what the write is handed instead
PREREAD_FIELD, PREREAD_KEPT = "receiptBase64", "receiptKept"
# Python's doors the relay still answers whole, with why
HOLD: dict[str, str] = {
    "beAnotherStop": "the relay sends the session's queued writes and chat sends first (its ledger), then ends it",
}
# a rung ported here ahead of the relay's (action -> handler(env, raw, request)), asked before RELAY_FIRST
RUNGS: dict[str, Callable[[dict[str, Any], bytes, Any], Awaitable[Response]]] = {}
HERE_READS = frozenset(a for a in READS if a not in RELAY_FIRST | RELAY_SHAPED and a not in HOLD)
HERE_WRITES = frozenset(a for a in WRITES if a in FINAL and a not in RELAY_FIRST and a not in HOLD
                        and (a not in RELAY_SHAPED or a in PREPARE or a in PREREAD))
HERE_AUTH = frozenset(a for a in AUTH_DOORS if a not in RELAY_FIRST and a not in HOLD)
# the doors whose acts leave no line: never named in this module's log
SILENT_DOORS = auth_doors.SESSION
# the held verdicts that go with these answers, whoever gave them
SESSION_ENDERS = frozenset({"authLogout", "beAnotherStop", "releaseUser"})
SESSION_STARTS = frozenset({"beAnotherStart"})

# main.py, handed over by install()
M: Any = None


# ---- the envelope, as doPost reads it --------------------------------------------------------------------------------

def _json_constant(name: str) -> Any:
    """_relay_json_constant: JSON.parse refuses NaN and Infinity."""
    raise ValueError(name)


def read_envelope(raw: bytes) -> tuple[dict[str, Any] | None, bool]:
    """(the envelope, whether it came as raw JSON): doPost's read — the raw JSON body first, then the form field
    `body`, the first parse that succeeds kept and one that is not an object naming nothing — whole, at any size up to
    doPost's own cap (the relay's _master_guard_envelope without its byte filter); None when it does not read."""
    if len(raw) > WHOLE_MAX:
        return None, False
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None, False
    for as_json, candidate in ((True, text), (False, (urllib.parse.parse_qs(text).get("body") or [""])[0])):
        try:
            env = json.loads(candidate, parse_constant=_json_constant)
        except (ValueError, RecursionError):
            continue
        return (env if isinstance(env, dict) else {}), as_json
    return None, False


def is_service(raw: bytes) -> bool:
    """_relay_is_service: the machine identity rather than a person."""
    return b"service_secret" in raw[:HEAD_BYTES]


def form_raw(env: dict[str, Any]) -> bytes:
    """The envelope as the relay's readers take it: the form field `body`."""
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


def _answer(env: dict[str, Any]) -> Response:
    """The relay's own answer: its JSON as json.dumps writes it."""
    return Response(content=json.dumps(env).encode(), media_type="application/json")


def _bytes(content: bytes, headers: dict[str, str] | None = None) -> Response:
    return Response(content=content, media_type="application/json", headers=headers or {})


# ---- the session gate ------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Session:
    """A token's verdict (auth_doors' _verdict): live or not, its account, the master flag, and whether it was minted
    from the master's own session (the worn account's name, and when it ends)."""
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False
    worn: str = ""
    until: float = 0.0

    @property
    def master(self) -> bool:
        """_app_pack_master: an admin session the sign-in names the master, never a switched one."""
        return self.ok and self.role.strip().lower() == "admin" and not self.acting and self.is_master


_SESSIONS: dict[str, tuple[float, Session]] = {}
_GATE_UNSURE: dict[str, float] = {}
# told the accounts (None: every one) whose held verdicts went, so what holds a session open judges it again: the
# live stream (live_events), the chat's streams (chat_doors) and the slices App Control decides (slice_gate)
SESSIONS_FORGOTTEN: list[Callable[[frozenset[str] | None], None]] = [slice_gate.forget]
# the in-process finish (live_finish.finish), set by live_plane; None asks the relay's /front-door/finish
FINISH: Callable[..., Awaitable[Any]] | None = None
# what an answer the relay gave at /gas leaves in this app's own state (live_finish.carried), set by live_plane
CARRIED: Callable[[str, bytes, bytes], None] | None = None


def verdict(token: str) -> Session | None:
    """Blocking: the relay's _session_verdict on Python's door, in-process; None when it cannot be told."""
    try:
        got = auth_doors.run("_verdict", {"token": token},
                             auth_doors.Context(M.DB, M.DRIVE, M.AUTH_STORE, M._own, M._own_locked))
    except (sc.Defer, hubdb.Unreadable):
        return None
    if not isinstance(got, dict) or got.get("ok") is not True:
        return Session(ok=False)
    # _note_session_answer: a block naming nobody worn is no switched session
    block = got.get("be_another") if isinstance(got.get("be_another"), dict) else {}
    worn = block.get("acting") if isinstance(block.get("acting"), dict) else None
    acting = bool(worn) and bool(str(worn.get("id") or "").strip())
    until = 0.0
    if acting:
        ms = gsjs.date_parse(worn.get("until"))
        try:
            until = ms / 1000.0 if ms is not None else time.time() + float(worn.get("expires_in_ms") or 0) / 1000.0
        except (TypeError, ValueError):
            until = time.time()
    return Session(ok=True, role=str(got.get("role") or ""), uid=str(got.get("uid") or ""),
                   is_master=got.get("is_master") is True and not acting, acting=acting,
                   worn=str(worn.get("display_name") or "") if acting and worn else "", until=until)


async def session(token: str) -> Session | None:
    """_session_actor's verdict, held SESSION_TTL_S; None when none could be read (and nothing held)."""
    if not token:
        return None
    now = time.time()
    hit = _SESSIONS.get(token)
    if hit is not None and now < hit[0]:
        return hit[1]
    try:
        got = await run_in_threadpool(verdict, token)
    except Exception as exc:  # noqa: BLE001 - the relay decides what nobody here could
        log.warning("front door: a session could not be read (%s)", type(exc).__name__)
        return None
    if got is None:
        return None
    if len(_SESSIONS) >= SESSIONS_MAX:
        _SESSIONS.clear()
    _SESSIONS[token] = (min(now + SESSION_TTL_S, got.until) if got.acting else now + SESSION_TTL_S, got)
    return got


def held_session(token: str) -> Session | None:
    hit = _SESSIONS.get(token) if token else None
    return hit[1] if hit is not None and time.time() < hit[0] else None


def forget_sessions(uids: Any = None) -> None:
    """The held verdicts a sign-out, a release or an account write may have changed: those of these accounts, or all."""
    gone = None if uids is None else frozenset(str(u) for u in uids if str(u or "").strip())
    if gone is None:
        _SESSIONS.clear()
    else:
        for token, (_at, s) in list(_SESSIONS.items()):
            if s.uid in gone:
                _SESSIONS.pop(token, None)
    for told in list(SESSIONS_FORGOTTEN):
        try:
            told(gone)
        except Exception as exc:  # noqa: BLE001 - a listener never stands in the door's way
            log.warning("front door: a session listener failed (%s)", type(exc).__name__)


def said(s: Session, env: dict[str, Any], action: str) -> dict[str, Any]:
    """_backend_user then _acting_user: the verified session, where its envelope stands (_backend_place) and the
    action it named; a session minted from the master's own says so, is never the master, and leaves no line."""
    user: dict[str, Any] = {"uid": s.uid, "role": s.role.strip().lower(), "is_master": s.master,
                            "place": {k: str(env.get(k) or "").strip()[:120]
                                      for k in ("tenant", "member", "world", "resource")},
                            "asked": str(env.get("action") or action)}
    if s.acting:
        user = {**user, "acting": True, "unlogged": True, "is_master": False}
    return user


def _quiet(action: str, s: Session | None = None) -> bool:
    """Nothing is said of the master's own switch, nor of a session minted from it."""
    return action in SILENT_DOORS or (s is not None and s.acting)


# ---- the guards, in the relay's order -------------------------------------------------------------------------------

_AC_WRITERS: dict[str, Any] = {"at": 0.0, "ids": frozenset()}
_MASTER_IDS: dict[str, Any] = {"at": 0.0, "ids": None}


def app_access_write(action: str, payload: Any) -> bool:
    """_relay_app_access_write: this call changes which apps a badge or a tenant reaches."""
    if action in ("appBadgeAccessSet", "appTenantAccessSet"):
        return True
    if action != "appAccessSetBulk" or not isinstance(payload, dict):
        return False
    return any(isinstance(payload.get(k), (dict, list)) and len(payload.get(k)) > 0 for k in ("rules", "tenants"))


def ac_writers() -> frozenset[str]:
    """Blocking: configLane's `app_control_writers` (config_lane.py), the accounts App Control is shared with and may
    change; none when it cannot be read, as the relay's lane not read yet."""
    held = _AC_WRITERS
    if time.time() - float(held["at"]) < AC_WRITERS_TTL_S:
        return held["ids"]
    try:
        ids = frozenset(str(d["id"]).strip() for d in app_control.delegates_read(L.Reads(M.DB, M.DRIVE))
                        if d.get("may_change") and d.get("apps") and str(d.get("id") or "").strip())
    except Exception:  # noqa: BLE001 - FAIL-CLOSED: nobody shared
        ids = frozenset()
    held.update(at=time.time(), ids=ids)
    return ids


async def app_access_refusal(env: dict[str, Any]) -> dict[str, Any] | None:
    """_relay_app_access_refusal: an early answer, not the gate; an unknown master flag is not "not the master"."""
    action = str(env.get("action") or "")
    if action not in APP_ACCESS_ACTIONS:
        return None
    token = str(env.get("token") or "")
    s = await session(token) if token else None
    if s is None or not s.ok or s.is_master:
        return None
    if not app_access_write(action, env.get("payload")):
        return None
    try:
        if s.uid.strip() and s.uid.strip() in await run_in_threadpool(ac_writers):
            return None
    except Exception:  # noqa: BLE001 - an unreadable answer is not a pass
        pass
    return dict(UNKNOWN_ACTION)


def master_account_ids() -> frozenset[str]:
    """Blocking: the master's account id off the users copy in asa-hub-db; raises when it names none."""
    held = _MASTER_IDS.get("ids")
    if held and time.time() - float(_MASTER_IDS["at"]) < MASTER_IDS_TTL_S:
        return held
    ids = frozenset(gsjs.str_(u.get("userid")) for u in L.Reads(M.DB, M.DRIVE).users()
                    if sc.is_master_email(u.get("email")) and gsjs.str_(u.get("userid")))
    if not ids:
        raise RuntimeError("the users copy names no master account")
    _MASTER_IDS.update({"at": time.time(), "ids": ids})
    return ids


def master_row_named(action: str, payload: Any) -> list[str]:
    """_master_row_named: the account ids this write names, read as the handler reads them."""
    if not isinstance(payload, dict):
        return []
    out: list[str] = []
    for key in MASTER_ROW_TARGETS.get(action, ()):
        named = payload.get(key)
        for one in (named if isinstance(named, list) else [named]):
            if one is not None and not isinstance(one, (dict, list)) and str(one).strip():
                out.append(str(one).strip())
    return out


async def master_account_refusal(env: dict[str, Any]) -> dict[str, Any] | None:
    """_master_account_refusal: None when this call may go on; else the answer it gets instead of reaching the
    master's account."""
    action = str(env.get("action") or "")
    if action not in MASTER_ROW_TARGETS and action != "platformMemberAsk":
        return None
    payload = env.get("payload")
    if action == "platformMemberAsk":
        asked = str((payload or {}).get("email") or "").strip().lower() if isinstance(payload, dict) else ""
        return dict(MASTER_ASK_REFUSED) if asked == MASTER_ACCOUNT else None
    named = master_row_named(action, payload)
    if not named:
        return None
    try:
        masters = await run_in_threadpool(master_account_ids)
    except Exception:  # noqa: BLE001 - FAIL-CLOSED: an account write that cannot be told from one on the master waits
        log.warning("front door: an account write held — the master's account could not be read off the users copy")
        return dict(ACCOUNTS_UNREAD)
    hit = next((uid for uid in named if uid in masters), "")
    if not hit:
        return None
    token = str(env.get("token") or "")
    if token and not str(env.get("member") or "").strip():
        s = await session(token)
        if s is not None and s.master:
            return None
    log.info("front door: an account write on the master's account refused — %s", action)
    return {"status": 404, "message": f'No user "{hit}".'}


async def switched_refusal(env: dict[str, Any]) -> dict[str, Any] | None:
    """_acting_refusal: what a session minted from the master's own may not do, in Apps Script's words."""
    token = str(env.get("token") or "")
    if not token:
        return None
    s = await session(token)
    if s is None or not s.ok or not s.acting:
        return None
    action = str(env.get("action") or "")
    # the chat's own path answers a switched session already, in the words the page reads
    if action in CHAT_ACTIONS:
        return None
    what = SWITCHED_REFUSED.get(action)
    if what is None and action in ("create", "update", "delete"):
        what = SWITCHED_REFUSED_RESOURCES.get(str(env.get("resource") or ""))
    if what is None:
        return None
    name = s.worn.strip() or "another account"
    return {"status": 409, "code": "be_another_refused",
            "message": f"Not while acting as {name}: {what}. Press Be Back to do this as yourself."}


# ---- the master's sign-in is not a stranger's to lock (the relay's MASTER_SIGN_IN_*) ---------------------------------

_SIGN_IN: dict[str, Any] = {"known": None, "fails": []}


def sign_in_addr(request: Any) -> str:
    """_master_sign_in_addr: nginx's X-Real-IP, keyed as the relay keys it; '' when the request carries none. No
    address is ever written down."""
    ip = str(request.headers.get("x-real-ip") or "").strip()
    if not ip:
        return ""
    return hmac.new(SIGN_IN_KEY, ip.encode(), hashlib.sha256).hexdigest()[:32]


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    """The relay's _write_atomic: renamed into place, never overwritten."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), default=str)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def sign_in_known() -> dict[str, float]:
    """_master_sign_in_known: the places the master signed in from, kept on disk; the stale ones let go."""
    known = _SIGN_IN.get("known")
    if known is None:
        try:
            held = json.loads(MASTER_SIGN_IN_PATH.read_text())
            known = {str(k): float(v) for k, v in (held.get("known") or {}).items()}
        except Exception:  # noqa: BLE001 - none kept yet reads as none
            known = {}
        _SIGN_IN["known"] = known
    cutoff = time.time() - float(SIGN_IN["known_s"])
    for k in [k for k, at in known.items() if at < cutoff]:
        known.pop(k, None)
    return known


def sign_in_names_master(env: dict[str, Any]) -> bool:
    """_master_sign_in_identifier: an authLogin for the master's address."""
    if str(env.get("action") or "") != "authLogin":
        return False
    payload = env.get("payload")
    asked = str(payload.get("identifier") or "").strip().lower() if isinstance(payload, dict) else ""
    return asked == MASTER_ACCOUNT


def sign_in_refusal(env: dict[str, Any], addr: str) -> dict[str, Any] | None:
    """_master_sign_in_refusal: the backend's own 429 for an address that has spent its tries on the master's address;
    None to carry it."""
    if not sign_in_names_master(env):
        return None
    if addr and addr in sign_in_known():
        return None
    now = time.time()
    fails = [(at, a) for at, a in _SIGN_IN["fails"] if now - at < float(SIGN_IN["window_s"])]
    _SIGN_IN["fails"] = fails
    if sum(1 for _, a in fails if a == addr) >= int(SIGN_IN["per_ip"]) or len(fails) >= int(SIGN_IN["strangers"]):
        log.info("front door: a sign-in with the master's address held — its unknown-place tries are spent")
        return dict(SIGN_IN["refused"])
    return None


def sign_in_observed(env: dict[str, Any], content: bytes, addr: str) -> None:
    """_master_sign_in_observed: the master's success makes the address known, a refusal from elsewhere counts."""
    try:
        if not sign_in_names_master(env):
            return
        status = json.loads(content).get("status")
        known = sign_in_known()
        if status == 200 and addr:
            known[addr] = time.time()
            write_atomic(MASTER_SIGN_IN_PATH, {"known": known})
        elif status == 401 and addr not in known:
            _SIGN_IN["fails"].append((time.time(), addr))
    except Exception:  # noqa: BLE001 - observation is a bonus, never a failure mode
        pass


# ---- who reads what, as the relay last saw it change ----------------------------------------------------------------

_PEOPLE: dict[str, Any] = {"mtime": None, "at": 0.0}


def people_at() -> float:
    """_backend_people_extra: while a change of who reads what the relay saw land settles, its moment (Python answers
    503 from a copy older than it); 0 otherwise. The relay keeps the mark beside its packs."""
    path = PACKS_DIR / PEOPLE_FILE
    try:
        mtime = path.stat().st_mtime
        if mtime != _PEOPLE["mtime"]:
            _PEOPLE.update(mtime=mtime, at=min(float(json.loads(path.read_text(encoding="utf-8"))["at"]), time.time()))
    except FileNotFoundError:
        _PEOPLE.update(mtime=None, at=0.0)
    except Exception:  # noqa: BLE001 - an unreadable mark is a change just now, as the relay takes one up
        _PEOPLE.update(mtime=None, at=time.time())
    at = float(_PEOPLE["at"])
    return at if at and time.time() - at < SETTLE_S else 0.0


# ---- routing ---------------------------------------------------------------------------------------------------------

def generic_door(action: str, env: dict[str, Any]) -> str:
    """_backend_generic_door: My World's door where the envelope names a world, else the resource's own, else App
    Studio's for a name the router does not hold; the action itself for any other."""
    if action not in GENERIC_VERBS:
        return action
    if str(env.get("world") or "").strip():
        return WORLD_DOORS[action]
    resource = str(env.get("resource") or "")
    door = GENERIC_DOORS.get((resource, action))
    if door:
        return door
    return action if resource in ROUTE_NAMES else "builder" + action.title()


def settings_tools_generic(action: str, env: dict[str, Any]) -> bool:
    """_settings_tools_door for a generic verb: the asking rhythm's, outside a world (the relay's own rung)."""
    return (action in GENERIC_VERBS and not env.get("world")
            and str(env.get("resource") or "") == SETTINGS_TOOLS_RESOURCE)


def route(env: dict[str, Any] | None, raw: bytes) -> tuple[str, str, str]:
    """(kind, door, app): a `rung`, `write`, `read` or `auth` answered here, `relay` for everything else — in
    gas_relay's own order: its rungs, then Python's write, then its read, then the sign-in."""
    if not env or is_service(raw):
        return "relay", "", ""
    action = str(env.get("action") or "")
    if not action:
        return "relay", "", ""
    if action in RUNGS:
        return "rung", action, ""
    if action in RELAY_FIRST or settings_tools_generic(action, env):
        return "relay", action, ""
    door = generic_door(action, env)
    if door in WRITES:
        return ("write", door, WRITES[door]) if door in HERE_WRITES else ("relay", door, "")
    if door in READS:
        return ("read", door, READS[door]) if door in HERE_READS else ("relay", door, "")
    if action in AUTH_DOORS:
        return ("auth", action, "auth") if action in HERE_AUTH else ("relay", action, "")
    return "relay", door, ""


SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
SERVICE_REFUSED = {"status": 401, "message": "Authentication required."}


def service_route(env: dict[str, Any]) -> tuple[str, str, str] | None:
    """(kind, door, app) of a machine-identity envelope among Python's doors answered here — `write` or `read` — or
    None for one the relay's /gas still takes."""
    action = str(env.get("action") or "")
    if not action or action in RELAY_FIRST:
        return None
    door = generic_door(action, env)
    if door in WRITES and door in HERE_WRITES:
        return "write", door, WRITES[door]
    if door in READS and door in HERE_READS:
        return "read", door, READS[door]
    return None


async def service_gas(env: dict[str, Any]) -> dict[str, Any] | None:
    """gas_relay for the machine identity: its secret proved, then Python's door asked in-process as the service (the
    relay's _backend_call, clocks.service_door for a write); None for a door the relay still takes."""
    picked = service_route(env)
    if picked is None:
        return None
    if not SERVICE_SECRET or not hmac.compare_digest(str(env.get("service_secret") or ""), SERVICE_SECRET):
        return SERVICE_REFUSED
    import clocks  # noqa: PLC0415 - it builds on this module

    kind, door, app_id = picked
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    payload = builder_payload(door, env, dict(payload))
    if kind == "write":
        try:
            return await clocks.service_door(app_id, door, payload)
        except RuntimeError as exc:
            return {"status": 503, "message": str(exc)[:200]}
    got, why = await clocks.call(app_id, door, payload)
    return got if got is not None else {"status": 503, "message": f"Python did not answer ({why})"}


def builder_payload(action: str, env: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """_builder_payload: an App Studio generic door is told the resource its verb names."""
    if action not in BUILDER_DOORS:
        return payload
    axes = payload.get("_envelope") if isinstance(payload.get("_envelope"), dict) else {}
    return {**payload, "_envelope": {**axes, "resource": str(env.get("resource") or "")}}


# ---- Python's doors, in-process --------------------------------------------------------------------------------------

def header(resp: Any, name: str) -> str | None:
    """A response header, None when it is not there (whatever case it was set in)."""
    held = getattr(resp, "headers", None) or {}
    for k in (name, name.lower()):
        try:
            v = held.get(k)
        except Exception:  # noqa: BLE001
            v = None
        if v is not None:
            return str(v)
    return None


async def call_app(app_id: str, action: str, user: dict[str, Any], payload: dict[str, Any], write_id: str = "",
                   at: float = 0.0) -> tuple[bytes, float, dict[str, Any], frozenset[str] | None, float] | None:
    """main.py's /v1/{app}/{action} (`act`) and the relay's _backend_call, in-process: (the answer, how old its copy
    is, its JSON, the own writes it holds, when it read the kept edits); None when the door deferred."""
    said_ = not user.get("acting")
    module, deciding = M.APPS.get(app_id), M.WRITES.get(app_id)
    write_door = deciding is not None and action in deciding.ACTIONS
    if module is None or (action not in module.ACTIONS and not write_door):
        if said_:
            log.info("front door: %s not answered by Python — not ported", action)
        return None
    if write_door:
        resp = await run_in_threadpool(M._run_write, deciding, action, user, payload, write_id, at)
    else:
        resp = await run_in_threadpool(M._run, module, action, user, payload, at)
    body = bytes(resp.body or b"")
    if resp.status_code != 200:
        if said_:
            log.info("front door: %s not answered by Python — it deferred %d", action, resp.status_code)
        return None
    try:
        env = json.loads(body)
    except ValueError:
        env = None
    if not isinstance(env, dict) or not isinstance(env.get("status"), int):
        if said_:
            log.warning("front door: %s not answered by Python — another shape", action)
        return None
    as_of = float(header(resp, "X-Hub-As-Of") or 0.0) or time.time()
    named = header(resp, "X-Hub-Own")
    held = None if named is None else frozenset(w for w in named.split(",") if w)
    edits = header(resp, "X-Hub-Edits-At") or ""
    edits_at = float(edits) if re.fullmatch(r"\d{1,12}(\.\d{1,6})?", edits) else 0.0
    return body, as_of, env, held, edits_at


def settle_void(app_id: str, write_id: str) -> None:
    """Blocking: main.py's /v1/{app}/_settle for a void, in-process (the relay's _backend_settle): the write Python
    decided and nobody used, its log lines and its owed texts with it."""
    store = M.stores().get(app_id)
    if app_id not in M.WRITES or store is None or not store.available:
        return
    why = ""
    for attempt in range(3):
        try:
            done = store.settle(write_id, "void", "", None)
            if done:
                sys_log.void(store, write_id)
                smart_comms.void_write(store.conn(), write_id)
            log.info("write %s settled void%s", write_id, "" if done else " (nothing to settle)")
            return
        except Exception as exc:  # noqa: BLE001 - said below; Python retires it by its own clock
            why = type(exc).__name__
        time.sleep(2.0 * (attempt + 1))
    log.warning("front door: write %s not settled void (%s)", write_id, why)


def settle_void_soon(app_id: str, write_id: str) -> None:
    """_backend_settle_soon(..., "void"): sent behind the answer; never raises."""
    if not write_id:
        return
    try:
        asyncio.get_running_loop().create_task(run_in_threadpool(settle_void, app_id, write_id))
    except Exception:  # noqa: BLE001 - Python retires it by its own clock
        return


def unwritten(action: str, why: str, s: Session | None = None) -> Response:
    """_backend_unwritten: a write Python could not decide — nothing written anywhere, said."""
    if not _quiet(action, s):
        log.info("front door: %s not written — %s", action, why)
    return _answer(dict(UNWRITTEN))


# ---- the relay's half: what it does once Python answered (server/front_door_finish.py) ------------------------------

@dataclass(frozen=True)
class Finished:
    """The relay's word on an answer given here: its own bytes in its place (None: as given), the ring a kept read is
    re-read on (None: not a kept read), and the phase every relay answer says (X-Hub-Phase, lib/hubStatus.ts)."""
    content: bytes | None
    ring: str | None
    phase: str | None = None

    def headers(self) -> dict[str, str]:
        out = {"X-Kept-Ring": self.ring} if self.ring is not None else {}
        return {**out, "X-Hub-Phase": self.phase} if self.phase is not None else out


async def finish(meta: dict[str, Any], raw: bytes, content: bytes) -> Finished | None:
    """What an answer given here sets going after it (app/live_finish.py, installed by the live plane); None before it
    is installed: the answer stands as given."""
    if FINISH is not None:
        return await FINISH(meta, raw, content)
    return None


def _kept(fin: Finished | None, content: bytes) -> Response:
    """The answer given here, or the relay's bytes in its place, with what the relay says on every answer."""
    if fin is None:
        return _bytes(content)
    return _bytes(fin.content if fin.content is not None else content, fin.headers())


# ---- the doors -------------------------------------------------------------------------------------------------------

async def read(door: str, app_id: str, env: dict[str, Any], raw: bytes, s: Session) -> Response:
    """_backend_answer and gas_relay's answer loop: Python's read for the verified session, its age against the writes
    the relay saw and its laid edits judged there, the relay's observers run on it."""
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    payload = builder_payload(door, env, payload)
    got = await call_app(app_id, door, said(s, env, door), payload, "", people_at())
    meta = {"kind": "read", "action": str(env.get("action") or ""), "door": door, "app_id": app_id,
            "quiet": _quiet(door, s)}
    if got is None:
        # Python owns this read: its defer is its 503, never Apps Script's (_backend_said_unread)
        content = json.dumps(UNREAD).encode()
        return _kept(await finish({**meta, "said": True}, raw, content), content)
    content, as_of, _env, held, edits_at = got
    return _kept(await finish({**meta, "as_of": as_of, "held": None if held is None else sorted(held),
                               "edits_at": edits_at}, raw, content), content)


async def write(door: str, app_id: str, env: dict[str, Any], raw: bytes, s: Session | None) -> Response:
    """_backend_write for a final door: refused in its words, kept in Postgres and finished by the relay
    (_backend_final), or said 503 with nothing written — never handed to Apps Script."""
    payload = env.get("payload")
    token = str(env.get("token") or "")
    if not isinstance(payload, dict) or not token:
        return unwritten(door, "no payload or no session", s)
    payload = builder_payload(door, env, payload)
    if s is None or not s.ok:
        return unwritten(door, "the session could not be read", s)
    write_id = str(env.get("write_id") or "")
    if not write_id:
        # stamped as the exactly-once lane would: Python's receipt and the relay's carry one id
        write_id = "W" + hashlib.sha256(raw + str(time.time_ns()).encode()).hexdigest()[:24]
        env = {**env, "write_id": write_id}
        raw = form_raw(env)
    elif not WRITE_ID.fullmatch(write_id):
        return unwritten(door, "an unusable write id", s)
    preread = PREREAD.get(door)
    if preread is not None and payload.get(PREREAD_FIELD):
        # the receipt kept on the server and read before the write, so the write stays inside its budget
        got = await call_app(app_id, preread, said(s, env, door), payload)
        env_r = got[2] if got is not None else None
        if env_r is None or env_r.get("status") != 200 or not isinstance(env_r.get("data"), dict):
            if env_r is not None and isinstance(env_r.get("status"), int) and env_r["status"] < 500:
                return _answer({k: v for k, v in env_r.items() if k in ("status", "message")})
            return unwritten(door, "the receipt could not be read just now", s)
        payload = {**{k: v for k, v in payload.items() if k != PREREAD_FIELD}, PREREAD_FIELD: "kept",
                   PREREAD_KEPT: env_r["data"]}
    prepare = PREPARE.get(door)
    if prepare is not None and (not prepare[1] or payload.get(prepare[1])):
        got = await call_app(app_id, prepare[0], said(s, env, door), payload)
        env_p = got[2] if got is not None else None
        if env_p is None or env_p.get("status") != 200 or not isinstance(env_p.get("data"), dict):
            # the door's own refusal (a 502 says what it could not reach) is the person's answer; nothing was written
            if env_p is not None and isinstance(env_p.get("status"), int) and env_p["status"] != 200:
                return _answer({k: v for k, v in env_p.items() if k in ("status", "message", "data")})
            return unwritten(door, "its preparation could not be done just now", s)
        payload = {**{k: v for k, v in payload.items() if k != prepare[1]}, "prepared": env_p["data"]}
        if prepare[1]:
            payload[prepare[1]] = "kept"
    # the copy may not hold a just-changed App Control or account yet: Python decides nothing on an older one, but the
    # master's final writes, as before
    got = await call_app(app_id, door, said(s, env, door), payload, write_id, 0.0 if s.master else people_at())
    quiet = _quiet(door, s)
    if got is None:
        settle_void_soon(app_id, write_id)
        return unwritten(door, "Python did not answer", s)
    _content, as_of, answer, held, edits_at = got
    data = answer.get("data") if isinstance(answer.get("data"), dict) else None
    # the presses the simulator made in-process in Apps Script, made by the relay once this write is kept
    handed = data.get("handed") if app_id == "hiring" and answer.get("status") == 200 and data else None
    plan = answer.pop("_write", None)
    plan = plan if isinstance(plan, dict) else None
    replay = bool(plan and plan.get("replay"))
    content = json.dumps(answer).encode()
    if plan is not None and plan.get("final") and not replay:
        fin = await finish({"kind": "write", "action": str(env.get("action") or ""), "door": door, "app_id": app_id,
                            "write_id": write_id, "as_of": as_of, "held": None if held is None else sorted(held),
                            "edits_at": edits_at, "plan": plan, "handed": handed or None, "quiet": quiet}, raw, content)
        forget_named(door, payload, fin.content if fin is not None and fin.content is not None else content)
        return _kept(fin, content)
    if handed:
        await finish({"kind": "handed", "door": door, "handed": handed, "quiet": quiet}, raw, b"")
    if plan is not None and not plan.get("final"):
        # a final door that answered with a sheet write: never carried
        if not replay:
            settle_void_soon(app_id, write_id)
        return unwritten(door, "its door answered a sheet write", s)
    # a refusal, an answer that writes nothing, or a write already kept under this id: the door's own words
    if not quiet:
        log.info("front door: %s decided by Python (%s)%s", door, answer.get("status"), " — replayed" if replay else "")
    return _bytes(content)


def forget_named(action: str, payload: Any, content: bytes) -> None:
    """An account write that landed: the verdicts held for the accounts it names are read again."""
    if action not in MASTER_ROW_TARGETS:
        return
    try:
        if json.loads(content).get("status") == 200:
            forget_sessions(master_row_named(action, payload))
    except Exception:  # noqa: BLE001 - they expire on their own
        pass


async def auth(action: str, env: dict[str, Any], raw: bytes, relay_raw: bytes, request: Any, addr: str) -> Response:
    """_auth_py_answer: the sign-in's door in-process; Python's hand-back goes to the relay (and on to Apps Script)
    unchanged, Python not answering is said and never handed on."""
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    token = env.get("token")
    resp = await run_in_threadpool(M._run_auth, action, {"payload": payload, "token": token,
                                                         "tenant": env.get("tenant"), "member": env.get("member")})
    if resp.status_code == HAND_BACK:
        return await proxy(raw, request, action)
    got: Any = None
    if resp.status_code == 200:
        try:
            got = json.loads(bytes(resp.body or b""))
        except ValueError:
            got = None
    meta: dict[str, Any] = {"kind": "auth", "action": action, "door": action, "token": str(token or ""),
                            "quiet": _quiet(action)}
    if not isinstance(got, dict) or not isinstance(got.get("status"), int):
        if action not in SILENT_DOORS:
            log.warning("front door: %s not answered by Python (%s)", action, resp.status_code)
        # the forgot door answers its one generic yes whatever happens, so who exists never leaks
        got = dict(FORGOT_SENT) if action == "authForgot" else dict(AUTH_UNAVAILABLE)
    else:
        # what the sign-in once asked the relay to carry to Apps Script: never sent on
        got.pop("_also_apps_script", None)
        got.pop("_slid", None)
        if action in SESSION_STARTS and got.get("status") == 200:
            # a new switched session ends the master's earlier ones: their held verdicts go with them
            forget_sessions()
    content = json.dumps(got).encode()
    sign_in_observed(env, content, addr)
    return _kept(await finish(meta, relay_raw, content), content)


async def proxy(raw: bytes, request: Any, action: str = "", env: dict[str, Any] | None = None) -> Response:
    """What no door here answers: Unknown action., said here. The relay that once took it is retired."""
    s = held_session(str((env or {}).get("token") or ""))
    if action and not _quiet(action, s):
        log.info("front door: %s has no door here — answered Unknown action.", action)
    return _answer(dict(NO_DOOR))


async def gas(request: Request) -> Response:
    """POST /gas — gas_relay: the guards in the relay's order, then Python's doors here or the relay's /gas."""
    raw = await request.body()
    env, as_json = read_envelope(raw)
    held_env = env or {}
    # the master's account: its sign-in and the account writes that name it, before any door is asked
    refused = await app_access_refusal(held_env)
    if refused is not None:
        log.info("front door: an app-access write refused — app access is the master's, shared only through App "
                 "Control access")
        return _answer(refused)
    addr = sign_in_addr(request)
    held = sign_in_refusal(held_env, addr) or await switched_refusal(held_env) or await master_account_refusal(held_env)
    if held is not None:
        return _answer(held)
    if env is not None and is_service(raw):
        here = await service_gas(env)
        if here is not None:
            return _answer(here)
    kind, door, app_id = route(env, raw)
    if kind == "relay" or env is None:
        return await proxy(raw, request, door or str(held_env.get("action") or ""), env)
    if kind == "rung":
        return await RUNGS[door](env, raw, request)
    # what the relay's readers take: the form envelope, whatever shape the browser sent it in
    relay_raw = form_raw(env) if as_json else raw
    if kind == "auth":
        return await auth(door, env, raw, relay_raw, request, addr)
    token = str(env.get("token") or "")
    s = await session(token) if token else None
    if kind == "write":
        return await write(door, app_id, env, relay_raw, s)
    # a read on Python's verdict alone, whoever minted the token: no session, or one the sign-in ended, is its 401; one
    # it could not judge just now its 503 — never handed on
    if s is None:
        if not _quiet(door):
            log.info("front door: %s not read — %s", door, "no session" if not token else "the session could not "
                                                                                          "be read")
        return _answer(dict(AUTH_ENDED) if not token else dict(UNREAD))
    if not s.ok:
        return _answer(dict(AUTH_ENDED))
    return await read(door, app_id, env, relay_raw, s)


# ---- GET /auth: nginx's auth_request before a slice ------------------------------------------------------------------

_MANIFEST: dict[str, Any] = {"mtime": None, "entries": []}
OPEN_DOORS = frozenset({"/digest/try", "/digest/shelf", "/digest/proposals", "/digest/proposals/decide",
                        "/digest/teach", "/snapshot/events", "/snapshot/chat-stream", "/snapshot/chat-beat",
                        "/snapshot/chat-ticket", "/cortex/chat/send", "/snapshot/place"})
ADMIN_DOORS = frozenset({"/cortex/mesh/graph", "/cortex/mesh/live", "/cortex/health", "/cortex/fleet"})


def load_manifest() -> list[dict[str, Any]]:
    """The relay's load_manifest: the slice list, those held on the live path left out; read again when it moves."""
    try:
        mtime = MANIFEST_PATH.stat().st_mtime
        if mtime != _MANIFEST["mtime"]:
            entries = json.loads(MANIFEST_PATH.read_text())["resources"]
            _MANIFEST.update(mtime=mtime, entries=[e for e in entries if e.get("mode") != "live"])
    except Exception as exc:  # noqa: BLE001 - reported, never fatal
        log.warning("front door: the snapshot manifest is unreadable at %s (%s)", MANIFEST_PATH, type(exc).__name__)
        _MANIFEST.update(mtime=None, entries=[])
    return _MANIFEST["entries"]


def role_may_read(role: str, uri: str) -> bool:
    """_role_may_read: whether this role can reach the resource behind the requested file."""
    if "#" in uri or "\\" in uri:
        return False
    path = uri.split("?", 1)[0]
    if "%" in path:
        return False
    if path in OPEN_DOORS:
        return True
    if path in ADMIN_DOORS:
        return role == "admin"
    name = path.rsplit("/", 1)[-1]
    if name in ("index.json", "all.json"):
        return True
    if not name.endswith(".json"):
        return False
    resource = name[: -len(".json")]
    for entry in load_manifest():
        if entry["resource"] == resource:
            return role in (entry.get("roles") or [])
    return False


def slice_named(uri: str) -> str:
    """The resource a slice file's address names; '' for the index, the bang and every other door."""
    path = uri.split("?", 1)[0]
    if path in OPEN_DOORS or path in ADMIN_DOORS:
        return ""
    name = path.rsplit("/", 1)[-1]
    return name[: -len(".json")] if name.endswith(".json") and name not in ("index.json", "all.json") else ""


async def gate(request: Request) -> Response:
    """GET /auth — the relay's: Authorization and X-Original-URI in; 200, 401 or 403 out, no body and no header."""
    authorization = str(request.headers.get("authorization") or "")
    original_uri = str(request.headers.get("x-original-uri") or "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not token:
        return Response(status_code=401)
    if time.time() < _GATE_UNSURE.get(token, 0.0):
        return Response(status_code=401)
    s = await session(token)
    if s is None:
        # no verdict could be read: refused a little while, never held as a sign-out
        if len(_GATE_UNSURE) >= SESSIONS_MAX:
            _GATE_UNSURE.clear()
        _GATE_UNSURE[token] = time.time() + GATE_UNSURE_S
        return Response(status_code=401)
    if not s.ok:
        return Response(status_code=401)
    # an SSA's or a FAMILY's slices are matched by slice_gate.FAMILY_ROLE, whatever its role says
    if not role_may_read(s.role if s.master else await run_in_threadpool(slice_gate.slice_role, s), original_uri):
        return Response(status_code=403)
    # a slice App Control decides (app/slice_gate.py): the master's own session, else the rows that own its data
    resource = slice_named(original_uri)
    if resource in slice_gate.OWNERS and not s.master:
        if resource in await run_in_threadpool(slice_gate.shut, s, load_manifest()):
            return Response(status_code=403)
    return Response(status_code=200)


def install(app: Any, main: Any) -> None:
    """The two doors on main.py's app, with main.py's own reader, stores and doors."""
    global M
    M = main
    app.post("/gas")(gas)
    app.get("/auth")(gate)
