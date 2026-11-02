"""The relay's own /gas rungs over Python's doors, answered here in its words (server/snapshot_service.py gas_relay), as
front door rungs (front_door.RUNGS) on the front door's own session verdict: House Supplies' doors and the file doors
(_location_meds), Emergency Contacts, the JSON lane's bundles, a client's MARS papers, My Work's Time off message,
Settings' last tools, a signed packet attached, the papers filed in Drive as asatech (a certificate, a family member's
paper, a calendar day's file, a Library file, a reading room's store and trash, an IST paper), the sweeps a person
presses (inbound, the window ask, the ISP intake and contacts, the platform's contact list), the reads the relay handed
its own record (the pharmacy's stock, the purchases) or composed (the policies import, the TrueLink sync), and the AI
lane test, its leg asked of this app's own /analyze (app/analyze.py)."""
from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Awaitable, Callable

from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import analyze
import front_door as FD

log = logging.getLogger("asa-hub-app.door-rungs")

SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
SERVICE: dict[str, Any] = {"is_service": True}
# what the relay's readers take whole below doPost's cap: past it the relay names no action
ENVELOPE_MAX = 100_000
WRITE_ID = re.compile(r"[A-Za-z0-9_.:\-]{8,80}")

# ---- the relay's own words ------------------------------------------------------------------------------------------
RELAY_UNKNOWN_ACTION = {"status": 404, "message": "Unknown action."}
AUTH_ENDED = {"status": 401, "message": "Authentication required."}
BACKEND_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
BACKEND_FINAL_UNWRITTEN = "This change could not be saved just now, and nothing was written. Try again in a moment."
ADMIN_ONLY = {"status": 403, "message": "Requires an admin or manager account"}
LOCATION_MEDS_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
LOCATION_MEDS_AWAY = {"status": 409, "message": "This is read from your own workspace — not on a visit, in a world "
                                                "or at another place."}
EMERGENCY_CONTACTS_COMPILED = {"status": 200, "data": {"source": "compiled"}}
EMERGENCY_CONTACTS_OFF = {"status": 403,
                          "message": "The directory is the built-in one until Emergency Contacts runs on Python "
                                     "(Settings › Back-end per app). Nothing was saved."}
EMERGENCY_CONTACTS_UNREAD = {"status": 503, "message": "The directory could not be read just now. Try again in a "
                                                       "moment."}
EMERGENCY_CONTACTS_EVENT = "emergency-contacts"
BUNDLE_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
MY_WORK_MESSAGE_UNSENT = {"status": 503, "message": "The message could not be handed to Smart Comms just now, and "
                                                    "nothing was sent. Try again in a moment."}
SETTINGS_TOOLS_AWAY = {"status": 409, "message": "Settings is used from your own workspace — not on a visit, in a "
                                                 "world or at another place."}
SETTINGS_TOOLS_UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
PYTHON_TOOL_UNANSWERED = {"status": 503, "message": "This could not be done just now — nothing was saved. Try again "
                                                    "in a moment."}
CERT_PAPERS_UNFILED = {"status": 503, "message": "The document could not be filed just now — try again in a minute. "
                                                 "Nothing was filed."}
CERT_PAPERS_NO_OWNER = {"status": 503, "message": "Documents cannot be filed just now: the platform's own Drive "
                                                  "account is not given to this server. Nothing was filed."}
CERT_PAPERS_UNKEPT = {"status": 503, "message": "The document reached Drive, but its record could not be kept just "
                                                "now — file it again in a minute."}
CALENDAR_UNFILED = {"status": 503, "message": "The file could not be pinned just now — try again in a minute. "
                                              "Nothing was filed."}
CALENDAR_UNKEPT = {"status": 503, "message": "The file reached Drive, but it could not be pinned to the day just now "
                                             "— pin it again in a minute."}
LIBRARY_UNSTORED = {"status": 503, "message": "The file could not be stored just now — try again in a minute. "
                                              "Nothing was stored."}
LIBRARY_UNKEPT = {"status": 503, "message": "The file reached Drive, but it could not be recorded just now — store "
                                            "it again in a minute."}
DOC_ROOM_UNDONE = {"status": 503, "message": "Drive could not be reached just now — try again in a minute. Nothing "
                                             "was changed."}
DOC_ROOM_UNKEPT = {"status": 503, "message": "Drive took the change, but it could not be recorded just now — look at "
                                             "the room again in a minute."}
IST_PAPER_UNFILED = {"status": 503, "message": "The paper could not be filed just now — try again in a minute. Nothing "
                                               "was written."}
IST_PAPER_UNKEPT = {"status": 503,
                    "message": "Drive took the paper, but its IST record could not be updated just now — look at the "
                               "house again in a minute."}
INBOUND_UNREAD = {"status": 503, "message": "The inbound messages could not be read just now. Try again in a moment."}
ISP_INTAKE_UNREAD = {"status": 503, "message": "The plans could not be read just now. Try again in a moment."}

# ---- the doors each rung asks ---------------------------------------------------------------------------------------
HOUSE_MEDS_APP = "house-supplies"
LOCATION_MEDS_APP_OF = {"locationDocsWhere": "locations", "locationDocFile": "locations",
                        "adminDocFile": "administration", "academyVideoFile": "academy",
                        "techDocFile": "technology", "policyDocFile": "policy-acks", "taskFile": "taskboard",
                        "finDocFile": "finance", "obDocFile": "onboarding", "inventorySupplyFile": "inventory"}
LOCATION_MEDS_MINE = frozenset({"locationMedications", "locationMedicationHistory", "houseSuppliesInventory",
                                "locationDocFile", "adminDocFile", "academyVideoFile", "techDocFile", "policyDocFile",
                                "taskFile", "finDocFile", "obDocFile", "inventorySupplyFile"})
EMERGENCY_CONTACTS_APP = "emergency-contacts"
EMERGENCY_CONTACTS_READ = "emergencyContactsRead"
BUNDLE_APP = "bundles"
BUNDLE_PYTHON_ACTIONS = frozenset({"snapshotBundleBuild", "snapshotBundleSweep", "snapshotBundleOwned",
                                   "snapshotBundlePlaces", "snapshotBundleLatest"})
MAR_PAPERS_APP = "clients"
MAR_PAPERS_ACTIONS = frozenset({"clientSourceMar", "clientSourceMarDocFile"})
MY_WORK_APP = "my-work"
SETTINGS_TOOLS_APP = "settings-tools"
SETTINGS_TOOLS_MINE = frozenset({"usersQuoEnrich", "syncFromLegacy", "contactSweepInstall"})
SETTINGS_TOOLS_WRITES = frozenset({"syncFromLegacy", "contactSweepInstall"})
# door -> (app, prepare read, the payload's bytes field)
PYTHON_TOOL_DOORS = {"packetUpload": ("onboarding", "packetUploadPrepare", "base64")}
CERT_PAPERS_APP = "cert-docs"
CALENDAR_APP = "calendar"
TEAM_BOARD_APP = "teamboard"
AUDIT_LIBRARY_APP = "audit-library"
IST_APP = "ist"
OPT_OUTS_APP = "opt-outs"
CLIENT_CARE_APP = "client-care"
ISP_CONTACTS_PASSES = 40
ISP_APP = "isp"
ISP_INTAKE_DOORS = {"ispIntakeSweep": "sweep", "ispIntakeRedo": "redo", "clientProfileIspSections": "sections"}
CONTACTS_SYNC_APP = "contacts-sync"
CONTACTS_SYNC_PASSES = 10
COMM_WINDOW_ASK_APP = "comm-window-ask"
COMM_WINDOW_ASK_BUDGET_S = 60.0
GUARDIAN_APP = "guardian"
POLICIES_APP = "policy-acks"
FINANCE_APP = "finance"
# the reads whose record the relay handed in (now read here, app/service_records.py), and the ones it composed
RELAY_RECORD_ACTIONS = frozenset({"shopPurchases", "inventoryPharmacy"})
COMPOSED_READS = frozenset({"policiesImport", "truelinkSync"})
# the AI lane test's leg (KeyStress.gs): this app's own /analyze, asked with the secret, the question app/
# ai_key_stress.py asks every key of the ladder
AI_KEY_STRESS_SELF = os.getenv("HUB_ANALYZE_SELF_URL", "http://127.0.0.1:8080/analyze")
AI_KEY_STRESS_PROMPT = 'Reply as JSON: {"what": "one short sentence on what an API rate limit is"}'
AI_KEY_STRESS_ROUNDS = (2, 5)
AI_KEY_STRESS_GAP_S = 1.2

