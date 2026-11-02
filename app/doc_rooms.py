"""The Drive reading rooms (DocFolders.gs): the Audit Library's case-folder cabinet and the other screens drawn by
DriveReadingRoom — a room is a registry key, never a folder id a caller sends. docRoomList reads the room's files off
Drive as the platform's own account; docRoomUploadPlan and docRoomTrashPlan decide a store or a trash, which the relay
carries out in Drive as asatech before doc_rooms_writes.py keeps what happened in app.doc_room_events."""
from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable

import gsjs
import locations as L
from scope import Defer

APP_ID = "audit-library"
# DocFolders.gs DOC_ROOMS
ROOMS: dict[str, dict[str, Any]] = {
    "interviews": {"prop": "INTERVIEW_DOCS_FOLDER_ID", "sibling": "interviews",
                   "fallback": "19BJDdwj0_1kgASStvoPWr7TPRbf-G8Ob", "roles": ("admin", "manager"), "write": True},
    "invoices": {"prop": "INVOICE_DOCS_FOLDER_ID", "sibling": "invoices", "roles": ("admin", "manager"), "write": True},
    # the Drive folder is named "Audit & Legal", not "auditory"
    "audits": {"prop": "AUDIT_DOCS_FOLDER_ID", "sibling": "audit & legal", "fallback": "13my33Eg3JPIhfmFxC8OPltngZpMWDIKz",
               "roles": ("admin",), "write": True, "tree": True},
    "training": {"prop": "TRAINING_DOCS_FOLDER_ID", "sibling": "training", "roles": ("admin", "manager", "staff"),
                 "write": False},
    "isp": {"prop": "ISP_DOCS_FOLDER_ID", "sibling": "", "roles": ("admin", "manager"), "write": True},
    "houses": {"prop": "HOUSE_DOCS_FOLDER_ID", "sibling": "house _ client books", "roles": ("admin", "manager"),
               "write": True, "tree": True}}
LIST_CAP = 400
FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink"
SIBLING_TTL_S = 21600.0
# Drive round trips one listing asks at once
DRIVE_WORKERS = 8
# a room's listing answers again for this long; a store or trash through the Hub drops it at once
HOLD_S = 180.0
# what one store may carry (Apps Script's own POST ceiling stood here)
MAX_BYTES = 30 * 1024 * 1024
UNKNOWN = {"status": 404, "message": "Unknown action."}
_SIBLINGS: dict[str, tuple[float, str]] = {}
_HELD: dict[str, tuple[float, dict[str, Any]]] = {}
# room -> listings dropped so far; a read begun before a drop never keeps its answer
_DROPS: dict[str, int] = {}
_LOCK = threading.Lock()

s_ = gsjs.str_


def drive(reads: L.Reads) -> Any:
    """The app's Drive client, acting as the platform's own account first."""
    if reads.drive is None or not getattr(reads.drive, "available", False):
        raise Defer("no Drive client is configured")
    return reads.drive


def bad_room() -> dict[str, Any]:
    return {"status": 400, "message": "room: one of " + ", ".join(ROOMS)}


def may_read(key: str, user: dict | None) -> bool:
    """docRoomMayRead_: an admin reads every room, anybody else the rooms naming their role."""
    room = ROOMS.get(key)
    if not room or not user or user.get("is_service"):
        return False
    role = s_(user.get("role"))
    return role == "admin" or role in room["roles"]


def _sibling(reads: L.Reads, key: str) -> str:
    """docRoomFamily_ and the same-named sibling of the Administration folder, held six hours."""
    with _LOCK:
        held = _SIBLINGS.get(key)
        if held and time.time() - held[0] < SIBLING_TTL_S:
            return held[1]
    admin = s_(reads.db.prop("ADMIN_DOCS_FOLDER_ID"))
    if not admin:
        return ""
    try:
        parents = drive(reads).file(admin).get("parents") or []
        if not parents:
            return ""
        want = ROOMS[key]["sibling"].lower()
        found = next((s_(f.get("id")) for f in drive(reads).children(parents[0], True, "id,name")
                      if gsjs.trim(s_(f.get("name"))).lower() == want), "")
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - as docRoomFamily_: no family, no sibling
        return ""
    if found:
        with _LOCK:
            _SIBLINGS[key] = (time.time(), found)
    return found


