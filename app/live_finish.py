"""The finish of an answer Python gave at the front door (what server/front_door_finish.py did in the relay), here,
in-process: a read judged against the writes seen land since its copy was read (Python's 503 when one landed after),
a final write taken back (409) when it was decided on an older copy, else every copy and pack it changes read again
(_backend_final_landed); the answer's observers in gas_relay's order; Settings › Editions' cut; the hiring presses a
write handed back; the phase every answer says. The relay is never asked.

The packs are this app's (app_packs), and so are the marks every read is judged by. The relay keeps copies only for
the doors it still answers (the boards of the reads it carries, My Inbox): the names a landing rings, the apps it
sweeps and the wakes its own clocks take are told to it (live_notify.told), and published here once it heard them.
An answer the relay carried is observed here for this app's state alone, its rings left to the relay."""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
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

log = logging.getLogger("asa-hub-app.live-finish")

BACKEND_OWN_SLACK_S = 5.0
BACKEND_FINAL_KEEP_S = 3600.0
BACKEND_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
TAKEN_BACK = {"status": 409, "message": "This record changed a moment ago — reload it and try again. Nothing was "
                                        "written."}
RELAY_ENVELOPE_MAX = 100_000
CERT_PAPERS_MAX_BODY = 32 * 1024 * 1024
RESOLVER_MANIFEST_PATH = Path(os.getenv("HUB_RESOLVER_MANIFEST", "/srv/manifests/resolver-manifest.json"))
VIEWER_CACHE_DEFAULT = os.getenv("HUB_VIEWER_CACHE_DEFAULT", "1").strip().lower() not in ("0", "false", "no", "off")
GENERIC_VERBS = ("list", "get")
APP_RELEASE_APP = "app-release"
HIRING_APP = "hiring"
SERVICE = {"is_service": True}
AUTH_LOGOUT = "authLogout"
RELEASE_USER = "releaseUser"

# set by live_plane
M: Any = None
FD: Any = None
EVENTS: Any = None
SLICES: Any = None
GATE: Any = None
PACKS: Any = None
NOTIFY: Any = None
TABLES: dict[str, Any] = {}
TOKEN: list[str] = [os.getenv("HUB_APP_TOKEN", "")]

# the pack marks: (app, key) -> when a write naming it landed; (app, key) -> the moment no copy read before may stand;
# app -> when a write swept every key; (app, key) -> when Python's own final write laid it. The relay's own landings
# (the doors it still carries) are merged in through /live/marks.
MARKS: dict[str, dict[Any, float]] = {"touched": {}, "void": {}, "swept": {}, "final_at": {}}
_BG: set[asyncio.Task] = set()
_RESOLVER: dict[str, Any] = {"mtime": None, "actions": {}, "default": None}


def keep_task(coro: Any) -> asyncio.Task:
    task = asyncio.ensure_future(coro)
    _BG.add(task)
    task.add_done_callback(_BG.discard)
    return task


# ---- the marks -----------------------------------------------------------------------------------------------------

def merge_marks(said: Any) -> int:
    """The relay's marks (whole or since a moment) laid over the ones held; a later moment wins."""
    n = 0
    if not isinstance(said, dict):
        return 0
    for name in ("touched", "void", "final_at"):
        for item in said.get(name) or []:
            if isinstance(item, list) and len(item) == 3:
                slot, at = (str(item[0]), str(item[1])), float(item[2])
                if at > MARKS[name].get(slot, 0.0):
                    MARKS[name][slot] = at
                    n += 1
    for item in said.get("swept") or []:
        if isinstance(item, list) and len(item) == 2:
            app, at = str(item[0]), float(item[1])
            if at > MARKS["swept"].get(app, 0.0):
                MARKS["swept"][app] = at
                n += 1
    return n


def _final_covers(slot: tuple[str, str], mark: float, edits_at: float) -> bool:
    at = MARKS["final_at"].get(slot)
    return at is not None and edits_at >= at and mark <= at + BACKEND_OWN_SLACK_S


def copy_at(app_id: str, key: str, as_of: float, held: frozenset[str] | None = None, *, any_key: bool = False,
            pack: str = "", edits_at: float = 0.0) -> float | None:
    """How current Python's read is for the writes seen at this key (any_key: at any); None when one landed after."""
    pack = pack or str(((TABLES.get("apps") or {}).get(app_id) or {}).get("pack") or app_id)
    void, touched, swept = MARKS["void"], MARKS["touched"], MARKS["swept"]
    marks = [void.get((pack, ""), 0.0)]
    covered = False
    at = swept.get(pack, 0.0)
    if at > as_of and _final_covers((pack, ""), at, edits_at):
        covered = True
    else:
        marks.append(at)
    if key:
        slots = [(pack, key)]
    elif any_key:
        slots = sorted({s for s in list(touched) + list(void) if s[0] == pack and s[1]})
    else:
        slots = []
    for slot in slots:
        mark = max(touched.get(slot, 0.0), void.get(slot, 0.0))
        if mark > as_of and _final_covers(slot, mark, edits_at):
            covered = True
        else:
            marks.append(mark)
    if max(marks) > as_of:
        return None
    return max(as_of, edits_at) if covered else as_of