# ---- the papers' rules (the relay's cert_papers.py) ----------------------------------------------------------------
FOLDER = "Compliance Docs"
FOLDER_MIME = "application/vnd.google-apps.folder"
MAX_BYTES = 15 * 1024 * 1024
B64_MAX = 21000000
TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
         "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}
TYPE_WORDS = "Images and PDFs only — a PDF, or a PNG, JPEG, GIF, WebP or HEIC picture."
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
DRIVE_TIMEOUT_S = 60.0
# past this a file goes up in a resumable session, as the relay's client sent it
RESUMABLE_PAST = 5 * 1024 * 1024

# main.py, handed over by install()
M: Any = None


class Refused(ValueError):
    """The file itself is refused (a 400), in the door's words; nothing was filed."""


class NoOwner(RuntimeError):
    """No Drive token acting as the platform's own account: nothing is filed as anyone else."""


# ---- the answer, the session and Python's doors ---------------------------------------------------------------------

def _phase() -> dict[str, str]:
    """The phase every relay answer says (X-Hub-Phase)."""
    try:
        import live_slices  # noqa: PLC0415

        return {"X-Hub-Phase": str(live_slices.PHASE["phase"])}
    except Exception:  # noqa: BLE001 - the plane not installed says none
        return {}


def said(env: Any) -> Response:
    return Response(content=json.dumps(env, default=str).encode(), media_type="application/json", headers=_phase())


def _relay_raw(env: dict[str, Any], raw: bytes) -> bytes:
    """The envelope as the relay's readers took it: a raw-JSON body as the form field `body`."""
    return FD.form_raw(env) if raw[:64].lstrip().startswith(b"{") else raw


def _oversized(env: dict[str, Any], raw: bytes) -> bool:
    """Past the relay's envelope reader its action is named by nobody: doPost's unknown action."""
    if len(raw) > ENVELOPE_MAX:
        return True
    return raw[:64].lstrip().startswith(b"{") and len(FD.form_raw(env)) > ENVELOPE_MAX


def _unknown(action: str) -> Response:
    log.info("door rungs: %s answered Unknown action — past the envelope reader, no door takes it", action or "?")
    return said(dict(RELAY_UNKNOWN_ACTION))


def _payload(env: dict[str, Any]) -> dict[str, Any]:
    return env.get("payload") if isinstance(env.get("payload"), dict) else {}


def _away(env: dict[str, Any]) -> bool:
    return any(env.get(k) for k in ("world", "tenant", "member"))


async def _caller(env: dict[str, Any]) -> FD.Session | None:
    """_session_actor: the front door's verdict on the envelope's token, a live one only."""
    token = str(env.get("token") or "")
    s = await FD.session(token) if token else None
    return s if s is not None and s.ok else None


def _user(s: FD.Session, *, master: bool = True, **extra: Any) -> dict[str, Any]:
    """The identity the relay told Python's door (then _acting_user): a session minted from the master's own says so,
    is never the master, and leaves no line."""
    user: dict[str, Any] = {"uid": s.uid, "role": s.role.strip().lower()}
    if master:
        user["is_master"] = s.master
    user.update(extra)
    if s.acting:
        user = {**user, "acting": True, "unlogged": True, "is_master": False}
    return user


def _say(s: FD.Session | None, level: int, msg: str, *args: Any) -> None:
    """Nothing is said of a session minted from the master's own."""
    if s is None or not s.acting:
        log.log(level, msg, *args)


def _write_id(env: dict[str, Any], seed: bytes) -> str:
    wid = str(env.get("write_id") or "")
    if WRITE_ID.fullmatch(wid):
        return wid
    return "W" + hashlib.sha256(seed + str(time.time_ns()).encode()).hexdigest()[:24]


def _new_id(tag: str) -> str:
    return "W" + hashlib.sha256(f"{tag}|{time.time_ns()}".encode()).hexdigest()[:24]


def _unanswered(action: str, why: str) -> tuple[None, str]:
    return None, why


async def ask(app_id: str, action: str, payload: dict[str, Any], user: dict[str, Any], *, wid: str = "",
              people: float = 0.0) -> tuple[dict[str, Any] | None, str]:
    """The relay's _backend_call in-process (main.py's act): the door's answer, or None and why there was none (its
    defer, a fault, another shape). No line can drop in-process, so the door is let finish: a worker thread is never
    cut short, and its answer is never thrown away for a wait the relay spent on HTTP."""
    module, deciding = M.APPS.get(app_id), M.WRITES.get(app_id)
    write = deciding is not None and action in deciding.ACTIONS
    if module is None or (action not in module.ACTIONS and not write):
        return _unanswered(action, "it deferred 404: not ported")
    started = time.monotonic()
    try:
        resp = await (run_in_threadpool(M._run_write, deciding, action, user, payload, wid, people) if write
                      else run_in_threadpool(M._run, module, action, user, payload, people))
    except Exception as exc:  # noqa: BLE001 - said by the caller, as the relay's line that dropped
        return _unanswered(action, f"{type(exc).__name__} after {time.monotonic() - started:.1f}s")
    body = bytes(getattr(resp, "body", b"") or b"")
    if resp.status_code != 200:
        try:
            why = str((json.loads(body) or {}).get("defer") or "")
        except Exception:  # noqa: BLE001
            why = ""
        return _unanswered(action, f"it deferred {resp.status_code}: {why[:120]}")
    try:
        env = json.loads(body)
    except ValueError:
        env = None
    if not isinstance(env, dict) or not isinstance(env.get("status"), int):
        return _unanswered(action, "another shape")
    return env, ""


def _void(app_id: str, wid: str) -> None:
    FD.settle_void_soon(app_id, wid)


def traffic() -> None:
    try:
        import live_slices  # noqa: PLC0415

        live_slices.traffic_note("backend_python")
    except Exception:  # noqa: BLE001 - a counter is never the outage
        pass


def mark_dirty(names: Any) -> None:
    """The relay's _mark_dirty: the slices the manifest knows, rebuilt on the debounced clock."""
    try:
        import live_slices  # noqa: PLC0415

        live_slices.mark_dirty(list(names))
    except Exception as exc:  # noqa: BLE001 - the rebuild clock carries it
        log.warning("door rungs: slices not marked dirty (%s)", type(exc).__name__)


def landed(action: str, raw: bytes, content: bytes) -> None:
    """_backend_final_landed: every kept copy and pack the write changes read again, said once."""
    try:
        import live_finish  # noqa: PLC0415

        with live_finish.Raised():
            live_finish.final_landed(action, raw, content)
    except Exception as exc:  # noqa: BLE001 - each copy's own age still refreshes it
        log.warning("door rungs: %s kept by Python, its copies not all read again (%s)", action, type(exc).__name__)


def publish(name: str) -> None:
    """_publish_slice: a bare name rung."""
    try:
        import live_finish  # noqa: PLC0415

        live_finish.publish(name)
    except Exception:  # noqa: BLE001 - telling nobody must never fail a write
        pass


def smart_comms_rang(action: str, raw: bytes, content: bytes) -> None:
    try:
        import live_finish  # noqa: PLC0415

        with live_finish.Raised():
            live_finish.smart_comms_rang(action, raw, content)
    except Exception:  # noqa: BLE001
        pass


def resolver_invalidates(action: str) -> tuple[str, ...]:
    try:
        import live_finish  # noqa: PLC0415

        return tuple(live_finish.resolver_invalidates(action))
    except Exception:  # noqa: BLE001 - none declared
        return ()


def keep_task(coro: Awaitable[Any]) -> None:
    try:
        import live_finish  # noqa: PLC0415

        live_finish.keep_task(coro)
    except Exception:  # noqa: BLE001 - no loop: nothing behind the answer
        pass


def _rung_raw(token: str, action: str, payload: dict[str, Any]) -> bytes:
    """The small envelope a landing is rung with (the bytes never ride the ring)."""
    return urllib.parse.urlencode({"body": json.dumps({"token": token, "action": action,
                                                       "payload": payload})}).encode()


