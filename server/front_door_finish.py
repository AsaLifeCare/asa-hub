"""The relay's half of an answer asa-hub-app gave at its own front door (app/front_door.py).

gas_relay's work after Python answered, run here on that answer, so this relay goes on serving its kept copies, packs,
rings and sign-in tables as if it had carried the call itself: the tail of _backend_answer (Python's copy judged
against the writes this relay saw land, and how current it is), of _backend_write (_backend_final: taken back, or every
copy it changes read again; the hiring presses handed back) and of _auth_py_answer, then the observers of gas_relay's
answer and its kept read. The master's sign-in tries are counted by the front door itself, so that observer is not run
here.

Wired by `front_door_finish.install(app, globals())` from snapshot_service.py: every name is read from the relay's own
module at call time. POST /front-door/finish, asa-hub-app alone (X-Hub-Token); its body is two big-endian lengths, the
meta's JSON, the envelope as the relay's readers take it, then Python's answer. It answers 204 when the answer stands,
200 with the bytes that replace it, and X-Front-Door-Ring when the read is one a viewer keeps."""
from __future__ import annotations

import hmac
import json
import re
import struct
from typing import Any

from fastapi import Request
from fastapi.responses import Response

FINISH_PATH = "/front-door/finish"
DERIVED_PATH = "/slices/derived"
# gas_relay's answer observers, in its order: (observer, its arguments); the master's sign-in tries are the front door's
LOOP: tuple[tuple[str, str], ...] = (
    ("_relay_observe_auth", "raw content"),
    ("_relay_observe_be_another", "raw content"),
    ("_auth_py_released", "action raw content"),
    ("_relay_observe_chat", "raw content"),
    ("_relay_observe_chat_read", "raw content"),
    ("_chat_live_observed", "raw content gas"),
    ("_chat_push_observed", "raw content"),
    ("_relay_observe_access_write", "raw content"),
    ("_relay_observe_app_pack", "action raw content python"),
    ("_relay_observe_scheduling", "action content"),
    ("_relay_observe_support_desk", "action content"),
    ("_vehicle_calendar_rang", "action content"),
    ("_staff_profiles_rang", "action content"),
    ("_smart_comms_rang", "action content"),
    ("_forms_rang", "action content"),
    ("_support_desk_rang", "action content"),
    ("_docs_rang", "action content raw"),
    ("_learning_rang", "action content raw"),
    ("_recon_rang", "action content raw"),
    ("_viewer_cache_written", "action raw content"),
    ("_edit_overlay_config_seen", "action raw content"),
)
LOOP_LEFT_OUT = frozenset({"_master_sign_in_observed"})


def unframe(body: bytes) -> tuple[dict[str, Any], bytes, bytes]:
    """(meta, envelope, answer) out of the front door's body; ValueError when it is not one."""
    if len(body) < 16:
        raise ValueError("short")
    n_meta, n_raw = struct.unpack(">QQ", body[:16])
    if 16 + n_meta + n_raw > len(body):
        raise ValueError("lengths past the body")
    meta = json.loads(body[16:16 + n_meta])
    if not isinstance(meta, dict):
        raise ValueError("meta")
    return meta, body[16 + n_meta:16 + n_meta + n_raw], body[16 + n_meta + n_raw:]


def observe(ns: dict[str, Any], action: str, raw: bytes, content: bytes, only: Any = None) -> None:
    """gas_relay's answer loop on Python's answer (`only`: those observers alone, in its order); an observer never
    breaks the answer."""
    values = {"action": action, "raw": raw, "content": content}
    for name, spec in LOOP:
        if only is not None and name not in only:
            continue
        args = [values[a] for a in spec.split() if a in values]
        if "gas" in spec.split():
            args.append("gas")
        try:
            fn = ns[name]
            fn(*args, python=True) if "python" in spec.split() else fn(*args)
        except Exception:  # noqa: BLE001 - as each observer swallows its own
            continue


def _payload(ns: dict[str, Any], door: str, env: dict[str, Any]) -> dict[str, Any]:
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    return ns["_builder_payload"](door, env, payload)


