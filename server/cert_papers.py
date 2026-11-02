"""TRAINING AND COMPLIANCE PAPERS, FILED IN DRIVE AS THE PLATFORM'S OWN ACCOUNT, AND READ AT ONCE.
asa-hub-app decides whose record a paper goes on and keeps its ledger row (certDocUploadPlan, certDocUpload). This side
files the paper in <platform root>/Compliance Docs/<label> as asatech@asalifecare.com, through the Drive-only token
asatech granted (server/.asatech-drive.json, made by tools/asatech_drive_consent.py). It then reads it with the
certificate lane's own steps (cert_reads.read_one) and keeps the reading in app.cert_reads, where asa-hub-app lays the
verdict over the ledger. A reading that fails is kept with the row's own line, and the lane tries it again."""
from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

log = logging.getLogger("hub.cert_papers")

# the account every platform file is created as; a Drive client acting as any other is never used to file
OWNER = "asatech@asalifecare.com"
TOKEN_FILE = os.getenv("HUB_ASATECH_DRIVE_FILE",
                       os.path.join(os.path.dirname(os.path.abspath(__file__)), ".asatech-drive.json"))
FOLDER = "Compliance Docs"
FOLDER_MIME = "application/vnd.google-apps.folder"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
TOKEN_URI = "https://oauth2.googleapis.com/token"
# ComplianceDocs.gs CERT_DOC_MAX_BYTES and CERT_DOC_TYPES
MAX_BYTES = 15 * 1024 * 1024
B64_MAX = 21000000
TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
         "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}
TYPE_WORDS = "Images and PDFs only — a PDF, or a PNG, JPEG, GIF, WebP or HEIC picture."
OWNER_HOLD_S = 1800.0
# the lane leaves a paper being read here alone this long before it takes it up itself
READ_HOLD_S = 600.0
# test hook: the owner's Drive
OWNER_FACTORY: Callable[[], Any] | None = None


class Refused(ValueError):
    """The paper itself is refused (a 400), in the door's words; nothing was filed."""


class NoOwner(RuntimeError):
    """No Drive client acting as the platform's own account: nothing is filed as anyone else."""


_OWNER_HELD: dict[str, Any] = {"at": 0.0, "v": None}
_FOLDER_LOCK = threading.Lock()


def owner_drive() -> Any:
    """Drive acting as asatech through its Drive-only token, proved by asking Drive who it is; NoOwner otherwise."""
    if OWNER_FACTORY is not None:
        return OWNER_FACTORY()
    if _OWNER_HELD["v"] is not None and time.monotonic() - _OWNER_HELD["at"] < OWNER_HOLD_S:
        return _OWNER_HELD["v"]
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError) as exc:
        raise NoOwner(f"the platform account's Drive token is not on this server ({type(exc).__name__})") from None
    from google.oauth2.credentials import Credentials  # noqa: PLC0415
    from googleapiclient.discovery import build  # noqa: PLC0415
    creds = Credentials(None, refresh_token=c.get("refresh_token"), client_id=c.get("client_id"),
                        client_secret=c.get("client_secret"), token_uri=TOKEN_URI, scopes=[DRIVE_SCOPE])
    try:
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        who = str(((drive.about().get(fields="user(emailAddress)").execute() or {}).get("user") or {})
                  .get("emailAddress") or "").strip().lower()
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry a token
        raise NoOwner(f"the platform account's Drive token was refused ({type(exc).__name__})") from None
    if who != OWNER:
        raise NoOwner("the Drive token acts as another account")
    _OWNER_HELD.update(v=drive, at=time.monotonic())
    return drive


def _q(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def child_folder(drive: Any, parent: str, name: str) -> str:
    """filesChildByName_: the folder of this name under the parent, else one made there."""
    got = drive.files().list(
        q=f"'{_q(parent)}' in parents and name = '{_q(name)}' and mimeType = '{FOLDER_MIME}' and trashed = false",
        fields="files(id)", pageSize=10, orderBy="createdTime", supportsAllDrives=True,
        includeItemsFromAllDrives=True).execute()
    files = got.get("files") or []
    if files:
        return str(files[0]["id"])
    made = drive.files().create(body={"name": name, "mimeType": FOLDER_MIME, "parents": [parent]}, fields="id",
                                supportsAllDrives=True).execute()
    return str(made["id"])


def decode(b64: str, mime: str) -> bytes:
    """The paper's bytes, its type and size checked again: Refused in the door's words."""
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


def _upload(drive: Any, folder: str, name: str, mime: str, data: bytes) -> dict[str, Any]:
    from googleapiclient.http import MediaIoBaseUpload  # noqa: PLC0415
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=len(data) > 5 * 1024 * 1024)
    return drive.files().create(body={"name": name, "parents": [folder]}, media_body=media,
                                fields="id,name,mimeType,size", supportsAllDrives=True).execute()