def written_after(app_id: str, key: str, as_of: float, held: frozenset[str] | None = None, *, any_key: bool = False,
                  pack: str = "", edits_at: float = 0.0) -> bool:
    return copy_at(app_id, key, as_of, held, any_key=any_key, pack=pack, edits_at=edits_at) is None


# ---- the envelope, as the relay's readers take it -------------------------------------------------------------------

def _no_constant(name: str) -> Any:
    raise ValueError(name)


def _envelope(raw: bytes, most: int) -> dict[str, Any] | None:
    if len(raw) > most:
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    for candidate in (text, (urllib.parse.parse_qs(text).get("body") or [""])[0]):
        try:
            env = json.loads(candidate, parse_constant=_no_constant)
        except (ValueError, RecursionError):
            continue
        return env if isinstance(env, dict) else {}
    return None


def relay_envelope(raw: bytes) -> dict[str, Any] | None:
    return _envelope(raw, RELAY_ENVELOPE_MAX)


def upload_envelope(raw: bytes) -> dict[str, Any] | None:
    return _envelope(raw, CERT_PAPERS_MAX_BODY)


def backend_key(app_id: str, payload: dict[str, Any]) -> str:
    """The pack key a call names, folded as its pack folds it (a house code, a client key); '' for none."""
    spec = (TABLES.get("apps") or {}).get(app_id) or {}
    pack = (TABLES.get("packs") or {}).get(spec.get("pack", app_id))
    if pack is None:
        return ""
    raw = str(payload.get(spec.get("key", "house")) or "").strip()
    fold = pack.get("fold")
    key = raw.upper() if fold == "upper" else raw.lower() if fold == "lower" else raw
    return key if re.fullmatch(pack["key_re"], key) else ""


# ---- the resolver manifest's declarations ---------------------------------------------------------------------------

def resolver_table() -> dict[str, Any]:
    """The declared actions, read again when the file on disk changes; the last table stands when it cannot be."""
    try:
        mtime = RESOLVER_MANIFEST_PATH.stat().st_mtime
    except OSError:
        mtime = None
    if mtime is not None and mtime != _RESOLVER["mtime"]:
        try:
            _RESOLVER["actions"] = json.loads(RESOLVER_MANIFEST_PATH.read_text()).get("actions") or {}
            _RESOLVER["mtime"] = mtime
            _RESOLVER["default"] = None
        except Exception as exc:  # noqa: BLE001 - the last table stands
            log.warning("resolver manifest unreadable (%s)", exc)
    return _RESOLVER["actions"]


def resolver_lane(action: str) -> str:
    """'read' | 'write' | 'tool' | 'auth', or '' when undeclared; a job measured in minutes is a tool."""
    entry = resolver_table().get(action) if action else None
    if not entry:
        return ""
    lane = str(entry.get("lane") or "")
    if lane == "write" and str(entry.get("cost")) == "minutes":
        return "tool"
    return lane if lane in ("read", "write", "tool", "auth") else ""


def resolver_invalidates(action: str) -> tuple[str, ...]:
    entry = resolver_table().get(action or "")
    return tuple(entry.get("invalidates") or ()) if entry else ()


def resolver_touches(action: str) -> tuple[str, ...] | None:
    """The only reads a write changes when it declares them (`touches`); () for a door that only answers bytes."""
    entry = resolver_table().get(action or "")
    if entry and isinstance(entry.get("touches"), list):
        return tuple(str(r) for r in entry["touches"])
    if action in set((TABLES.get("viewer_cache") or {}).get("byte_reads") or ()):
        return ()
    return None


# ---- the reads a viewer's copy is kept of (VIEWER CACHE) ------------------------------------------------------------

def _default_tables() -> dict[str, Any]:
    """The default lane off the resolver manifest: read -> its ring, ring -> its reads, write -> its file's ring and
    resource -> the rings of its writers' files."""
    table = resolver_table()
    if _RESOLVER["default"] is not None:
        return _RESOLVER["default"]
    vc = TABLES.get("viewer_cache") or {}
    byte_reads = set(vc.get("byte_reads") or ())
    opt_out = set(vc.get("opt_out") or ())
    opt_out_re = re.compile(str(vc.get("opt_out_re") or r"$^"))
    ring_prefix = str(vc.get("file_ring") or "gs:")
    sessions = {str((table.get(a) or {}).get("file") or "") for a in vc.get("no_receipt") or ()
                if a not in byte_reads and (table.get(a) or {}).get("lane") not in (None, "read")}
    reads: dict[str, str] = {}
    files: dict[str, str] = {}
    by_resource: dict[str, set[str]] = {}
    for name, entry in table.items():
        file = str((entry or {}).get("file") or "") if isinstance(entry, dict) else ""
        if not file.endswith(".gs"):
            continue
        ring = ring_prefix + file[:-3]
        files[name] = ring
        if entry.get("lane") in ("write", "tool"):
            for resource in entry.get("invalidates") or ():
                by_resource.setdefault(str(resource), set()).add(ring)
        if (entry.get("lane") != "read" or entry.get("router") or entry.get("service") or entry.get("cache") is False
                or not entry.get("idempotent") or entry.get("cost") == "minutes" or file in sessions
                or name in opt_out or opt_out_re.search(name)):
            continue
        reads[name] = ring
    rings: dict[str, tuple[str, ...]] = {}
    for name, ring in sorted(reads.items()):
        rings[ring] = rings.get(ring, ()) + (name,)
    _RESOLVER["default"] = {"reads": reads, "rings": rings, "files": files, "by_resource": by_resource}
    return _RESOLVER["default"]


