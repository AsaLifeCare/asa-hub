"""The relay's service doors (server/snapshot_service.py), answered here in its words, statuses and headers: the mail
server's (service_mail.py), the records the old platform keeps (service_records.py), the forecast, the plan reader, a
Technology text, the Decoder lab's shelf, proposals, teach and Try, the cortex's admin reads and the courier of a
Drive upload. The Try reads with tesseract, which this image lacks: it is judged here and read on asa-hub-worker
(server/hub_worker.py). The clip probe stays the relay's: it reads with ffmpeg."""
from __future__ import annotations

import base64
import functools
import hmac
import json
import logging
import os
import time
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

import front_door as FD
import hubdb
import isp_decode as ID
import locations as L
import scope as sc

log = logging.getLogger("asa-hub-app.service-doors")

# the machine identity the service doors check, the relay's own
SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
# what the relay's write guard answers a session minted from the master's own, on any of its doors but /gas
SWITCHED_WRITE = {"status": 409, "code": "be_another_refused",
                  "message": "Not in a switched session: this door cannot take the write. "
                             "Press Be Back to do this as yourself."}

# ---- what every door here shares --------------------------------------------------------------------------------------


def secret_ok(body: Any) -> bool:
    """_mail_auth_ok: the service secret in the body, compared in constant time."""
    given = str(body.get("service_secret") or "") if isinstance(body, dict) else ""
    return bool(SERVICE_SECRET) and hmac.compare_digest(given, SERVICE_SECRET)


async def body_of(request: Request) -> dict[str, Any] | None:
    """The JSON body, None when it does not read as an object."""
    try:
        got = await request.json()
    except Exception:  # noqa: BLE001 - said by each door in its words
        return None
    return got if isinstance(got, dict) else None


def said(env: dict[str, Any], status_code: int = 200, headers: dict[str, str] | None = None) -> Response:
    """A dict the relay's route returned, as FastAPI renders it."""
    return JSONResponse(env, status_code=status_code, headers=headers)


def dumped(env: dict[str, Any], status_code: int) -> Response:
    """A Response(json.dumps(...)) the relay's route built itself."""
    return Response(content=json.dumps(env), status_code=status_code, media_type="application/json")


def bearer(request: Request) -> str:
    authorization = str(request.headers.get("authorization") or "")
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


async def write_refusal(request: Request) -> Response | None:
    """The relay's word, before any of its own write doors runs, to a session minted from the master's own: 409, the
    HTTP status saying it too."""
    token = bearer(request)
    if not token:
        return None
    s = await FD.session(token)
    if s is None or not s.ok or not s.acting:
        return None
    return Response(content=json.dumps(SWITCHED_WRITE).encode(), status_code=409, media_type="application/json")


def with_reads(fn: Callable[[L.Reads], Any]) -> Any:
    """Blocking: fn on one request's reads as main.py's doors have them, Python's own kept writes laid on the copy."""
    m = FD.M
    own = m._own()
    token = hubdb.OWN.set(own)
    try:
        return fn(L.Reads(m.DB, m.DRIVE))
    finally:
        hubdb.OWN.reset(token)
        if own is not None:
            m._finish(own)


_GATES_SAID: set[str] = set()