async def _keep_twice(app_id: str, action: str, body: dict[str, Any], user: dict[str, Any],
                      wid: str) -> dict[str, Any] | None:
    """A filing's row kept under its id; the platform's write lock held a moment, asked once more."""
    answer = None
    for _attempt in (1, 2):
        answer, _why = await ask(app_id, action, dict(body), user, wid=wid)
        if not (answer and answer.get("status") == 409 and "in progress" in str(answer.get("message") or "")):
            break
        await asyncio.sleep(1.0)
    return answer


# ---- Drive as the platform's own account (the relay's cert_papers) -------------------------------------------------

_FOLDER_LOCK = threading.Lock()
_PROJECT: dict[str, str] = {}


def _q(s: Any) -> str:
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


class Owner:
    """Drive acting as asatech alone, through the app's Drive client's own token for it (drive.py); NoOwner when it
    gives none — nothing is ever filed as another account."""

    def __init__(self, drv: Any) -> None:
        try:
            self.auth = drv._owner_write("a file is filed in Drive")  # noqa: SLF001 - the client's owner token
        except Exception as exc:  # noqa: BLE001 - the type only: the words may carry a token
            raise NoOwner(f"the platform account's Drive token gives none ({type(exc).__name__})") from None

    def _send(self, method: str, url: str, *, body: Any = None, data: bytes | None = None, ctype: str = "",
              headers: dict[str, str] | None = None) -> tuple[dict[str, Any], Any]:
        sent = data if data is not None else (json.dumps(body).encode() if body is not None else None)
        h = {**self.auth, **(headers or {})}
        if sent is not None:
            h["Content-Type"] = ctype or "application/json; charset=UTF-8"
        req = urllib.request.Request(url, data=sent, headers=h, method=method)
        with urllib.request.urlopen(req, timeout=DRIVE_TIMEOUT_S) as res:
            return json.loads(res.read() or b"{}"), res.headers

    def files(self, q: str, fields: str, page_size: int = 10, order_by: str = "") -> list[dict[str, Any]]:
        params = {"q": q, "fields": fields, "pageSize": page_size, "supportsAllDrives": "true",
                  "includeItemsFromAllDrives": "true", **({"orderBy": order_by} if order_by else {})}
        return list(self._send("GET", DRIVE_API + "?" + urllib.parse.urlencode(params))[0].get("files") or [])

    def child_folder(self, parent: str, name: str) -> str:
        """filesChildByName_: the oldest folder of this name under the parent, else one made there."""
        found = self.files(f"'{_q(parent)}' in parents and name = '{_q(name)}' and mimeType = '{FOLDER_MIME}' "
                           "and trashed = false", "files(id)", order_by="createdTime")
        if found:
            return str(found[0]["id"])
        made = self._send("POST", DRIVE_API + "?supportsAllDrives=true&fields=id",
                          body={"name": name, "mimeType": FOLDER_MIME, "parents": [parent]})[0]
        return str(made["id"])

    def upload(self, folder: str, name: str, mime: str, data: bytes) -> dict[str, Any]:
        """createFile: the bytes in the folder under this name; {id, name, mimeType, size}."""
        meta = {"name": name, "parents": [folder]}
        if len(data) <= RESUMABLE_PAST:
            boundary = "hub" + os.urandom(12).hex()
            body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
                    + json.dumps(meta).encode()
                    + f"\r\n--{boundary}\r\nContent-Type: {mime or 'application/octet-stream'}\r\n\r\n".encode()
                    + data + f"\r\n--{boundary}--\r\n".encode())
            q = urllib.parse.urlencode({"uploadType": "multipart", "supportsAllDrives": "true",
                                        "fields": "id,name,mimeType,size"})
            return self._send("POST", f"{DRIVE_UPLOAD}?{q}", data=body,
                              ctype=f"multipart/related; boundary={boundary}")[0]
        q = urllib.parse.urlencode({"uploadType": "resumable", "supportsAllDrives": "true",
                                    "fields": "id,name,mimeType,size"})
        _got, head = self._send("POST", f"{DRIVE_UPLOAD}?{q}", body=meta,
                                headers={"X-Upload-Content-Type": mime or "application/octet-stream",
                                         "X-Upload-Content-Length": str(len(data))})
        where = head.get("Location") if head is not None else None
        if not where:
            raise RuntimeError("Drive named no upload session")
        return self._send("PUT", str(where), data=data, ctype=mime or "application/octet-stream")[0]

    def get(self, file_id: str, fields: str) -> dict[str, Any]:
        q = urllib.parse.urlencode({"fields": fields, "supportsAllDrives": "true"})
        return self._send("GET", f"{DRIVE_API}/{urllib.parse.quote(file_id)}?{q}")[0]

    def trash(self, file_id: str) -> None:
        self._send("PATCH", f"{DRIVE_API}/{urllib.parse.quote(file_id)}?supportsAllDrives=true&fields=id",
                   body={"trashed": True})

    def share_anyone(self, file_id: str) -> None:
        self._send("POST", f"{DRIVE_API}/{urllib.parse.quote(file_id)}/permissions?supportsAllDrives=true",
                   body={"type": "anyone", "role": "reader"})


# the owner's Drive for a filing (a test stands its own in)
OWNER: Callable[[Any], Any] = Owner


def _owner() -> Any:
    return OWNER(getattr(M, "DRIVE", None))


def decode_paper(b64: str, mime: str) -> bytes:
    """cert_papers.decode: the paper's bytes, its type and size checked again."""
    if mime not in TYPES.values():
        raise Refused(TYPE_WORDS + " Nothing was filed.")
    if not b64:
        raise Refused("The file is required.")
    if len(b64) > B64_MAX:
        raise Refused("The file is too large — up to 15MB.")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        raise Refused("The file could not be read as sent. Nothing was filed.") from None
    if not data:
        raise Refused("The file is empty.")
    if len(data) > MAX_BYTES:
        raise Refused("The file is too large — up to 15MB.")
    return data


def file_paper(data: bytes, plan: dict[str, Any]) -> dict[str, Any]:
    """cert_papers.file: the paper in <platform root>/<top, Compliance Docs>/<label> as asatech, and the courtesy copy
    in the shared archive (never fatal)."""
    drive = _owner()
    with _FOLDER_LOCK:
        top = str(plan.get("top") or FOLDER)
        home = drive.child_folder(drive.child_folder(str(plan["platform_root"]), top), str(plan["folder"]))
    made = drive.upload(home, str(plan["name"]), str(plan["mime"]), data)
    file_id = str(made.get("id") or "")
    if not file_id:
        raise RuntimeError("Drive named no file")
    shared = False
    if plan.get("shared_copy") is True and plan.get("shared_folder"):
        try:
            drive.upload(str(plan["shared_folder"]), str(plan["name"]), str(plan["mime"]), data)
            shared = True
        except Exception as exc:  # noqa: BLE001 - a courtesy copy never costs the filing
            log.info("cert papers: the shared copy of %s was not made (%s)", file_id, type(exc).__name__)
    return {"file_id": file_id, "url": f"https://drive.google.com/file/d/{file_id}/view", "name": str(plan["name"]),
            "mime": str(plan["mime"]), "size": len(data), "shared": shared}


def calendar_decode(b64: str) -> bytes:
    try:
        data = base64.b64decode(b64, validate=False)
    except ValueError:
        raise Refused("The file could not be read as sent. Nothing was filed.") from None
    if not data:
        raise Refused("The file is empty.")
    return data


def _project_folder(drive: Any, name: str) -> str:
    """The one project folder of that name the platform's account sees, never one made here."""
    if _PROJECT.get(name):
        return _PROJECT[name]
    found = [str(f["id"]) for f in drive.files(f"name = '{_q(name)}' and mimeType = '{FOLDER_MIME}' and "
                                               "trashed = false", "files(id)")]
    if len(found) != 1:
        raise RuntimeError(f"{len(found)} project folders of that name")
    _PROJECT[name] = found[0]
    return found[0]