def _default_table() -> dict[str, str]:
    """read -> its ring for every read the resolver manifest declares a viewer may be answered a copy of."""
    return _default_tables()["reads"]


def ring_of(read: str) -> str | None:
    """The name a kept read's screens re-read on; None for a read never kept."""
    ring = ((TABLES.get("viewer_cache") or {}).get("reads") or {}).get(read)
    if ring is not None or not VIEWER_CACHE_DEFAULT:
        return ring
    return _default_table().get(read)


def reads_of(name: str) -> tuple[str, ...]:
    """The kept reads a ring of `name` makes stale."""
    ring_prefix = str((TABLES.get("viewer_cache") or {}).get("file_ring") or "gs:")
    explicit = tuple(((TABLES.get("finish") or {}).get("rings") or {}).get(name) or ())
    if not VIEWER_CACHE_DEFAULT or not name.startswith(ring_prefix):
        return explicit
    return explicit + tuple(_default_tables()["rings"].get(name, ()))


def write_rings(action: str, raw: bytes = b"") -> set[str]:
    """The default lane's names a write rings: its own file's, and the files of every writer of a resource it (or
    the generic verb it is) changes — those whose reads are kept."""
    if not VIEWER_CACHE_DEFAULT or not action or resolver_touches(action) is not None:
        return set()
    held = _default_tables()
    rings: set[str] = set()
    resources: set[str] = set()
    if PACKS is not None and action in PACKS._APP_PACK_VERBS:
        resource = str((relay_envelope(raw) or {}).get("resource") or "")
        if resource:
            resources.add(resource)
    elif resolver_lane(action) in ("write", "tool"):
        if action in held["files"]:
            rings.add(held["files"][action])
        resources.update(resolver_invalidates(action))
    for resource in resources:
        rings |= held["by_resource"].get(resource, set())
    return {ring for ring in rings if ring in held["rings"]}


def touched(action: str, raw: bytes = b"") -> set[str]:
    """The kept boards a write changes, by the names its landing rings; only those it names when it names them."""
    fin = TABLES.get("finish") or {}
    touches = resolver_touches(action)
    if touches is not None:
        return {read for read in touches if ring_of(read) is not None}
    names = write_rings(action, raw)
    if PACKS is not None:
        names |= PACKS.ring_names(action, raw)
    sched = fin.get("scheduling") or {}
    if (action.startswith("scheduling") and action not in set(sched.get("reads") or ())
            and resolver_lane(action) != "read"):
        names.add(str(sched.get("event")))
    desk = fin.get("support_desk") or {}
    if action in set(desk.get("writes") or ()):
        names.add(str(desk.get("event")))
    if action in set(desk.get("sched_writes") or ()):
        names.add(str(sched.get("event")))
    for part in ("vehicle_calendar", "staff_profiles"):
        if action in set((fin.get(part) or {}).get("writes") or ()):
            names.add(str(fin[part]["event"]))
    names.update(name for name, actions in (fin.get("lane_writes") or {}).items() if action in actions)
    return {read for name in names for read in reads_of(name)}


def viewer_written(action: str, raw: bytes, content: bytes | None = None) -> None:
    """_viewer_cache_written: a write landed 200 — each My app whose rows it changed rung, and each file the default
    lane keeps reads of; App Control's own changes every copy the relay keeps. Nothing is kept here."""
    try:
        if action == "authLogout":
            return
        fin = TABLES.get("finish") or {}
        access = action in set(fin.get("access_actions") or ())
        reads = set() if access else touched(action, raw)
        if not access and not reads:
            return
        if content is not None and (_json(content) or {}).get("status") != 200:
            return
        if access:
            wake(ACCESS_WRITTEN)
            return
        if content is not None:
            for name, actions in (fin.get("lane_writes") or {}).items():
                if action in actions:
                    publish(name)
            for name in sorted(write_rings(action, raw)):
                publish(name)
    except Exception:  # noqa: BLE001 - a kept copy never fails a write
        pass


def kept_read(action: str, raw: bytes) -> bool:
    """_viewer_cache_key's question: is this read one a viewer's copy is kept of."""
    if ring_of(action) is None or action in set((TABLES.get("viewer_cache") or {}).get("lanes") or ()):
        return False
    env = relay_envelope(raw) or {}
    token = env.get("token")
    if not isinstance(token, str) or not token or "service_secret" in env or env.get("action") != action:
        return False
    if isinstance(env.get("payload"), dict) and env["payload"].get("edit"):
        return False
    try:
        json.dumps({k: v for k, v in env.items() if k not in ("token", "write_id")}, sort_keys=True)
    except (TypeError, ValueError):
        return False
    return True


# ---- Settings › Editions' cut ---------------------------------------------------------------------------------------

def editions_cut(action: str, content: bytes) -> bytes:
    """editionsMine less an edition whose only door is Python's while its app is not (every app is Python's)."""
    if action != "editionsMine":
        return content
    try:
        env = json.loads(content)
    except Exception:  # noqa: BLE001
        return content
    data = env.get("data") if isinstance(env, dict) else None
    listed = data.get("editions") if isinstance(data, dict) else None
    only = TABLES.get("edition_only") or {}
    if not isinstance(listed, list) or not any(str(e) in only for e in listed):
        return content
    return json.dumps({**env, "data": {**data, "editions": list(listed)}}).encode()