def _lane_held(gid: str, reads: L.Reads, person: bool = False) -> dict[str, Any] | None:
    import config_lane as CL  # noqa: PLC0415
    import smart_comms_desk as SCD  # noqa: PLC0415

    unread = ""
    try:
        armed = SCD.situation_on(SCD.situations(reads), gid) is not None
    except (sc.Defer, hubdb.Unreadable) as exc:
        # a gate not read is not armed: only a door that reaches a person is held by that
        if not person:
            return None
        armed, unread = False, str(exc)[:120] or type(exc).__name__
    if not armed and not unread:
        return None
    try:
        tm = CL.test_mode(reads.config())
    except (sc.Defer, hubdb.Unreadable):
        tm = None
    if unread:
        if isinstance(tm, dict) and tm.get("on") is False and not tm.get("unreadable"):
            return None
        why = (f"{gid} hands a person something that cannot be taken back, and whether it is armed could not be "
               f"read ({unread}) while the send switch holds — held rather than done")
    elif not isinstance(tm, dict):
        why = (f"{gid} is armed and the send switch could not be read (the configuration the relay reads does not "
               "carry test mode (Bundle.gs configLane has no test_mode part)), which holds")
    elif tm.get("unreadable"):
        why = (f"{gid} is armed and the send switch could not be read (Apps Script could not read test mode "
               f"({str(tm.get('unreadable'))[:120]})), which holds")
    elif tm.get("on") is False:
        return None
    else:
        why = f"{gid} is armed and the send switch is on"
    if gid not in _GATES_SAID:
        _GATES_SAID.add(gid)
        log.info("lane gate: %s", why)
    return {"status": 409, "message": why, "held": True}


async def lane_refusal(gid: str, person: bool = False) -> dict[str, Any] | None:
    """lane_gate.holds then lane_gate.refused, on this app's reading of the Desk's situations and the send switch (what
    config_lane hands the relay): the 409 a held door answers, or None. A door that hands a person something that
    cannot be taken back (`person`) is held by a gate that could not be read."""
    try:
        return await run_in_threadpool(with_reads, functools.partial(_lane_held, gid, person=person))
    except Exception as exc:  # noqa: BLE001 - an unread gate holds no door that reaches no person
        log.info("lane gate: %s not read (%s)", gid, type(exc).__name__)
        if not person:
            return None
        return {"status": 409,
                "message": f"{gid} hands a person something that cannot be taken back, and whether it is armed "
                           f"could not be read ({type(exc).__name__}) while the send switch holds — held rather "
                           "than done", "held": True}


# ---- /weather: one forecast for Columbus, OH, held half an hour -------------------------------------------------------

WEATHER_LAT, WEATHER_LON = 39.9612, -82.9988
WEATHER_TTL_S = 1800.0
WEATHER_URL = ("https://api.open-meteo.com/v1/forecast"
               f"?latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
               "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
               "&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m"
               "&temperature_unit=fahrenheit&wind_speed_unit=mph"
               "&timezone=America%2FNew_York&forecast_days=16")
_WEATHER: dict[str, Any] = {"at": 0.0, "data": None}


def weather_icon(code: int) -> str:
    """WMO weather_code: the small vocabulary the UI draws."""
    if code == 0:
        return "sun"
    if code in (1, 2):
        return "partsun"
    if code == 3:
        return "cloud"
    if code in (45, 48):
        return "fog"
    if code in (56, 57, 66, 67):
        return "sleet"
    if 51 <= code <= 65 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow"
    if code >= 95:
        return "storm"
    return "cloud"


def forecast(raw: dict[str, Any], now: float) -> dict[str, Any]:
    daily = raw.get("daily") or {}
    dates = daily.get("time") or []
    codes = daily.get("weather_code") or []
    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []
    rain = daily.get("precipitation_probability_max") or []
    days = []
    for i, d in enumerate(dates):
        code = int(codes[i]) if i < len(codes) and codes[i] is not None else 3
        days.append({
            "date": str(d), "code": code, "icon": weather_icon(code),
            "tmax": round(tmax[i]) if i < len(tmax) and tmax[i] is not None else None,
            "tmin": round(tmin[i]) if i < len(tmin) and tmin[i] is not None else None,
            "rain": int(rain[i]) if i < len(rain) and rain[i] is not None else 0,
        })
    cur = raw.get("current") or {}
    cur_code = int(cur.get("weather_code") or 3)
    return {
        "place": "Columbus, OH",
        "now": {
            "temp": round(cur.get("temperature_2m")) if cur.get("temperature_2m") is not None else None,
            "code": cur_code, "icon": weather_icon(cur_code), "humidity": cur.get("relative_humidity_2m"),
            "wind": round(cur.get("wind_speed_10m")) if cur.get("wind_speed_10m") is not None else None,
        },
        "days": days,
        "fetched_at": int(now),
    }


