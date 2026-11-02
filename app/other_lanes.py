"""The relay's /hub-lanes doors of Settings, Technology, the runbook, web push, House Supplies' pharmacy reports and
the PRN list, answered here with the relay's own gates and words (app/lane_gate.py): hub-containers, backends,
tech-status, tech-manual, production-actions, versions, push/key, push/subscribe, push/unsubscribe,
house-supplies/meds, meds/rx, meds/commit, meds/match, meds/preview, meds/folder and broadcast/prn; the My apps'
lanes are app/my_lanes.py's. Python's own doors are asked in-process; the tables the relay wrote are asa-hub-db's
(schema app), through the writer role's shared connection."""
from __future__ import annotations

import base64
import hmac
import json
import logging
import os
import re
import time
import urllib.parse
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import front_door as FD
import gsjs
import house_meds_import as HMI
import lane_gate as LG
import live_notify
import my_lanes

log = logging.getLogger("asa-hub-app.lanes")

TABLES = json.loads((Path(os.getenv("HUB_OTHER_LANES") or Path(__file__).resolve().parent / "other_lanes.json"))
                    .read_text(encoding="utf-8"))
BACKENDS = TABLES["backends"]
BACKEND_IDS = frozenset(r["id"] for r in BACKENDS)
BACKEND_GAS_REFUSED = TABLES["backend_gas"]["refused"]
BACKEND_CHOICES = tuple(TABLES["backend_gas"]["choices"])
TECH_STATUSES = tuple(TABLES["tech_statuses"])

_STORE: list[Any] = []


def _store() -> Any:
    """The writer role's shared connection (writes.Store); the relay's own tables are in its schema app."""
    if not _STORE:
        import writes  # noqa: PLC0415
        _STORE.append(writes.Store(kind="lanes", label="the lanes"))
    return _STORE[0]


def _visit(request: Request) -> bool:
    return bool(LG.query(request, "member").strip())


async def _master_door(request: Request, *, visit: bool = True) -> tuple[Any, dict[str, Any] | None]:
    """_backend_master_door: the master's own session alone; everyone else is told the lane does not exist."""
    token = LG.token_of(request)
    if not token:
        return None, {"status": 401, "reason": "session", "message": "sign in first"}
    if visit and _visit(request):
        return None, {"status": 403, "reason": "visit", "message": "This setting is the signed-in account's own."}
    s = await LG.session(token)
    return s, (None if LG.is_master(s) else dict(LG.UNKNOWN_LANE))


# ---- the asa-hub containers (the status sidecar, ops/status.py) ------------------------------------------------------

HUB_STATUS_URL = (os.getenv("HUB_STATUS_URL") or "http://asa-hub-status:8090").rstrip("/")
HUB_STATUS_TOKEN_FILE = os.getenv("HUB_STATUS_TOKEN_FILE", "/run/secrets/hub-status-token")
HUB_STATUS_TIMEOUT_S = 12.0