# ---- what an answer's observers raise ------------------------------------------------------------------------------

# the relay's own clocks an answer wakes: its hotline desk's access copy and its kept boards (App Control changed),
# its sheet keeper (who reads what changed)
ACCESS_WRITTEN = "access-written"
SHEET_SYNC = "sheet-sync"


class Raised:
    """What one answer's observers raise: the names rung, the apps swept, the relay's clocks woken and the slices
    marked dirty, said together once they ran; `quiet`: an answer the relay carried, which raised them itself."""

    def __init__(self, quiet: bool = False) -> None:
        self.quiet = quiet
        self.closed = False
        self.rang: list[str] = []
        self.swept: list[str] = []
        self.wake: list[str] = []
        self.dirty: list[str] = []

    def add(self, kind: str, name: str) -> bool:
        if self.closed:
            return False
        held = getattr(self, kind)
        if not self.quiet and name not in held:
            held.append(name)
        return True

    def __enter__(self) -> "Raised":
        self._token = _RAISED.set(self)
        return self

    def __exit__(self, *_exc: Any) -> bool:
        _RAISED.reset(self._token)
        self.closed = True
        if not self.quiet:
            _say(self.rang, self.swept, self.wake, self.dirty)
        return False


_RAISED: "contextvars.ContextVar[Raised | None]" = contextvars.ContextVar("live_finish_raised", default=None)


def _say(rang: list[str], swept: list[str], wake: list[str], dirty: list[str]) -> None:
    """The slices marked dirty here; the rest told to the relay's memory, each name published here once it heard."""
    try:
        if dirty and SLICES is not None:
            SLICES.mark_dirty(dirty)
    except Exception as exc:  # noqa: BLE001 - the next write or the rebuild clock says it again
        log.warning("finish: slices not marked dirty (%s)", type(exc).__name__)
    if not (rang or swept or wake):
        return
    try:
        notify = NOTIFY
        if notify is None:
            import live_notify as notify  # noqa: PLC0415
        notify.told(rang=rang, swept=swept, wake=wake)
    except Exception as exc:  # noqa: BLE001 - never in the answer's way
        log.warning("finish: what the answer raised was not said (%s)", type(exc).__name__)


def _raise(kind: str, name: str) -> None:
    got = _RAISED.get()
    if got is not None and got.add(kind, name):
        return
    _say(*[[name] if k == kind else [] for k in ("rang", "swept", "wake", "dirty")])


def publish(name: str, *, kept_copy: bool = False) -> None:
    """_publish_slice: a name rung; a kept copy's own refresh is published here alone."""
    if kept_copy:
        if EVENTS is not None:
            EVENTS.publish(name, kept_copy=True)
        return
    _raise("rang", name)


def sweep(app: str) -> None:
    """Every key of this app written: the mark here at once, told to the relay with the rest."""
    MARKS["swept"][app] = time.time()
    _raise("swept", app)


def wake(name: str) -> None:
    _raise("wake", name)


def mark_dirty(resource: str) -> None:
    _raise("dirty", resource)


def _json(content: bytes | None) -> Any:
    try:
        return json.loads(content) if content is not None else None
    except Exception:  # noqa: BLE001
        return None


def _ok(content: bytes) -> bool:
    env = _json(content)
    return isinstance(env, dict) and env.get("status") == 200


def _fin(part: str) -> dict[str, Any]:
    return (TABLES.get("finish") or {}).get(part) or {}


def _resource(raw: bytes) -> str:
    """_relay_resource: the envelope's resource, for the generic verbs; '' past the envelope reader's size."""
    if len(raw) > 100_000:
        return ""
    return str((relay_envelope(raw) or {}).get("resource") or "")


def _generic_write(action: str) -> bool:
    return action in set((TABLES.get("finish") or {}).get("generic_verbs") or ()) and action not in ("list", "get")


def _door_resource(action: str) -> str:
    return str(((TABLES.get("finish") or {}).get("sheet_resource_doors") or {}).get(action) or "")


# ---- the observers: what a landed write rings, sweeps and rebuilds -------------------------------------------------

def scheduling_rang(action: str, raw: bytes, content: bytes) -> None:
    """_relay_observe_scheduling: a Scheduling write landed — its bare name rung, every house swept."""
    try:
        sched = _fin("scheduling")
        if not action.startswith("scheduling") or action in set(sched.get("reads") or ()) or \
                resolver_lane(action) == "read":
            return
        if _ok(content):
            try:
                publish(str(sched["event"]))
            finally:
                sweep(str(sched["event"]))
    except Exception:  # noqa: BLE001 - telling nobody must never fail a write
        pass


def vehicle_calendar_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("vehicle_calendar")
        if action not in set(part.get("writes") or ()):
            return
        if _ok(content):
            try:
                publish(str(part["event"]))
            finally:
                sweep(str(part["event"]))
    except Exception:  # noqa: BLE001
        pass