def read_tail(ns: dict[str, Any], meta: dict[str, Any], raw: bytes, content: bytes) -> tuple[bytes, float]:
    """_backend_answer after _backend_call: Python's 503 when a write this relay saw landed after the copy was read,
    else the answer and how current it is."""
    app_id, door = str(meta["app_id"]), str(meta["door"])
    env = ns["_relay_envelope"](raw) or {}
    payload = _payload(ns, door, env)
    key = ns["_backend_key"](app_id, payload)
    keyless = not key and bool(ns["BACKEND_APPS"][app_id].get("any_key"))
    as_of, edits_at = float(meta["as_of"]), float(meta.get("edits_at") or 0.0)
    held = None if meta.get("held") is None else frozenset(str(w) for w in meta["held"])
    if ns["_backend_written_after"](app_id, key, as_of, held, any_key=keyless, edits_at=edits_at):
        said, at = ns["_backend_said_unread"](door, "a write landed after Python's copy was read")
        return said.content, at
    ns["_traffic_note"]("backend_python")
    fresh = ns["_backend_copy_at"](app_id, key, as_of, held, any_key=keyless, edits_at=edits_at)
    return content, as_of if fresh is None else fresh


async def write_tail(ns: dict[str, Any], meta: dict[str, Any], raw: bytes, content: bytes) -> bytes:
    """_backend_write's key for the write Python kept, then _backend_final: taken back and said 409, or answered with
    every copy and pack it changes read again (and App Control's own, _app_control_landed)."""
    app_id, door = str(meta["app_id"]), str(meta["door"])
    env = ns["_cert_papers_envelope"](raw) or {}
    payload = _payload(ns, door, env)
    plan = meta.get("plan") if isinstance(meta.get("plan"), dict) else {}
    spec = ns["BACKEND_APPS"][app_id]
    if app_id == "locations":
        house = str(plan.get("house") or payload.get("house") or "").strip().upper()
        key = house if re.fullmatch(ns["_APP_PACK_HOUSE_RE"], house) else ""
    else:
        named = spec.get("key", "house")
        given = next((payload.get(k) for k in spec.get("keys", ()) if payload.get(k)), payload.get(named))
        key = ns["_backend_key"](app_id, {named: plan.get("house") or given})
    held = None if meta.get("held") is None else frozenset(str(w) for w in meta["held"])
    res = await ns["_backend_final"](app_id, door, raw, str(meta["write_id"]), json.loads(content), key,
                                     float(meta["as_of"]), held, float(meta.get("edits_at") or 0.0), False)
    return bytes(res.body)


LIVE_KINDS = frozenset({"observe", "landed", "marks", "online"})


async def observed(ns: dict[str, Any], meta: dict[str, Any], raw: bytes, content: bytes) -> bytes:
    """asa-hub-app finished the answer itself (app/live_finish.py): this relay's observers run on it for the state they
    keep here (its sign-in tables, the acting table, the chat, the kept copies and packs, the editions overlay), and
    what they raise — the names rung, the slices marked dirty, the release notices — is handed back with the pack
    marks they set, for asa-hub-app to raise and judge by. `landed`: a final write Python kept (_backend_final_landed,
    and App Control's own); `marks`: every mark held; `online`: a viewer opened the live stream, its stale kept boards
    read again (_viewer_cache_online)."""
    import asyncio  # noqa: PLC0415
    import time  # noqa: PLC0415

    kind, action = str(meta.get("kind") or ""), str(meta.get("action") or "")
    if kind == "marks":
        return json.dumps({"marks": ns["_live_marks_since"](0.0)}).encode()
    if kind == "online":
        ns["_viewer_cache_online"](str(meta.get("token") or ""))
        return b"{}"
    began = time.time()
    caught: dict[str, Any] = {"published": [], "dirty": [], "released": [], "files": {}}
    token = ns["_LIVE_CAPTURE"].set(caught)
    try:
        if kind == "landed":
            ns["_backend_final_landed"](action, raw, content)
            if meta.get("app_control"):
                ns["_app_control_landed"](action, raw, str(meta.get("answer") or "").encode())
        else:
            observe(ns, action, raw, content, frozenset(meta.get("observers") or ()))
            if meta.get("take"):
                ask = ns["_viewer_cache_key"](action, raw, None)
                if ask:
                    ns["_viewer_cache_take"](ask, content)
        # the tasks they started say what they raise before the word goes back
        await asyncio.sleep(0)
    finally:
        ns["_LIVE_CAPTURE"].reset(token)
    return json.dumps({"published": caught["published"], "dirty": caught["dirty"], "released": caught["released"],
                       "marks": ns["_live_marks_since"](began)}).encode()