def calendar_file(data: bytes, plan: dict[str, Any]) -> dict[str, str]:
    """calendarDayFolder_ and createFile as asatech, the link opened to anyone for viewing unless the gate holds (a
    sharing Drive refuses leaves the file private)."""
    drive = _owner()
    with _FOLDER_LOCK:
        home = str(plan.get("platform_root") or "") or _project_folder(drive, str(plan["project"]))
        for name in plan["path"]:
            home = drive.child_folder(home, str(name))
    made = drive.upload(home, str(plan["name"]), str(plan["mime"]) or "application/octet-stream", data)
    file_id = str(made.get("id") or "")
    if not file_id:
        raise RuntimeError("Drive named no file")
    if not plan.get("held"):
        try:
            drive.share_anyone(file_id)
        except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
            log.info("calendar files: the link of a day file was not opened (%s)", type(exc).__name__)
    return {"file_id": file_id}


def library_decode(b64: str, most: int) -> bytes:
    try:
        data = base64.b64decode(b64, validate=False)
    except ValueError:
        raise Refused("The file could not be read as sent. Nothing was stored.") from None
    if not data:
        raise Refused("The file is empty")
    if len(data) > most:
        raise Refused("The file is over 25MB")
    return data


def library_file(data: bytes, plan: dict[str, Any]) -> str:
    drive = _owner()
    with _FOLDER_LOCK:
        home = drive.child_folder(str(plan["platform_root"]), str(plan["folder"]))
    made = drive.upload(home, str(plan["drive_name"]), str(plan["mime_type"]), data)
    file_id = str(made.get("id") or "")
    if not file_id:
        raise RuntimeError("Drive named no file")
    return file_id


def doc_room_change(plan: dict[str, Any], data: bytes | None) -> dict[str, Any]:
    """createFile into the room's folder, or setTrashed on the file, as asatech; the file as Drive then holds it."""
    drive = _owner()
    if data is None:
        drive.trash(str(plan["id"]))
        return {"id": str(plan["id"]), "name": str(plan.get("name") or "")}
    made = drive.upload(str(plan["folder_id"]), str(plan["name"]), str(plan["mime"]), data)
    file_id = str(made.get("id") or "")
    if not file_id:
        raise RuntimeError("Drive named no file")
    return drive.get(file_id, "id,name,mimeType,size,modifiedTime,webViewLink")


# ---- House Supplies and the file doors, Emergency Contacts, the bundles, MARS papers, My Work's message -----------