def staff_profiles_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("staff_profiles")
        if action in set(part.get("writes") or ()) and _ok(content):
            publish(str(part["event"]))
    except Exception:  # noqa: BLE001
        pass


def smart_comms_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("smart_comms")
        if action not in set(part.get("writes") or ()):
            return
        if _ok(content):
            try:
                publish(str(part["event"]))
            finally:
                sweep(str(part["event"]))
    except Exception:  # noqa: BLE001
        pass


def forms_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("forms")
        if action in set(part.get("writes") or ()) and _ok(content):
            sweep(str(part["app"]))
    except Exception:  # noqa: BLE001
        pass


def support_desk_observed(action: str, raw: bytes, content: bytes) -> None:
    """_relay_observe_support_desk: a Support Requests or Scheduling write landed — the desk rung, and Scheduling's
    own screens where the write moves its flows."""
    try:
        desk = _fin("support_desk")
        ours = action in set(desk.get("writes") or ())
        sched = action.startswith("scheduling") and resolver_lane(action) not in ("read", "")
        if not ours and not sched:
            return
        if not _ok(content):
            return
        publish(str(desk["event"]))
        if action in set(desk.get("sched_writes") or ()):
            event = str(_fin("scheduling")["event"])
            try:
                publish(event)
            finally:
                sweep(event)
    except Exception:  # noqa: BLE001
        pass


def support_desk_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        desk = _fin("support_desk")
        if action in set(desk.get("writes") or ()) and _ok(content):
            sweep(str(desk["event"]))
    except Exception:  # noqa: BLE001
        pass


def docs_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("docs")
        resource = str(part["resource"])
        touches = (action in ("docsCreate", "docsUpdate", "docsDelete") or resource in resolver_invalidates(action)
                   or (_generic_write(action) and _resource(raw) == resource))
        if touches and _ok(content):
            sweep(str(part["app"]))
    except Exception:  # noqa: BLE001
        pass


def learning_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("learning")
        resources = set(part.get("resources") or ())
        touches = (action in set(part.get("writes") or ()) or bool(resources & set(resolver_invalidates(action)))
                   or (_generic_write(action) and _resource(raw) in resources)
                   or _door_resource(action) in resources)
        if touches and _ok(content):
            sweep(str(part["app"]))
    except Exception:  # noqa: BLE001
        pass


def recon_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        part = _fin("recon")
        touches = (action in set(part.get("writes") or ())
                   or (_generic_write(action) and _resource(raw) == "financeConfig")
                   or _door_resource(action) in ("financeConfig", "time_punches", "recon_runs", "recon_errors"))
        if touches and _ok(content):
            sweep(str(part["app"]))
    except Exception:  # noqa: BLE001
        pass


# a slice built again now, by Python, with the row a write kept in it: its resource -> the writes that keep one
SLICE_WRITES = {"call_offs": ("callOffsCreate", "callOffsUpdate", "callOffsDelete"),
                "questionnaires": ("questionnaireSubmit",), "support_requests": ("requestSubmit", "requestResolve"),
                "staff_issues": ("staffIssueAdd", "staffProfileHrIssueAdd")}


def slices_rang(action: str, raw: bytes, content: bytes) -> None:
    """_call_offs_rang, _questionnaires_rang, _support_requests_rang, _staff_issues_rang, _sheet_resources_rang and
    _generic_rows_rang: the slice a kept write lands in, marked dirty."""
    try:
        fin = TABLES.get("finish") or {}
        resources = fin.get("slice_resources") or {}
        for part, actions in SLICE_WRITES.items():
            if action in actions and _ok(content):
                mark_dirty(str(resources[part]))
        resource = _door_resource(action)
        if resource and resource in (TABLES.get("slice_doors") or {}) and _ok(content):
            mark_dirty(resource)
        if resource and resource in set(fin.get("generic_rings") or ()) and _ok(content):
            mark_dirty(resource)
    except Exception:  # noqa: BLE001 - the next pass carries it all the same
        pass


def _access_write(action: str, payload: Any) -> bool:
    """_relay_app_access_write: this call changes which apps a badge or a tenant reaches."""
    if action in ("appBadgeAccessSet", "appTenantAccessSet"):
        return True
    if action != "appAccessSetBulk" or not isinstance(payload, dict):
        return False
    return any(isinstance(payload.get(k), (dict, list)) and len(payload.get(k)) > 0 for k in ("rules", "tenants"))


def app_control_landed(action: str, raw: bytes, content: bytes) -> None:
    """An App Control save Python kept: who reads what marked, the relay's access copy retired, and what it opened
    handed to Python's release announcement."""
    try:
        if PACKS is not None:
            PACKS.rang_write(action, raw, content, python=True)
        if (_json(content) or {}).get("status") != 200:
            return
        payload = (relay_envelope(raw) or {}).get("payload")
        if not _access_write(action, payload):
            return
        wake(ACCESS_WRITTEN)
        keep_task(release_noticed(action, payload))
    except Exception:  # noqa: BLE001 - an observer never breaks the answer
        return