def _status_token() -> str:
    """The env first; else a private file mounted beside the app."""
    token = os.getenv("HUB_STATUS_TOKEN", "").strip()
    if token:
        return token
    try:
        return Path(HUB_STATUS_TOKEN_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _status_unreachable(why: str) -> dict[str, Any]:
    return {"status": 503, "reason": "unreachable", "message": f"Status sidecar unreachable: {why}. No list was read."}


async def hub_containers(request: Request) -> Response:
    """The asa-hub containers as the status sidecar reads them — the master's read; a failure is never an empty list."""
    return LG.answer(await _hub_containers(request), no_store=True)


async def _hub_containers(request: Request) -> dict[str, Any]:
    import httpx  # noqa: PLC0415 - where it is installed

    token = LG.token_of(request)
    if not token:
        return {"status": 401, "reason": "session", "message": "sign in first"}
    if not LG.is_master(await LG.session(token)):
        return dict(LG.UNKNOWN_LANE)
    status_token = _status_token()
    if not status_token:
        return _status_unreachable("HUB_STATUS_TOKEN is not set on asa-hub-app")
    try:
        async with httpx.AsyncClient(timeout=HUB_STATUS_TIMEOUT_S) as client:
            res = await client.get(f"{HUB_STATUS_URL}/containers", headers={"X-Hub-Status-Token": status_token})
    except Exception as exc:  # noqa: BLE001
        log.warning("hub containers: the status sidecar did not answer (%s)", type(exc).__name__)
        return _status_unreachable(f"it did not answer ({type(exc).__name__})")
    try:
        body = res.json()
    except ValueError:
        body = None
    rows = body.get("containers") if isinstance(body, dict) else None
    if res.status_code != 200 or not isinstance(rows, list):
        said = str(body.get("error") or "")[:160] if isinstance(body, dict) else ""
        log.warning("hub containers: the status sidecar answered %s", res.status_code)
        return _status_unreachable(f"it answered {res.status_code}" + (f" ({said})" if said else ""))
    return {"status": 200, "data": {"containers": [r for r in rows if isinstance(r, dict)],
                                    "read_at": str(body.get("read_at") or ""), "cache_s": body.get("cache_s")}}


# ---- Settings › Back-end per app -------------------------------------------------------------------------------------

_SWITCH_HELD: dict[str, Any] = {"rows": {}, "why": ""}


def _switch_rows() -> dict[str, dict[str, Any]]:
    """Blocking, read-only: every app's chosen engine as the switch keeps it (app.hub_backend_switch)."""
    cur = _store().conn().cursor()
    cur.execute("SELECT app, backend, set_by, set_at FROM app.hub_backend_switch")
    return {str(a): {"backend": str(b), "set_by": str(s or ""), "set_at": t.isoformat() if t else ""}
            for a, b, s, t in cur.fetchall()}


def _engine_state() -> dict[str, Any]:
    """Blocking: whether Python can answer at all — asa-hub-db read, and Drive at hand."""
    M = FD.M
    try:
        M.DB.catalog()
    except Exception:  # noqa: BLE001 - said on the screen
        return {"reachable": False, "why": "asa-hub-app answered, but cannot read asa-hub-db."}
    return {"reachable": True, "why": "" if M.DRIVE.available else
            "asa-hub-app has no Drive credentials: Documents and the house pack cannot be read."}


async def _backend_view() -> dict[str, Any]:
    """_backend_view: each migratable app and the engine that answers it — always Python."""
    held = _SWITCH_HELD
    try:
        held.update(rows=await run_in_threadpool(_switch_rows), why="")
    except Exception as exc:  # noqa: BLE001 - the last reading stands; none at all is Python's
        held.update(why=f"the switch could not be read ({type(exc).__name__})")
        log.warning("backend: %s", held["why"])
    rows = held["rows"]
    engine = await run_in_threadpool(_engine_state)
    return {"apps": [{"id": r["id"], "label": r["label"], "reads": list(r["reads"]), "writes": list(r["writes"]),
                      "final": list(r["final"]), "backend": "python",
                      "set_by": (rows.get(r["id"]) or {}).get("set_by") or "",
                      "set_at": (rows.get(r["id"]) or {}).get("set_at") or ""} for r in BACKENDS],
            "python": engine, "store_why": held["why"], "settling": FD.people_at() > 0}


async def backends(request: Request) -> Response:
    """Settings › Back-end per app: each migratable app and the engine that answers its reads."""
    _s, refused = await _master_door(request)
    return LG.answer(refused if refused is not None else {"status": 200, "data": await _backend_view()},
                     no_store=True)


async def backends_set(request: Request) -> Response:
    """The master's choice of engine: Python is the only one, already answering every app; Apps Script is refused.
    The switch is never written again."""
    _s, refused = await _master_door(request)
    if refused is not None:
        return LG.answer(refused, no_store=True)
    body = await LG.body_json(request)
    app_id = str(body.get("app") or "") if isinstance(body, dict) else ""
    backend = str(body.get("backend") or "") if isinstance(body, dict) else ""
    if app_id not in BACKEND_IDS:
        env: dict[str, Any] = {"status": 400, "reason": "app", "message": "That app has no Python back-end yet."}
    elif backend == "apps_script":
        env = dict(BACKEND_GAS_REFUSED)
    elif backend not in BACKEND_CHOICES:
        env = {"status": 400, "reason": "backend", "message": "backend: python."}
    else:
        log.info("backend: %s is answered by Python, as every app is", app_id)
        env = {"status": 200, "data": await _backend_view()}
    return LG.answer(env, no_store=True)


# ---- Technology ------------------------------------------------------------------------------------------------------

TECH_UNKEPT = {"status": 503, "message": "This change could not be saved just now, and nothing was written. "
                                         "Try again in a moment."}


async def _tech_actor(request: Request) -> tuple[Any, dict[str, Any] | None]:
    s = await LG.session(LG.token_of(request))
    who = LG.actor(s)
    if who is None:
        return s, {"status": 401, "message": "sign in first"}
    if who[0] not in ("admin", "manager"):
        return s, {"status": 403, "message": "admins and managers only"}
    return s, None


async def _tech_write(s: Any, action: str, payload: dict[str, Any]) -> dict[str, Any]:
    """_tech_python_write: a Technology write decided and kept by Python (app.tech_*), then its projects ring."""
    wid = LG.write_id("technology", action)
    env = await LG.python("technology", action, LG.user_of(s, action), payload, write=wid)
    if env is None:
        log.warning("technology: %s was not answered by Python", action)
        return dict(TECH_UNKEPT)
    if env.get("status") == 200:
        live_notify.dirty(["techProjects"])
        log.info("technology: %s %s by %s", action, payload.get("name"), s.uid)
    return {k: v for k, v in env.items() if k in ("status", "data", "message")}


async def tech_status(request: Request) -> Response:
    """The Technology status dropdown."""
    s, refused = await _tech_actor(request)
    if refused is not None:
        return LG.answer(refused)
    body = await LG.body_json(request)
    if not isinstance(body, dict):
        return LG.answer({"status": 400, "message": "invalid body"})
    name = str(body.get("name") or "").strip()[:200]
    status = str(body.get("status") or "").strip()
    if not name:
        return LG.answer({"status": 400, "message": "name is required"})
    if status not in TECH_STATUSES:
        return LG.answer({"status": 400, "message": "status must be one of: " + ", ".join(TECH_STATUSES)})
    return LG.answer(await _tech_write(s, "techStatusSet", {"name": name, "status": status}))


async def tech_manual(request: Request) -> Response:
    """Add or delete a hand-tracked Technology project."""
    s, refused = await _tech_actor(request)
    if refused is not None:
        return LG.answer(refused)
    body = await LG.body_json(request)
    if not isinstance(body, dict):
        return LG.answer({"status": 400, "message": "invalid body"})
    op = str(body.get("op") or "").strip()
    name = str(body.get("name") or "").strip()[:200]
    if not name:
        return LG.answer({"status": 400, "message": "name is required"})
    return LG.answer(await _tech_write(s, "techManualSave", {
        "op": op, "name": name, "category": str(body.get("category") or ""),
        "status": str(body.get("status") or "Not started"), "blurb": str(body.get("blurb") or "")}))


# ---- the runbook and the versions box --------------------------------------------------------------------------------

async def production_actions(request: Request) -> Response:
    """Both runbook houses, and the test-mode switch — the master's own session alone."""
    return LG.answer(await _production_actions(request), no_store=True)


async def _production_actions(request: Request) -> dict[str, Any]:
    s = await LG.session(LG.token_of(request))
    who = LG.actor(s)
    if who is None or str(who[0] or "").strip().lower() != "admin" or not LG.is_master(s):
        return dict(LG.UNKNOWN_LANE)
    env = await LG.python("production-actions", "productionActionsView", LG.user_of(s, "productionActionsView"), {})
    if not env or env.get("status") != 200 or not isinstance(env.get("data"), dict):
        log.warning("production actions: the view was not answered by Python (%s)",
                    "deferred" if env is None else env.get("status"))
        return {"status": 503, "reason": "unavailable",
                "message": "The runbook could not be read just now. Try again in a moment."}
    data = env["data"]
    data["test_mode"] = await run_in_threadpool(LG.in_reads, LG.switch)
    return {"status": 200, "data": data}


ENGINE_BUILD_PATH = Path(os.getenv("HUB_ENGINE_BUILD_PATH", str(FD.PACKS_DIR / "engine-build.json")))
# the versions box's relay row: the relay is retired, so it names no code (the chip says so)
RELAY_RETIRED = {"code": "", "started_at": "", "why": "the relay is retired"}


def _engine_build() -> str:
    """The Apps Script build the relay last heard, kept beside the packs; else HUB_GAS_ENGINE_BUILD."""
    try:
        kept = str(json.loads(ENGINE_BUILD_PATH.read_text(encoding="utf-8")).get("build") or "")
    except Exception:  # noqa: BLE001 - no file is no build
        kept = ""
    return kept or os.getenv("HUB_GAS_ENGINE_BUILD", "").strip()


async def versions(request: Request) -> Response:
    """The master's versions box: the code asa-hub-app runs and since when (the relay's row says it is retired), and
    the Apps Script build that last answered."""
    return LG.answer(await _versions(request), no_store=True)


async def _versions(request: Request) -> dict[str, Any]:
    if not LG.is_master(await LG.session(LG.token_of(request))):
        return dict(LG.UNKNOWN_LANE)
    M = FD.M
    python: dict[str, Any] = {"code": str(M.CODE_STAMP), "started_at": str(M.STARTED_AT), "why": ""}
    try:
        await run_in_threadpool(M.DB.catalog)
    except Exception:  # noqa: BLE001 - said in the box
        python["why"] = "asa-hub-app answered without its health"
    return {"status": 200, "data": {"relay": dict(RELAY_RETIRED), "python": python,
                                    "engine_build": await run_in_threadpool(_engine_build)}}


# ---- web push (server/web_push.py): kept for the session's account, never an id from the body -----------------------

VAPID_FILE = Path(os.getenv("HUB_WEBPUSH_VAPID_FILE", "/run/secrets/webpush-vapid.json"))
DEVICES_PER_ACCOUNT = int(os.getenv("HUB_WEBPUSH_DEVICES", "8"))
PUSH_HOSTS = tuple(h.strip().lower() for h in os.getenv(
    "HUB_WEBPUSH_HOSTS",
    "fcm.googleapis.com,android.googleapis.com,push.services.mozilla.com,push.apple.com,notify.windows.com",
).split(",") if h.strip())
SUBS = "app.asa_hub_push_subs"
_KEYS: dict[str, Any] = {"mtime": None, "path": None, "value": None}


def _b64url_decode(text: str) -> bytes:
    raw = str(text or "").strip()
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def push_keys(path: Path | None = None) -> dict[str, Any]:
    """web_push.keys: the VAPID keys, checked whole, or why there are none."""
    target = path or VAPID_FILE
    try:
        mtime = target.stat().st_mtime
    except FileNotFoundError:
        return {"ok": False, "why": f"no VAPID keys at {target} — run tools/mint_vapid_keys.py"}
    except OSError as exc:
        return {"ok": False, "why": f"the VAPID key file cannot be read ({type(exc).__name__})"}
    if _KEYS["path"] == str(target) and _KEYS["mtime"] == mtime and _KEYS["value"]:
        return _KEYS["value"]
    try:
        body = json.loads(target.read_text(encoding="utf-8"))
        pub, priv = str(body["public_key"]), str(body["private_key"])
        subject = str(body.get("subject") or "")
        point, scalar = _b64url_decode(pub), _b64url_decode(priv)
    except Exception as exc:  # noqa: BLE001 - a broken file is no keys, said as such
        return {"ok": False, "why": f"the VAPID key file is not usable ({type(exc).__name__})"}
    if len(point) != 65 or point[0] != 4:
        return {"ok": False, "why": "the VAPID public key is not an uncompressed P-256 point"}
    if len(scalar) != 32:
        return {"ok": False, "why": "the VAPID private key is not a 32-byte P-256 scalar"}
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        return {"ok": False, "why": "the VAPID subject must be a mailto: or https:// address"}
    value = {"ok": True, "public_key": pub.rstrip("="), "why": ""}
    _KEYS.update({"path": str(target), "mtime": mtime, "value": value})
    return value


def _push_host(endpoint: str) -> bool:
    host = urllib.parse.urlsplit(endpoint).hostname or ""
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def _canonical_endpoint(endpoint: str) -> str | None:
    """Anything two URL parsers could disagree about is refused."""
    if "\\" in endpoint or "@" in endpoint or "#" in endpoint:
        return None
    try:
        parts = urllib.parse.urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or parts.username or parts.password or parts.fragment:
        return None
    if port not in (None, 443):
        return None
    host = (parts.hostname or "").strip().lower()
    if not host or not re.fullmatch(r"[a-z0-9.-]+", host):
        return None
    rebuilt = urllib.parse.urlunsplit(("https", host, parts.path or "/", parts.query, ""))
    try:
        from urllib3.util import parse_url  # noqa: PLC0415 - the sender's own parser, when installed
    except Exception:  # noqa: BLE001
        return rebuilt
    try:
        theirs = parse_url(rebuilt)
    except Exception:  # noqa: BLE001
        return None
    if (theirs.host or "").lower() != host or theirs.port not in (None, 443) or theirs.auth:
        return None
    return rebuilt


def clean_subscription(raw: Any) -> dict[str, str] | None:
    """web_push.clean_subscription: a browser's subscription to a known push service, or None."""
    if not isinstance(raw, dict):
        return None
    endpoint = str(raw.get("endpoint") or "").strip()
    got_keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
    p256dh, auth = str(got_keys.get("p256dh") or "").strip(), str(got_keys.get("auth") or "").strip()
    if not endpoint.startswith("https://") or len(endpoint) > 2048 or re.search(r"\s", endpoint):
        return None
    endpoint = _canonical_endpoint(endpoint) or ""
    if not endpoint or not _push_host(endpoint):
        return None
    try:
        if len(_b64url_decode(p256dh)) != 65 or len(_b64url_decode(auth)) != 16:
            return None
    except Exception:  # noqa: BLE001
        return None
    return {"endpoint": endpoint, "p256dh": p256dh, "auth": auth}


def push_subscribe(uid: str, role: str, sub: dict[str, str], ua: str = "") -> dict[str, Any]:
    """Blocking: this device kept for the account, its oldest past DEVICES_PER_ACCOUNT let go."""
    uid = str(uid or "").strip()
    if not uid:
        raise ValueError("a device is kept for an account, and this session carries none")
    c = _store().conn()
    with c.transaction():
        cur = c.cursor()
        cur.execute(
            f"INSERT INTO {SUBS} (endpoint, user_id, p256dh, auth, role, ua) "
            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (endpoint) DO UPDATE SET "
            "user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, "
            "role=EXCLUDED.role, ua=EXCLUDED.ua, seen_at=now(), fails=0 "
            "RETURNING (xmax = 0) AS fresh",
            (sub["endpoint"], uid, sub["p256dh"], sub["auth"], str(role or "")[:40], str(ua or "")[:300]))
        fresh = bool((cur.fetchone() or [False])[0])
        cur.execute(
            f"DELETE FROM {SUBS} WHERE user_id=%s AND endpoint IN ("
            f"SELECT endpoint FROM {SUBS} WHERE user_id=%s ORDER BY seen_at DESC OFFSET %s)",
            (uid, uid, DEVICES_PER_ACCOUNT))
        cur.execute(f"SELECT count(*) FROM {SUBS} WHERE user_id=%s", (uid,))
        devices = int(cur.fetchone()[0])
    return {"kept": True, "fresh": fresh, "devices": devices}


def push_unsubscribe(uid: str, endpoint: str) -> int:
    """Blocking: one of the account's own devices let go."""
    raw = str(endpoint or "")
    c = _store().conn()
    with c.transaction():
        cur = c.cursor()
        cur.execute(f"DELETE FROM {SUBS} WHERE endpoint = ANY(%s) AND user_id=%s",
                    (sorted({raw, _canonical_endpoint(raw) or raw}), str(uid or "")))
        gone = cur.rowcount
    return int(gone or 0)


async def push_key(request: Request) -> Response:
    """{key, why} — the VAPID public key, or null and why."""
    if LG.actor(await LG.session(LG.token_of(request))) is None:
        return LG.answer({"status": 401, "message": "sign in first"})
    got = await run_in_threadpool(push_keys)
    return LG.answer({"status": 200, "data": {"key": got.get("public_key") if got.get("ok") else None,
                                              "why": got.get("why") or ""}})


async def push_subscribe_door(request: Request) -> Response:
    """Keep this browser's push subscription for the signed-in account."""
    who = LG.actor(await LG.session(LG.token_of(request)))
    if who is None:
        return LG.answer({"status": 401, "message": "sign in first"})
    if not who[1]:
        return LG.answer({"status": 403, "message": "this session carries no account to keep a device for"})
    body = await LG.body_json(request)
    if body is LG.INVALID:
        return LG.answer({"status": 400, "message": "invalid body"})
    body = body if isinstance(body, dict) else {}
    sub = clean_subscription(body.get("subscription"))
    if sub is None:
        return LG.answer({"status": 400, "message": "not a push subscription this relay can write to"})
    if not (await run_in_threadpool(push_keys)).get("ok"):
        return LG.answer({"status": 409, "message": "this relay has no push keys yet, so nothing could reach the device"})
    try:
        kept = await run_in_threadpool(push_subscribe, who[1], who[0], sub,
                                       str(body.get("ua") or request.headers.get("user-agent") or ""))
    except Exception as exc:  # noqa: BLE001
        log.warning("web push: a device could not be kept (%s)", type(exc).__name__)
        return LG.answer({"status": 502, "message": f"not kept ({type(exc).__name__})"})
    if kept.get("fresh"):
        log.info("web push: a device was kept for %s (%s device(s) on the account)", who[1], kept.get("devices"))
    return LG.answer({"status": 200, "data": kept})


async def push_unsubscribe_door(request: Request) -> Response:
    """Let one of this account's own devices go."""
    who = LG.actor(await LG.session(LG.token_of(request)))
    if who is None:
        return LG.answer({"status": 401, "message": "sign in first"})
    body = await LG.body_json(request)
    if body is LG.INVALID:
        return LG.answer({"status": 400, "message": "invalid body"})
    endpoint = str(body.get("endpoint") or "") if isinstance(body, dict) else ""
    if not endpoint.startswith("https://"):
        return LG.answer({"status": 400, "message": "endpoint is required"})
    try:
        gone = await run_in_threadpool(push_unsubscribe, who[1], endpoint)
    except Exception as exc:  # noqa: BLE001
        return LG.answer({"status": 502, "message": f"not removed ({type(exc).__name__})"})
    return LG.answer({"status": 200, "data": {"removed": gone}})


# ---- House Supplies: the pharmacy's reports (server/house_meds.py scope_of; Python's houseMeds* doors) ---------------

MEDS_HM_BADGE = "HM"
MEDS_REFUSED_ROLES = frozenset({"client", "guardian"})
MEDS_REFUSED_BADGES = frozenset({"CLIENT", "FAMILY", "SSA"})
MEDS_CLIENT_SCOPE = {"reader": True, "writer": False, "every_house": True, "houses": [],
                     "managers_readable": True, "why": ""}
MEDS_CLIENT_SHUT = {"status": 403, "reason": "badge",
                    "message": "One client's prescriptions are not open to this account."}
MEDS_WRITERS = "Importing the pharmacy's reports is for the badges that decide every house."


def meds_scope(who: dict[str, Any]) -> dict[str, Any]:
    """house_meds.scope_of: what a reader may see (who: the Requests lanes' reader)."""
    role = str(who.get("role") or "").strip().lower()
    badges = {str(b).strip().upper() for b in (who.get("badges") or [])}
    base = {"reader": False, "writer": False, "every_house": False, "houses": [],
            "managers_readable": bool(who.get("managers_readable", True)), "why": ""}
    if role in MEDS_REFUSED_ROLES or badges & MEDS_REFUSED_BADGES:
        return {**base, "why": "The pharmacy's reports are not open to client or guardian accounts."}
    every = bool(who.get("decides_everywhere"))
    houses = sorted({str(h).strip().upper() for h in (who.get("manages") or []) if str(h).strip()})
    hm = MEDS_HM_BADGE in badges or bool(houses)
    if every:
        return {**base, "reader": True, "writer": True, "every_house": True}
    if hm:
        why = "" if houses else ("The house managers could not be read, so no house is shown."
                                 if not base["managers_readable"] else
                                 "The hotline calendar names you as the manager of no house today.")
        return {**base, "reader": True, "houses": houses, "why": why}
    return {**base, "why": "The pharmacy's reports are open to the house managers of their houses and to "
                           "the badges that decide every house."}


async def _meds_reader(s: Any, *, writer: bool = False) -> tuple[dict[str, Any], dict[str, Any]] | dict[str, Any]:
    """(who, scope) or the refusal envelope."""
    gate = await LG.gate(s, "house-supplies", refuse_roles=("onboarding", "interviewer"), app_label="House Supplies")
    if isinstance(gate, dict):
        return LG.refusal(gate)
    got = await LG.viewer(s)
    if isinstance(got, dict):
        return {**got, "reason": got.get("reason") or "unreadable"}
    who, _session = got
    scope = meds_scope(who)
    if not scope["reader"]:
        return {"status": 403, "reason": "badge", "message": scope["why"]}
    if writer and not scope["writer"]:
        return {"status": 403, "reason": "badge", "message": MEDS_WRITERS}
    return who, scope


async def _meds_client_reader(request: Request, s: Any) -> dict[str, Any] | None:
    """FAIL-CLOSED: None when one client's prescriptions are open to the session, else the refusal envelope."""
    if not LG.token_of(request):
        return {"status": 401, "reason": "session", "message": "sign in first"}
    if LG.is_master(s):
        return None
    if await LG.released(s, "client-profiles"):
        return None
    return dict(MEDS_CLIENT_SHUT)


def _meds_label(who: dict[str, Any], s: Any) -> str:
    return str(who.get("name") or f"account {s.uid}")


async def _meds_read(request: Request, action: str, extra: dict[str, Any], failed: str) -> dict[str, Any]:
    client = LG.query(request, "client").strip()[:120]
    s = await LG.session(LG.token_of(request))
    if client:
        shut = await _meds_client_reader(request, s)
        if shut is not None:
            return shut
        scope = dict(MEDS_CLIENT_SCOPE)
    else:
        got = await _meds_reader(s)
        if isinstance(got, dict):
            return got
        _who, scope = got
    env = await LG.python("house-supplies", action, LG.user_of(s, action), {"scope": scope, **extra, "client": client})
    if env is None:
        return {"status": 503, "reason": "unreadable", "message": f"{failed} (Python did not answer)."}
    return env


async def meds(request: Request) -> Response:
    """The Medications tab and the hero, scoped to the reader; `?since=` answers `{unchanged}` while nothing moved."""
    return LG.answer(await _meds_read(request, "houseMedsView", {"since": LG.query(request, "since")[:40]},
                                      "The pharmacy reports could not be read"), no_store=True)


async def meds_rx(request: Request) -> Response:
    """One prescription's history."""
    return LG.answer(await _meds_read(request, "houseMedsRx", {"key": LG.query(request, "key")[:64]},
                                      "The prescription could not be read"), no_store=True)


async def _meds_write(request: Request, action: str, payload_of: Any, failed: str) -> dict[str, Any]:
    s = await LG.session(LG.token_of(request))
    got = await _meds_reader(s, writer=True)
    if isinstance(got, dict):
        return got
    who, scope = got
    body = await LG.body_json(request)
    payload = payload_of(body, who, s)
    if isinstance(payload.get("status"), int):
        return payload
    wid = LG.write_id(s.uid, action, json.dumps(payload, sort_keys=True))
    env = await LG.python("house-supplies", action, LG.user_of(s, action), {"scope": scope, **payload}, write=wid)
    if env is None:
        return {"status": 503, "reason": "unreadable", "message": f"{failed} (Python did not answer)."}
    return env


def _commit_payload(body: Any, who: dict[str, Any], s: Any) -> dict[str, Any]:
    if body is LG.INVALID or (body is not None and not isinstance(body, dict)):
        return {"status": 400, "reason": "request", "message": "Send {staged: [stage ids]}."}
    raw = (body or {}).get("staged") or []
    staged = [str(x) for x in raw if str(x).strip()][:200] if isinstance(raw, list) else []
    if not staged:
        return {"status": 400, "reason": "request", "message": "Nothing was named to import."}
    return {"stage_ids": staged[:50], "actor_uid": str(s.uid), "actor_label": _meds_label(who, s)}


def _match_payload(body: Any, who: dict[str, Any], s: Any) -> dict[str, Any]:
    if body is LG.INVALID:
        return {"status": 400, "reason": "request", "message": "Send {patid, client_key}."}
    body = body if isinstance(body, dict) else {}
    return {"patid": str(body.get("patid") or "")[:40], "client_key": str(body.get("client_key") or "")[:120],
            "same_as": str(body.get("same_as") or "")[:40], "by": _meds_label(who, s)}


async def meds_commit(request: Request) -> Response:
    """Import the staged files named — by stage id, never a line: the rows come only from the staging."""
    env = await _meds_write(request, "houseMedsCommit", _commit_payload, "The import could not be written")
    if env.get("status") == 200:
        log.info("house meds: commit (Python) → %s", (env.get("data") or {}).get("counts"))
    return LG.answer(env, no_store=True)


async def meds_match(request: Request) -> Response:
    """A person's match of a PatID to a client (or to another PatID of the same person)."""
    return LG.answer(await _meds_write(request, "houseMedsMatch", _match_payload, "The match could not be written"),
                     no_store=True)


# the import desk (app/house_meds_import.py): the lane's tables written here, as the relay's own doors wrote them
MEDS_DOWN = {"status": 503, "reason": "unreadable", "message": "The pharmacy reports lane is not loaded on this server."}
MEDS_TOO_BIG = {"status": 413, "reason": "request",
                "message": "The file is larger than 5 MB — not a pharmacy report. Nothing was kept."}
MEDS_BODY_CAP = HMI.MAX_BYTES * 4 // 3 + 64 * 1024


async def _meds_desk(request: Request) -> tuple[Any, dict[str, Any] | None]:
    """(the session, the actor) for a writer of the import desk, or the refusal envelope."""
    if not await run_in_threadpool(HMI.ready):
        return None, dict(MEDS_DOWN)
    s = await LG.session(LG.token_of(request))
    got = await _meds_reader(s, writer=True)
    if isinstance(got, dict):
        return None, got
    who, _scope = got
    return (s, {"uid": str(s.uid), "label": _meds_label(who, s)}), None


async def meds_preview(request: Request) -> Response:
    """One dropped file: parsed once, judged, staged when new — every verdict that needs no person recorded."""
    got, shut = await _meds_desk(request)
    if shut is not None:
        return LG.answer(shut, no_store=True)
    s, actor = got
    declared = str(request.headers.get("content-length") or "").strip()
    if declared.isdigit() and int(declared) > MEDS_BODY_CAP:
        return LG.answer(dict(MEDS_TOO_BIG), no_store=True)
    held = bytearray()
    async for chunk in request.stream():
        held += chunk
        if len(held) > MEDS_BODY_CAP:
            return LG.answer(dict(MEDS_TOO_BIG), no_store=True)
    try:
        body = json.loads(bytes(held))
        raw = base64.b64decode(str((body or {}).get("b64") or ""), validate=True)
    except Exception:  # noqa: BLE001
        return LG.answer({"status": 400, "reason": "request", "message": "Send {name, size, b64} — one file per request."},
                         no_store=True)
    name = str((body or {}).get("name") or "")
    if not raw:
        return LG.answer({"status": 400, "reason": "request", "message": "The file arrived empty."}, no_store=True)
    try:
        data = await run_in_threadpool(HMI.preview_now, name=name, data=raw, actor=actor)
    except Exception as exc:  # noqa: BLE001
        log.warning("house meds: the preview failed (%s)", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The file could not be judged ({type(exc).__name__}). Nothing was imported."},
                         no_store=True)
    log.info("house meds: a file was dropped by %s → %s", s.uid, data.get("verdict"))
    return LG.answer({"status": 200, "data": data}, no_store=True)


async def meds_folder(request: Request) -> Response:
    """Read the Drive folder: what is on file is skipped without a download, at most a batch of new files is read."""
    got, shut = await _meds_desk(request)
    if shut is not None:
        return LG.answer(shut, no_store=True)
    s, actor = got
    try:
        data = await run_in_threadpool(HMI.folder_now, actor=actor)
    except Exception as exc:  # noqa: BLE001
        log.warning("house meds: the folder read failed (%s)", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The folder could not be read ({type(exc).__name__})."}, no_store=True)
    if data.get("busy"):
        return LG.answer({"status": 409, "reason": "busy", "message": f"The folder is being read by {data.get('by')}.",
                          "data": data}, no_store=True)
    if data.get("error"):
        return LG.answer({"status": 502, "reason": "unreadable",
                          "message": f"The folder could not be read — {data['error']}.", "data": data}, no_store=True)
    log.info("house meds: folder read by %s — %s listed, %s on file, %s downloaded, %s remaining",
             s.uid, data.get("listed"), data.get("known"), data.get("downloaded"), data.get("remaining"))
    return LG.answer({"status": 200, "data": data}, no_store=True)


# ---- Smart Comms' broadcast: who is PRN (service identity only) ------------------------------------------------------

PRN_SHEET = "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU"
PRN_TAB = "Staff Preferences"
_PRN_WORD = re.compile(r"\bprn\b", re.IGNORECASE)


def _prn_key(name: str) -> str:
    """Clients.gs clientNameKey_."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def prn_from_staff(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """staff_broadcast.prn_from_staff: only a note of exactly "PRN" counts."""
    names: list[str] = []
    exact: set[str] = set()
    for r in rows:
        name, note = str(r.get("name") or "").strip(), str(r.get("note") or "").strip()
        key = _prn_key(name)
        if not key or key in exact or note.upper() != "PRN":
            continue
        exact.add(key)
        names.append(name)
    mentions: list[dict[str, str]] = []
    said: set[str] = set()
    for r in rows:
        name, note = str(r.get("name") or "").strip(), str(r.get("note") or "").strip()
        key = _prn_key(name)
        if not key or key in exact or key in said or not _PRN_WORD.search(note):
            continue
        said.add(key)
        mentions.append({"name": name, "note": note[:80]})
    return {"names": names, "mentions": mentions}


def prn_view() -> dict[str, Any]:
    """Blocking: staff_broadcast.prn_view off asa-hub-db's copy of the master calendar's Staff Preferences."""
    def read(reads: Any) -> dict[str, Any]:
        ref = reads.tab_of(PRN_SHEET, PRN_TAB, "the master calendar")
        if ref is None:
            raise LookupError("the master calendar has no tab named " + PRN_TAB)
        heads = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
        name_h, note_h = heads.get("Select Your Name"), heads.get("NOTE")
        rows = [{"name": str(gsjs.or_blank(raw.get(name_h)) if name_h else "").strip(),
                 "note": str(gsjs.or_blank(raw.get(note_h)) if note_h else "").strip()}
                for _rn, raw in reads.db.rows(ref)]
        rows = sorted((r for r in rows if r["name"]), key=lambda r: r["name"].lower())
        out = prn_from_staff(rows)
        as_of = reads.db.as_of({PRN_SHEET})
        out.update(readable=True, rows=len(rows),
                   as_of=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(as_of)) if as_of else "")
        return out
    return LG.in_reads(read)


def _service_ok(body: dict[str, Any]) -> bool:
    secret = os.getenv("HUB_SERVICE_SECRET", "")
    return bool(secret) and hmac.compare_digest(str(body.get("service_secret") or ""), secret)


async def broadcast_prn(request: Request) -> Response:
    """Who is PRN; service identity only; an unreadable copy answers 502."""
    body = await LG.body_json(request)
    if body is LG.INVALID:
        return LG.answer({"status": 400, "message": "invalid body"})
    if not isinstance(body, dict) or not _service_ok(body):
        return LG.answer({"status": 401, "message": "service identity required"})
    try:
        view = await run_in_threadpool(prn_view)
    except Exception as exc:  # noqa: BLE001
        log.warning("broadcast/prn: the Staff Preferences copy could not be read (%s)", type(exc).__name__)
        return LG.answer({"status": 502,
                          "message": f"the Staff Preferences mirror could not be read ({type(exc).__name__})"})
    return LG.answer({"status": 200, "data": view})


def _vapid_readable() -> bool:
    try:
        return VAPID_FILE.is_file() and os.access(VAPID_FILE, os.R_OK)
    except OSError:
        return False


def install(app: Any) -> list[str]:
    """These doors on main.py's app, matched before the relay carrier; a group whose secret is not here is left to
    the relay, as before. The groups taken, by name."""
    taken: list[str] = []
    left: list[str] = []
    if _status_token():
        app.get("/hub-lanes/hub-containers")(hub_containers)
        taken.append("hub-containers")
    else:
        left.append("hub-containers (no status token)")
    if _vapid_readable():
        app.get("/hub-lanes/push/key")(push_key)
        app.post("/hub-lanes/push/subscribe")(push_subscribe_door)
        app.post("/hub-lanes/push/unsubscribe")(push_unsubscribe_door)
        taken.append("push")
    else:
        left.append("push (no VAPID file)")
    app.get("/hub-lanes/backends")(backends)
    app.post("/hub-lanes/backends")(backends_set)
    app.post("/hub-lanes/tech-status")(tech_status)
    app.post("/hub-lanes/tech-manual")(tech_manual)
    app.get("/hub-lanes/production-actions")(production_actions)
    app.get("/hub-lanes/versions")(versions)
    app.get("/hub-lanes/house-supplies/meds")(meds)
    app.get("/hub-lanes/house-supplies/meds/rx")(meds_rx)
    app.post("/hub-lanes/house-supplies/meds/commit")(meds_commit)
    app.post("/hub-lanes/house-supplies/meds/match")(meds_match)
    app.post("/hub-lanes/house-supplies/meds/preview")(meds_preview)
    app.post("/hub-lanes/house-supplies/meds/folder")(meds_folder)
    app.post("/hub-lanes/broadcast/prn")(broadcast_prn)
    my_lanes.install(app)
    taken += ["backends", "tech", "production-actions", "versions", "house-supplies meds", "broadcast/prn",
              "my-work", "my-profile", "my-calendar"]
    log.info("other lanes: answered here: %s; left to the relay: %s", ", ".join(taken), ", ".join(left) or "none")
    return taken