def folder_id(reads: L.Reads, key: str) -> str:
    """docRoomFolderId_: the property, then the fallback, then the Administration folder's sibling."""
    room = ROOMS[key]
    got = s_(reads.db.prop(room["prop"]))
    if got:
        return got
    if room.get("fallback"):
        return room["fallback"]
    return _sibling(reads, key) if room["sibling"] else ""


def unset(key: str) -> dict[str, Any]:
    return {"folder": None, "reason": f'The "{key}" folder is not configured and could not be found beside the '
                                      f'Administration folder — set the {ROOMS[key]["prop"]} property.'}


def folder(reads: L.Reads, key: str) -> dict[str, Any]:
    """docRoomFolder_: the room's folder, or why it cannot be opened."""
    fid = folder_id(reads, key)
    return opened(drive(reads), key, fid) if fid else unset(key)


def opened(d: Any, key: str, fid: str) -> dict[str, Any]:
    """The room's folder off Drive, or why it cannot be opened."""
    try:
        got = d.file(fid, "id,name,trashed")
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - the port's own sentence
        return {"folder": None, "reason": f'The platform cannot open the "{key}" folder — check that '
                                          "asatech@asalifecare.com has access to it."}
    if got.get("trashed"):
        return {"folder": None, "reason": "The configured folder is in the trash."}
    return {"folder": got, "id": fid}


def shape(f: dict, category: str, case_path: str) -> dict[str, Any]:
    """docRoomFileShape_."""
    size = s_(f.get("size"))
    return {"id": s_(f.get("id")), "name": s_(f.get("name")), "mime": s_(f.get("mimeType")),
            "size_bytes": int(size) if size.isdigit() else 0, "modified_time": s_(f.get("modifiedTime")),
            "web_view_link": s_(f.get("webViewLink")), "category": category, "case_path": case_path}


def _tree(pool: ThreadPoolExecutor, d: Any, cats: Future, loose: Future) -> list[dict]:
    """A tree room's files in the order the port walked them — each category's own files, then its case folders',
    then the room's loose files — every folder of a level read at once."""
    def files(fid: str) -> Future:
        return pool.submit(d.children, fid, False, FIELDS, LIST_CAP)

    def folders(fid: str) -> Future:
        return pool.submit(d.children, fid, True, "id,name")

    level = [(s_(c.get("name")), files(c["id"]), folders(c["id"])) for c in cats.result()]
    cases = [[(s_(cs.get("name")), files(cs["id"])) for cs in sub.result()] for _n, _own, sub in level]
    out: list[dict] = []
    for (name, own, _sub), held in zip(level, cases):
        out += [shape(f, name, "") for f in own.result()]
        for case, got in held:
            out += [shape(f, name, case) for f in got.result()]
    return out + [shape(f, "", "") for f in loose.result()]


def drop(key: str) -> None:
    """A file stored in the room or trashed from it through the Hub: its listing is read off Drive again."""
    with _LOCK:
        _HELD.pop(key, None)
        _DROPS[key] = _DROPS.get(key, 0) + 1