def final_landed(action: str, raw: bytes, content: bytes) -> None:
    """_backend_final_landed: Python kept a write in Postgres — every kept copy and pack it changes read again, and
    the moment it laid each mark it set kept, so a read whose edits were read after it is not held to it."""
    began = time.time()
    try:
        viewer_written(action, raw, content)
        if PACKS is not None:
            for app in sorted(PACKS.apps_of(action, raw)):
                PACKS.ring(app)
            name, body = PACKS.write_of(action, raw)
            if name:
                PACKS.note_write(name, body, json.loads(content))
        for observer in LANDED:
            observer(action, raw, content)
    except Exception as exc:  # noqa: BLE001 - each copy's own age still refreshes it
        log.warning("backend: %s kept by Python, its copies not all read again (%s)", action, type(exc).__name__)
    now = time.time()
    final_at = MARKS["final_at"]
    for slot, at in list(MARKS["touched"].items()) + list(MARKS["void"].items()):
        if at >= began and slot[1]:
            final_at[slot] = now
    for app, at in list(MARKS["swept"].items()):
        if at >= began:
            final_at[(app, "")] = now
    if len(final_at) > 4096:
        for slot, at in list(final_at.items()):
            if now - at > BACKEND_FINAL_KEEP_S:
                final_at.pop(slot, None)


# _backend_final_landed's order, after the copies and the packs
LANDED = (staff_profiles_rang, scheduling_rang, support_desk_observed, support_desk_rang, vehicle_calendar_rang,
          smart_comms_rang, forms_rang, docs_rang, slices_rang, learning_rang, recon_rang)


async def release_noticed(action: str, payload: Any) -> None:
    """An App Control save that landed, handed to Python: the badges each rule now holds and the app's own words."""
    try:
        p = payload if isinstance(payload, dict) else {}
        if action == "appBadgeAccessSet":
            app_id = str(p.get("app_id") or "").strip()
            rules = {app_id: p.get("badges")} if app_id else {}
            meta = {app_id: p.get("app_meta")} if app_id and isinstance(p.get("app_meta"), dict) else {}
        elif action == "appAccessSetBulk":
            rules = p.get("rules") if isinstance(p.get("rules"), dict) else {}
            meta = p.get("app_meta") if isinstance(p.get("app_meta"), dict) else {}
        else:
            return
        if not rules:
            return
        meta = {a: {"name": str((m or {}).get("name") or ""), "tagline": str((m or {}).get("tagline") or "")}
                for a, m in meta.items() if isinstance(m, dict)}
        write_id = "W" + hashlib.sha256(f"app-release|{time.time_ns()}".encode()).hexdigest()[:24]
        got = await FD.call_app(APP_RELEASE_APP, "appReleaseNoticed", dict(SERVICE), {"rules": rules, "meta": meta},
                                write_id)
        env = got[2] if got is not None else None
        if not env or env.get("status") != 200:
            log.warning("app release: the save was not told to Python (%s)",
                        str((env or {}).get("message") or "Python did not answer")[:160])
            return
        log.info("app release: %s", json.dumps(env.get("data") or {}, separators=(",", ":"))[:300])
    except Exception as exc:  # noqa: BLE001 - the clock's pass carries what is owed
        log.warning("app release: %s", type(exc).__name__)


# ---- the answer loop's own observers --------------------------------------------------------------------------------

def auth_seen(action: str, raw: bytes, content: bytes) -> None:
    """A sign-out answered: the front door's held verdict on that session goes, so the gate and the streams ask the
    sign-in again (the relay's gate learning)."""
    if action != AUTH_LOGOUT:
        return
    try:
        token = str((relay_envelope(raw) or {}).get("token") or "")
        if token:
            FD._SESSIONS.pop(token, None)
            EVENTS.sessions_forgotten()
    except Exception:  # noqa: BLE001 - an observer never breaks the answer
        pass


def released(action: str, raw: bytes, content: bytes) -> None:
    """releaseUser landed: the account's Python sessions, and those minted from them, end too."""
    if action != RELEASE_USER:
        return
    try:
        if (json.loads(content) or {}).get("status") != 200:
            return
        payload = (relay_envelope(raw) or {}).get("payload") or {}
        uid = str(payload.get("user_id") or "").strip() if isinstance(payload, dict) else ""
    except Exception:  # noqa: BLE001
        return
    if uid:
        keep_task(run_in_threadpool(M._run_auth, "_end_account", {"user_id": uid}))


def access_written(action: str, raw: bytes, content: bytes) -> None:
    """An App Control grant landed: the hotline stream's gate stops taking an older copy's word."""
    if action not in ("appBadgeAccessSet", "appTenantAccessSet", "appAccessSetBulk"):
        return
    try:
        payload = (relay_envelope(raw) or {}).get("payload")
        if action == "appAccessSetBulk" and not (isinstance(payload, dict) and any(
                isinstance(payload.get(k), (dict, list)) and len(payload.get(k)) > 0 for k in ("rules", "tenants"))):
            return
        if (json.loads(content) or {}).get("status") == 200:
            GATE.note_access_written()
    except Exception:  # noqa: BLE001
        pass


def access_observed(action: str, raw: bytes, content: bytes) -> None:
    """_relay_observe_access_write: App Control changed a grant — the access copies stop vouching, who reads what is
    marked, and what the save opened is announced by Python."""
    try:
        if action not in set((TABLES.get("finish") or {}).get("access_actions") or ()):
            return
        payload = (relay_envelope(raw) or {}).get("payload")
        if not _access_write(action, payload) or (_json(content) or {}).get("status") != 200:
            return
        GATE.note_access_written()
        wake(ACCESS_WRITTEN)
        if PACKS is not None:
            PACKS.people_changed()
        keep_task(release_noticed(action, payload))
    except Exception:  # noqa: BLE001 - an observer never breaks the answer
        return


