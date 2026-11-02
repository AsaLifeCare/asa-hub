"""The techDocs slice: the Technology Drive folder walked by the relay itself, one meta row then file rows."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("snapshot")

RESOURCES = ("techDocs",)

TECH_FOLDER_ID = os.getenv("TECH_DRIVE_FOLDER_ID", "14HGIPBe5KcQg6gr9Dd9wHBh_Aq1DG0PA")

# the same table TechnologyDocs.gs carried, so the badges never change spelling
_KIND_BY_EXT = {
    ".pdf": "pdf",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".doc": "word", ".docx": "word",
    ".xls": "sheet", ".xlsx": "sheet", ".csv": "sheet",
    ".md": "text", ".txt": "text",
    ".mov": "video", ".mp4": "video", ".m4v": "video", ".webm": "video",
}
_GOOGLE_KIND = {
    "application/vnd.google-apps.document": "word",
    "application/vnd.google-apps.spreadsheet": "sheet",
    "application/vnd.google-apps.presentation": "pdf",
}

_MAX_FILES = 2000
_MAX_FOLDERS = 400
_TEXT_MAX_BYTES = 2_000_000

# the walk blocks the relay loop for about a minute; between walks the slice keeps its real read time
LISTING_EVERY_S = float(os.getenv("TECH_DOCS_LISTING_EVERY_S", "900"))

# apart from _LATEST, which also holds a failed walk's meta row: a failure never holds the window shut
_LAST_GOOD: dict[str, Any] = {"rows": None, "at": 0.0, "read_at": ""}

_TEXT_DIR = Path(os.getenv("TECH_DOCS_TEXT_DIR", "/srv/snapshot/techdocs"))
_STATE_FILE = _TEXT_DIR / "state.json"

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{10,90}$")

_LATEST: list[dict] | None = None


def _drive_service():
    try:
        from google.oauth2.service_account import Credentials  # type: ignore
        from googleapiclient.discovery import build  # type: ignore

        raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        if not raw:
            return None
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:
            info = json.loads(raw)
        creds = Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/drive.readonly"])
        return build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:  # noqa: BLE001
        log.warning("technology_docs: no Drive service (%s: %s)", type(e).__name__, e)
        return None


def _kind(name: str, mime: str) -> str:
    if mime in _GOOGLE_KIND:
        return _GOOGLE_KIND[mime]
    dot = name.rfind(".")
    return _KIND_BY_EXT.get(name[dot:].lower(), "") if dot != -1 else ""


def _load_state() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text())
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    try:
        _TEXT_DIR.mkdir(parents=True, exist_ok=True)
        _STATE_FILE.write_text(json.dumps(state))
    except Exception as e:  # noqa: BLE001
        log.warning("technology_docs: state not saved (%s)", e)


def _fetch_text(svc, file_id: str, size: int, state: dict, modified: str) -> None:
    if size and size > _TEXT_MAX_BYTES:
        return
    if state.get(file_id) == modified and (_TEXT_DIR / f"{file_id}.txt").exists():
        return
    try:
        data = svc.files().get_media(fileId=file_id, supportsAllDrives=True).execute()
        _TEXT_DIR.mkdir(parents=True, exist_ok=True)
        (_TEXT_DIR / f"{file_id}.txt").write_bytes(data if isinstance(data, bytes) else bytes(data))
        state[file_id] = modified
    except Exception as e:  # noqa: BLE001
        log.warning("technology_docs: text fetch failed for %s (%s)", file_id, e)


def text_path(file_id: str) -> Path | None:
    """The id is validated here so the route never touches the filesystem with unvetted input."""
    if not _SAFE_ID.match(file_id or ""):
        return None
    p = _TEXT_DIR / f"{file_id}.txt"
    return p if p.is_file() else None


def latest_listing() -> list[dict] | None:
    if _LATEST is not None:
        return _LATEST
    for root in ("/srv/snapshot", "/opt/docker/asa-hub/web/snapshot"):
        try:
            rows = json.loads(Path(root, "techDocs.json").read_text())
            if isinstance(rows, list):
                return rows
        except Exception:
            continue
    return None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:  # noqa: ARG001
    global _LATEST

    held =_LAST_GOOD.get("rows")
    if held and (time.monotonic() - float(_LAST_GOOD.get("at") or 0.0)) < LISTING_EVERY_S:
        _LATEST = held
        return held, str(_LAST_GOOD.get("read_at") or "")

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    svc = _drive_service()
    if svc is None:
        rows = [{"id": "meta", "kind": "meta", "configured": False,
                 "reason": "GOOGLE_SERVICE_ACCOUNT_JSON is not set on the relay",
                 "updated_at": now}]
        _LATEST = rows
        return rows, now

    try:
        # supportsAllDrives on every call: a shared-drive folder answers 404 without it
        root = svc.files().get(fileId=TECH_FOLDER_ID,
                               fields="id,name,webViewLink",
                               supportsAllDrives=True).execute()
    except Exception as e:  # noqa: BLE001
        rows = [{"id": "meta", "kind": "meta", "configured": True,
                 "reason": f"the folder did not answer ({type(e).__name__})",
                 "folder_id": TECH_FOLDER_ID, "updated_at": now}]
        _LATEST = rows
        return rows, now

    state = _load_state()
    files: list[dict] = []
    truncated = False
    queue: list[tuple[str, list[str]]] = [(TECH_FOLDER_ID, [])]
    seen_folders: set[str] = {TECH_FOLDER_ID}
    walked = 0
    # A LISTING THAT FAILED IS NOT AN EMPTY FOLDER.
    failed_folders: list[str] = []
    fail_kinds: list[str] = []
    root_listed = False
    while queue and walked < _MAX_FOLDERS and not truncated:
        folder_id, trail = queue.pop(0)
        walked += 1
        page_token = None
        while True:
            try:
                resp = svc.files().list(
                    q=f"'{folder_id}' in parents and trashed=false",
                    fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
                    pageSize=1000, pageToken=page_token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True).execute()
            except Exception as e:  # noqa: BLE001
                log.warning("technology_docs: list failed under %s (%s)", folder_id, e)
                if folder_id not in failed_folders:
                    failed_folders.append(folder_id)
                if type(e).__name__ not in fail_kinds:
                    fail_kinds.append(type(e).__name__)
                break
            if folder_id == TECH_FOLDER_ID:
                root_listed = True
            for f in resp.get("files", []):
                if f.get("mimeType") == "application/vnd.google-apps.folder":
                    if f["id"] not in seen_folders:
                        seen_folders.add(f["id"])
                        queue.append((f["id"], trail + [str(f.get("name") or "")]))
                    continue
                if len(files) >= _MAX_FILES:
                    truncated = True
                    break
                name = str(f.get("name") or "")
                kind = _kind(name, str(f.get("mimeType") or ""))
                size = int(f.get("size") or 0)
                modified = str(f.get("modifiedTime") or "")
                rel = "/".join(trail + [name])
                files.append({
                    "id": str(f.get("id") or ""),
                    "kind": "file",
                    "name": name,
                    "rel": rel,
                    "category": trail[0] if trail else "",
                    "case": trail[1] if len(trail) > 1 else "",
                    "trail": " / ".join(trail),
                    "ext": kind,
                    "size_bytes": size,
                    "modified_time": modified,
                    "web_view_link": str(f.get("webViewLink") or ""),
                })
                if kind == "text":
                    _fetch_text(svc, str(f.get("id") or ""), size, state, modified)
            page_token = resp.get("nextPageToken")
            if not page_token or truncated:
                break
    _save_state(state)

    files.sort(key=lambda r: (str(r.get("category") or ""), str(r.get("rel") or "")))
    meta: dict[str, Any] = {
        "id": "meta", "kind": "meta", "configured": True,
        "folder_id": str(root.get("id") or TECH_FOLDER_ID),
        "folder_name": str(root.get("name") or ""),
        "folder_url": str(root.get("webViewLink") or ""),
        "updated_at": now,
        "truncated": truncated,
    }
    kinds = ", ".join(fail_kinds) or "no answer"
    if not root_listed:
        # the root never answered: nothing was listed, so this is a failed read, not 0 files
        meta["reason"] = f"the folder listing failed ({kinds})"
        files = []
    elif failed_folders:
        # some subfolders never answered: every file counted is real, but not every file was counted
        meta["partial"] = True
        meta["partial_reason"] = f"{len(failed_folders)} of {walked} folder listing(s) failed ({kinds})"
    rows: list[dict] = [meta] + files
    # only a complete walk holds the window shut; a failed or partial one is walked again next build
    if root_listed and not failed_folders:
        _LAST_GOOD.update({"rows": rows, "at": time.monotonic(), "read_at": now})
    _LATEST = rows
    log.info("technology_docs: %d files under '%s'%s%s", len(files),
             root.get("name"), " (TRUNCATED)" if truncated else "",
             f" ({len(failed_folders)} folder listing(s) FAILED)" if failed_folders else "")
    return rows, now


def project_stats() -> dict[str, dict]:
    """A top-level folder is a project; under "Automation Projects" the second level is."""
    rows = latest_listing() or []
    stats: dict[str, dict] = {}
    for r in rows:
        if r.get("kind") != "file":
            continue
        cat = str(r.get("category") or "")
        if not cat:
            continue
        if cat == "Automation Projects":
            case = str(r.get("case") or "")
            if not case:
                continue
            project = case
        else:
            project = cat
        entry = stats.setdefault(project, {"files": 0, "size": 0, "recent": []})
        entry["files"] += 1
        entry["size"] += int(r.get("size_bytes") or 0)
        if len(entry["recent"]) < 5:
            entry["recent"].append(str(r.get("name") or ""))
    return stats