async def weather() -> Response:
    """GET /weather: the forecast, stale before blank."""
    import httpx  # noqa: PLC0415

    now = time.time()
    if _WEATHER["data"] is not None and now - _WEATHER["at"] < WEATHER_TTL_S:
        return said({"status": 200, "data": _WEATHER["data"]})
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(WEATHER_URL)
            resp.raise_for_status()
            raw = resp.json()
    except Exception as exc:  # noqa: BLE001
        log.warning("weather: upstream failed (%s)", type(exc).__name__)
        if _WEATHER["data"] is not None:
            return said({"status": 200, "data": _WEATHER["data"]})
        return said({"status": 502, "message": f"forecast unavailable ({type(exc).__name__})"})
    data = forecast(raw, now)
    _WEATHER["at"], _WEATHER["data"] = now, data
    return said({"status": 200, "data": data})


# ---- /isp/decode: an OhioISP plan in, the seventeen flat fields out ----------------------------------------------------

def _isp_read(text: str, pdf_b64: str) -> tuple[dict[str, Any], str]:
    if pdf_b64:
        text = ID.pdf_text(base64.b64decode(pdf_b64))
    return ID.flatten(ID.parse_isp_text(text, prune=False)), text


async def isp_decode(request: Request) -> Response:
    refused = await write_refusal(request)
    if refused is not None:
        return refused
    body = await body_of(request) or {}
    if not secret_ok(body):
        return dumped({"status": 401, "message": "Authentication required."}, 401)
    text = str(body.get("text") or "")
    pdf_b64 = str(body.get("pdf_b64") or "")
    if not text and not pdf_b64:
        return dumped({"status": 400, "message": "Send the plan: `pdf_b64` or `text`."}, 400)
    try:
        flat, text = await run_in_threadpool(_isp_read, text, pdf_b64)
    except Exception as exc:  # noqa: BLE001
        log.warning("isp decode failed: %s", str(exc)[:200])
        return dumped({"status": 500, "message": "The plan could not be read: " + str(exc)[:140]}, 500)
    return dumped({"status": 200, "data": {"fields": flat, "pages": text.count("\f") + 1 if text else 0,
                                           "chars": len(text), "raw_text": text}}, 200)


# ---- /techdocs/text/{id}: a Technology .md/.txt off the server's own copy ---------------------------------------------

TECH_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}


async def techdocs_text(file_id: str, request: Request) -> Response:
    """The text itself, or 404 while the copy is not kept (the reader then shows Drive's preview)."""
    token = bearer(request)
    s = await FD.session(token) if token else None
    if s is None or not s.ok:
        return dumped({"status": 401, "message": "sign in first"}, 401)
    if s.role not in ("admin", "manager"):
        return dumped({"status": 403, "message": "admins and managers only"}, 403)
    got = await FD.call_app("technology", "techDocFile", FD.said(s, {}, "techDocFile"),
                            {"file_id": file_id, "as": "original"})
    env = got[2] if got is not None else None
    if env is None:
        return dumped(dict(TECH_UNREAD), 503)
    if env.get("status") != 200:
        code = int(env.get("status") or 404)
        return dumped({"status": code, "message": str(env.get("message") or "not kept")}, code if code < 500 else 503)
    try:
        text = base64.b64decode(str((env.get("data") or {}).get("b64") or ""))
    except Exception:  # noqa: BLE001
        return dumped({"status": 404, "message": "not readable"}, 404)
    return Response(content=text, media_type="text/plain; charset=utf-8")


# ---- the Decoder lab: its shelf, its proposals, a decision and a teach, on Python's doors ------------------------------

DIGEST_APP = "digestlab"
LAB_ROLES = ("admin", "administrator", "director", "manager")
LAB_SIGN_IN = {"status": 401, "message": "sign in again"}
LAB_REFUSED = {"status": 403, "message": "the decoder lab is for admins and managers"}
DIGEST_GATE = "gate_digest_writes"