def packs_observed(action: str, raw: bytes, content: bytes) -> None:
    """_relay_observe_app_pack: a write that changes a pack answered 200."""
    if PACKS is not None:
        PACKS.observe(action, raw, content, python=True)


def action_label(action: str, raw: bytes) -> str:
    if action in GENERIC_VERBS:
        resource = str((relay_envelope(raw) or {}).get("resource") or "")
        if resource:
            return action + ":" + resource
    return action


# ---- the tails -----------------------------------------------------------------------------------------------------

def read_tail(meta: dict[str, Any], raw: bytes, content: bytes) -> bytes:
    """Python's 503 when a write seen landed after the copy was read, else the answer."""
    app_id, door = str(meta["app_id"]), str(meta["door"])
    env = relay_envelope(raw) or {}
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    payload = FD.builder_payload(door, env, payload)
    key = backend_key(app_id, payload)
    keyless = not key and bool(((TABLES.get("apps") or {}).get(app_id) or {}).get("any_key"))
    as_of, edits_at = float(meta["as_of"]), float(meta.get("edits_at") or 0.0)
    held = None if meta.get("held") is None else frozenset(str(w) for w in meta["held"])
    if written_after(app_id, key, as_of, held, any_key=keyless, edits_at=edits_at):
        log.info("backend: %s said 503 — a write landed after Python's copy was read (never handed to Apps Script)",
                 door)
        return json.dumps(BACKEND_UNREAD).encode()
    SLICES.traffic_note("backend_python")
    return content


def settle_void(app_id: str, write_id: str) -> bool:
    """Blocking: a write Python decided, taken back (the relay's _backend_settle 'void'); False when not settled."""
    import smart_comms
    import sys_log

    store = M.stores().get(app_id)
    if app_id not in M.WRITES or store is None or not store.available:
        log.warning("backend: write %s not settled void in Python (no write store)", write_id)
        return False
    why = ""
    for attempt in range(3):
        try:
            done = store.settle(write_id, "void", "", None)
            if done:
                sys_log.void(store, write_id)
                smart_comms.void_write(store.conn(), write_id)
            log.info("write %s settled void%s", write_id, "" if done else " (nothing to settle)")
            return True
        except Exception as exc:  # noqa: BLE001 - said below
            why = type(exc).__name__
        time.sleep(2.0 * (attempt + 1))
    log.warning("backend: write %s not settled void in Python (%s)", write_id, why)
    return False


async def write_tail(meta: dict[str, Any], raw: bytes, content: bytes) -> bytes:
    """_backend_final: taken back and said 409, or answered with every copy and pack it changes read again."""
    app_id, door = str(meta["app_id"]), str(meta["door"])
    env = upload_envelope(raw) or {}
    payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
    payload = FD.builder_payload(door, env, payload)
    plan = meta.get("plan") if isinstance(meta.get("plan"), dict) else {}
    spec = (TABLES.get("apps") or {})[app_id]
    if app_id == "locations":
        house = str(plan.get("house") or payload.get("house") or "").strip().upper()
        key = house if re.fullmatch(str(TABLES.get("house_re")), house) else ""
    else:
        named = spec.get("key", "house")
        given = next((payload.get(k) for k in spec.get("keys", ()) if payload.get(k)), payload.get(named))
        key = backend_key(app_id, {named: plan.get("house") or given})
    held = None if meta.get("held") is None else frozenset(str(w) for w in meta["held"])
    answer = json.loads(content)
    write_id = str(meta["write_id"])
    as_of, edits_at = float(meta["as_of"]), float(meta.get("edits_at") or 0.0)
    if written_after(app_id, key, as_of, held, any_key=not key, edits_at=edits_at):
        if await run_in_threadpool(settle_void, app_id, write_id):
            log.info("backend: %s taken back — a write landed after Python's copy was read", door)
            return json.dumps(TAKEN_BACK).encode()
        log.warning("backend: %s stands in Postgres although a write landed after its copy (not taken back)", door)
    out = json.dumps(answer)
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    if answer.get("status") == 200 or data.get("written"):
        landed = json.dumps({**answer, "status": 200}).encode()
        app_control = door in set(TABLES.get("app_control_writes") or ())
        with Raised():
            final_landed(door, raw, landed)
            if app_control:
                app_control_landed(door, raw, out.encode())
        if app_control:
            access_written(door, raw, out.encode())
    SLICES.traffic_note("backend_python")
    log.info("backend: %s kept by Python in Postgres (%s)", door, answer.get("status"))
    return out.encode()