def room_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docRoomList: the room's files, newest first — a tree room reads its categories and their case folders, a
    level at a time; the answer is held HOLD_S."""
    reads = sess.reads
    key = s_((payload or {}).get("room"))
    if key not in ROOMS:
        return bad_room()
    if not may_read(key, sess.user):
        return dict(UNKNOWN)
    with _LOCK:
        held, drops = _HELD.get(key), _DROPS.get(key, 0)
    if held and time.time() - held[0] < HOLD_S:
        return {"status": 200, "data": held[1]}
    fid = folder_id(reads, key)
    if not fid:
        return {"status": 200, "data": {"configured": False, "reason": unset(key)["reason"], "files": []}}
    d = drive(reads)
    with ThreadPoolExecutor(max_workers=DRIVE_WORKERS) as pool:
        # the folder is opened beside its first listing; a Defer there is the door's, as folder() raises it
        head = pool.submit(opened, d, key, fid)
        loose = pool.submit(d.children, fid, False, FIELDS, LIST_CAP)
        cats = pool.submit(d.children, fid, True, "id,name") if ROOMS[key].get("tree") else None
        found = head.result()
        if not found["folder"]:
            return {"status": 200, "data": {"configured": False, "reason": found["reason"], "files": []}}
        try:
            out = _tree(pool, d, cats, loose) if cats else [shape(f, "", "") for f in loose.result()]
        except Defer as exc:
            return {"status": 502, "message": "Drive refused the listing: " + str(exc)[:120]}
        except Exception as exc:  # noqa: BLE001 - Drive's own refusal, said
            return {"status": 502, "message": "Drive refused the listing: " + type(exc).__name__}
    out = out[:LIST_CAP]
    out.sort(key=lambda f: f["modified_time"], reverse=True)
    data = {"configured": True, "room": key, "folder_name": s_(found["folder"].get("name")),
            "truncated": len(out) >= LIST_CAP, "writable": bool(ROOMS[key]["write"]), "files": out}
    with _LOCK:
        if _DROPS.get(key, 0) == drops:
            _HELD[key] = (time.time(), data)
    return {"status": 200, "data": data}


def upload_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docRoomUpload's verdict before the relay stores the file: the room, its folder, the name and the type."""
    p = payload if isinstance(payload, dict) else {}
    key = s_(p.get("room"))
    room = ROOMS.get(key)
    if room is None:
        return bad_room()
    user = sess.user or {}
    if not may_read(key, user):
        return dict(UNKNOWN)
    if not room["write"]:
        return {"status": 403, "message": "This room is read-only."}
    if s_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": "Requires an admin or manager account"}
    name = s_(p.get("filename"))[:180]
    if not name or not int(p.get("b64_chars") or 0):
        return {"status": 400, "message": "filename and base64 are required."}
    found = folder(sess.reads, key)
    if not found["folder"]:
        return {"status": 503, "message": found["reason"]}
    return {"status": 200, "data": {"room": key, "folder_id": found["id"], "name": name,
                                    "mime": s_(p.get("mime")) or "application/octet-stream", "max_bytes": MAX_BYTES}}


def trash_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docRoomTrash's verdict: an admin, a writable room, and a file proved to sit within three levels of it."""
    p = payload if isinstance(payload, dict) else {}
    key = s_(p.get("room"))
    room = ROOMS.get(key)
    if room is None:
        return bad_room()
    user = sess.user or {}
    if s_(user.get("role")) != "admin" or user.get("is_service"):
        return {"status": 403, "message": "Requires an admin or manager account"}
    if not room["write"]:
        return {"status": 403, "message": "This room is read-only."}
    fid = s_(p.get("id"))
    if not fid:
        return {"status": 400, "message": "id is required."}
    found = folder(sess.reads, key)
    if not found["folder"]:
        return {"status": 503, "message": found["reason"]}
    d = drive(sess.reads)
    try:
        f = d.file(fid, "id,name,parents")
        level, inside = list(f.get("parents") or []), False
        for _depth in range(3):
            if found["id"] in level:
                inside = True
                break
            nxt: list[str] = []
            for pid in level:
                nxt += list(d.file(pid, "id,parents").get("parents") or [])
            level = nxt
    except Exception as exc:  # noqa: BLE001 - Drive's own refusal, said
        return {"status": 502, "message": "Drive refused: " + (str(exc)[:120] if isinstance(exc, Defer)
                                                              else type(exc).__name__)}
    if not inside:
        return {"status": 403, "message": f'That file is not inside the "{key}" room.'}
    return {"status": 200, "data": {"room": key, "id": fid, "name": s_(f.get("name"))}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "docRoomList": room_list, "docRoomUploadPlan": upload_plan, "docRoomTrashPlan": trash_plan}
POLICY: dict[str, dict[str, Any]] = {
    "docRoomList": {"roles": ("admin", "manager", "staff")}, "docRoomUploadPlan": {"roles": ("admin", "manager")},
    "docRoomTrashPlan": {"roles": ("admin",)}}