def _lab_open_in(s: Any, reads: L.Reads) -> bool:
    import digest_lab as D  # noqa: PLC0415

    user = FD.M.caller(FD.said(s, {}, "digestProposals"), reads, "digestProposals", D)
    return bool(D.lab_open(L.Session(reads, user)))


async def lab_gate(request: Request) -> tuple[Response | None, Any, str]:
    """_lab_gate: a live session, then the lab's own verdict (its roles, else its App Control rule); a verdict that
    cannot be read keeps the lab shut."""
    token = bearer(request)
    s = await FD.session(token) if token else None
    if s is None or not s.ok:
        return said(dict(LAB_SIGN_IN)), None, token
    if s.role.lower() not in LAB_ROLES:
        try:
            open_ = await run_in_threadpool(with_reads, functools.partial(_lab_open_in, s))
        except Exception as exc:  # noqa: BLE001
            log.info("decoder lab: the verdict could not be read (%s)", type(exc).__name__)
            open_ = False
        if not open_:
            return said(dict(LAB_REFUSED)), None, token
    return None, s, token


async def lab_door(action: str, payload: dict[str, Any], token: str, s: Any, write: bool) -> Response:
    """The lab's door on Python as the front door asks it (its receipts, settles and the relay's finish): its answer,
    and the phase the relay says on it."""
    env = {"token": token, "action": action, "payload": payload}
    door = FD.write if write else FD.read
    resp = await door(action, DIGEST_APP, env, FD.form_raw(env), s)
    try:
        answer = json.loads(bytes(resp.body or b""))
    except ValueError:
        answer = None
    if not isinstance(answer, dict):
        answer = dict(FD.UNWRITTEN if write else FD.UNREAD)
    phase = FD.header(resp, "X-Hub-Phase")
    return said(answer, headers={"X-Hub-Phase": phase} if phase is not None else None)


async def digest_proposals(request: Request) -> Response:
    """GET /digest/proposals (?scan=1 reads every ledger again and appends what it taught)."""
    refused, s, token = await lab_gate(request)
    if refused is not None:
        return refused
    scan = str(request.query_params.get("scan") or "") == "1"
    return await lab_door("digestScan" if scan else "digestProposals", {}, token, s, scan)


async def digest_decide(request: Request) -> Response:
    """POST /digest/proposals/decide: approve or reject one proposal."""
    refused_w = await write_refusal(request)
    if refused_w is not None:
        return refused_w
    refused, s, token = await lab_gate(request)
    if refused is not None:
        return refused
    body = await request.json() if await request.body() else {}
    pid = str(body.get("id") or "").strip()
    action = str(body.get("action") or "").strip().lower()
    category = str(body.get("category") or "").strip()
    if not pid or action not in ("approve", "reject"):
        return said({"status": 400, "message": "id and action (approve|reject) are required"})
    held = await lane_refusal(DIGEST_GATE)
    if held is not None:
        return said(held)
    return await lab_door("digestDecide", {"id": pid, "action": action, "category": category}, token, s, True)


async def digest_teach(request: Request) -> Response:
    """POST /digest/teach: one paper's kind corrected, its phrases proposed."""
    refused_w = await write_refusal(request)
    if refused_w is not None:
        return refused_w
    refused, s, token = await lab_gate(request)
    if refused is not None:
        return refused
    body = await request.json() if await request.body() else {}
    ledger = str(body.get("ledger") or "client_files").strip()
    rid = str(body.get("row_id") or "").strip()
    kind = str(body.get("kind") or "").strip()
    if not rid or not kind:
        return said({"status": 400, "message": "row_id and kind are required"})
    held = await lane_refusal(DIGEST_GATE)
    if held is not None:
        return said(held)
    return await lab_door("digestTeach", {"ledger": ledger, "row_id": rid, "kind": kind}, token, s, True)


async def digest_shelf(request: Request) -> Response:
    """GET /digest/shelf: everything already filed, as folders."""
    refused, s, token = await lab_gate(request)
    if refused is not None:
        return refused
    folder = str(request.query_params.get("folder") or "").strip()
    q = str(request.query_params.get("q") or "").strip().lower()
    limit = max(1, min(int(request.query_params.get("limit") or 200), 500))
    return await lab_door("digestShelf", {"folder": folder, "q": q, "limit": limit}, token, s, False)