async def hiring_handed(handed: list[dict[str, Any]]) -> None:
    """The presses a hiring write handed back, each pressed through its own lane as the service's identity — its
    prepare read first when it has one — and what came of them recorded by hiringSimPressRecord. Never raises."""
    results = []
    for entry in handed or []:
        action = str(entry.get("action") or "")
        payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
        app_id = FD.READS.get(action) or HIRING_APP
        try:
            prepare = (TABLES.get("write_prepare") or {}).get(action)
            if prepare is not None and (not prepare[1] or payload.get(prepare[1])):
                got = await FD.call_app(app_id, prepare[0], dict(SERVICE), payload)
                env_p = got[2] if got is not None else None
                if env_p is None or env_p.get("status") != 200:
                    results.append({**entry, "status": (env_p or {}).get("status") or 503,
                                    "message": str((env_p or {}).get("message") or "its preparation was not done")})
                    continue
                payload = {**{k: v for k, v in payload.items() if k != prepare[1]}, "prepared": env_p.get("data")}
            write_id = "W" + hashlib.sha256(f"{action}|{time.time_ns()}".encode()).hexdigest()[:24]
            got = await FD.call_app(app_id, action, dict(SERVICE), payload, write_id)
            env = dict(got[2] or {}) if got is not None else {"status": 503, "message": "Python did not answer"}
            env.pop("_write", None)
            results.append({**entry, "status": env.get("status"), "data": env.get("data"),
                            "message": env.get("message")})
        except Exception as exc:  # noqa: BLE001 - said as this press's own failure
            results.append({**entry, "status": 503, "message": type(exc).__name__})
    if not results:
        return
    try:
        write_id = "W" + hashlib.sha256(f"hiringSimPressRecord|{time.time_ns()}".encode()).hexdigest()[:24]
        await FD.call_app(HIRING_APP, "hiringSimPressRecord", dict(SERVICE), {"results": results}, write_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("hiring presses: not recorded (%s)", type(exc).__name__)


def _viewer_observed(action: str, raw: bytes, content: bytes) -> None:
    viewer_written(action, raw, content)


# gas_relay's answer observers that act on an answer the front door gives, in its order. The chat's are the chat
# rungs' own (chat_doors); the sign-in tables and the chat state they fed were the relay's, never read here.
LOOP = (auth_seen, released, access_observed, packs_observed, scheduling_rang, support_desk_observed,
        vehicle_calendar_rang, staff_profiles_rang, smart_comms_rang, forms_rang, support_desk_rang, docs_rang,
        learning_rang, recon_rang, _viewer_observed)
# what they keep of this app's own state on an answer the relay carried, which rang and rebuilt for it itself
CARRIED = (packs_observed, scheduling_rang, support_desk_observed, vehicle_calendar_rang, smart_comms_rang,
           forms_rang, support_desk_rang, docs_rang, learning_rang, recon_rang)


def observe(action: str, raw: bytes, content: bytes, loop: tuple[Any, ...] = LOOP) -> None:
    for fn in loop:
        try:
            fn(action, raw, content)
        except Exception:  # noqa: BLE001 - as each observer swallows its own
            continue


def carried(action: str, raw: bytes, content: bytes) -> None:
    """An answer the relay gave at /gas (front_door.proxy): its packs and marks kept here, nothing rung or told. An
    upload past the envelope reader is named by its opening bytes alone, as gas_relay names it."""
    if len(raw) > RELAY_ENVELOPE_MAX:
        action = ""
    try:
        with Raised(quiet=True):
            observe(action, raw, content, CARRIED)
    except Exception:  # noqa: BLE001 - never in the answer's way
        pass


async def finish(meta: dict[str, Any], raw: bytes, content: bytes) -> Any:
    """The front door's finish (front_door.Finished): the bytes that replace Python's answer (None: it stands), the
    ring a kept read re-reads on, and the phase."""
    kind, action = str(meta.get("kind") or ""), str(meta.get("action") or "")
    phase = str(SLICES.PHASE["phase"])
    if meta.get("handed"):
        keep_task(hiring_handed(meta["handed"]))
    if kind == "handed":
        return FD.Finished(None, None, phase)
    if action and not FD.is_service(raw):
        SLICES.action_note(action_label(action, raw))
    if kind == "write":
        try:
            out = await write_tail(meta, raw, content)
        except Exception as exc:  # noqa: BLE001 - the answer stands as Python gave it; said
            if not meta.get("quiet"):
                log.warning("front door: %s not finished (%s)", meta.get("door"), type(exc).__name__)
            return None
        return FD.Finished(out, None, phase)
    answer = content
    try:
        if kind == "read" and not meta.get("said"):
            answer = read_tail(meta, raw, content)
        elif kind == "auth":
            SLICES.traffic_note("backend_python")
    except Exception as exc:  # noqa: BLE001
        if not meta.get("quiet"):
            log.warning("front door: %s not finished (%s)", meta.get("door"), type(exc).__name__)
        return None
    ring = (ring_of(action) or "") if kept_read(action, raw) else None
    with Raised():
        observe(action, raw, answer)
    out = editions_cut(action, answer)
    return FD.Finished(None if out == content else out, ring, phase)


async def marks_door(request: Request) -> Response:
    """POST /live/marks — the relay's: the marks its own landings set, for the next read's judgement here."""
    if not TOKEN[0] or not hmac.compare_digest(str(request.headers.get("x-hub-token") or ""), TOKEN[0]):
        return Response(status_code=401)
    try:
        said = json.loads(await request.body() or b"{}")
    except ValueError:
        return Response(status_code=400)
    return Response(content=json.dumps({"merged": merge_marks(said)}).encode(), media_type="application/json")


def install(app: Any) -> None:
    app.post("/live/marks")(marks_door)
