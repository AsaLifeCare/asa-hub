"""APP PACKS, moved from the relay (server/snapshot_service.py, APP PACKS and A CLIENT'S OWN VIEW): one app's whole
record for one key — a house, a client, an SSA, a family member, a candidate, a referral, a staff member — filled by
Python's own pack door for the service's identity, held in memory and kept on disk (/srv/app-packs), warmed by a pass
of its own, made dirty or stale by the writes that change it, and served through /hub-lanes/app-pack/{app} and its
/own view, cut per reader. The writes and sweeps a pack hears are the marks the front door judges every read by
(live_finish.MARKS). Its tables are the relay's (live_plane.json app_packs); the slices it takes its keys from are the
ones this app writes; the accounts, App Control and Settings › My Work are read off asa-hub-db."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import badge_follows
import front_door as FD
import gsjs
import lane_gate as LG
import live_finish as LF

log = logging.getLogger("asa-hub-app.app-packs")

def _read_plane() -> dict[str, Any]:
    try:
        return json.loads((Path(__file__).resolve().parent / "live_plane.json").read_text()).get("app_packs") or {}
    except (OSError, ValueError):
        return {}


_PLANE: dict[str, Any] = _read_plane()

OUT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
BUNDLE_DIR = os.getenv("HUB_BUNDLE_DIR", "/srv/bundles")

# the packs' clocks: fresh, the ceiling nothing older is served past, and the warm pass's beat
APP_PACK_FRESH_S = max(60.0, float(os.getenv("HUB_APP_PACK_FRESH_S", "2400")))
APP_PACK_CEILING_S = max(APP_PACK_FRESH_S, float(os.getenv("HUB_APP_PACK_CEILING_S", "14400")))
APP_PACK_WARM_EVERY_S = max(60.0, float(os.getenv("HUB_APP_PACK_WARM_EVERY_S", "600")))
# the bounded background refill: the packs of keys a person read lately are read again at this age
APP_PACK_REFILL_S = max(60.0, float(os.getenv("HUB_BACKGROUND_REFILL_S", "180")))
APP_PACK_RECENT_S = max(APP_PACK_REFILL_S, float(os.getenv("HUB_BACKGROUND_RECENT_S", "1800")))
# where the filled packs are kept across restarts: the packs' own volume, never inside the served snapshot tree
APP_PACK_DEFAULT_DIR = os.getenv("HUB_APP_PACK_DEFAULT_DIR", "/srv/app-packs").strip()
APP_PACK_DIR = os.getenv("HUB_APP_PACK_DIR", APP_PACK_DEFAULT_DIR).strip()
APP_PACK_WARM_START_S = float(os.getenv("HUB_APP_PACK_WARM_START_S", "120"))
# under the proxy's 30-second read timeout on /hub-lanes/, counted from the request's arrival
APP_PACK_WAIT_S = 25.0
# a read that waits less than this starts its fill in the background
APP_PACK_PERSON_WAIT_S = 10.0
# fills on a person's lane at once, every app together; past it a read starts a background fill and answers `filling`
APP_PACK_PERSON_FILLS = 2
APP_PACK_CLIENT_FILL_TIMEOUT_S = 300
APP_PACK_MAX_KEYS = 160
# packs held at once, every app together, the oldest let go past it
APP_PACK_MAX_HELD = 400
_APP_PACK_FILE_RE = r"[0-9a-f]{64}\.json"
# an app's mark: no copy of its packs read before the moment it holds is taken up (`<app>.void`)
_APP_PACK_MARK_RE = r"([a-z][a-z0-9\-]{0,40})\.void"
# a kept file's or a mark's temporary neighbour while it is written: `.<its name>.<random>.tmp`
_APP_PACK_TEMP_RE = r"\.(?:[0-9a-f]{64}\.json|[a-z][a-z0-9\-]{0,40}\.void)\.[A-Za-z0-9_]+\.tmp"
# how long ago a session's own write may be named on its read (?written_ms=, ?sent_ms=)
APP_PACK_WRITTEN_MAX_MS = 15 * 60 * 1000
# a prefetch that finds nothing held starts a background fill only while fewer than this many are waiting
APP_PACK_PEEK_QUEUE = 2
# an engine that does not know the pack's action yet is not asked again until it changes, or for this long
APP_PACK_UNPUBLISHED_S = 1800.0
# an upload past what the envelope reader parses names its action and its house in these first bytes
APP_PACK_HEAD_BYTES = 4096
_APP_PACK_REFUSED = {"status": 404, "reason": "unknown", "message": "Unknown lane."}
_APP_PACK_VERBS = frozenset(_PLANE.get("verbs") or ())
# the doors that file or edit an estate row through the estate's own write, and the generic verbs answered under
# their door's name: the resource each writes
_APP_PACK_DOOR_RESOURCES: dict[str, str] = dict(_PLANE.get("door_resources") or {})
HOUSEKEEPING_SLOTS = int(os.getenv("HUB_SNAPSHOT_HOUSEKEEPING_SLOTS", "3"))
ENGINE_HOLD_S = 30.0

# (app, key) -> {data, built_at, read_at, filled_at, dirty, stale, lane, engine}
_app_pack_held: dict[tuple[str, str], dict[str, Any]] = {}
_app_pack_inflight: dict[tuple[str, str], asyncio.Task] = {}
# set when a person comes to wait on a background fill: one still queued for its turn runs on the person's lane
_app_pack_promote: dict[tuple[str, str], asyncio.Event] = {}
# the promote events of the fills holding a person's lane, APP_PACK_PERSON_FILLS at most
_app_pack_person_lane: set[asyncio.Event] = set()
# bumped by every write that names the key: a fill whose execution began before the write lands dirty
_app_pack_gen: dict[tuple[str, str], int] = {}
# bumped by every sweep: a fill whose execution began before it lands stale
_app_pack_stale_gen: dict[tuple[str, str], int] = {}
# the marks every read is judged by: a write naming a key landed; no copy read before may stand; a sweep of every key
_app_pack_touched: dict[tuple[str, str], float] = LF.MARKS["touched"]
_app_pack_void: dict[tuple[str, str], float] = LF.MARKS["void"]
_app_pack_swept: dict[str, float] = LF.MARKS["swept"]
# (app, key) -> when Python last refused that pack (its whole app: key ""); a refusal is no write
_app_pack_refused: dict[tuple[str, str], float] = {}
# the fill executing now for a key, and when it began reading
_app_pack_began: dict[tuple[str, str], tuple[Any, float]] = {}
# app -> (when, the engine build then)
_app_pack_unpublished: dict[str, tuple[float, str]] = {}
_app_pack_warm_sem = asyncio.Semaphore(1)
# one background fill at a time across every app, holding one housekeeping ticket
_app_pack_bg_sem = asyncio.Semaphore(1)
_housekeeping_slots = asyncio.Semaphore(HOUSEKEEPING_SLOTS)
_app_pack_warm_wake = asyncio.Event()
_ENGINE: dict[str, Any] = {"at": 0.0, "build": ""}


class _AppPackRefused(Exception):
    """Python answered the pack with a refusal: its status and its own words."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _client_live(row: Any) -> bool:
    """server/client_status.py live: a client row not archived, and its status blank or 'active', any case."""
    if not isinstance(row, dict):
        return False
    archived = row.get("archived")
    if archived is True or str(archived or "").strip().lower() == "true":
        return False
    return str(row.get("status") or "").strip().lower() in ("", "active")


async def _backend_pack(app_id: str, action: str, key: str, *, pack: str = "", named: str = "") -> dict[str, Any]:
    """An app pack filled by Python for the service's identity, its refusal, or its 503."""
    spec = (LF.TABLES.get("apps") or {}).get(app_id) or {}
    got = await FD.call_app(app_id, action, {"is_service": True}, {named or spec.get("key", "house"): key})
    if got is None:
        log.info("backend: %s %s said 503 — Python did not answer", action, key)
        return dict(LF.BACKEND_UNREAD)
    _content, as_of, env, held, edits_at = got
    status = env["status"]
    if status != 200:
        if _app_pack_not_served(status, str(env.get("message") or "")):
            log.warning("backend: %s %s answered %d by Python — said 503", action, key, status)
            return dict(LF.BACKEND_UNREAD)
        log.info("backend: %s %s refused by Python (%d) — the pack's answer", action, key, status)
        return env
    if LF.written_after(app_id, key, as_of, held, pack=pack, edits_at=edits_at):
        log.info("backend: %s %s said 503 — a write landed after Python's copy was read", action, key)
        return dict(LF.BACKEND_UNREAD)
    fresh = LF.copy_at(app_id, key, as_of, held, pack=pack, edits_at=edits_at)
    return {**env, "as_of": as_of if fresh is None else fresh}


# ---- each app's keys, and the keys a write names --------------------------------------------------------------------

_APP_PACK_HOUSE_RE = r"[A-Z]{2,4}\d{3,6}"
_APP_PACK_CLIENT_RE = r"[A-Za-z0-9_.\-]{1,80}"
_APP_PACK_CLIENTS = "client-profiles"