# the lab's Try reads with tesseract, which this image lacks: asked of asa-hub-worker (server/hub_worker.py) on the
# backend network with the machine token, once the session and the lab's door are judged here
WORKER_URL = (os.getenv("HUB_WORKER_URL") or "http://asa-hub-worker:8091").rstrip("/")
WORKER_TOKEN = os.getenv("HUB_APP_TOKEN", "")
TRY_TIMEOUT_S = float(os.getenv("HUB_LAB_TRY_TIMEOUT_S", "600"))
TRY_UNREACHED = {"status": 503, "message": "the lab's reader could not be reached just now — try again in a moment"}


async def digest_try(request: Request) -> Response:
    """POST /digest/try: one document, both readings, and nothing moved — read on the worker."""
    import httpx  # noqa: PLC0415

    refused_w = await write_refusal(request)
    if refused_w is not None:
        return refused_w
    refused, _s, _token = await lab_gate(request)
    if refused is not None:
        return refused
    body = await body_of(request) or {}
    file_id = str(body.get("file_id") or "").strip()
    name = str(body.get("file_name") or "document").strip()
    if not file_id:
        return said({"status": 400, "message": "file_id is required"})
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(TRY_TIMEOUT_S, connect=5.0)) as client:
            res = await client.post(f"{WORKER_URL}/digest/try", json={"file_id": file_id, "file_name": name},
                                    headers={"X-Hub-Token": WORKER_TOKEN})
        if res.status_code != 200:
            log.warning("decoder lab: the worker answered the Try %s", res.status_code)
        env = res.json() if res.status_code == 200 else None
    except Exception as exc:  # noqa: BLE001
        log.warning("decoder lab: the worker's Try was not reached (%s)", type(exc).__name__)
        env = None
    if not isinstance(env, dict):
        return dumped(dict(TRY_UNREACHED), 503)
    return said(env)


# ---- the cortex's admin reads, forwarded whole -------------------------------------------------------------------------

# the cortex is retired (2026-10-27; it ran on the old platform, which is shut down): no address is asked, and every
# read below answers RETIRED to an admin
CORTEX_URL = ""
CORTEX_KEY = ""
CORTEX_READS = {"/cortex/mesh/graph": "/v1/cortex/mesh/graph", "/cortex/mesh/live": "/v1/cortex/mesh/live",
                "/cortex/health": "/health", "/cortex/fleet": "/v1/monitor/actions/recent?limit=5"}
CORTEX_RETIRED = {"status": 410, "reason": "retired",
                  "message": "The cortex is retired: it ran on the old platform, which is shut down."}


async def cortex_get(upstream: str, request: Request) -> Response:
    """_cortex_get: a live session, an admin, the machine credential; then the cortex's answer as it came."""
    import httpx  # noqa: PLC0415

    token = bearer(request)
    s = await FD.session(token) if token else None
    if s is None or not s.ok:
        return dumped({"status": 401, "message": "Authentication required."}, 401)
    if s.role != "admin":
        return dumped({"status": 403, "message": "Admins only."}, 403)
    if not CORTEX_URL:
        return dumped(dict(CORTEX_RETIRED), 410)
    if not CORTEX_KEY:
        return dumped({"status": 503, "message": "The cortex door is not configured on this server."}, 503)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{CORTEX_URL}{upstream}", headers={"Authorization": f"Bearer {CORTEX_KEY}"})
    except Exception as exc:  # noqa: BLE001
        log.warning("cortex mesh: %s unreachable: %s", upstream, str(exc)[:120])
        return dumped({"status": 502, "message": "The cortex did not answer."}, 502)
    if r.status_code != 200:
        log.warning("cortex mesh: %s answered %s", upstream, r.status_code)
        return dumped({"status": 502, "message": f"The cortex refused ({r.status_code})."}, 502)
    return Response(content=r.content, status_code=200, media_type="application/json")