def file(data: bytes, plan: dict[str, Any]) -> dict[str, Any]:
    """complianceDocsStore_'s Drive half: the paper in <platform root>/Compliance Docs/<label> as asatech, and the
    courtesy copy in the shared archive (never fatal, never in test mode)."""
    drive = owner_drive()
    with _FOLDER_LOCK:
        # a family member's paper names its own top folder (Families); a certificate is under Compliance Docs
        top = str(plan.get("top") or FOLDER)
        home = child_folder(drive, child_folder(drive, str(plan["platform_root"]), top), str(plan["folder"]))
    made = _upload(drive, home, str(plan["name"]), str(plan["mime"]), data)
    file_id = str(made.get("id") or "")
    if not file_id:
        raise RuntimeError("Drive named no file")
    shared = False
    if plan.get("shared_copy") is True and plan.get("shared_folder"):
        try:
            _upload(drive, str(plan["shared_folder"]), str(plan["name"]), str(plan["mime"]), data)
            shared = True
        except Exception as exc:  # noqa: BLE001 — a courtesy copy never costs the filing
            log.info("cert papers: the shared copy of %s was not made (%s)", file_id, type(exc).__name__)
    return {"file_id": file_id, "url": f"https://drive.google.com/file/d/{file_id}/view", "name": str(plan["name"]),
            "mime": str(plan["mime"]), "size": len(data), "shared": shared}


def read_now(line: dict[str, Any]) -> str:
    """The filed paper's reading, made at once by the certificate lane's own steps and kept in app.cert_reads; a
    failure is kept with the row's own line, which the lane reads again. Answers read / failed / unkept."""
    import cert_reads as CRD  # noqa: PLC0415 — the lane's store, its books and its reader
    import mar_papers as MP  # noqa: PLC0415
    import psycopg2.extras  # noqa: PLC0415
    row_id, file_id = str(line.get("id") or ""), str(line.get("file_id") or "")
    if not CRD.DSN or not row_id or not file_id:
        return "unkept"
    snap = psycopg2.extras.Json({"line": line})
    now = datetime.now(timezone.utc)
    try:
        conn = MP._connect(CRD.DSN)
    except Exception as exc:  # noqa: BLE001 — the row stays pending on the ledger; said
        log.warning("cert papers: %s not kept for reading (%s)", row_id, type(exc).__name__)
        return "unkept"
    try:
        with conn, conn.cursor() as cur:
            cur.execute(f"insert into {CRD._t('cert_reads')} (row_id, file_id, reading, next_try_at, updated_at)"
                        " values (%s, %s, %s, %s, %s) on conflict (row_id) do nothing",
                        (row_id, file_id, snap, now + timedelta(seconds=READ_HOLD_S), now))
        try:
            held = CRD.books()
            roster = None
            try:
                import form_digest as fd  # noqa: PLC0415 — the roster the decoder's who-is reads
                fd.PG_DSN = fd.PG_DSN or CRD.MIRROR_DSN
                roster = fd._roster_rows(None)
            except Exception as exc:  # noqa: BLE001 — a nameless reading still reads
                log.warning("cert papers: the roster could not be read (%s)", type(exc).__name__)
            reading = CRD.read_one(owner_drive(), line, held, roster)
        except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the paper's words
            why = str(exc) if isinstance(exc, CRD.Unread) else f"the reading stopped ({type(exc).__name__})"
            CRD._failed(conn, {"row_id": row_id, "file_id": file_id, "attempts": 0}, why,
                        datetime.now(timezone.utc))
            return "failed"
        done = datetime.now(timezone.utc)
        with conn, conn.cursor() as cur:
            cur.execute(f"update {CRD._t('cert_reads')} set state = 'read', reading = %s, error = '',"
                        " attempts = attempts + 1, read_at = %s, seconds = %s, updated_at = %s"
                        " where row_id = %s and file_id = %s",
                        (psycopg2.extras.Json(reading), done, reading.get("seconds"), done, row_id, file_id))
        return "read"
    finally:
        conn.close()