async def derived(ns: dict[str, Any], resources: list[str], late: list[str]) -> dict[str, Any]:
    """The slices this relay's own lane modules shape, built for asa-hub-app, which writes them (one writer of the
    slices): each one's index record and its file, never written here; `late`: the analyses built from other slices
    (hiring, medcorr, coverage), asked once asa-hub-app wrote the pass they read."""
    import asyncio  # noqa: PLC0415

    caught: dict[str, Any] = {"published": [], "dirty": [], "released": [], "files": {}}
    token = ns["_LIVE_CAPTURE"].set(caught)
    try:
        manifest = {e["resource"]: e for e in ns["load_manifest"]()}
        entries = [manifest[r] for r in resources if r in manifest]
        doors = ns["BACKEND_SLICE_DOORS"]
        from_python = [e["resource"] for e in entries
                       if e["resource"] in doors and not ns["_is_hopeless"](e["resource"])]
        shaped = await ns["_rows_from_python"](from_python) if from_python else {}
        carried = {n for n in from_python if n not in shaped}
        results = list(await asyncio.gather(*(ns["build_one"](e, None, shaped, carried) for e in entries)))
        if "hiring" in late:
            results += ns["_derived_late_slices"](ns["hiring_slices"])
        if "medcorr" in late:
            await ns["_medcorr_hand_in"]()
            results += ns["_derived_late_slices"](ns["medcorr_slices"])
        if "coverage" in late:
            results += ns["_derived_late_slices"](ns["coverage_slices"])
    finally:
        ns["_LIVE_CAPTURE"].reset(token)
    return {"results": results, "files": caught["files"], "published": caught["published"],
            "dirty": caught["dirty"]}


async def finish(ns: dict[str, Any], meta: dict[str, Any], raw: bytes,
                 content: bytes) -> tuple[bytes | None, str | None]:
    """(the bytes that replace Python's answer, None when it stands; the kept read's ring, None for any other)."""
    kind, action = str(meta.get("kind") or ""), str(meta.get("action") or "")
    if kind in LIVE_KINDS:
        return await observed(ns, meta, raw, content), None
    if meta.get("handed"):
        ns["_keep_task"](ns["_hiring_handed"](meta["handed"]))
    if kind == "handed":
        return None, None
    if kind == "write":
        return await write_tail(ns, meta, raw, content), None
    answer = content
    if kind == "read" and not meta.get("said"):
        answer, _asked_at = read_tail(ns, meta, raw, content)
    elif kind == "auth":
        ns["_traffic_note"]("backend_python")
    board_ask = ns["_viewer_cache_key"](action, raw, None)
    ring = (ns["_viewer_cache_ring_of"](action) or "") if board_ask else None
    observe(ns, action, raw, answer)
    if board_ask:
        ns["_viewer_cache_take"](board_ask, answer)
    out = await ns["_backend_editions_cut"](action, answer)
    return (None if out == content else out), ring


def install(app: Any, ns: dict[str, Any]) -> None:
    """POST /front-door/finish on the relay's own app; `ns` is snapshot_service.py's globals()."""

    @app.post(FINISH_PATH)
    async def front_door_finish(request: Request) -> Response:
        token = str(ns.get("HUB_APP_TOKEN") or "")
        if not token or not hmac.compare_digest(request.headers.get("x-hub-token", ""), token):
            return Response(status_code=401)
        try:
            meta, raw, content = unframe(await request.body())
        except (ValueError, struct.error):
            return Response(status_code=400)
        try:
            out, ring = await finish(ns, meta, raw, content)
        except Exception as exc:  # noqa: BLE001 - the answer stands as Python gave it; said
            if not meta.get("quiet"):
                ns["log"].warning("front door: %s not finished here (%s)", meta.get("door"), type(exc).__name__)
            return Response(status_code=500)
        headers = {"X-Front-Door-Ring": ring} if ring is not None else {}
        if out is None:
            return Response(status_code=204, headers=headers)
        return Response(content=out, media_type="application/json", headers=headers)

    @app.post(DERIVED_PATH)
    async def slices_derived(request: Request) -> Response:
        token = str(ns.get("HUB_APP_TOKEN") or "")
        if not token or not hmac.compare_digest(request.headers.get("x-hub-token", ""), token):
            return Response(status_code=401)
        try:
            body = json.loads(await request.body() or b"{}")
        except ValueError:
            return Response(status_code=400)
        if not isinstance(body, dict):
            return Response(status_code=400)
        said = await derived(ns, [str(r) for r in body.get("resources") or []],
                             [str(k) for k in body.get("late") or []])
        return Response(content=json.dumps(said, separators=(",", ":"), default=str).encode(),
                        media_type="application/json")