def _cortex_door(upstream: str) -> Callable[[Request], Any]:
    async def door(request: Request) -> Response:
        return await cortex_get(upstream, request)
    return door


# ---- /upload-chunk: a courier between the page and Google's upload session, nothing more ------------------------------

DRIVE_SESSION_PREFIX = "https://www.googleapis.com/upload/drive/v3/files?"


async def upload_chunk(request: Request) -> Response:
    """One piece of a file the page sends, handed to the Drive upload session it names."""
    import httpx  # noqa: PLC0415

    refused = await write_refusal(request)
    if refused is not None:
        return refused
    session = str(request.headers.get("x-upload-session") or "").strip()
    content_range = str(request.headers.get("content-range") or "")
    if not session.startswith(DRIVE_SESSION_PREFIX):
        return dumped({"ok": False, "reason": "not an upload session"}, 403)
    body = await request.body()
    if not body:
        return dumped({"ok": False, "reason": "no bytes"}, 400)
    headers = {"Content-Length": str(len(body))}
    if content_range:
        headers["Content-Range"] = content_range
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            res = await client.put(session, content=body, headers=headers)
    except Exception as exc:  # noqa: BLE001 - the page must hear what happened
        return dumped({"ok": False, "reason": f"{type(exc).__name__}"}, 502)
    if res.status_code in (200, 201):
        try:
            got = res.json()
        except Exception:  # noqa: BLE001
            got = {}
        return dumped({"ok": True, "done": True, "file_id": got.get("id", ""), "name": got.get("name", "")}, 200)
    if res.status_code == 308:
        return dumped({"ok": True, "done": False, "range": res.headers.get("Range", "")}, 200)
    return dumped({"ok": False, "status": res.status_code, "reason": res.text[:200]}, 502)


# ---- the routes --------------------------------------------------------------------------------------------------------

def cortex_ready() -> bool:
    """The cortex's reads are always routed here: a cortex named (never the old platform's) is asked, else every
    read answers RETIRED, so no path falls through to Unknown."""
    return True


def install(app: Any) -> list[str]:
    """Every door above on main.py's app, matched before the relay carrier; a group whose prerequisite is not here is
    not registered, so its paths go on to the relay as before. The groups registered, said once."""
    import service_mail as SM  # noqa: PLC0415
    import service_records as SR  # noqa: PLC0415

    groups = {"mail": SM.ready(), "mail provision": SM.provision_ready(), "records": SR.ready(),
              "cortex": cortex_ready()}
    if groups["mail"]:
        for path, door in SM.ROUTES:
            app.post(path, include_in_schema=False)(door)
    if groups["mail provision"]:
        app.post("/mail/provision", include_in_schema=False)(SM.mail_provision)
    if groups["records"]:
        for path, door in SR.ROUTES:
            app.post(path, include_in_schema=False)(door)
    if groups["cortex"]:
        for path, upstream in CORTEX_READS.items():
            app.get(path, include_in_schema=False)(_cortex_door(upstream))
    here = ["weather, plan reader, techdocs, decoder lab (its Try on asa-hub-worker), courier"] + \
        [g for g, ok in groups.items() if ok]
    left = [g for g, ok in groups.items() if not ok]
    log.info("service doors: answered here — %s; left to the relay — %s", ", ".join(here),
             ", ".join(left) or "none")
    app.get("/weather", include_in_schema=False)(weather)
    app.post("/isp/decode", include_in_schema=False)(isp_decode)
    app.get("/techdocs/text/{file_id}", include_in_schema=False)(techdocs_text)
    app.get("/digest/proposals", include_in_schema=False)(digest_proposals)
    app.post("/digest/proposals/decide", include_in_schema=False)(digest_decide)
    app.post("/digest/teach", include_in_schema=False)(digest_teach)
    app.get("/digest/shelf", include_in_schema=False)(digest_shelf)
    app.post("/digest/try", include_in_schema=False)(digest_try)
    app.post("/upload-chunk", include_in_schema=False)(upload_chunk)
    return left