async def location_meds(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_location_meds: one house's prescriptions and the file doors, behind their apps' own doors; never Apps
    Script."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    got, why = await ask(LOCATION_MEDS_APP_OF.get(action, HOUSE_MEDS_APP), action, _payload(env), _user(s))
    if got is None:
        _say(s, logging.WARNING, "house meds: %s not answered by Python (%s) — said 503", action, why)
        return said(LOCATION_MEDS_UNREAD)
    got.pop("_write", None)
    traffic()
    return said(got)


def _emergency_contacts_rang(answer: dict[str, Any]) -> None:
    data = answer.get("data")
    if answer.get("status") == 200 or (isinstance(data, dict) and data.get("written")):
        publish(EMERGENCY_CONTACTS_EVENT)


async def emergency_contacts(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_emergency_contacts: the directory's read and save; never Apps Script."""
    action = str(env.get("action") or "")
    read = action == EMERGENCY_CONTACTS_READ
    off = EMERGENCY_CONTACTS_COMPILED if read else EMERGENCY_CONTACTS_OFF
    failed = EMERGENCY_CONTACTS_UNREAD if read else {"status": 503, "message": BACKEND_FINAL_UNWRITTEN}
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(off)
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(off)
    # the copy may not hold a just-changed App Control yet: a save is the master's alone meanwhile
    if not read and FD.people_at() and not s.master:
        return said(failed)
    wid = "" if read else _write_id(env, _relay_raw(env, raw))
    got, _why = await ask(EMERGENCY_CONTACTS_APP, action, _payload(env), _user(s), wid=wid)
    if got is None:
        if wid:
            _void(EMERGENCY_CONTACTS_APP, wid)
        _say(s, logging.WARNING, "emergency contacts: %s not answered by Python — said %s, never handed to Apps "
                                 "Script", action, failed["status"])
        return said(failed)
    got.pop("_write", None)
    traffic()
    if not read:
        _emergency_contacts_rang(got)
    return said(got)


async def bundle_python(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_bundle_python: the JSON lane's doors, for the machine on a service secret that matches, else the session;
    a visit and a place away from home are refused as doPost refuses them."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    secret = str(env.get("service_secret") or "")
    s = None
    if secret and len(SERVICE_SECRET) >= 20 and hmac.compare_digest(secret, SERVICE_SECRET):
        user: dict[str, Any] = dict(SERVICE)
    else:
        s = await _caller(env)
        if s is None:
            return said(dict(AUTH_ENDED))
        if env.get("member") or env.get("tenant"):
            return said(dict(RELAY_UNKNOWN_ACTION))
        user = _user(s)
    got, _why = await ask(BUNDLE_APP, action, _payload(env), user)
    if got is None:
        _say(s, logging.WARNING, "bundle lane: %s not answered by Python — said 503, never handed to Apps Script",
             action)
        return said(BUNDLE_UNREAD)
    traffic()
    return said(got)


async def mar_papers(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_mar_papers: a client's MARS papers, and one paper's bytes or kept OCR text; never Apps Script."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    got, _why = await ask(MAR_PAPERS_APP, action, _payload(env), _user(s))
    if got is None:
        _say(s, logging.WARNING, "mar papers: %s not answered by Python — said 503, never handed to Apps Script",
             action)
        return said(LOCATION_MEDS_UNREAD)
    got.pop("_write", None)
    traffic()
    return said(got)


async def my_work_message(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_my_work_message: a Time off approval row's message, raised to Smart Comms by My Work's door; never Apps
    Script."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said({"status": 403, "message": "My Work tells from your own workspace — not on a visit, in a world "
                                               "or at another place."})
    wid = _write_id(env, _relay_raw(env, raw))
    got, _why = await ask(MY_WORK_APP, action, _payload(env), _user(s), wid=wid,
                          people=0.0 if s.master else FD.people_at())
    if got is None:
        # whatever Python may have kept under this id is taken back, its owed text with it
        _void(MY_WORK_APP, wid)
        _say(s, logging.WARNING, "my work: %s not answered by Python — said 503, never handed to Apps Script", action)
        return said(MY_WORK_MESSAGE_UNSENT)
    got.pop("_write", None)
    traffic()
    _say(s, logging.INFO, "my work: %s answered %s by Python (%s)", action, got.get("status"),
         ((got.get("data") or {}).get("state") if isinstance(got.get("data"), dict) else "") or "")
    return said(got)


# ---- Settings' last tools and a signed packet attached --------------------------------------------------------------

def _tools_landed(action: str, raw: bytes, answer: dict[str, Any]) -> None:
    """_settings_tools_landed: the packs and slices a tool's write changes read again."""
    landed(action, raw, json.dumps(answer).encode())
    mark_dirty(resolver_invalidates(action))


async def _users_quo_enrich(user: dict[str, Any], payload: dict[str, Any], raw: bytes) -> dict[str, Any]:
    """usersQuoEnrich: the provider's contact book walked (usersQuoFetch), then matched and kept (usersQuoEnrichApply,
    a write of its own, handed the sealed book)."""
    env, why = await ask(SETTINGS_TOOLS_APP, "usersQuoFetch", payload, user)
    if env is None:
        log.warning("quo enrich: the book was not read (%s)", why)
        return {"status": 503, "message": "The Quo contact book could not be read just now. Try again in a moment."}
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        return {k: v for k, v in env.items() if k in ("status", "message")}
    wid = _new_id("usersQuoEnrich")
    answer, why = await ask(SETTINGS_TOOLS_APP, "usersQuoEnrichApply", {"prepared": env["data"]}, user, wid=wid)
    if answer is None:
        _void(SETTINGS_TOOLS_APP, wid)
        log.warning("quo enrich: not kept (%s)", why)
        return {"status": 503, "message": BACKEND_FINAL_UNWRITTEN}
    answer.pop("_write", None)
    if answer.get("status") == 200:
        _tools_landed("usersQuoEnrich", raw, answer)
    return answer


async def settings_tools(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_settings_tools for Quo Enrich, the legacy import and the contact clock; never Apps Script."""
    door = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(door)
    # away from home an action not declared safe there is the unknown action (Tenant.gs)
    if env.get("tenant"):
        return said(dict(RELAY_UNKNOWN_ACTION))
    if env.get("member") or env.get("world"):
        return said(SETTINGS_TOOLS_AWAY)
    payload = _payload(env)
    rraw = _relay_raw(env, raw)
    s = None
    if FD.is_service(raw):
        user: dict[str, Any] = dict(SERVICE)
    else:
        s = await _caller(env)
        if s is None:
            return said(dict(AUTH_ENDED))
        user = _user(s)
    if door == "usersQuoEnrich":
        traffic()
        return said(await _users_quo_enrich(user, payload, rraw))
    wid = _write_id(env, rraw) if door in SETTINGS_TOOLS_WRITES else ""
    got, _why = await ask(SETTINGS_TOOLS_APP, door, payload, user, wid=wid, people=0.0 if wid else FD.people_at())
    if got is None:
        if wid:
            _void(SETTINGS_TOOLS_APP, wid)
        _say(s, logging.WARNING, "settings tools: %s not answered by Python — said 503, never handed to Apps Script",
             door)
        return said({"status": 503, "message": BACKEND_FINAL_UNWRITTEN} if wid else SETTINGS_TOOLS_UNREAD)
    got.pop("_write", None)
    if wid and got.get("status") == 200:
        _tools_landed(door, rraw, got)
    traffic()
    return said(got)


async def python_tool(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_python_tool_door for a signed packet attached: its prepare read first as the caller, then its write kept under
    its own id."""
    action = str(env.get("action") or "")
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    user = _user(s)
    # what the relay alone hands Python is never taken from the browser
    payload = {k: v for k, v in _payload(env).items() if k not in ("prepared", "walk")}
    app_id, prepare, field = PYTHON_TOOL_DOORS[action]
    if prepare and (not field or payload.get(field)):
        ready, why = await ask(app_id, prepare, payload, user)
        if ready is None:
            _say(s, logging.WARNING, "%s: its prepare not answered by Python (%s) — said 503", action, why)
            return said(PYTHON_TOOL_UNANSWERED)
        if ready.get("status") != 200 or not isinstance(ready.get("data"), dict):
            return said({k: v for k, v in ready.items() if k in ("status", "message", "data")})
        payload = {**{k: v for k, v in payload.items() if k != field}, "prepared": ready["data"]}
        if field:
            payload[field] = "kept"
    wid = _write_id(env, raw[:4096])
    answer, why = await ask(app_id, action, payload, user, wid=wid)
    if answer is None:
        _say(s, logging.WARNING, "%s: not answered by Python (%s) — said 503", action, why)
        return said(PYTHON_TOOL_UNANSWERED)
    answer.pop("_write", None)
    if answer.get("status") == 200:
        landed(action, _relay_raw(env, raw), json.dumps(answer).encode())
    traffic()
    return said(answer)


# ---- the papers filed in Drive as asatech ---------------------------------------------------------------------------

async def cert_doc_upload(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_cert_papers: every refusal from Python's plan before Drive, the paper filed as asatech, its ledger row kept by
    Python. Its reading is the certificate lane's (the cert-reads keeper), which takes up every pending row."""
    if FD.is_service(raw):
        return said(dict(ADMIN_ONLY))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    b64 = payload.get("base64") if isinstance(payload.get("base64"), str) else ""
    ask_ = {k: payload.get(k) for k in ("req_id", "cert", "person", "filename", "mime") if k in payload}
    ask_["b64_chars"] = len(b64)
    plan, _why = await ask(CERT_PAPERS_APP, "certDocUploadPlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "cert papers: the filing's plan not answered by Python — said 503, never handed to "
                                 "Apps Script")
        return said(CERT_PAPERS_UNFILED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(decode_paper, b64, str(data.get("mime") or ""))
        filed = await asyncio.to_thread(file_paper, blob, data)
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("cert papers: nothing filed — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("cert papers: nothing filed — Drive did not take the paper (%s)", type(exc).__name__)
        return said(CERT_PAPERS_UNFILED)
    wid = _write_id(env, f"{filed['file_id']}|".encode())
    answer = await _keep_twice(CERT_PAPERS_APP, "certDocUpload", {**ask_, "filed": filed}, user, wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void(CERT_PAPERS_APP, wid)
        log.warning("cert papers: Drive file %s was filed but its ledger row was not kept (%s) — an orphan file",
                    filed["file_id"], "Python did not answer" if answer is None else answer.get("status"))
        return said(CERT_PAPERS_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    out = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    token = str(env.get("token") or "")
    rung = {k: out.get(k) for k in ("person", "req_id", "cert") if out.get(k)}
    landed("certDocUpload", _rung_raw(token, "certDocUpload", rung), json.dumps({**answer, "status": 200}).encode())
    traffic()
    if out.pop("read_owed", False):
        _say(s, logging.INFO, "cert papers: %s waits for the certificate lane's reading", out.get("id"))
    _say(s, logging.INFO, "cert papers: a paper filed as asatech and its ledger row kept by Python (%s)",
         "read" if out.get("read_state") == "pending" else "no reading owed")
    return said(answer)


async def family_doc_add(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_family_papers: with a file, Python's plan, the paper filed in <root>/Families/<name> as asatech and its row kept
    in Families' registry; a Drive link alone goes on as the write it is (front_door.write)."""
    payload = _payload(env)
    b64 = payload.get("base64") if isinstance(payload.get("base64"), str) else ""
    token = str(env.get("token") or "")
    if not b64:
        s0 = await FD.session(token) if token else None
        return await FD.write("familyProfileDocAdd", "family", env, _relay_raw(env, raw), s0)
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    user = _user(s)
    ask_ = {k: payload.get(k) for k in ("family", "mime", "filename", "title") if k in payload}
    plan, _why = await ask("family", "familyDocPlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "family papers: the filing's plan not answered by Python — said 503, never handed to "
                                 "Apps Script")
        return said(CERT_PAPERS_UNFILED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(decode_paper, b64, str(data.get("mime") or ""))
        filed = await asyncio.to_thread(file_paper, blob, data)
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("family papers: nothing filed — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("family papers: nothing filed — Drive did not take the paper (%s)", type(exc).__name__)
        return said(CERT_PAPERS_UNFILED)
    wid = _write_id(env, f"{filed['file_id']}|".encode())
    body = {"family": data.get("family") or payload.get("family"), "title": payload.get("title") or "",
            "doc_type": payload.get("doc_type") or "", "filed": filed}
    answer = await _keep_twice("family", "familyProfileDocAdd", body, user, wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void("family", wid)
        log.warning("family papers: Drive file %s was filed but its row was not kept (%s) — an orphan file",
                    filed["file_id"], "Python did not answer" if answer is None else answer.get("status"))
        return said(CERT_PAPERS_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    # the family member's copies and the index are read again, as any final write rings them
    landed("familyProfileDocAdd", _rung_raw(token, "familyProfileDocAdd", {"family": body["family"]}),
           json.dumps({**answer, "status": 200}).encode())
    traffic()
    _say(s, logging.INFO, "family papers: a paper filed as asatech and its row kept in Families' registry by Python")
    return said(answer)


async def calendar_day_file(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_calendar_files: Python's plan, the file filed as asatech, the row kept in app.calendar_files."""
    if FD.is_service(raw):
        return said(dict(ADMIN_ONLY))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    b64 = str(payload.get("base64") or "")
    ask_ = {k: payload.get(k) for k in ("date", "filename", "mime") if k in payload}
    ask_["b64_chars"] = len(b64)
    plan, _why = await ask(CALENDAR_APP, "calendarDayFilePlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "calendar files: the plan not answered by Python — said 503, never handed to Apps "
                                 "Script")
        return said(CALENDAR_UNFILED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(calendar_decode, b64)
        filed = await asyncio.to_thread(calendar_file, blob, data)
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("calendar files: nothing filed — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("calendar files: nothing filed — Drive did not take the file (%s)", type(exc).__name__)
        return said(CALENDAR_UNFILED)
    wid = _write_id(env, f"{filed['file_id']}|".encode())
    body = {"date": data.get("date"), "name": data.get("name"), "mime": data.get("mime"),
            "held": data.get("held") or "", "filed": filed}
    answer = await _keep_twice(CALENDAR_APP, "calendarDayFileStore", body, user, wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void(CALENDAR_APP, wid)
        log.warning("calendar files: Drive file %s was filed but its row was not kept (%s) — an orphan file",
                    filed["file_id"], "Python did not answer" if answer is None else answer.get("status"))
        return said(CALENDAR_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    token = str(env.get("token") or "")
    landed("calendarDayFileStore", _rung_raw(token, "calendarDayFileStore", {"date": body["date"]}),
           json.dumps({**answer, "status": 200}).encode())
    traffic()
    _say(s, logging.INFO, "calendar files: a day file filed as asatech and its row kept by Python (%s)",
         "private" if body["held"] else "shared by link")
    return said(answer)


async def library_upload(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_library_upload: Python's plan, the file stored in <platform folder>/Library Files as asatech, its row kept in
    app.library_uploads."""
    if FD.is_service(raw):
        return said(dict(ADMIN_ONLY))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    b64 = str(payload.get("base64") or "")
    ask_ = {k: payload.get(k) for k in ("filename", "mime_type") if k in payload}
    ask_["b64_chars"] = len(b64)
    plan, _why = await ask(TEAM_BOARD_APP, "libraryUploadPlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "library upload: the plan not answered by Python — said 503, never handed to Apps "
                                 "Script")
        return said(LIBRARY_UNSTORED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(library_decode, b64, int(data.get("max_bytes") or 0))
        file_id = await asyncio.to_thread(library_file, blob, data)
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("library upload: nothing stored — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("library upload: nothing stored — Drive did not take the file (%s)", type(exc).__name__)
        return said(LIBRARY_UNSTORED)
    wid = _write_id(env, f"{file_id}|".encode())
    body = {"file_id": file_id, "file_name": data.get("file_name"), "drive_name": data.get("drive_name"),
            "mime_type": data.get("mime_type"), "size_bytes": len(blob)}
    answer = await _keep_twice(TEAM_BOARD_APP, "libraryUploadKeep", body, user, wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void(TEAM_BOARD_APP, wid)
        log.warning("library upload: Drive file %s was stored but its row was not kept (%s) — an orphan file",
                    file_id, "Python did not answer" if answer is None else answer.get("status"))
        return said(LIBRARY_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    traffic()
    _say(s, logging.INFO, "library upload: a file stored as asatech and its row kept by Python")
    return said(answer)


async def doc_room(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_doc_room_door: a store or a trash in a Drive reading room, decided by Python, carried out as asatech, kept by
    Python."""
    action = str(env.get("action") or "")
    if action == "docRoomTrash" and _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    upload = action == "docRoomUpload"
    b64 = str(payload.get("base64") or "") if upload else ""
    ask_ = ({"room": payload.get("room"), "filename": payload.get("filename"), "mime": payload.get("mime"),
             "b64_chars": len(b64)} if upload else {"room": payload.get("room"), "id": payload.get("id")})
    plan, _why = await ask(AUDIT_LIBRARY_APP, "docRoomUploadPlan" if upload else "docRoomTrashPlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "doc room: the verdict not answered by Python — said 503, never handed to Apps Script")
        return said(DOC_ROOM_UNDONE)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(library_decode, b64, int(data.get("max_bytes") or 0)) if upload else None
        made = await asyncio.to_thread(doc_room_change, data, blob)
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("doc room: nothing changed — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("doc room: nothing changed — Drive refused (%s)", type(exc).__name__)
        return said({"status": 502, "message": "Drive refused the " + ("upload" if upload else "trash") + "."})
    wid = _write_id(env, f"{made.get('id')}|".encode())
    body = {"room": data.get("room"), "action": "upload" if upload else "trash", "id": made.get("id"),
            "name": made.get("name"), "mime": made.get("mimeType"), "size": made.get("size"),
            "modified_time": made.get("modifiedTime"), "web_view_link": made.get("webViewLink")}
    answer, _why = await ask(AUDIT_LIBRARY_APP, "docRoomKeep", body, user, wid=wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void(AUDIT_LIBRARY_APP, wid)
        log.warning("doc room: Drive changed %s but the event was not kept (%s)", made.get("id"),
                    "Python did not answer" if answer is None else answer.get("status"))
        return said(DOC_ROOM_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    traffic()
    _say(s, logging.INFO, "doc room: a %s in %s carried out as asatech and kept by Python", body["action"],
         data.get("room"))
    return said(answer)


async def ist_paper(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_ist_paper_door: the verdict and the record's link Python's, the paper filed as asatech (Compliance Docs/IST)."""
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    f = payload.get("file") if isinstance(payload.get("file"), dict) else payload
    b64 = str(f.get("base64") or f.get("b64") or f.get("data")
              or (payload.get("file") if isinstance(payload.get("file"), str) else "") or "")
    b64 = re.sub(r"^data:[^,]*,", "", b64)
    ask_ = {"house": payload.get("house"), "staff": payload.get("staff"), "client": payload.get("client"),
            "filename": f.get("filename") or f.get("name"), "mime": f.get("mime") or f.get("type"),
            "b64_chars": len(b64)}
    plan, _why = await ask(IST_APP, "locationIstFilePlan", ask_, user)
    if plan is None:
        _say(s, logging.WARNING, "ist paper: the verdict not answered by Python — said 503, never handed to Apps "
                                 "Script")
        return said(IST_PAPER_UNFILED)
    if plan.get("status") != 200 or not isinstance(plan.get("data"), dict):
        return said(plan)
    data = plan["data"]
    try:
        blob = await asyncio.to_thread(decode_paper, b64, str(data.get("mime") or ""))
        filed = await asyncio.to_thread(file_paper, blob, {k: data[k] for k in ("platform_root", "folder", "name",
                                                                              "mime")})
    except Refused as no:
        return said({"status": 400, "message": str(no)})
    except NoOwner as no:
        log.warning("ist paper: nothing filed — no Drive client acts as the platform's own account (%s)", no)
        return said(CERT_PAPERS_NO_OWNER)
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("ist paper: nothing filed — Drive refused (%s)", type(exc).__name__)
        return said({"status": 502, "message": "Drive refused the upload."})
    wid = _write_id(env, f"{filed['file_id']}|".encode())
    answer, _why = await ask(IST_APP, "locationIstFileKeep", {**ask_, "file_id": filed["file_id"]}, user, wid=wid)
    if answer is None or answer.get("status") != 200:
        if answer is None:
            _void(IST_APP, wid)
        log.warning("ist paper: Drive holds %s but its record was not updated (%s)", filed["file_id"],
                    "Python did not answer" if answer is None else answer.get("status"))
        return said(IST_PAPER_UNKEPT if answer is None or int(answer.get("status") or 500) >= 500 else answer)
    answer.pop("_write", None)
    traffic()
    _say(s, logging.INFO, "ist paper: filed in Drive as asatech and kept on its record by Python")
    return said(answer)


# ---- the sweeps a person presses ------------------------------------------------------------------------------------

async def _inbound_run(ask_: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    """commsInboundRun_: commsInboundFetch reads as the person, commsInboundKeep files as the service; None when Python
    did not answer."""
    read, _why = await ask(OPT_OUTS_APP, "commsInboundFetch", ask_, user)
    if read is None:
        return None
    data = read.get("data") if isinstance(read.get("data"), dict) else None
    if read.get("status") != 200 or data is None:
        return read
    if isinstance(data.get("answer"), dict):
        return data["answer"]
    wid = _new_id("inbound")
    answer, _why = await ask(OPT_OUTS_APP, "commsInboundKeep", {"run": data.get("run") or {}}, dict(SERVICE), wid=wid)
    if answer is None:
        _void(OPT_OUTS_APP, wid)
        return None
    answer.pop("_write", None)
    return answer


async def inbound_sweep(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_inbound_door: commsInboundSweep pressed by a person (one cursor, one filer)."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(ADMIN_ONLY))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    answer = await _inbound_run({"mode": "sweep", "restart": _payload(env).get("restart")}, _user(s, email=s.uid))
    if answer is None:
        return said(INBOUND_UNREAD)
    if answer.get("status") == 200:
        smart_comms_rang("commsInboundSweep", _relay_raw(env, raw), json.dumps(answer).encode())
    traffic()
    return said(answer)


async def isp_contacts_sweep(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_isp_contacts_door: each pass read by ispContactsFetch as the person who asked and kept by ispContactsKeep,
    again while the plans are not all read."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(ADMIN_ONLY))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    ask_: dict[str, Any] = {"client_key": payload.get("client_key"), "redo": payload.get("redo")}
    answer: dict[str, Any] | None = {"status": 200, "data": {}}
    for _ in range(ISP_CONTACTS_PASSES):
        read, _why = await ask(CLIENT_CARE_APP, "ispContactsFetch", ask_, user)
        if read is None:
            return said(ISP_INTAKE_UNREAD)
        if read.get("status") != 200 or not isinstance(read.get("data"), dict):
            return said(read)
        wid = _new_id("isp-contacts")
        answer, _why = await ask(CLIENT_CARE_APP, "ispContactsKeep", {**read["data"], "by": s.uid}, dict(SERVICE),
                                 wid=wid)
        if answer is None:
            _void(CLIENT_CARE_APP, wid)
            return said(ISP_INTAKE_UNREAD)
        answer.pop("_write", None)
        out = answer.get("data") if isinstance(answer.get("data"), dict) else {}
        if answer.get("status") != 200 or not out.get("more"):
            break
        ask_ = {**ask_, "from": out.get("next"), "tally": out}
    traffic()
    return said(answer)


async def isp_intake(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_isp_intake_door: ispIntakeSweep, ispIntakeRedo and clientProfileIspSections — the plan read by one call, filed
    by the next."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    payload = _payload(env)
    s = None
    if FD.is_service(raw):
        user: dict[str, Any] = dict(SERVICE)
    else:
        s = await _caller(env)
        if s is None:
            return said(dict(AUTH_ENDED))
        if _away(env):
            return said(LOCATION_MEDS_AWAY)
        user = _user(s, email=s.uid)
    ask_ = {"mode": ISP_INTAKE_DOORS[action], "only": str(payload.get("source_file") or ""),
            "client": str(payload.get("client") or "")}
    read, _why = await ask(ISP_APP, "ispIntakeFetch", ask_, user)
    if read is None:
        _say(s, logging.WARNING, "isp intake: %s not read by Python — said 503, never handed to Apps Script", action)
        return said(ISP_INTAKE_UNREAD)
    if read.get("status") != 200 or not isinstance(read.get("data"), dict):
        return said(read)
    items = read["data"].get("items") or []
    if not items:
        return said(read["data"].get("answer") or {"status": 200, "data": {}})
    wid = _write_id(env, f"{action}|".encode())
    answer, _why = await ask(ISP_APP, "ispIntakeKeep", {"items": items, "asked": bool(read["data"].get("asked")),
                                                         "by": user.get("email", "")}, dict(SERVICE), wid=wid)
    if answer is None:
        _void(ISP_APP, wid)
        return said(ISP_INTAKE_UNREAD)
    answer.pop("_write", None)
    traffic()
    mark_dirty(("isps",))
    return said(answer)


async def _people_sync_python(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """_people_sync_python: pass after pass while the door hands rows back, each pass its own final write; the passes'
    summed answer, or the one that stopped them. The ingest gate holds it as the clocks' doors are held."""
    import clocks  # noqa: PLC0415

    why = clocks.ingest_hold("peopleSyncFromPlatform", await clocks.config_lane())
    if why:
        return {"status": 409, "message": str(why), "held": True}
    left = payload.get("rows")
    done = {k: 0 for k in ("updated", "inserted", "unchanged", "foreign", "unnamed", "refused", "writes", "received")}
    named: list[str] = []
    for _ in range(CONTACTS_SYNC_PASSES):
        wid = _new_id("contacts-sync")
        env, why = await ask(CONTACTS_SYNC_APP, "peopleSyncFromPlatform", {**payload, "rows": left}, user, wid=wid)
        if env is None:
            _void(CONTACTS_SYNC_APP, wid)
            return {"status": 503, "message": f"Python did not answer ({why})"}
        data = env.get("data") or {}
        if env.get("status") != 200 or data.get("skipped"):
            return env
        for k in done:
            done[k] += int(data.get(k) or 0)
        named = (named + list(data.get("refused_named") or []))[:40]
        left = data.get("left") or []
        if not left:
            traffic()
            return {"status": 200, "data": {**done, "refused_named": named,
                                            "source_at": str(payload.get("source_at") or "")}}
    return {"status": 503, "message": f"{len(left)} roster row(s) not reached in {CONTACTS_SYNC_PASSES} passes"}


async def people_sync(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_people_sync_door: the platform's contact list an admin hands over from Settings, pass by pass; a session away
    in another place names no door (doPost's unknown action)."""
    if FD.is_service(raw) or _away(env):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    synced = await _people_sync_python(_payload(env), _user(s))
    data = synced.get("data") if isinstance(synced.get("data"), dict) else {}
    if data.get("updated") or data.get("inserted"):
        mark_dirty(("people",))
    return said(synced)


async def _backend_pass(app_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
    """One write of a relay-rung Smart Comms door, as the service; its answer, or a 503 saying why there was none."""
    wid = _new_id(app_id)
    env, why = await ask(app_id, action, payload, dict(SERVICE), wid=wid)
    if env is None:
        _void(app_id, wid)
        return {"status": 503, "message": f"Python did not answer ({why})"}
    traffic()
    return env


async def comm_window_ask(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_comm_window_ask_door: the look (commWindowAskPlan), then its plans kept pass by pass (commWindowAskKeep)
    inside the sweep's own budget; an admin's, or the service's."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if not FD.is_service(raw):
        s = await _caller(env)
        if s is None or s.role.strip().lower() != "admin":
            return said(dict(ADMIN_ONLY))
    payload = _payload(env)
    force = payload.get("force") is True or str(payload.get("force")) == "true"
    read, _why = await ask(COMM_WINDOW_ASK_APP, "commWindowAskPlan", {"force": force}, dict(SERVICE))
    if not read or read.get("status") != 200 or not isinstance(read.get("data"), dict):
        return said({"status": 503, "message": "The window ask could not be asked just now. Try again in a moment."})
    plan = read["data"]
    if not plan.pop("due", False):
        return said({"status": 200, "data": plan})
    plans, tally, first = plan.get("plans") or [], {}, True
    started = time.monotonic()
    while True:
        last = time.monotonic() - started > COMM_WINDOW_ASK_BUDGET_S
        kept = await _backend_pass(COMM_WINDOW_ASK_APP, "commWindowAskKeep",
                                   {"run": plan.get("run"), "plans": plans, "first": first,
                                    "stamp": plan.get("stamp") is True, "last": last, "tally": tally})
        if kept.get("status") != 200:
            return said(kept)
        out = kept.get("data") or {}
        first = False
        plans, tally = out.pop("left", None) or [], out.pop("tally", None) or tally
        if not plans or last:
            return said({"status": 200, "data": out})


# ---- the AI lane test -----------------------------------------------------------------------------------------------

def _ai_key_stress_rounds(payload: dict[str, Any]) -> int:
    try:
        n = float(payload.get("rounds") or AI_KEY_STRESS_ROUNDS[0])
    except (TypeError, ValueError):
        n = AI_KEY_STRESS_ROUNDS[0]
    return int(min(round(n), AI_KEY_STRESS_ROUNDS[1])) if n >= 1 else AI_KEY_STRESS_ROUNDS[0]


async def _analyze_leg(body: dict[str, Any]) -> tuple[int, str]:
    """One round of the leg: this app's /analyze, in-process, as its route answers it."""
    try:
        return 200, analyze.rendered(await analyze.answer(body)).decode("utf-8")
    except Exception:  # noqa: BLE001 - the route's own 500
        return 500, "Internal Server Error"


async def ai_key_stress(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """_ai_key_stress_door: the leg asked here, where the secret lives, each round's answer handed to Python
    (app/ai_key_stress.py), which asks the ladder's keys and grades both."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    if FD.is_service(raw):
        return said(dict(RELAY_UNKNOWN_ACTION))
    s = await _caller(env)
    if s is None:
        return said(dict(AUTH_ENDED))
    if _away(env):
        return said(LOCATION_MEDS_AWAY)
    payload = _payload(env)
    user = _user(s)
    leg: list[dict[str, Any]] = []
    why = ""
    if str(user["role"]) != "admin":
        why = "not asked for a caller the test refuses"
    elif not SERVICE_SECRET:
        why = "no HUB_SERVICE_SECRET"
    else:
        rounds = _ai_key_stress_rounds(payload)
        body = {"service_secret": SERVICE_SECRET, "temperature": 0.2, "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": AI_KEY_STRESS_PROMPT}]}
        for r in range(rounds):
            started = time.monotonic()
            code, text = await _analyze_leg(body)
            leg.append({"code": code, "body": text, "ms": int((time.monotonic() - started) * 1000)})
            if r < rounds - 1:
                await asyncio.sleep(AI_KEY_STRESS_GAP_S)
    got, why_not = await ask(GUARDIAN_APP, "aiKeyStress",
                             {**payload, "relay_leg": leg, "relay_url": AI_KEY_STRESS_SELF, "relay_why": why}, user)
    if got is None:
        _say(s, logging.WARNING, "ai key stress: Python did not answer (%s) — said 503, never handed to Apps Script",
             why_not)
        return said({"status": 503, "message": "The AI lane test did not answer — try again in a moment."})
    return said(got)


# ---- the reads the relay handed its own record, or composed --------------------------------------------------------

async def _read_session(env: dict[str, Any]) -> tuple[FD.Session | None, dict[str, Any] | None]:
    """_backend_answer's session: no session, or one the sign-in ended, its 401; one not told just now its 503."""
    token = str(env.get("token") or "")
    if not token:
        return None, dict(AUTH_ENDED)
    s = await FD.session(token)
    if s is None:
        return None, dict(BACKEND_UNREAD)
    if not s.ok:
        return None, dict(AUTH_ENDED)
    return s, None


async def relay_record_read(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """shopPurchases and inventoryPharmacy: Python's read handed the record the relay read (now read here,
    app/service_records.py), then the front door's own read and finish."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    s, refused = await _read_session(env)
    if refused is not None:
        return said(refused)
    import service_records as SR  # noqa: PLC0415

    record = SR.shopper_purchases_env if action == "shopPurchases" else SR.inventory_meds_env
    relayed = await run_in_threadpool(record)
    asked = {**env, "payload": {**_payload(env), "relayed": relayed}}
    return await FD.read(action, FD.READS[action], asked, _relay_raw(env, raw), s)


async def _policies_import(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """policiesImport: the folder read and its originals kept (policiesFetch), then both resources rewritten
    (policiesKeep, a write of its own), answered as Policies.gs answered."""
    env, why = await ask(POLICIES_APP, "policiesFetch", payload, user)
    if env is None:
        log.warning("policies import: the folder was not read (%s)", why)
        return {"status": 503, "message": "The policies folder could not be read just now. Try again in a moment."}
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        return {k: v for k, v in env.items() if k in ("status", "message")}
    data = env["data"]
    kenv, why = await ask(POLICIES_APP, "policiesKeep", {k: data.get(k) for k in ("policies", "contacts", "files")},
                          user, wid=_new_id("policiesImport"))
    if kenv is None or kenv.get("status") != 200:
        log.warning("policies import: not kept (%s)", why if kenv is None else kenv.get("status"))
        return {"status": 503, "message": "The policies were read but could not be saved just now, and nothing was "
                                          "changed. Try again in a moment."}
    mark_dirty(("policies", "contactLists"))
    n = kenv.get("data") or {}
    log.info("policies import: %s", json.dumps(n, separators=(",", ":"))[:200])
    return {"status": 200, "data": {"imported": len(data.get("titles") or []), "titles": data.get("titles") or [],
                                    "policy_rows": n.get("policy_rows", 0), "contact_rows": n.get("contact_rows", 0),
                                    "skipped": data.get("skipped") or []}}


async def resource_rows_upload(app_id: str, door: str) -> None:
    """_resource_rows_upload: the app's sheets uploaded into Postgres again from asa-hub-db's copy (rows nothing there
    has touched), its slices built again, and the files its rows link brought onto the server. Never raises."""
    try:
        import clocks  # noqa: PLC0415
        import live_slices  # noqa: PLC0415

        env, why = await ask(app_id, door, {}, dict(SERVICE), wid=_new_id(door))
        if env is None or env.get("status") != 200:
            log.warning("resource rows: %s not uploaded again (%s)", app_id, why if env is None else env.get("status"))
            return
        done = env.get("data") if isinstance(env.get("data"), dict) else {}
        log.info("resource rows: %s uploaded again %s", app_id, done)
        mark_dirty(tuple(r for r in done if r in live_slices.SLICE_DOORS))
        clocks.drive_intake_kick(app_id)
    except Exception as exc:  # noqa: BLE001 - the rows Postgres holds stand
        log.warning("resource rows: %s not uploaded again (%s)", app_id, type(exc).__name__)


async def _truelink_sync(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """truelinkSync: the automation asked (truelinkSync), its run recorded (truelinkRunKeep, a write of its own), and
    after a live run the ledger's tab uploaded again so the rows the bot added reach Postgres."""
    env, _why = await ask(FINANCE_APP, "truelinkSync", payload, user)
    if env is None:
        return {"status": 503, "message": "The TrueLink sync could not be asked just now. Try again in a moment."}
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        return {k: v for k, v in env.items() if k in ("status", "message")}
    data = env["data"]
    kenv, _why = await ask(FINANCE_APP, "truelinkRunKeep", copy.deepcopy(data), user, wid=_new_id("truelinkRunKeep"))
    if kenv is None or kenv.get("status") != 200:
        data["run_row_refused"] = "the run's record could not be kept just now"
    if not data.get("dryRun"):
        keep_task(resource_rows_upload(FINANCE_APP, "financeUpload"))
    return {"status": 200, "data": data}


async def composed_read(env: dict[str, Any], raw: bytes, _request: Any) -> Response:
    """policiesImport and truelinkSync: the halves composed here for the verified session, then the front door's
    finish (the answer loop's observers), as gas_relay ran them."""
    action = str(env.get("action") or "")
    if _oversized(env, raw):
        return _unknown(action)
    s, refused = await _read_session(env)
    if refused is not None:
        return said(refused)
    payload = FD.builder_payload(action, env, _payload(env))
    user = FD.said(s, env, action)
    answer = await (_policies_import(user, payload) if action == "policiesImport" else _truelink_sync(user, payload))
    content = json.dumps(answer).encode()
    meta = {"kind": "read", "action": action, "door": action, "app_id": FD.READS[action],
            "quiet": FD._quiet(action, s), "said": True}  # noqa: SLF001
    fin = await FD.finish(meta, _relay_raw(env, raw), content)
    return FD._kept(fin, content)  # noqa: SLF001


# ---- the rungs ------------------------------------------------------------------------------------------------------

RUNGS: dict[str, Callable[[dict[str, Any], bytes, Any], Awaitable[Response]]] = {
    **{a: location_meds for a in LOCATION_MEDS_MINE},
    **{a: emergency_contacts for a in ("emergencyContactsRead", "emergencyContactsSave")},
    **{a: bundle_python for a in BUNDLE_PYTHON_ACTIONS},
    **{a: mar_papers for a in MAR_PAPERS_ACTIONS},
    "myWorkTimeOffMessage": my_work_message,
    **{a: settings_tools for a in SETTINGS_TOOLS_MINE},
    **{a: python_tool for a in PYTHON_TOOL_DOORS},
    "certDocUpload": cert_doc_upload,
    "familyProfileDocAdd": family_doc_add,
    "calendarDayFileStore": calendar_day_file,
    "libraryUpload": library_upload,
    "docRoomUpload": doc_room, "docRoomTrash": doc_room,
    "locationIstFile": ist_paper,
    "commsInboundSweep": inbound_sweep,
    "ispContactsSweep": isp_contacts_sweep,
    **{a: isp_intake for a in ISP_INTAKE_DOORS},
    "peopleSyncFromPlatform": people_sync,
    "commWindowAskSweep": comm_window_ask,
    "aiKeyStress": ai_key_stress,
    **{a: relay_record_read for a in RELAY_RECORD_ACTIONS},
    **{a: composed_read for a in COMPOSED_READS},
}


def install(app: Any, main: Any) -> None:
    """The rungs on the front door, with main.py's doors, and POST /analyze on main.py's app."""
    global M
    M = main
    for action, rung in RUNGS.items():
        FD.RUNGS[action] = rung
    analyze.install(app)
    log.info("door rungs: %d /gas rungs answered here, and /analyze", len(RUNGS))