def _app_pack_house_keys() -> list[str]:
    """The active house codes of the houses slice; [] when it cannot be read."""
    try:
        body = json.loads((OUT_DIR / "houses.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no warm pass; a person's read still fills its own key
        return []
    rows = body.get("rows") if isinstance(body, dict) else body
    out: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip().upper()
        if row.get("active") is True and re.fullmatch(r"[A-Z]{2,4}\d{3,6}", code) and code not in out:
            out.append(code)
    return out[:APP_PACK_MAX_KEYS]


async def _app_pack_exec_locations(key: str) -> dict:
    return await _backend_pack("locations", "locationPack", key)


def _app_pack_house_of(body: dict[str, Any], env: Any) -> str:
    """The house a Locations write names: in its request, or in the note or entry it answers with; '' for none."""
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    said = [payload.get("house")] + [(data.get(k) or {}).get("house") for k in ("note", "entry")
                                     if isinstance(data.get(k), dict)]
    for value in said:
        code = str(value or "").strip().upper()
        if re.fullmatch(_APP_PACK_HOUSE_RE, code):
            return code
    return ""


def _app_pack_client_houses_of(body: dict[str, Any], env: Any) -> list[str]:
    """The houses a client's record edit touches: the house its clients slice row names for each client it names,
    and any house a changed field names."""
    out: list[str] = []
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    said = [c.get(f) for c in payload.get("changes") or [] if isinstance(c, dict)
            and "house" in str(c.get("field") or "").lower() for f in ("value", "expected")]
    clients = set(_app_pack_clients_of(body, env))
    if clients:
        for row in _app_pack_slice_rows("clients.json"):
            if (str(row.get("client_key") or "").strip() or _app_pack_fold_name(row.get("name"))) in clients:
                said.append(row.get("house"))
    for value in said:
        code = str(value or "").strip().upper()
        if re.fullmatch(_APP_PACK_HOUSE_RE, code) and code not in out:
            out.append(code)
    return out


def _app_pack_fold_name(value: Any) -> str:
    """A name folded the way the platform folds it (clientNameKey_): lower case, letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _app_pack_client_index() -> dict[str, Any]:
    """From the clients slice, identity only: every client key, the active ones in order, and each unambiguous
    folded name's key."""
    out: dict[str, Any] = {"active": [], "keys": set(), "names": {}}
    try:
        body = json.loads((OUT_DIR / "clients.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no warm pass and no name match
        return out
    rows = body.get("rows") if isinstance(body, dict) else body
    names: dict[str, str] = {}
    twice: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        fold = _app_pack_fold_name(row.get("name"))
        key = str(row.get("client_key") or "").strip() or fold
        if not key or not re.fullmatch(_APP_PACK_CLIENT_RE, key):
            continue
        out["keys"].add(key)
        if fold:
            if names.get(fold, key) != key:
                twice.add(fold)
            names.setdefault(fold, key)
        if _client_live(row) and key not in out["active"]:
            out["active"].append(key)
    out["names"] = {f: k for f, k in names.items() if f not in twice}
    out["active"] = out["active"][:APP_PACK_MAX_KEYS]
    return out


def _app_pack_client_keys() -> list[str]:
    return list(_app_pack_client_index()["active"])


async def _app_pack_exec_clients(key: str) -> dict:
    return await _backend_pack("clients", "clientPack", key)


def _app_pack_client_of(body: dict[str, Any], env: Any) -> str:
    """The client a write names, read the way the platform reads a client-bearing row (hubRowIsClients_): any field
    naming a client, its key or its folded name."""
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    sources = [payload, data] + [data[k] for k in ("row", "note", "entry", "record") if isinstance(data.get(k), dict)]
    said = [str(v).strip() for src in sources for k, v in src.items()
            if "client" in str(k).lower() and isinstance(v, (str, int)) and str(v).strip()]
    if not said:
        return ""
    index = _app_pack_client_index()
    known = index["keys"] | {k for (a, k) in list(_app_pack_held) + list(_app_pack_inflight) if a == _APP_PACK_CLIENTS}
    for value in said:
        key = value[4:] if value.startswith("CLI_") else value
        if key in known:
            return key
    for value in said:
        hit = index["names"].get(_app_pack_fold_name(value))
        if hit:
            return hit
    return ""


_APP_PACK_SSA_RE = r"ssa_[a-z0-9]{1,80}"
_APP_PACK_SSAS = "ssa-profiles"


def _app_pack_ssa_index() -> dict[str, Any]:
    """From the clients slice, identity only: every SSA key, the active ones, and the SSA each client names (or the
    held SSA pack that lists a client whose row names none)."""
    out: dict[str, Any] = {"active": [], "keys": set(), "of_client": {}}
    try:
        body = json.loads((OUT_DIR / "clients.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no warm pass and no client match
        return out
    rows = body.get("rows") if isinstance(body, dict) else body
    unnamed: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        client = str(row.get("client_key") or "").strip() or _app_pack_fold_name(row.get("name"))
        live = _client_live(row)
        if not str(row.get("ssa_name") or "").strip():
            if client and live:
                unnamed.append(client)
            continue
        key = "ssa_" + _app_pack_fold_name(row.get("ssa_name"))
        if not re.fullmatch(_APP_PACK_SSA_RE, key):
            continue
        out["keys"].add(key)
        if client:
            out["of_client"][client] = key
        if live and key not in out["active"]:
            out["active"].append(key)
    if unnamed:
        for (app, key), entry in list(_app_pack_held.items()):
            if app != _APP_PACK_SSAS:
                continue
            parts = (entry.get("data") or {}).get("parts") if isinstance(entry.get("data"), dict) else None
            overview = parts.get("overview") if isinstance(parts, dict) else None
            listed = overview.get("clients") if isinstance(overview, dict) else None
            current = {str(c.get("client_key") or "").strip() for c in (listed if isinstance(listed, list) else [])
                       if _client_live(c)}
            for client in unnamed:
                if client in current and client not in out["of_client"]:
                    out["of_client"][client] = key
                    out["keys"].add(key)
                    if key not in out["active"]:
                        out["active"].append(key)
    out["active"] = out["active"][:APP_PACK_MAX_KEYS]
    return out


def _app_pack_ssa_keys() -> list[str]:
    return list(_app_pack_ssa_index()["active"])


async def _app_pack_exec_ssas(key: str) -> dict:
    return await _backend_pack("ssa", "ssaPack", key)


def _app_pack_ssa_of(body: dict[str, Any], env: Any) -> str:
    """The SSA a write names: its key (the SSA app's own write, or the note it answers with), else the SSA a named
    SSA name or client gives."""
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    index = _app_pack_ssa_index()
    known = index["keys"] | {k for (a, k) in list(_app_pack_held) + list(_app_pack_inflight) if a == _APP_PACK_SSAS}
    note = data.get("note") if isinstance(data.get("note"), dict) else {}
    for value in (payload.get("ssa"), note.get("ssa")):
        key = value.strip() if isinstance(value, str) else ""
        if key in known:
            return key
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    for src in (fields, payload):
        key = "ssa_" + _app_pack_fold_name(src.get("ssa_name"))
        if key in known:
            return key
    client = _app_pack_client_of(body, env)
    return index["of_client"].get(client, "") if client else ""


def _app_pack_written_clients(env: Any) -> list[str] | None:
    """The client records a family member's edit wrote (its answer's client_keys); None for any other answer."""
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    keys = data.get("client_keys")
    if not isinstance(keys, list):
        return None
    return [k.strip() for k in keys if isinstance(k, str) and k.strip()]


def _app_pack_clients_of(body: dict[str, Any], env: Any) -> list[str]:
    written = _app_pack_written_clients(env)
    if written is not None:
        return written
    key = _app_pack_client_of(body, env)
    return [key] if key else []


def _app_pack_ssas_of(body: dict[str, Any], env: Any) -> list[str]:
    written = _app_pack_written_clients(env)
    if written is None:
        key = _app_pack_ssa_of(body, env)
        return [key] if key else []
    of_client = _app_pack_ssa_index()["of_client"]
    return sorted({of_client[k] for k in written if of_client.get(k)})


_APP_PACK_FAMILIES = "family-profiles"
_APP_PACK_FAMILY_RE = r"fam_[a-z0-9]{3,120}"
# a key Python says is no family member, or answers under another key, is not warmed again for this long
APP_PACK_FAMILY_REST_S = 6 * 3600.0
# family key -> (when, the engine build then)
_app_pack_family_refused: dict[str, tuple[float, str]] = {}


def _app_pack_slice_rows(name: str) -> list[dict[str, Any]]:
    """The rows of one of the slices this app writes; [] when it cannot be read."""
    try:
        body = json.loads((OUT_DIR / name).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no key from it
        return []
    rows = body.get("rows") if isinstance(body, dict) else body
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _app_pack_family_index() -> dict[str, Any]:
    """From the families index held here (familyIndexPack), identity only: every family member's key, the active
    first, and the family member each client's own record names; nothing until that index is held."""
    held = _app_pack_held.get((_APP_PACK_FAMILY_INDEX, _APP_PACK_FAMILY_INDEX_KEY)) or {}
    parts = (held.get("data") or {}).get("parts") or {}
    families = (parts.get("roster") or {}).get("families") or []
    keys = [str(f.get("key") or "") for f in sorted((f for f in families if isinstance(f, dict)),
                                                     key=lambda f: f.get("status") != "active")]
    records = parts.get("records") if isinstance(parts.get("records"), dict) else {}
    return {"keys": list(dict.fromkeys(k for k in keys if re.fullmatch(_APP_PACK_FAMILY_RE, k))),
            "clients": {str(c): str(k) for c, k in records.items() if re.fullmatch(_APP_PACK_FAMILY_RE, str(k))}}


def _app_pack_family_keys() -> list[str]:
    engine = _app_pack_engine()
    now = time.time()
    out: list[str] = []
    for key in _app_pack_family_index()["keys"]:
        rest = _app_pack_family_refused.get(key)
        if rest is not None and rest[1] == engine and now - rest[0] < APP_PACK_FAMILY_REST_S:
            continue
        out.append(key)
    return out[:APP_PACK_MAX_KEYS]


async def _app_pack_exec_families(key: str) -> dict:
    env = await _backend_pack("family", "familyPack", key)
    try:
        status = int(env.get("status") or 0) if isinstance(env, dict) else 0
    except (TypeError, ValueError):
        status = 0
    data = env.get("data") if status == 200 and isinstance(env.get("data"), dict) else {}
    if status == 200 and str(data.get("family") or key) == key:
        _app_pack_family_refused.pop(key, None)
    elif status == 200 or (status in (400, 404) and not _app_pack_not_served(status, str(env.get("message") or ""))):
        _app_pack_family_refused[key] = (time.time(), _app_pack_engine())
    return env


def _app_pack_family_of(body: dict[str, Any], env: Any) -> str:
    """The family member a write names: the family key of the request, or of the note, call or row it answers
    with, a guardian's person id, else the family member the client it names has."""
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    sources = [payload, data] + [data[k] for k in ("note", "call", "entry", "row", "record")
                                 if isinstance(data.get(k), dict)]
    for src in sources:
        key = str(src.get("family") or src.get("family_key") or "").strip()
        if re.fullmatch(_APP_PACK_FAMILY_RE, key):
            return key
    for src in sources:
        said = str(src.get("id") or "").strip()
        if said.startswith("PPL_guardian_"):
            key = "fam_" + _app_pack_fold_name(said[len("PPL_guardian_"):])
            if re.fullmatch(_APP_PACK_FAMILY_RE, key):
                return key
    client = _app_pack_client_of(body, env)
    return _app_pack_family_index()["clients"].get(client, "") if client else ""


# THE FAMILIES INDEX — every family member at once, under the one key `all`
_APP_PACK_FAMILY_INDEX = "family-index"
_APP_PACK_FAMILY_INDEX_KEY = "all"


def _app_pack_family_index_keys() -> list[str]:
    return [_APP_PACK_FAMILY_INDEX_KEY]


async def _app_pack_exec_family_index(key: str) -> dict:
    return await _backend_pack("family", "familyIndexPack", key, pack=_APP_PACK_FAMILY_INDEX)


def _app_pack_view_told(answer: dict[str, Any], master: bool, notes: bool = True) -> dict[str, Any]:
    """An answered pack that says which view its reader reads, in the roster's own words."""
    data = answer.get("data") if isinstance(answer, dict) else None
    if not isinstance(data, dict) or answer.get("status") != 200:
        return answer
    return {**answer, "data": {**data, "view": {"kind": "master" if master else "all", "notes": notes}}}


def _app_pack_family_notes(sess: Any) -> bool:
    import family as FAM  # noqa: PLC0415 - the rule is the family module's own
    view = FAM.view_of(sess)
    return bool(view) and FAM.notes_seen(view)


def _app_pack_ssa_notes(sess: Any) -> bool:
    import ssa as SSA  # noqa: PLC0415 - the rule is the SSA module's own
    return SSA.notes_open(sess)


# Families & Guardians' and SSA's admin notes: whom each app's own module opens them to (App Control's Notes row, else
# a badge from ADMIN up)
_APP_PACK_NOTES_RULES: dict[str, Callable[[Any], bool]] = {
    "family-index": _app_pack_family_notes, "family-profiles": _app_pack_family_notes,
    "ssa-profiles": _app_pack_ssa_notes}
_APP_PACK_NOTES_PACKS = frozenset(_APP_PACK_NOTES_RULES)


async def _app_pack_notes_open(s: FD.Session | None, pack: str) -> bool:
    """FAIL-CLOSED: a session the rule cannot be asked for is handed no notes."""
    try:
        return await run_in_threadpool(LG.in_session, s, _APP_PACK_NOTES_RULES[pack]) is True
    except Exception as exc:  # noqa: BLE001 - the pack is still served, without the notes
        log.info("%s pack: the notes rule could not be read (%s) — the notes withheld", pack, type(exc).__name__)
        return False


# the parts of a client's pack that are Clients › Transportation's (Calendar and History), the whole one and its own cut
_APP_PACK_CLIENT_TRANSPORT_PARTS = ("transport", "transport_own")


def _app_pack_client_transport(sess: Any) -> bool:
    import clients as C  # noqa: PLC0415 - the rule is the Clients module's own
    return C.transport_open(sess)


# the Transportation row's verdict per account, held as long as the My Work switches are (APP_PACK_HIDES_HOLD_S)
_APP_PACK_TRANSPORT_HELD: dict[str, tuple[float, bool]] = {}


async def _app_pack_transport_open(s: FD.Session | None) -> bool:
    """FAIL-CLOSED: a session App Control's Transportation row cannot be asked for is handed no transport parts. A
    verdict is held a minute per account, so peeks and waits do not read the rows again; a read that raised is never
    held (a Defer clients.transport_open swallows is its False, held like any other)."""
    who = LG.actor(s)
    uid = str(who[1] or "") if who else ""
    hit = _APP_PACK_TRANSPORT_HELD.get(uid) if uid else None
    if hit is not None and time.monotonic() - hit[0] < APP_PACK_HIDES_HOLD_S:
        return hit[1]
    try:
        got = await run_in_threadpool(LG.in_session, s, _app_pack_client_transport) is True
    except Exception as exc:  # noqa: BLE001 - the pack is still served, without the transport parts
        log.info("client-profiles pack: the Transportation rule could not be read (%s) — its parts withheld",
                 type(exc).__name__)
        return False
    if uid:
        _APP_PACK_TRANSPORT_HELD[uid] = (time.monotonic(), got)
    return got


def _app_pack_notes_out(answer: dict[str, Any]) -> dict[str, Any]:
    """A pack without the admin notes: its notes part, and each note line of its activity."""
    answer = _app_pack_parts_out(answer, ("notes",))
    data = answer.get("data") if isinstance(answer, dict) else None
    parts = data.get("parts") if isinstance(data, dict) else None
    act = parts.get("activity") if isinstance(parts, dict) else None
    if not isinstance(act, dict) or not isinstance(act.get("items"), list):
        return answer
    items = [i for i in act["items"] if not (isinstance(i, dict) and i.get("kind") == "note")]
    total = act.get("total")
    if isinstance(total, int) and not isinstance(total, bool):
        total = max(0, total - (len(act["items"]) - len(items)))
    return {**answer, "data": {**data, "parts": {**parts, "activity": {**act, "items": items, "total": total}}}}


_APP_PACK_CANDIDATE_RE = r"CAN_[A-Za-z0-9]{6,80}"
_APP_PACK_CANDIDATES = "staff-candidates"


def _app_pack_candidate_keys() -> list[str]:
    """The candidates on the hiring board (the candidates slice, which holds no archived one), in its order."""
    try:
        body = json.loads((OUT_DIR / "candidates.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no warm pass
        return []
    rows = body.get("rows") if isinstance(body, dict) else body
    out: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not str(row.get("stage") or "").strip():
            continue
        key = str(row.get("id") or "").strip()
        if re.fullmatch(_APP_PACK_CANDIDATE_RE, key) and key not in out:
            out.append(key)
    return out[:APP_PACK_MAX_KEYS]


async def _app_pack_exec_candidates(key: str) -> dict:
    return await _backend_pack("candidates", "candidatePack", key)


def _app_pack_candidate_of(body: dict[str, Any], env: Any) -> str:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    sources = [payload, data] + [data[k] for k in ("candidate", "row", "note", "entry")
                                 if isinstance(data.get(k), dict)]
    for src in sources:
        for name, value in src.items():
            if "candidate" not in str(name).lower():
                continue
            if isinstance(value, list) and len(value) == 1:
                value = value[0]
            key = value.strip() if isinstance(value, str) else ""
            if re.fullmatch(_APP_PACK_CANDIDATE_RE, key):
                return key
    return ""


# a referral's row id as clientCandidatePack reads it
_APP_PACK_LEAD_RE = r"[A-Za-z0-9_\-]{3,80}"
_APP_PACK_LEADS = "client-candidates"
_APP_PACK_LEAD_CLOSED = frozenset({"converted", "lost", "on-hold", "closed", "ready-for-intake"})
_APP_PACK_LEAD_MOVED = frozenset({"contacted", "assessment", "intake", "isp-drafting", "discovery", "placement-review"})


def _app_pack_lead_stage(value: Any) -> str:
    return re.sub(r"[\s_\-]+", "-", str(value or "").strip().lower())


def _app_pack_lead_day(value: Any) -> str:
    """A referral's expiry as YYYY-MM-DD (the portal's MM/DD/YY, or ISO); '' when it names no day."""
    said = str(value or "").strip()
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", said)
    if iso:
        return "-".join(iso.groups())
    us = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?!\d)", said)
    if not us or not 1 <= int(us.group(1)) <= 12 or not 1 <= int(us.group(2)) <= 31:
        return ""
    year = int(us.group(3))
    if year < 100:
        year += 2000 if year < 69 else 1900
    return f"{year:04d}-{int(us.group(1)):02d}-{int(us.group(2)):02d}"


def _app_pack_lead_keys() -> list[str]:
    """The referrals still in the intake, in the potentialClients slice's order."""
    try:
        body = json.loads((OUT_DIR / "potentialClients.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - no slice, no warm pass
        return []
    rows = body.get("rows") if isinstance(body, dict) else body
    today = time.strftime("%Y-%m-%d", time.gmtime())
    out: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        key = str(row.get("id") or "").strip()
        stage = _app_pack_lead_stage(row.get("stage"))
        if (not re.fullmatch(_APP_PACK_LEAD_RE, key) or key in out or stage in _APP_PACK_LEAD_CLOSED
                or not str(row.get("client_name") or "").strip()):
            continue
        expires = _app_pack_lead_day(row.get("expiration_date"))
        if stage in _APP_PACK_LEAD_MOVED or not expires or expires >= today:
            out.append(key)
    return out[:APP_PACK_MAX_KEYS]


async def _app_pack_exec_leads(key: str) -> dict:
    return await _backend_pack("client-candidates", "clientCandidatePack", key)


def _app_pack_lead_of(body: dict[str, Any], env: Any) -> str:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    sources = [payload, data] + [data[k] for k in ("row", "note", "entry", "candidate", "lead")
                                 if isinstance(data.get(k), dict)]
    for src in sources:
        for name, value in src.items():
            said = str(name).lower()
            if said not in ("id", "ids") and "candidate" not in said and "lead" not in said:
                continue
            if isinstance(value, list) and len(value) == 1:
                value = value[0]
            key = value.strip() if isinstance(value, str) else ""
            if re.fullmatch(_APP_PACK_LEAD_RE, key):
                return key
    return ""


def _app_pack_leads_of(body: dict[str, Any], env: Any) -> list[str]:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    ids = payload.get("ids")
    if isinstance(ids, list) and len(ids) > 1:
        data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else None
        results = data.get("results") if isinstance(data, dict) else None
        named = ([r.get("id") for r in results if isinstance(r, dict) and not r.get("unchanged") and not r.get("error")]
                 if isinstance(results, list) else ids)
        out: list[str] = []
        for value in named:
            key = value.strip() if isinstance(value, str) else ""
            if re.fullmatch(_APP_PACK_LEAD_RE, key) and key not in out:
                out.append(key)
        return out
    key = _app_pack_lead_of(body, env)
    return [key] if key else []


_APP_PACK_STAFF = "staff-profiles"
# the client keys of the accounts whose own views the warm pass keeps warm, read off asa-hub-db's users
_app_pack_client_accounts: list[str] = []
_APP_PACK_OWN_INACTIVE = frozenset({"false", "0", "no"})


def _app_pack_row_cell(row: dict[str, Any], name: str) -> str:
    """A users row's cell by its header, whatever the header's case or punctuation; '' when it has none."""
    want = _app_pack_fold_name(name)
    for head, value in row.items():
        if _app_pack_fold_name(head) == want:
            return str(value if value is not None else "").strip()
    return ""


def _app_pack_own_key(row: Any) -> str:
    """FAIL-CLOSED: the client key a users row links, for an active client-role account, not merged, that wears no
    FAMILY or SSA badge; '' for any other."""
    if not isinstance(row, dict) or _app_pack_row_cell(row, "role").lower() != "client":
        return ""
    if _app_pack_row_cell(row, "active").lower() in _APP_PACK_OWN_INACTIVE or _app_pack_row_cell(row, "merged_into"):
        return ""
    types = _app_pack_row_cell(row, "types").upper()
    worn = {w.strip() for w in re.split(r"[,;|\n]+", types) if w.strip()} | {"CLIENT"}
    worn = badge_follows.with_followed(worn)
    # a cell in any other shape that names one at all is read as wearing it (GUARDIAN: FAMILY before 10-30)
    if any(b in worn or b in types for b in ("FAMILY", "SSA", "GUARDIAN")):
        return ""
    key = _app_pack_row_cell(row, "client_key")
    return key if re.fullmatch(_APP_PACK_CLIENT_RE, key) else ""


def _app_pack_client_account_rows() -> list[dict[str, Any]]:
    """Blocking: the accounts' rows, off asa-hub-db."""
    return [r for r in LG.in_reads(lambda reads: reads.users()) if isinstance(r, dict)]


def _app_pack_client_accounts_refresh() -> int:
    """Blocking: the client keys of the accounts a client's own view is kept warm for (_app_pack_own_key)."""
    keys: list[str] = []
    for row in _app_pack_client_account_rows():
        key = _app_pack_own_key(row)
        if key and key not in keys:
            keys.append(key)
    _app_pack_client_accounts[:] = keys[:APP_PACK_MAX_KEYS]
    return len(_app_pack_client_accounts)


def _app_pack_staff_keys() -> list[str]:
    return list(_app_pack_client_accounts)


async def _app_pack_exec_staff(key: str) -> dict:
    return await _backend_pack("staff", "staffClientPack", key, pack=_APP_PACK_STAFF, named="client")


# THE TEAM'S STAFF PACK — one staff member's whole sections, asked through the Staff app's own door
_APP_PACK_STAFF_TEAM = "staff-team"
_APP_PACK_STAFF_KEY_RE = r"[a-z0-9]{3,80}"
_APP_PACK_MASTER_PART = re.compile(r"edit_[a-z]+")
# an app's door -> the pack it reads, where the app's own view is another pack's
_APP_PACK_DOORS: dict[str, str] = dict(_PLANE.get("doors") or {})
# a door of its own -> the app whose App Control row opens it, and whose screens its fills ring
_APP_PACK_GATES: dict[str, str] = dict(_PLANE.get("gates") or {})


def _app_pack_staff_team_keys() -> list[str]:
    """The active staff of the people slice, keyed the way the platform keys them (clientNameKey_), less clients."""
    clients = {_app_pack_fold_name(r.get("name")) for r in _app_pack_slice_rows("clients.json")}
    out: list[str] = []
    for row in _app_pack_slice_rows("people.json"):
        if str(row.get("status") or "").strip().lower() != "active":
            continue
        if str(row.get("role") or "").strip().lower() in ("guardian", "entity", "client"):
            continue
        name = str(row.get("name") or "").strip() or f"{row.get('first_name') or ''} {row.get('last_name') or ''}"
        key = _app_pack_fold_name(name)
        if key and key not in clients and re.fullmatch(_APP_PACK_STAFF_KEY_RE, key) and key not in out:
            out.append(key)
    return out[:APP_PACK_MAX_KEYS]


async def _app_pack_exec_staff_team(key: str) -> dict:
    return await _backend_pack("staff", "staffPack", key)


def _app_pack_staff_key_of(body: dict[str, Any], env: Any) -> str:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    data = env.get("data") if isinstance(env, dict) and isinstance(env.get("data"), dict) else {}
    note = data.get("note") if isinstance(data.get("note"), dict) else {}
    for value in (payload.get("staff"), payload.get("key"), payload.get("person"), note.get("staff_key"),
                  data.get("staff_key")):
        key = _app_pack_fold_name(value)
        if re.fullmatch(_APP_PACK_STAFF_KEY_RE, key):
            return key
    return ""


# the parts of the team's Staff pack that are its Activity tab's (Timeline and Visits, Shifts)
_APP_PACK_STAFF_ACTIVITY_PARTS = ("activity", "shifts")
_APP_PACK_STAFF_SHUT = {"team": False, "activity": False}


def _app_pack_staff_view(sess: Any) -> dict[str, bool]:
    """The team's Staff pack as Staff's own doors cut it for this session: the whole team (App Control's Whole team
    row; anyone else opens their own profile alone, through its doors), and the Activity tab's row."""
    import staff as SP  # noqa: PLC0415 - the rules are the Staff module's own
    team = SP.whole_gate(sess) is not None and SP.own_only(sess) is None
    return {"team": team, "activity": team and SP.tab_open(sess, SP.ACTIVITY_FEATURE)}


async def _app_pack_staff_cut(s: FD.Session | None) -> dict[str, bool]:
    """FAIL-CLOSED: a session the Staff rules cannot be asked for is handed no team pack."""
    try:
        got = await run_in_threadpool(LG.in_session, s, _app_pack_staff_view)
    except Exception as exc:  # noqa: BLE001 - refused here, each section reads its own door
        log.info("staff-team pack: the Staff rules could not be read (%s) — the pack refused", type(exc).__name__)
        return dict(_APP_PACK_STAFF_SHUT)
    return got if isinstance(got, dict) else dict(_APP_PACK_STAFF_SHUT)


def _app_pack_master_parts_out(answer: dict[str, Any]) -> dict[str, Any]:
    """A pack as anyone but the master's own session is handed it: without the edit panels' raw values."""
    data = answer.get("data") if isinstance(answer, dict) else None
    parts = data.get("parts") if isinstance(data, dict) else None
    if not isinstance(parts, dict) or not any(_APP_PACK_MASTER_PART.fullmatch(str(p)) for p in parts):
        return answer
    status = data.get("part_status") if isinstance(data.get("part_status"), dict) else {}
    return {**answer, "data": {**data,
                               "parts": {k: v for k, v in parts.items() if not _APP_PACK_MASTER_PART.fullmatch(str(k))},
                               "part_status": {k: v for k, v in status.items()
                                               if not _APP_PACK_MASTER_PART.fullmatch(str(k))}}}


def _app_pack_parts_out(answer: dict[str, Any], names: tuple[str, ...] | frozenset[str]) -> dict[str, Any]:
    """A pack without these parts: each part, its state, and each client's own view of it."""
    data = answer.get("data") if isinstance(answer, dict) else None
    parts = data.get("parts") if isinstance(data, dict) else None
    if not isinstance(parts, dict) or not names:
        return answer
    status = data.get("part_status") if isinstance(data.get("part_status"), dict) else {}
    kept = {k: v for k, v in parts.items() if k not in names}
    views = kept.get("client_views")
    if isinstance(views, dict):
        kept["client_views"] = {c: ({k: v for k, v in view.items() if k not in names} if isinstance(view, dict)
                                    else view) for c, view in views.items()}
    said = {k: v for k, v in status.items() if k not in names}
    return {**answer, "data": {**data, "parts": kept, "part_status": said}}


def _app_pack_this_week() -> str:
    """This week's Monday in New York (MyFamily.gs myFamilyWeek_)."""
    from datetime import datetime, timedelta  # noqa: PLC0415
    from zoneinfo import ZoneInfo  # noqa: PLC0415
    day = datetime.fromtimestamp(time.time(), ZoneInfo("America/New_York")).date()
    return (day - timedelta(days=day.weekday())).isoformat()


def _app_pack_past_week(app: str, held: dict[str, Any] | None) -> bool:
    """A client's own Staff pack gathered for a week that is over: the people on it are that week's. A pack that names
    no week (its parts refused) is no week's, and is filled again on its own clock, never on every pass."""
    if app != _APP_PACK_STAFF or not isinstance(held, dict):
        return False
    data = held.get("data") if isinstance(held.get("data"), dict) else {}
    week = str(data.get("week") or "")
    return bool(week) and week != _app_pack_this_week()


def _fold_of(how: str) -> Any:
    if how == "upper":
        return lambda key: str(key or "").strip().upper()
    if how == "lower":
        return lambda key: str(key or "").strip().lower()
    return lambda key: str(key or "").strip()


# each pack's code; its tables (the writes, sweeps and resources it hears, its warm order…) are the relay's
_APP_PACK_CODE: dict[str, dict[str, Any]] = {
    "locations": {"exec": _app_pack_exec_locations, "keys": _app_pack_house_keys, "key_of": _app_pack_house_of,
                  "keys_of": _app_pack_client_houses_of},
    _APP_PACK_CLIENTS: {"exec": _app_pack_exec_clients, "keys": _app_pack_client_keys, "key_of": _app_pack_client_of,
                        "keys_of": _app_pack_clients_of},
    _APP_PACK_SSAS: {"exec": _app_pack_exec_ssas, "keys": _app_pack_ssa_keys, "key_of": _app_pack_ssa_of,
                     "keys_of": _app_pack_ssas_of},
    _APP_PACK_FAMILIES: {"exec": _app_pack_exec_families, "keys": _app_pack_family_keys,
                         "key_of": _app_pack_family_of},
    _APP_PACK_FAMILY_INDEX: {"exec": _app_pack_exec_family_index, "keys": _app_pack_family_index_keys,
                             "key_of": lambda body, env: _APP_PACK_FAMILY_INDEX_KEY},
    _APP_PACK_CANDIDATES: {"exec": _app_pack_exec_candidates, "keys": _app_pack_candidate_keys,
                           "key_of": _app_pack_candidate_of},
    _APP_PACK_LEADS: {"exec": _app_pack_exec_leads, "keys": _app_pack_lead_keys, "key_of": _app_pack_lead_of,
                      "keys_of": _app_pack_leads_of},
    _APP_PACK_STAFF: {"exec": _app_pack_exec_staff, "keys": _app_pack_staff_keys, "key_of": lambda body, env: ""},
    _APP_PACK_STAFF_TEAM: {"exec": _app_pack_exec_staff_team, "keys": _app_pack_staff_team_keys,
                           "key_of": _app_pack_staff_key_of},
}


def _spec_of(pack: str, table: dict[str, Any]) -> dict[str, Any]:
    spec: dict[str, Any] = {**table, "fold": _fold_of(str(table.get("fold") or "strip"))}
    for name in ("writes", "elsewhere", "sweeps", "resources"):
        spec[name] = frozenset(table.get(name) or ())
    spec.update(_APP_PACK_CODE[pack])
    return spec


_APP_PACKS: dict[str, dict[str, Any]] = {pack: _spec_of(pack, table)
                                         for pack, table in (_PLANE.get("specs") or {}).items()
                                         if pack in _APP_PACK_CODE}
_APP_PACK_WATCHED = frozenset().union(*(s["writes"] | s["elsewhere"] | s["sweeps"]
                                        for s in _APP_PACKS.values())) | _APP_PACK_VERBS
# THE PROFILE APPS' RINGS — each app's screens re-read on its name
_APP_PACK_EVENTS: dict[str, str] = dict(_PLANE.get("events") or {})
# each app's own doors: any of them on a write lane changes what its screens show
_APP_PACK_PREFIXES: dict[str, tuple[str, ...]] = {a: tuple(p) for a, p in (_PLANE.get("prefixes") or {}).items()}
# (app, key) -> when a person last read its pack
_app_pack_viewed: dict[tuple[str, str], float] = {}


def _app_pack_apps_of(action: str, raw: bytes) -> set[str]:
    """The apps whose screens a write changes; empty for a read and for any other write."""
    try:
        watched, body = _app_pack_write_of(action, raw)
        action = watched or action
        if not action:
            return set()
        # a door that only answers bytes, or a write naming the only reads it changes, changes no app's screens
        if not watched and LF.resolver_touches(action) is not None:
            return set()
        resource = (str(body.get("resource") or "") if action in _APP_PACK_VERBS
                    else _APP_PACK_DOOR_RESOURCES.get(action, ""))
        apps = {app for app, spec in _APP_PACKS.items()
                if action in spec["writes"] or action in spec["elsewhere"] or action in spec["sweeps"]
                or (resource and resource in spec["resources"])}
        own = [app for app, prefixes in _APP_PACK_PREFIXES.items() if app not in apps and action.startswith(prefixes)]
        if own and LF.resolver_lane(action) in ("write", "tool"):
            apps.update(own)
        return apps
    except Exception:  # noqa: BLE001 - no ring; each copy's own age still refreshes it
        return set()


def ring_names(action: str, raw: bytes) -> set[str]:
    """The names a write rings, for the kept copies (the viewer cache's touched boards)."""
    return {_APP_PACK_EVENTS[app] for app in _app_pack_apps_of(action, raw)}


def _app_pack_ring(app: str, *, kept_copy: bool = False) -> None:
    try:
        LF.publish(_APP_PACK_EVENTS[app], kept_copy=kept_copy)
    except Exception:  # noqa: BLE001 - telling nobody never fails a write or a fill
        pass


# a write that changes these apps' Python copy behind it: those apps swept
_APP_PACK_PYTHON_BEHIND: dict[str, tuple[str, ...]] = {a: tuple(v) for a, v in
                                                       (_PLANE.get("python_behind") or {}).items()}
# the writes that change who reads what — accounts, App Control, the hidden apps, a client's record
_APP_PACK_PEOPLE_WRITES = frozenset(_PLANE.get("people_writes") or ())
_APP_PACK_PEOPLE_RESOURCES = frozenset(_PLANE.get("people_resources") or ())
# when one last landed, kept on disk beside the packs, where the front door reads it (front_door.people_at)
_app_pack_people_at: list[float] = [0.0]
_BACKEND_PEOPLE_FILE = "who-reads-what.json"


def _backend_people_changed() -> None:
    """The mark written to disk, and the relay's sheet keeper told once Drive's listing vouches for it."""
    folder = _app_pack_dir()
    if folder is not None:
        _app_pack_write_file(folder, _BACKEND_PEOPLE_FILE, {"v": 1, "at": _app_pack_people_at[0]})
    LF.wake("sheet-sync")


def people_changed() -> None:
    """Who reads what changed just now."""
    _app_pack_people_at[0] = time.time()
    _backend_people_changed()


def rang_write(action: str, raw: bytes, content: bytes | None = None, *, python: bool = False) -> None:
    """A write landed: every app it changes rings its name, who reads what marked when it changed that, and the apps
    whose Python copy it leaves behind swept."""
    try:
        if action in _APP_PACK_PEOPLE_WRITES or (action in _APP_PACK_VERBS and str(
                (LF.relay_envelope(raw) or {}).get("resource") or "") in _APP_PACK_PEOPLE_RESOURCES):
            said = json.loads(content) if content is not None else {"status": 200}
            if isinstance(said, dict) and said.get("status") == 200:
                people_changed()
    except Exception:  # noqa: BLE001 - an observer never stops the ring below
        pass
    try:
        behind = () if python else _APP_PACK_PYTHON_BEHIND.get(action or _app_pack_write_of(action, raw)[0], ())
        said = json.loads(content) if behind and content is not None else {"status": 200}
        if behind and isinstance(said, dict) and said.get("status") == 200:
            for app in behind:
                LF.sweep(app)
    except Exception:  # noqa: BLE001 - an observer never stops the ring below
        pass
    try:
        apps = _app_pack_apps_of(action, raw)
        if not apps:
            return
        if content is not None:
            env = json.loads(content)
            if not isinstance(env, dict) or env.get("status") != 200:
                return
        for app in sorted(apps):
            _app_pack_ring(app)
    except Exception:  # noqa: BLE001 - telling nobody must never fail a write
        pass


def _app_pack_unclocked(data: Any) -> Any:
    """A pack's parts without the clocks that move on every read."""
    clocks = ("built_at", "now", "stamp", "as_of", "age_s", "read_age_s", "state")
    parts = data.get("parts") if isinstance(data, dict) else None
    if not isinstance(parts, dict):
        return data
    return {k: {f: v for f, v in p.items() if f not in clocks} if isinstance(p, dict) else p for k, p in parts.items()}


def _app_pack_viewed_lately(slot: tuple[str, str]) -> bool:
    return time.time() - _app_pack_viewed.get(slot, 0.0) < APP_PACK_RECENT_S


def _app_pack_engine() -> str:
    """The engine build last seen (live_health.engine_build), read again at most every ENGINE_HOLD_S."""
    now = time.monotonic()
    if now - float(_ENGINE["at"]) >= ENGINE_HOLD_S or not _ENGINE["at"]:
        try:
            import live_health  # noqa: PLC0415 - the plane's own reading of it

            _ENGINE["build"] = live_health.engine_build()
        except Exception:  # noqa: BLE001 - the last one read stands
            pass
        _ENGINE["at"] = now
    return str(_ENGINE["build"] or "")


def _app_pack_resting(app: str) -> bool:
    rest = _app_pack_unpublished.get(app)
    return rest is not None and rest[1] == _app_pack_engine() and time.time() - rest[0] < APP_PACK_UNPUBLISHED_S


def _app_pack_not_served(status: int, message: str) -> bool:
    """Python serves no pack at all — an action it does not know, or one the service identity may not ask."""
    said = str(message or "").strip().lower()
    return status in (401, 403) or (status == 404 and said.startswith("unknown action"))


def _app_pack_trim() -> None:
    while len(_app_pack_held) > APP_PACK_MAX_HELD:
        oldest = min(_app_pack_held, key=lambda s: _app_pack_held[s].get("filled_at", 0.0))
        _app_pack_held.pop(oldest, None)
        _app_pack_forget(oldest)


def _app_pack_engine_moved(held: dict[str, Any]) -> bool:
    was, now = str(held.get("engine") or ""), _app_pack_engine()
    return bool(was and now and was != now)


def _app_pack_is_stale(held: dict[str, Any]) -> bool:
    """Served only while it is filled again: swept, written to elsewhere, taken up after a restart, or filled under
    another engine build."""
    return bool(held.get("stale")) or _app_pack_engine_moved(held)


def _app_pack_voided(slot: tuple[str, str], read_at: Any) -> bool:
    """Read before a moment that voids or refuses its key or its whole app: never kept, never taken up."""
    try:
        began = float(read_at or 0.0)
    except (TypeError, ValueError):
        return True
    return began < max(_app_pack_void.get(slot, 0.0), _app_pack_void.get((slot[0], ""), 0.0),
                       _app_pack_refused.get(slot, 0.0), _app_pack_refused.get((slot[0], ""), 0.0))


# ---- the packs on disk ----------------------------------------------------------------------------------------------

def _app_pack_dir_state(path: str | None = None) -> "tuple[Path | None, str]":
    """(the folder the packs are kept in, '') — or (None, why there is none): unset, missing, unreadable, or inside
    the served snapshot tree or the bundle deposit."""
    raw = APP_PACK_DIR if path is None else path
    if not raw:
        return None, "unset"
    try:
        folder = Path(raw).resolve()
        refused = ((OUT_DIR.resolve(), "inside the served snapshot tree"),
                   (Path(BUNDLE_DIR).resolve(), "inside the bundle deposit"))
        for root, why in refused:
            if folder == root or root in folder.parents:
                return None, why
        if not folder.is_dir():
            return None, "missing"
    except (OSError, RuntimeError):
        return None, "unreadable"
    return folder, ""


def _app_pack_dir() -> "Path | None":
    return _app_pack_dir_state()[0]


def _app_pack_file(app: str, key: str) -> str:
    """A kept pack's file name: a hash of its app and key, never the key itself (a client's key is a name)."""
    return hashlib.sha256(f"{app}\n{key}".encode("utf-8")).hexdigest() + ".json"


def _app_pack_forget(slot: tuple[str, str]) -> None:
    folder = _app_pack_dir()
    if folder is None:
        return
    try:
        (folder / _app_pack_file(*slot)).unlink(missing_ok=True)
    except OSError as exc:
        log.warning("app pack: a kept %s pack could not be removed (%s)", slot[0], type(exc).__name__)


def _app_pack_write_file(folder: Path, name: str, body: dict[str, Any]) -> bool:
    """One file of the pack folder written whole beside itself, then renamed over it: 0600, the folder 0700."""
    temp = ""
    try:
        text = json.dumps(body, separators=(",", ":"))
        os.chmod(folder, 0o700)
        fd, temp = tempfile.mkstemp(dir=folder, prefix=f".{name}.", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(text)
        os.replace(temp, folder / name)
        temp = ""
        return True
    except Exception as exc:  # noqa: BLE001 - what it holds is still held in memory
        log.warning("app pack: a pack file could not be written (%s)", type(exc).__name__)
        return False
    finally:
        if temp:
            try:
                os.unlink(temp)
            except OSError:
                pass


def _app_pack_kept(slot: tuple[str, str], job: "asyncio.Future[bool]") -> None:
    held = _app_pack_held.get(slot)
    wrote = not job.cancelled() and job.exception() is None and job.result() is True
    if not wrote or held is None or held.get("dirty") or _app_pack_voided(slot, held.get("read_at")):
        _app_pack_forget(slot)


async def _app_pack_keep(slot: tuple[str, str], entry: dict[str, Any]) -> None:
    """A filled pack kept whole on disk, written off the event loop."""
    if entry.get("dirty") or _app_pack_voided(slot, entry.get("read_at")):
        _app_pack_forget(slot)
        return
    folder = _app_pack_dir()
    if folder is None:
        return
    body = {"v": 1, "app": slot[0], "key": slot[1], "engine": str(entry.get("engine") or ""),
            "built_at": entry["built_at"], "read_at": entry["read_at"], "filled_at": entry["filled_at"],
            "data": entry["data"]}
    job = asyncio.ensure_future(asyncio.to_thread(_app_pack_write_file, folder, _app_pack_file(*slot), body))
    job.add_done_callback(lambda done: _app_pack_kept(slot, done))
    try:
        await asyncio.shield(job)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - the pack stays held, its file goes (_app_pack_kept)
        pass


def _app_pack_mark(app: str, at: float) -> None:
    """The app's mark on disk: after a restart no copy of its packs read before `at` is taken up."""
    folder = _app_pack_dir()
    if folder is not None:
        _app_pack_write_file(folder, f"{app}.void", {"v": 1, "app": app, "at": at})


def _app_pack_refuse(slot: tuple[str, str]) -> None:
    _app_pack_refused[slot] = time.time()
    held = _app_pack_held.get(slot)
    if held is not None:
        held["dirty"] = True
    _app_pack_forget(slot)


def _app_pack_refuse_app(app: str) -> None:
    now = time.time()
    _app_pack_refused[(app, "")] = now
    for slot, held in list(_app_pack_held.items()):
        if slot[0] == app:
            held["dirty"] = True
            _app_pack_forget(slot)
    _app_pack_mark(app, now)


def _app_pack_expire() -> int:
    """Every held pack past the ceiling dropped with its kept file, unless a fill for it is out."""
    now = time.time()
    gone = 0
    for slot, held in list(_app_pack_held.items()):
        task = _app_pack_inflight.get(slot)
        if now - float(held.get("filled_at") or 0.0) < APP_PACK_CEILING_S or (task is not None and not task.done()):
            continue
        _app_pack_held.pop(slot, None)
        _app_pack_forget(slot)
        gone += 1
    for marks in (_app_pack_void, _app_pack_refused):
        for slot, at in list(marks.items()):
            if now - at >= APP_PACK_CEILING_S + APP_PACK_CLIENT_FILL_TIMEOUT_S:
                marks.pop(slot, None)
    for slot, at in list(_app_pack_viewed.items()):
        if now - at >= APP_PACK_RECENT_S:
            _app_pack_viewed.pop(slot, None)
    return gone


def _app_pack_from_disk(name: str, body: Any, now: float) -> tuple[tuple[str, str], dict[str, Any]]:
    """A kept file as a held entry, stale whatever engine filled it: a restart never serves a kept pack as fresh."""
    if not isinstance(body, dict) or body.get("v") != 1:
        raise ValueError("shape")
    app, key = str(body.get("app") or ""), str(body.get("key") or "")
    spec = _APP_PACKS.get(app)
    if (spec is None or spec["fold"](key) != key or not re.fullmatch(spec["key_re"], key)
            or _app_pack_file(app, key) != name):
        raise ValueError("key")
    data = body.get("data")
    filled_at = float(body.get("filled_at"))
    read_at = float(body.get("read_at") or filled_at)
    if (not isinstance(data, dict) or not isinstance(data.get("parts"), dict)
            or not 0 < read_at <= filled_at <= now + 60 or now - filled_at >= APP_PACK_CEILING_S):
        raise ValueError("pack")
    return (app, key), {"data": data, "built_at": str(body.get("built_at") or ""), "read_at": read_at,
                        "filled_at": filled_at, "dirty": False, "stale": True, "lane": "disk",
                        "engine": str(body.get("engine") or "")}


def _app_pack_disk_read(now: float) -> tuple[list[tuple[tuple[str, str], dict[str, Any]]], list[str]]:
    """The kept packs: (every whole one inside the ceiling and read after its app's mark, the files to remove)."""
    folder = _app_pack_dir()
    if folder is None:
        return [], []
    names = sorted(path.name for path in folder.iterdir())
    marks: dict[str, float] = {}
    drop: list[str] = []
    for name in names:
        said = re.fullmatch(_APP_PACK_MARK_RE, name)
        if said is None:
            continue
        try:
            marks[said.group(1)] = float(json.loads((folder / name).read_text(encoding="utf-8"))["at"])
        except Exception:  # noqa: BLE001 - an unreadable mark: none of its app's packs taken up, and the mark goes
            marks[said.group(1)] = now
            drop.append(name)
    found: list[tuple[tuple[str, str], dict[str, Any]]] = []
    for name in names:
        if re.fullmatch(_APP_PACK_TEMP_RE, name):
            drop.append(name)
            continue
        if not re.fullmatch(_APP_PACK_FILE_RE, name):
            continue
        try:
            slot, entry = _app_pack_from_disk(name, json.loads((folder / name).read_text(encoding="utf-8")), now)
        except Exception:  # noqa: BLE001 - no pack: not taken up, and its file goes
            drop.append(name)
            continue
        if entry["read_at"] < marks.get(slot[0], 0.0):
            drop.append(name)
            continue
        found.append((slot, entry))
    return found, drop


def _app_pack_purge_unused() -> int:
    """The pack files the default folder still holds while it is not the folder in use."""
    folder = _app_pack_dir_state(APP_PACK_DEFAULT_DIR)[0]
    if folder is None or folder == _app_pack_dir():
        return 0
    gone = 0
    for path in folder.iterdir():
        if any(re.fullmatch(p, path.name) for p in (_APP_PACK_FILE_RE, _APP_PACK_TEMP_RE, _APP_PACK_MARK_RE)):
            path.unlink(missing_ok=True)
            gone += 1
    return gone


async def _app_pack_adopt_disk() -> int:
    """After a restart, the kept packs taken up stale — never over a key held, filling, written to or voided."""
    folder, why = _app_pack_dir_state()
    if folder is None:
        if why != "unset":
            log.warning("app pack: the pack folder %s is %s; the packs are held in memory alone", APP_PACK_DIR, why)
    try:
        gone = await asyncio.to_thread(_app_pack_purge_unused)
    except Exception as exc:  # noqa: BLE001
        log.warning("app pack: the default pack folder could not be swept (%s)", type(exc).__name__)
        gone = 0
    if gone:
        log.warning("app pack: %d file(s) left in %s, a pack folder not in use, removed", gone, APP_PACK_DEFAULT_DIR)
    if folder is None:
        return 0
    try:
        found, drop = await asyncio.to_thread(_app_pack_disk_read, time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("app pack: the kept packs could not be read (%s)", type(exc).__name__)
        return 0
    taken = 0
    for slot, entry in found:
        if slot in _app_pack_held:
            continue
        if (_app_pack_gen.get(slot) or slot in _app_pack_inflight or slot in _app_pack_touched
                or _app_pack_voided(slot, entry["read_at"])):
            drop.append(_app_pack_file(*slot))
            continue
        _app_pack_held[slot] = entry
        taken += 1
    written = {_app_pack_file(*s) for s in _app_pack_held}
    removed = 0
    for name in drop:
        if name not in written:
            try:
                (folder / name).unlink(missing_ok=True)
                removed += 1
            except OSError:
                pass
    _app_pack_trim()
    if found or drop:
        log.info("app pack: %d kept pack(s) taken up stale, %d file(s) removed", taken, removed)
    return taken


# ---- the fills ------------------------------------------------------------------------------------------------------

async def _app_pack_take(sem: asyncio.Semaphore, promote: asyncio.Event) -> bool:
    """True once `sem` is held; False when a person came to wait first — nothing is then held."""
    take = asyncio.ensure_future(sem.acquire())
    wake = asyncio.ensure_future(promote.wait())
    try:
        await asyncio.wait((take, wake), return_when=asyncio.FIRST_COMPLETED)
    except BaseException:
        wake.cancel()
        take.cancel()
        if take.done() and not take.cancelled():
            sem.release()
        raise
    wake.cancel()
    if take.done():
        return True
    take.cancel()
    return False


async def _app_pack_ticket(promote: asyncio.Event) -> bool:
    """A background fill's turn: True once it is the one background fill running and holds a housekeeping ticket;
    False when a person came to wait on it first."""
    if promote.is_set():
        return False
    if not await _app_pack_take(_app_pack_bg_sem, promote):
        return False
    try:
        if await _app_pack_take(_housekeeping_slots, promote):
            return True
    except BaseException:
        _app_pack_bg_sem.release()
        raise
    _app_pack_bg_sem.release()
    return False


def _app_pack_ticket_back() -> None:
    _housekeeping_slots.release()
    _app_pack_bg_sem.release()


async def _app_pack_fill(app: str, key: str, *, promote: asyncio.Event) -> dict[str, Any]:
    """One execution for one key, stored in memory; raises when Python did not answer the pack."""
    slot = (app, key)
    ticket = await _app_pack_ticket(promote)
    if ticket:
        _app_pack_person_lane.discard(promote)
    # taken as the execution begins: a write landed before it is in what it reads
    gen = _app_pack_gen.get(slot, 0)
    stale_gen = _app_pack_stale_gen.get(slot, 0)
    engine = _app_pack_engine()
    read_at = time.time()
    began = (asyncio.current_task(), read_at)
    _app_pack_began[slot] = began
    started = time.monotonic()
    try:
        env = await _APP_PACKS[app]["exec"](key)
    except Exception as exc:  # noqa: BLE001 - said once here; the caller answers in words
        log.warning("app pack: a %s fill failed (%s)", app, type(exc).__name__)
        raise
    finally:
        if ticket:
            _app_pack_ticket_back()
        _app_pack_person_lane.discard(promote)
        if _app_pack_began.get(slot) is began:
            _app_pack_began.pop(slot, None)
    try:
        status = int(env.get("status") or 0) if isinstance(env, dict) else 0
    except (TypeError, ValueError):
        status = 0
    if status != 200:
        message = str((env or {}).get("message") or "") if isinstance(env, dict) else ""
        if _app_pack_not_served(status, message):
            _app_pack_unpublished[app] = (time.time(), _app_pack_engine())
            _app_pack_refuse_app(app)
            log.warning("app pack: the engine does not answer the %s pack yet; not asked again until it changes", app)
        else:
            log.warning("app pack: a %s fill was refused (%s)", app, status or "no status")
            if 400 <= status < 500 and status not in (408, 429):
                _app_pack_refuse(slot)
        raise _AppPackRefused(status if 400 <= status < 600 else 502, message)
    data = env.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("parts"), dict):
        log.warning("app pack: a %s fill answered another shape", app)
        raise _AppPackRefused(502, "")
    built = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lane = "housekeeping" if ticket else "person"
    # a pack read off a copy is as old as the copy
    copy_at = env.get("as_of") if isinstance(env, dict) else None
    if isinstance(copy_at, (int, float)) and 0 < copy_at < read_at:
        read_at = float(copy_at)
    entry = {"data": data, "built_at": str(data.get("built_at") or built), "read_at": read_at, "filled_at": time.time(),
             "dirty": _app_pack_gen.get(slot, 0) != gen, "stale": _app_pack_stale_gen.get(slot, 0) != stale_gen,
             "lane": lane, "engine": engine}
    before = _app_pack_held.get(slot)
    _app_pack_held[slot] = entry
    _app_pack_trim()
    await _app_pack_keep(slot, entry)
    # other parts than the copy before, of a key read lately or written: its open screens read again
    if (before is not None and (_app_pack_viewed_lately(slot) or before.get("dirty") or before.get("stale"))
            and _app_pack_unclocked(before.get("data")) != _app_pack_unclocked(data)):
        _app_pack_ring(app, kept_copy=True)
    refused = sum(1 for v in (data.get("part_status") or {}).values()
                  if isinstance(v, dict) and v.get("status") != 200)
    log.info("app pack: %s filled on the %s lane (%d part(s), %d refused, %.1f s)", app, lane, len(data["parts"]),
             refused, time.monotonic() - started)
    return entry


def _app_pack_settled(slot: tuple[str, str], task: asyncio.Task, promote: asyncio.Event) -> None:
    _app_pack_person_lane.discard(promote)
    if _app_pack_inflight.get(slot) is task:
        _app_pack_inflight.pop(slot, None)
        _app_pack_promote.pop(slot, None)
    if task.cancelled() or task.exception() is not None:
        return
    held = _app_pack_held.get(slot)
    # written to, or swept, while it was being read: read again, in the background
    if held is not None and (held.get("dirty") or held.get("stale")):
        _app_pack_kick(slot[0], slot[1], housekeeping=True)


def _app_pack_to_person(promote: asyncio.Event) -> bool:
    if len(_app_pack_person_lane) >= APP_PACK_PERSON_FILLS:
        return False
    _app_pack_person_lane.add(promote)
    promote.set()
    return True


def _app_pack_on_person_lane(slot: tuple[str, str]) -> bool:
    promote = _app_pack_promote.get(slot)
    return promote is not None and promote in _app_pack_person_lane


def _app_pack_kick(app: str, key: str, *, housekeeping: bool) -> asyncio.Task:
    """The one fill in flight for this key, started when there is none."""
    slot = (app, key)
    task = _app_pack_inflight.get(slot)
    if task is not None and not task.done():
        promote = _app_pack_promote.get(slot)
        if not housekeeping and promote is not None and not promote.is_set() and slot not in _app_pack_began:
            _app_pack_to_person(promote)
        return task
    promote = asyncio.Event()
    if not housekeeping:
        _app_pack_to_person(promote)
    task = asyncio.ensure_future(_app_pack_fill(app, key, promote=promote))
    _app_pack_inflight[slot] = task
    _app_pack_promote[slot] = promote
    task.add_done_callback(lambda t, s=slot, p=promote: _app_pack_settled(s, t, p))
    return task


def _app_pack_due(app: str, key: str) -> bool:
    slot = (app, key)
    task = _app_pack_inflight.get(slot)
    if task is not None and not task.done():
        return False
    held = _app_pack_held.get(slot)
    if held is None or bool(held.get("dirty")) or _app_pack_is_stale(held) or _app_pack_past_week(app, held):
        return True
    age = time.time() - held["filled_at"]
    fresh = min(APP_PACK_CEILING_S / 2, float(_APP_PACKS.get(app, {}).get("warm_every_s") or APP_PACK_FRESH_S))
    return age >= fresh or (age >= APP_PACK_REFILL_S and _app_pack_viewed_lately(slot))


def _app_pack_invalidate(app: str, key: str = "", *, stale: bool = False) -> int:
    """A write that names its key, from the app itself: dirty at once — never served again — and filled again; one
    from elsewhere (stale): served while it is filled again behind it; no key: every key of the app stale."""
    if app not in _APP_PACKS:
        return 0
    if not key:
        LF.sweep(app)
        known = sorted({k for (a, k) in list(_app_pack_held) + list(_app_pack_inflight) if a == app})
        for k in known:
            slot = (app, k)
            _app_pack_stale_gen[slot] = _app_pack_stale_gen.get(slot, 0) + 1
            held = _app_pack_held.get(slot)
            if held is not None:
                held["stale"] = True
        _app_pack_warm_wake.set()
        return len(known)
    slot = (app, key)
    held = _app_pack_held.get(slot)
    _app_pack_touched[slot] = time.time()
    if stale:
        _app_pack_stale_gen[slot] = _app_pack_stale_gen.get(slot, 0) + 1
        if held is not None:
            held["stale"] = True
    else:
        _app_pack_gen[slot] = _app_pack_gen.get(slot, 0) + 1
        if held is not None:
            held["dirty"] = True
        _app_pack_forget(slot)
    try:
        asyncio.get_running_loop()
    except RuntimeError:  # no loop to fill on: the mark stands and the next read fills it
        return 1
    if not _app_pack_resting(app) and (not stale or held is not None or slot in _app_pack_inflight):
        _app_pack_kick(app, key, housekeeping=stale)
    return 1


def note_write(action: str, body: dict[str, Any], env: Any = None) -> None:
    """A landed write that changes what a pack holds: the app's own write makes the key it names dirty, a write made
    elsewhere the keys it names stale, a sweep (or a generic write to a resource every key reads) every key stale."""
    resource = str(body.get("resource") or "") or _APP_PACK_DOOR_RESOURCES.get(action, "")
    generic = action in _APP_PACK_VERBS or action in _APP_PACK_DOOR_RESOURCES
    for app, spec in _APP_PACKS.items():
        if action in spec["writes"]:
            _app_pack_invalidate(app, spec["key_of"](body, env))
        elif action in spec["elsewhere"] or (generic and resource in spec["resources"] and spec["verbs"] == "by_key"):
            keys = spec["keys_of"](body, env) if "keys_of" in spec else [spec["key_of"](body, env)]
            for key in keys:
                if key:
                    _app_pack_invalidate(app, key, stale=True)
        elif action in spec["sweeps"] or (generic and resource in spec["resources"]):
            _app_pack_invalidate(app)


def _app_pack_upload_envelope(raw: bytes) -> dict[str, Any]:
    """What the opening bytes of a body too big for the envelope reader (an upload) name — its action, resource and
    the keys it names — for a watched write alone."""
    if len(raw) <= 100_000:
        return {}
    head = raw[:APP_PACK_HEAD_BYTES].decode("utf-8", "ignore")
    if head.startswith("body="):
        head = urllib.parse.unquote_plus(head[5:])
    said: dict[str, str] = {}
    for name in ("action", "resource", "house", "client", "candidate_id", "candidate"):
        found = re.search(r'"%s"\s*:\s*"([A-Za-z0-9_.\-]{1,80})"' % name, head)
        if found:
            said[name] = found.group(1)
    if said.get("action") not in _APP_PACK_WATCHED:
        return {}
    return {"action": said["action"], "resource": said.get("resource", ""),
            "payload": {k: said[k] for k in ("house", "client", "candidate_id", "candidate") if said.get(k)}}


def _app_pack_write_of(action: str, raw: bytes) -> tuple[str, dict[str, Any]]:
    """The watched write a /gas body carries and its envelope; ('', {}) for any other."""
    if not action:
        body = _app_pack_upload_envelope(raw)
        return str(body.get("action") or ""), body
    if action not in _APP_PACK_WATCHED:
        return "", {}
    return action, LF.relay_envelope(raw) or {}


def write_of(action: str, raw: bytes) -> tuple[str, dict[str, Any]]:
    return _app_pack_write_of(action, raw)


def apps_of(action: str, raw: bytes) -> set[str]:
    return _app_pack_apps_of(action, raw)


def ring(app: str) -> None:
    _app_pack_ring(app)


def observe(action: str, raw: bytes, content: bytes, *, python: bool = False) -> None:
    """A write that changes a pack answered 200: its apps rung, its keys marked."""
    rang_write(action, raw, content, python=python)
    try:
        action, body = _app_pack_write_of(action, raw)
        if not action:
            return
        if action in _APP_PACK_VERBS and not any(str(body.get("resource") or "") in s["resources"]
                                                 for s in _APP_PACKS.values()):
            return
        env = json.loads(content)
        if isinstance(env, dict) and env.get("status") == 200:
            note_write(action, body, env)
    except Exception:  # noqa: BLE001 - an observer never breaks the answer
        return


# ---- the reads ------------------------------------------------------------------------------------------------------

def _app_pack_answer(entry: dict[str, Any], state: str) -> dict[str, Any]:
    now = time.time()
    age = max(0.0, now - float(entry.get("filled_at") or 0.0))
    read_age = max(age, now - float(entry.get("read_at") or entry.get("filled_at") or 0.0))
    return {"status": 200, "data": {**entry["data"], "built_at": entry["built_at"], "age_s": round(age, 1),
                                    "read_age_s": round(read_age, 1), "state": state}}


def _app_pack_written(app: str, key: str, written_ms: int, sent_ms: int = 0) -> None:
    """The session's write for this key was answered `written_ms` ago, and sent `sent_ms` ago."""
    if not 0 < written_ms <= APP_PACK_WRITTEN_MAX_MS:
        return
    slot = (app, key)
    now = time.time()
    need = now - written_ms / 1000.0
    if written_ms <= sent_ms <= APP_PACK_WRITTEN_MAX_MS:
        landed = _app_pack_touched.get(slot, 0.0)
        if landed >= now - sent_ms / 1000.0:
            need = landed
    _app_pack_void[slot] = max(_app_pack_void.get(slot, 0.0), need)
    held = _app_pack_held.get(slot)
    if held is not None and not held.get("dirty") and float(held.get("read_at") or held.get("filled_at") or 0.0) < need:
        held["dirty"] = True
        _app_pack_forget(slot)
    began = _app_pack_began.get(slot)
    if began is not None and began[1] < need:
        _app_pack_gen[slot] = _app_pack_gen.get(slot, 0) + 1


async def _app_pack_get(app: str, key: str, arrived: float | None = None,
                        wait_s: float | None = None) -> dict[str, Any]:
    """Fresh from memory; past fresh (or stale) and inside the ceiling, served while it is filled again; dirty or
    missing, filled while the read waits its turn."""
    slot = (app, key)
    wait = APP_PACK_WAIT_S if wait_s is None else max(0.0, min(float(wait_s), APP_PACK_WAIT_S))
    person = wait_s is None or float(wait_s) >= APP_PACK_PERSON_WAIT_S
    deadline = (time.monotonic() if arrived is None else arrived) + wait
    _app_pack_viewed[slot] = time.time()
    while True:
        held = _app_pack_held.get(slot)
        if held is not None and not held.get("dirty"):
            age = time.time() - held["filled_at"]
            if age < APP_PACK_FRESH_S and not _app_pack_is_stale(held):
                if age >= APP_PACK_REFILL_S and not _app_pack_resting(app):
                    _app_pack_kick(app, key, housekeeping=True)
                return _app_pack_answer(held, "fresh")
            if age < APP_PACK_CEILING_S:
                if not _app_pack_resting(app):
                    _app_pack_kick(app, key, housekeeping=True)
                return _app_pack_answer(held, "refreshing")
        if _app_pack_resting(app):
            return {"status": 503, "reason": "unpublished",
                    "message": "This read is not on the published engine yet; each section is read on its own."}
        task = _app_pack_kick(app, key, housekeeping=not person)
        left = deadline - time.monotonic()
        if left <= 0 or (person and not _app_pack_on_person_lane(slot) and slot not in _app_pack_began):
            return {"status": 503, "reason": "filling", "message": "This read is still being gathered. Try again."}
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=left)
        except asyncio.TimeoutError:
            return {"status": 503, "reason": "filling", "message": "This read is still being gathered. Try again."}
        except _AppPackRefused as exc:
            if _app_pack_resting(app):
                continue
            return {"status": exc.status, "reason": "refused",
                    "message": exc.message or "The engine did not answer this read."}
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: nothing is drawn from a fill that did not answer
            return {"status": 503, "reason": "unreadable",
                    "message": f"This read could not be gathered ({type(exc).__name__})."}


def _app_pack_spare(app: str, key: str) -> None:
    """A background fill for a key the warm pass keeps, while few background fills wait or run."""
    if _app_pack_resting(app):
        return
    task = _app_pack_inflight.get((app, key))
    if task is not None and not task.done():
        return
    waiting = 0
    for s, t in list(_app_pack_inflight.items()):
        promote = _app_pack_promote.get(s)
        if not t.done() and (promote is None or not promote.is_set()):
            waiting += 1
    if waiting >= APP_PACK_PEEK_QUEUE:
        return
    try:
        keys = _APP_PACKS[app]["keys"]()
    except Exception:  # noqa: BLE001 - no keys, no fill
        return
    if key in keys:
        _app_pack_kick(app, key, housekeeping=True)


def _app_pack_peek(app: str, key: str) -> dict[str, Any]:
    """A prefetch: what memory holds, never waited for and never on a person's lane."""
    held = _app_pack_held.get((app, key))
    if held is not None and not held.get("dirty"):
        age = time.time() - held["filled_at"]
        if age < APP_PACK_FRESH_S and not _app_pack_is_stale(held):
            return _app_pack_answer(held, "fresh")
        if age < APP_PACK_CEILING_S:
            _app_pack_spare(app, key)
            return _app_pack_answer(held, "refreshing")
    _app_pack_spare(app, key)
    return {"status": 503, "reason": "cold", "message": "This read is not held yet."}


# ---- the warm pass --------------------------------------------------------------------------------------------------

def _app_pack_warm_rank(app: str, key: str) -> int:
    held = _app_pack_held.get((app, key))
    if held is None:
        return 1
    return 0 if held.get("dirty") or _app_pack_is_stale(held) or _app_pack_viewed_lately((app, key)) else 2


def _app_pack_client_slots() -> list[tuple[str, str]]:
    """Each client account's own slots, its record first: its Clients pack and its Staff pack, and the packs of its
    one house and its SSA."""
    if not _app_pack_client_accounts:
        return []
    houses = _app_pack_own_houses()
    ssas = _app_pack_ssa_index()["of_client"]
    slots: list[tuple[str, str]] = []
    for key in list(_app_pack_client_accounts):
        for slot in ((_APP_PACK_CLIENTS, key), (_APP_PACK_STAFF, key), ("locations", houses.get(key, "")),
                     (_APP_PACK_SSAS, str(ssas.get(key) or ""))):
            if slot[1] and slot not in slots:
                slots.append(slot)
    return slots


async def _app_pack_warm_clients(slots: list[tuple[str, str]]) -> int:
    filled = 0
    for app, key in slots:
        if _app_pack_resting(app) or not _app_pack_due(app, key):
            continue
        async with _app_pack_warm_sem:
            try:
                await _app_pack_kick(app, key, housekeeping=True)
                filled += 1
            except Exception:  # noqa: BLE001 - said by the fill; the next turn tries again
                pass
    return filled


async def _app_pack_warm_pass() -> int:
    """Every key of every app that is missing, dirty, stale or no longer fresh, one execution at a time, on the
    housekeeping lane, the client accounts' own slots between each."""
    filled = 0
    try:
        await asyncio.to_thread(_app_pack_client_accounts_refresh)
    except Exception as exc:  # noqa: BLE001 - the accounts held stay; the next pass reads again
        log.warning("app pack: the client accounts could not be read (%s)", type(exc).__name__)
    try:
        slots = _app_pack_client_slots()
    except Exception:  # noqa: BLE001 - no slots, the pass itself still runs
        slots = []
    filled += await _app_pack_warm_clients(slots)
    for app, spec in sorted(_APP_PACKS.items(), key=lambda item: item[1].get("warm_order", 1)):
        if _app_pack_resting(app):
            continue
        try:
            keys = list(spec["keys"]())[:APP_PACK_MAX_KEYS]
        except Exception:  # noqa: BLE001 - no keys, no pass
            keys = []
        keys.sort(key=lambda k: _app_pack_warm_rank(app, k))
        for key in keys:
            if _app_pack_resting(app):
                break
            if not _app_pack_due(app, key):
                continue
            async with _app_pack_warm_sem:
                try:
                    await _app_pack_kick(app, key, housekeeping=True)
                    filled += 1
                except Exception:  # noqa: BLE001 - said by the fill; the next pass tries again
                    pass
            filled += await _app_pack_warm_clients(slots)
    return filled


async def warm_loop() -> None:
    """The kept packs taken up, then the warm pass on its beat; every beat, nothing past the ceiling stays."""
    await _app_pack_adopt_disk()
    await asyncio.sleep(APP_PACK_WARM_START_S)
    while True:
        _app_pack_warm_wake.clear()
        gone = _app_pack_expire()
        if gone:
            log.info("app pack: %d pack(s) past the ceiling dropped with their kept files", gone)
        started = time.monotonic()
        try:
            filled = await _app_pack_warm_pass()
            if filled:
                log.info("app pack: warm pass filled %d key(s) in %.1f s", filled, time.monotonic() - started)
        except Exception as exc:  # noqa: BLE001 - the next pass tries again
            log.warning("app pack: the warm pass failed (%s)", type(exc).__name__)
        try:
            await asyncio.wait_for(_app_pack_warm_wake.wait(), timeout=min(APP_PACK_WARM_EVERY_S, APP_PACK_REFILL_S))
        except asyncio.TimeoutError:
            pass


# ---- who may read a pack --------------------------------------------------------------------------------------------

# Settings › My Work — each pack's parts a switch keeps to the master's own session
_APP_PACK_HIDDEN_PARTS: dict[str, dict[str, tuple[str, ...]]] = {
    app: {switch: tuple(parts) for switch, parts in table.items()}
    for app, table in (_PLANE.get("hidden_parts") or {}).items()}
# the switches as Python answers them, per account
_APP_PACK_HIDES_HELD: dict[str, tuple[float, dict[str, bool]]] = {}
APP_PACK_HIDES_HOLD_S = 60.0


async def _app_pack_hidden_parts(s: FD.Session | None, app: str) -> tuple[str, ...]:
    """The parts of `app`'s pack out of this session's sight (never asked for the master's own): Python's
    myWorkHidesMine, held a minute per account; a session, an answer or a switch that cannot be had hides its parts."""
    table = _APP_PACK_HIDDEN_PARTS.get(app)
    if not table:
        return ()
    every = tuple(p for names in table.values() for p in names)
    who = LG.actor(s)
    uid = str(who[1] or "") if who else ""
    if not uid:
        return every
    hit = _APP_PACK_HIDES_HELD.get(uid)
    if hit is None or time.monotonic() - hit[0] >= APP_PACK_HIDES_HOLD_S:
        user: dict[str, Any] = {"uid": uid, "role": str(who[0] or "").strip().lower(), "is_master": False}
        if s is not None and s.acting:
            user = {**user, "acting": True, "unlogged": True, "is_master": False}
        try:
            got = await FD.call_app("editions", "myWorkHidesMine", user, {})
        except Exception:  # noqa: BLE001 - an answer that cannot be had hides its parts
            got = None
        env = got[2] if got is not None else {}
        data = env.get("data") if env.get("status") == 200 and isinstance(env.get("data"), dict) else None
        if data is None:
            log.info("my work hides: the switches could not be read for a session — %s parts withheld", app)
            return every
        hit = (time.monotonic(), {str(k): v is not False for k, v in data.items()})
        _APP_PACK_HIDES_HELD[uid] = hit
    return tuple(p for switch, names in table.items() if hit[1].get(switch, True) for p in names)


VISIT = {"status": 403, "reason": "visit",
         "message": "This read is the signed-in account's own; it is not drawn inside a visit."}


def _said(env: dict[str, Any]) -> Response:
    return LG.answer(env, no_store=True)


async def lane_app_pack(app_id: str, request: Request) -> Response:
    """One app's pack for one key, from memory: the master's own session, or one the app is released to — its key
    from X-App-Pack-Key (or ?key= where the app takes it there), a write of the session's own named (?written_ms=,
    ?sent_ms=), a prefetch (?peek=1) or a wait (?wait=)."""
    arrived = time.monotonic()
    if LG.query(request, "member").strip():
        return _said(dict(VISIT))
    token = LG.token_of(request)
    if not token:
        return _said({"status": 401, "reason": "session", "message": "sign in first"})
    s = await LG.session(token)
    if s is not None and s.acting:
        return _said(dict(_APP_PACK_REFUSED))
    ok = LG.is_master(s)
    pack = _APP_PACK_DOORS.get(app_id, app_id)
    spec = _APP_PACKS.get(pack)
    # a client's own view is its own door's alone
    if spec is None or spec.get("own_only"):
        return _said(dict(_APP_PACK_REFUSED))
    if not ok and not await LG.released(s, _APP_PACK_GATES.get(app_id, app_id)):
        return _said(dict(_APP_PACK_REFUSED))
    # the team's Staff packs: to whom Staff shows the whole team, as its doors ask it (app/staff.py own_only)
    staff = await _app_pack_staff_cut(s) if not ok and pack == _APP_PACK_STAFF_TEAM else None
    if staff is not None and not staff["team"]:
        return _said(dict(_APP_PACK_REFUSED))
    said = urllib.parse.unquote(str(request.headers.get("x-app-pack-key") or ""))
    if not said.strip() and spec.get("query_key"):
        said = LG.query(request, "key")
    key = spec["fold"](said)
    if not re.fullmatch(spec["key_re"], key):
        return _said({"status": 400, "reason": "key", "message": "That key cannot be read."})
    cut = (lambda answer: answer) if ok else _app_pack_master_parts_out
    hidden = await _app_pack_hidden_parts(s, pack) if not ok else ()
    if hidden:
        cut = (lambda answer, c=cut, h=hidden: _app_pack_parts_out(c(answer), h))
    notes = ok or pack not in _APP_PACK_NOTES_PACKS or await _app_pack_notes_open(s, pack)
    if not notes:
        cut = (lambda answer, c=cut: _app_pack_notes_out(c(answer)))
    if staff is not None and not staff["activity"]:
        cut = (lambda answer, c=cut: _app_pack_parts_out(c(answer), _APP_PACK_STAFF_ACTIVITY_PARTS))
    # Clients › Transportation: withheld where App Control's Transportation row shuts the tab (app/clients.py)
    if not ok and pack == _APP_PACK_CLIENTS and not await _app_pack_transport_open(s):
        cut = (lambda answer, c=cut: _app_pack_parts_out(c(answer), _APP_PACK_CLIENT_TRANSPORT_PARTS))
    handed = (lambda answer: _app_pack_view_told(cut(answer), ok, notes)) if spec.get("view") else cut
    if LG.query(request, "peek").strip() == "1":
        return _said(handed(_app_pack_peek(pack, key)))
    written_ms = LG.query(request, "written_ms").strip()
    if re.fullmatch(r"\d{1,9}", written_ms):
        sent = LG.query(request, "sent_ms").strip()
        _app_pack_written(pack, key, int(written_ms), int(sent) if re.fullmatch(r"\d{1,9}", sent) else 0)
    waited = LG.query(request, "wait").strip()
    wait_s = float(waited) if re.fullmatch(r"\d{1,3}(\.\d{1,3})?", waited) else None
    return _said(handed(await _app_pack_get(pack, key, arrived, wait_s)))


# ---- A CLIENT'S OWN VIEW --------------------------------------------------------------------------------------------

_APP_PACK_OWN_APPS = tuple(_PLANE.get("own_apps") or ())
# the roles the own-view gate refuses outright; past it only a client-role session is served
_APP_PACK_OWN_ROLES_REFUSED = ("guardian", "onboarding", "interviewer")
# a session's own client key, held this long per session and app
APP_PACK_OWN_HOLD_S = 60.0
# the parts a client's own view of Clients carries: its name there -> the pack's part
_APP_PACK_OWN_CLIENT_PARTS: dict[str, str] = dict(_PLANE.get("own_client_parts") or {})
# the parts of one client's entry in a house's or an SSA's client_views, and the house parts no client cut touches
_APP_PACK_OWN_VIEW_PARTS: dict[str, tuple[str, ...]] = {a: tuple(p) for a, p in
                                                        (_PLANE.get("own_view_parts") or {}).items()}
_APP_PACK_OWN_HOUSE_PARTS = tuple(_PLANE.get("own_house_parts") or ())
_APP_PACK_OWN_PROFILE_RE = r"profile_[a-z0-9]{3,80}"
_APP_PACK_OWN_UNPUBLISHED = {"status": 503, "reason": "unpublished",
                             "message": "This read is not on the published engine yet; each section is read on its own."}
_APP_PACK_OWN_UNLISTED = {"status": 503, "reason": "unlisted",
                          "message": "This read is not held for you just now; each section is read on its own."}
# (token, app) -> (when, the session's own client key, '' for none)
_app_pack_own_held: dict[tuple[str, str], tuple[float, str]] = {}
# the clients slice's (mtime, size) and the one house code each client's rows there give it
_app_pack_own_houses_held: dict[str, Any] = {"sig": None, "map": {}}


def _app_pack_own_houses() -> dict[str, str]:
    """client key -> the one house code the clients slice gives it; {} when the slice cannot be read."""
    try:
        st = (OUT_DIR / "clients.json").stat()
    except Exception:  # noqa: BLE001 - no slice, no house to name
        return {}
    sig = (st.st_mtime_ns, st.st_size)
    if _app_pack_own_houses_held["sig"] == sig:
        return _app_pack_own_houses_held["map"]
    seen: dict[str, set[str]] = {}
    for row in _app_pack_slice_rows("clients.json"):
        client = str(row.get("client_key") or "").strip() or _app_pack_fold_name(row.get("name"))
        if client:
            seen.setdefault(client, set()).add(str(row.get("house") or "").strip().upper())
    out = {}
    for client, codes in seen.items():
        code = next(iter(codes)) if len(codes) == 1 else ""
        if re.fullmatch(_APP_PACK_HOUSE_RE, code):
            out[client] = code
    _app_pack_own_houses_held.update({"sig": sig, "map": out})
    return out


def _app_pack_listing(app: str, client: str) -> list[str]:
    """The keys of the held packs of `app` whose client views list this client, whatever their age or state."""
    out: list[str] = []
    for (held_app, key), entry in list(_app_pack_held.items()):
        if held_app != app:
            continue
        data = entry.get("data") if isinstance(entry, dict) else None
        parts = data.get("parts") if isinstance(data, dict) else None
        views = parts.get("client_views") if isinstance(parts, dict) else None
        if isinstance(views, dict) and client in views:
            out.append(key)
    return sorted(out)


def _app_pack_own_slot(app: str, client: str) -> str:
    """The pack a client's own view of `app` is read from: its own key for Clients and Staff; for Locations the house
    the clients slice gives it, for SSA its SSA — else the one held pack whose client views list it."""
    if app in (_APP_PACK_CLIENTS, _APP_PACK_STAFF):
        return client
    if app == "locations":
        hint = _app_pack_own_houses().get(client, "")
    else:
        hint = str(_app_pack_ssa_index()["of_client"].get(client) or "")
        hint = hint if re.fullmatch(_APP_PACK_SSA_RE, hint) else ""
    if hint:
        return hint
    listed = _app_pack_listing(app, client)
    return listed[0] if len(listed) == 1 else ""


def _app_pack_own_row(uid: str) -> dict[str, Any] | None:
    """Blocking, FAIL-CLOSED: the account's own users row, off asa-hub-db; None when it cannot be had."""
    if not str(uid or "").strip():
        return None
    try:
        row = LG.in_reads(lambda reads: next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid), None))
    except Exception:  # noqa: BLE001 - a read that throws answers nothing
        return None
    return dict(row) if isinstance(row, dict) else None


def _app_pack_own_hold(token: str, app: str, client: str) -> str:
    if len(_app_pack_own_held) > 5000:
        _app_pack_own_held.clear()
    _app_pack_own_held[(token, app)] = (time.time(), client)
    return client


async def _app_pack_own_client(token: str, s: FD.Session | None, app_id: str) -> str:
    """FAIL-CLOSED: the client key a session's own view is read by — a client-role session the app's gate opens,
    whose own account row links an active client; '' for any other."""
    if not token:
        return ""
    held = _app_pack_own_held.get((token, app_id))
    if held is not None and time.time() - held[0] < APP_PACK_OWN_HOLD_S:
        return held[1]
    try:
        who = LG.actor(s)
        uid = str((who or ("", ""))[1] or "").strip()
        if not who or str(who[0] or "").strip().lower() != "client" or not uid:
            return _app_pack_own_hold(token, app_id, "")
        verdict = await LG.gate(s, app_id, refuse_roles=_APP_PACK_OWN_ROLES_REFUSED)
        if isinstance(verdict, dict) or not verdict:
            # a copy that could not be read is not a verdict on the account: asked again next time
            unsure = isinstance(verdict, dict) and verdict.get("reason") in ("unreadable", "stale")
            return "" if unsure else _app_pack_own_hold(token, app_id, "")
        if str(verdict[1] or "").strip() != uid:
            return ""
        row = await run_in_threadpool(_app_pack_own_row, uid)
        if row is None:
            return ""
        return _app_pack_own_hold(token, app_id, _app_pack_own_key(row))
    except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
        log.warning("app pack: the own-view check failed (%s)", type(exc).__name__)
        return ""


def _app_pack_own_view(app: str, client: str, key: str, answer: dict[str, Any]) -> dict[str, Any]:
    """The client's own view out of a door answer for pack `key`: its envelope — the times, the state, the entity
    it is of — and the parts that are its own."""
    if not isinstance(answer, dict) or answer.get("status") != 200:
        return answer
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    parts = data.get("parts") if isinstance(data.get("parts"), dict) else {}
    said = data.get("part_status") if isinstance(data.get("part_status"), dict) else {}
    out = {k: data[k] for k in ("built_at", "age_s", "read_age_s", "state") if k in data}
    picks: list[tuple[str, Any, Any]] = []
    if app == _APP_PACK_STAFF:
        if str(data.get("client") or "") != client:
            return dict(_APP_PACK_OWN_UNLISTED)
        if str(data.get("week") or "") != _app_pack_this_week():
            return {"status": 503, "reason": "filling", "message": "This read is still being gathered. Try again."}
        out.update({"client": client, "week": str(data["week"])})
        names = sorted({n for n in list(parts) + list(said) if n == "roster" or re.fullmatch(_APP_PACK_OWN_PROFILE_RE, n)})
        picks = [(n, parts.get(n), said.get(n)) for n in names]
    elif app == _APP_PACK_CLIENTS:
        if str(data.get("client") or "") != client:
            return dict(_APP_PACK_OWN_UNLISTED)
        if "roster_own" not in parts and "roster_own" not in said:
            return dict(_APP_PACK_OWN_UNPUBLISHED)
        out["client"] = client
        picks = [(name, parts.get(src), said.get(src)) for name, src in _APP_PACK_OWN_CLIENT_PARTS.items()]
    else:
        if "client_views" not in parts and "client_views" not in said:
            return dict(_APP_PACK_OWN_UNPUBLISHED)
        views = parts.get("client_views")
        view = views.get(client) if isinstance(views, dict) else None
        if not isinstance(view, dict) or _app_pack_listing(app, client) != [key]:
            return dict(_APP_PACK_OWN_UNLISTED)
        out["house" if app == "locations" else "ssa"] = key
        picks = [(n, view.get(n), {"status": 200} if view.get(n) is not None else None)
                 for n in _APP_PACK_OWN_VIEW_PARTS[app]]
        if app == "locations":
            picks += [(n, parts.get(n), said.get(n)) for n in _APP_PACK_OWN_HOUSE_PARTS]
    kept: dict[str, Any] = {}
    status: dict[str, Any] = {}
    for name, value, state in picks:
        if value is not None:
            kept[name] = value
        if isinstance(state, dict):
            status[name] = state
    return {"status": 200, "data": {**out, "parts": kept, "part_status": status}}


async def lane_app_pack_own(app_id: str, request: Request) -> Response:
    """A client-role session's own view of Locations, Clients, SSA or Staff, from memory: the same pack, cut to the
    parts that are the client's own."""
    arrived = time.monotonic()
    if LG.query(request, "member").strip():
        return _said(dict(VISIT))
    token = LG.token_of(request)
    if not token:
        return _said({"status": 401, "reason": "session", "message": "sign in first"})
    spec = _APP_PACKS.get(app_id)
    if app_id not in _APP_PACK_OWN_APPS or spec is None:
        return _said(dict(_APP_PACK_REFUSED))
    # a session not judged yet is not refused for good: each section reads its action meanwhile
    s = await LG.session(token)
    if not LG.actor(s):
        return _said({"status": 401, "reason": "session", "message": "sign in first"})
    client = await _app_pack_own_client(token, s, app_id)
    if not client:
        return _said(dict(_APP_PACK_REFUSED))
    key = _app_pack_own_slot(app_id, client)
    if not key or spec["fold"](key) != key or not re.fullmatch(spec["key_re"], key):
        return _said(dict(_APP_PACK_REFUSED))
    held = _app_pack_held.get((app_id, key))
    if held is not None and not held.get("dirty") and _app_pack_past_week(app_id, held):
        held["dirty"] = True
    if LG.query(request, "peek").strip() == "1":
        answer = _app_pack_peek(app_id, key)
    else:
        waited = LG.query(request, "wait").strip()
        wait_s = float(waited) if re.fullmatch(r"\d{1,3}(\.\d{1,3})?", waited) else None
        answer = await _app_pack_get(app_id, key, arrived, wait_s)
    # a client's own view never carries a part Settings › My Work keeps to the master
    hidden = await _app_pack_hidden_parts(s, app_id)
    if hidden:
        answer = _app_pack_parts_out(answer, hidden)
    # nor Clients › Transportation where App Control's Transportation row does not name the session's badges
    if app_id == _APP_PACK_CLIENTS and not await _app_pack_transport_open(s):
        answer = _app_pack_parts_out(answer, _APP_PACK_CLIENT_TRANSPORT_PARTS)
    return _said(_app_pack_own_view(app_id, client, key, answer))


def wire(tables: dict[str, Any]) -> None:
    """The relay's tables as live_plane read them (live_plane.json app_packs), in place of the ones read at import."""
    global _PLANE, _APP_PACK_VERBS, _APP_PACK_WATCHED, _APP_PACK_PEOPLE_WRITES, _APP_PACK_PEOPLE_RESOURCES
    global _APP_PACK_OWN_APPS, _APP_PACK_OWN_HOUSE_PARTS
    plane = tables.get("app_packs") or {}
    if not plane:
        return
    _PLANE = plane
    _APP_PACK_VERBS = frozenset(plane.get("verbs") or ())
    _APP_PACK_DOOR_RESOURCES.clear()
    _APP_PACK_DOOR_RESOURCES.update(plane.get("door_resources") or {})
    _APP_PACK_DOORS.clear()
    _APP_PACK_DOORS.update(plane.get("doors") or {})
    _APP_PACK_GATES.clear()
    _APP_PACK_GATES.update(plane.get("gates") or {})
    _APP_PACKS.clear()
    _APP_PACKS.update({pack: _spec_of(pack, table) for pack, table in (plane.get("specs") or {}).items()
                       if pack in _APP_PACK_CODE})
    _APP_PACK_WATCHED = frozenset().union(*(s["writes"] | s["elsewhere"] | s["sweeps"]
                                            for s in _APP_PACKS.values())) | _APP_PACK_VERBS
    _APP_PACK_EVENTS.clear()
    _APP_PACK_EVENTS.update(plane.get("events") or {})
    _APP_PACK_PREFIXES.clear()
    _APP_PACK_PREFIXES.update({a: tuple(p) for a, p in (plane.get("prefixes") or {}).items()})
    _APP_PACK_PYTHON_BEHIND.clear()
    _APP_PACK_PYTHON_BEHIND.update({a: tuple(v) for a, v in (plane.get("python_behind") or {}).items()})
    _APP_PACK_PEOPLE_WRITES = frozenset(plane.get("people_writes") or ())
    _APP_PACK_PEOPLE_RESOURCES = frozenset(plane.get("people_resources") or ())
    _APP_PACK_HIDDEN_PARTS.clear()
    _APP_PACK_HIDDEN_PARTS.update({app: {switch: tuple(parts) for switch, parts in table.items()}
                                   for app, table in (plane.get("hidden_parts") or {}).items()})
    _APP_PACK_OWN_APPS = tuple(plane.get("own_apps") or ())
    _APP_PACK_OWN_CLIENT_PARTS.clear()
    _APP_PACK_OWN_CLIENT_PARTS.update(plane.get("own_client_parts") or {})
    _APP_PACK_OWN_VIEW_PARTS.clear()
    _APP_PACK_OWN_VIEW_PARTS.update({a: tuple(p) for a, p in (plane.get("own_view_parts") or {}).items()})
    _APP_PACK_OWN_HOUSE_PARTS = tuple(plane.get("own_house_parts") or ())


def install(app: Any) -> None:
    """The two pack doors on main.py's app, ahead of the relay carrier; the warm loop starts with the live plane."""
    app.get("/hub-lanes/app-pack/{app_id}/own", include_in_schema=False)(lane_app_pack_own)
    app.get("/hub-lanes/app-pack/{app_id}", include_in_schema=False)(lane_app_pack)
    log.info("app packs: %d pack(s) served here (%s), kept in %s", len(_APP_PACKS), ", ".join(sorted(_APP_PACKS)),
             APP_PACK_DIR or "memory alone")
