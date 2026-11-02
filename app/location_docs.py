"""Locations › Documents kept on the server: every document a house's Documents names (each client's ISP, the house
guidebook's files, the company policies) copied out of Drive into the project's documents folder, so the platform's
viewer opens it from disk instead of waiting on Drive.

    <root>/locations/<HOUSE>/isp/<name>          each current client's ISP
    <root>/locations/<HOUSE>/guidebook/<name>    the house guidebook folder's files
    <root>/locations/policies/<name>             the company policies, one copy for every house
    <root>/locations/index.json                  file id -> where it is, its type, Drive's modifiedTime

A pass copies what is new or changed in Drive (a kept copy is checked again after RECHECK_S), a Google or an Office
file kept as its PDF; nothing is ever deleted, and a file Drive will not hand over (one past the size limit) is left to
the Drive read it always had. locationDocFile answers from the copy when there is one, the same answer it gave from
Drive."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import locations as L
from scope import Defer

log = logging.getLogger("asa-hub-app")

ROOT = Path(os.getenv("HUB_DOCUMENTS_DIR", "").strip() or "/srv/documents")
HOST_ROOT = os.getenv("HUB_DOCUMENTS_HOST_DIR", "").strip()
APP_DIR = "locations"
INDEX = "index.json"
POLICIES = "policies"
# a kept copy is asked of Drive again after this long (its modifiedTime); a new file is copied on the next pass
RECHECK_S = float(os.getenv("HUB_LOCATION_DOCS_RECHECK_S", str(6 * 3600)))
_EXT = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
        "text/plain": "txt"}
_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")
_lock = threading.Lock()
_held: dict[str, Any] = {"mtime": None, "index": {}}


def problem() -> str:
    """Why the folder cannot be written just now; '' when it can."""
    try:
        (ROOT / APP_DIR).mkdir(parents=True, exist_ok=True)
        probe = ROOT / APP_DIR / ".write-probe"
        probe.write_bytes(b"")
        probe.unlink()
        return ""
    except OSError as exc:
        return f"{ROOT} is not writable ({type(exc).__name__})"


def _index_path() -> Path:
    return ROOT / APP_DIR / INDEX


def index() -> dict[str, dict[str, Any]]:
    """The kept copies by Drive file id, read again only when the file on disk changed."""
    p = _index_path()
    try:
        mtime = p.stat().st_mtime
    except OSError:
        return {}
    if _held["mtime"] != mtime:
        try:
            got = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            got = {}
        _held.update(mtime=mtime, index=got if isinstance(got, dict) else {})
    return _held["index"]


def _write_index(idx: dict[str, dict[str, Any]]) -> None:
    p = _index_path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(idx, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)


def served(file_id: str) -> dict[str, Any] | None:
    """locationDocFile's answer out of the kept copy (name, mime, size, exported, b64), or None to read Drive."""
    hit = index().get(file_id)
    if not isinstance(hit, dict) or not hit.get("path"):
        return None
    try:
        data = (ROOT / APP_DIR / hit["path"]).read_bytes()
    except OSError:
        return None
    return {"name": hit.get("name") or "", "mime": hit.get("mime") or "application/octet-stream", "size": len(data),
            "exported": bool(hit.get("exported")), "b64": base64.b64encode(data).decode("ascii"), "kept": True}


def _file_name(name: str, mime: str, file_id: str) -> str:
    """A name the disk takes: the document's own, made safe, with its type's extension and the id's tail when needed."""
    stem = _UNSAFE.sub("_", (name or "document").strip()).strip(" ._") or "document"
    ext = _EXT.get(mime, "")
    if ext and not stem.lower().endswith("." + ext):
        stem = f"{stem}.{ext}"
    return stem[:150]


def _place(rel_dir: str, name: str, file_id: str, idx: dict[str, dict[str, Any]]) -> str:
    """The relative path a copy goes to: the same one it had, else its name, else its name with the id's tail."""
    had = idx.get(file_id, {}).get("path") or ""
    if had.startswith(rel_dir + "/"):
        return had
    taken = {v.get("path") for k, v in idx.items() if k != file_id}
    rel = f"{rel_dir}/{name}"
    if rel in taken:
        base, dot, ext = name.rpartition(".")
        rel = f"{rel_dir}/{base or name}-{file_id[-6:]}{dot}{ext if base else ''}"
    return rel


def wanted(reads: L.Reads) -> tuple[list[tuple[str, str, str, dict]], list[str]]:
    """(folder, file id, name, who it is) for every document a house's Documents names — `who` the house, the kind
    (isp, guidebook, policies) and the client an ISP is of, which locationDocFile checks a viewer against without
    Drive — and the houses that could not be read."""
    homes, why = L._soft(reads.homes)
    if homes is None:
        raise Defer(f"the house registry could not be read ({why})")
    out: dict[str, tuple[str, str, str, dict]] = {}
    missed: list[str] = []
    for h in homes:
        code = str(h.get("code") or "")
        ctx = L.house(reads, code)
        if ctx.get("refused"):
            missed.append(code)
            continue
        try:
            docs = L.documents_part(reads, ctx)
        except Exception as exc:  # noqa: BLE001 - one house that cannot be read leaves the others to copy
            log.info("location docs: %s not listed (%s)", code, type(exc).__name__)
            missed.append(code)
            continue
        for d in docs.get("isps") or []:
            if L.is_file_id(str(d.get("isp_doc_id") or "")):
                out.setdefault(d["isp_doc_id"], (f"{code}/isp", d["isp_doc_id"], d.get("isp_doc_name") or d["client"],
                                                 {"kind": "isp", "house": code, "client": d.get("client") or "",
                                                  "client_key": d.get("client_key") or ""}))
        for f in ((docs.get("guidebook") or {}).get("files") or []):
            if L.is_file_id(str(f.get("id") or "")):
                out.setdefault(f["id"], (f"{code}/guidebook", f["id"], f.get("name") or "",
                                         {"kind": "guidebook", "house": code}))
        for pol in docs.get("policies") or []:
            if L.is_file_id(str(pol.get("drive_id") or "")):
                out.setdefault(pol["drive_id"], (POLICIES, pol["drive_id"], pol.get("title") or "",
                                                 {"kind": "policies", "title": pol.get("title") or ""}))
    return list(out.values()), missed


def known(file_id: str, house: str, scope: dict) -> bool | None:
    """locationsDocKnown_ off the index (no Drive): True or False when the kept copy says whose it is, None to ask
    the Documents read as before (a file the index does not hold, or one it holds for another house)."""
    hit = index().get(file_id)
    if not isinstance(hit, dict) or not hit.get("kind"):
        return None
    kind = hit["kind"]
    if kind == "policies":
        return not L.cut_viewer(scope) or L.name_key(hit.get("title")) in L.CLIENT_POLICIES
    if hit.get("house") != house:
        return None
    if kind == "guidebook":
        return not L.cut_viewer(scope)
    if kind == "isp":
        return not L.narrowed(scope) or bool(L.mine([{"client_key": hit.get("client_key")}], scope))
    return None


def sync(reads: L.Reads, now: float | None = None) -> dict[str, Any]:
    """One pass: every named document copied when it is new to the folder or changed in Drive since its copy."""
    now = time.time() if now is None else now
    why = problem()
    if why:
        return {"ok": False, "why": why}
    drv = reads.need_drive()
    with _lock:
        idx = dict(index())
        files, missed = wanted(reads)
        report = {"ok": True, "named": len(files), "copied": 0, "kept": 0, "left": 0, "houses_missed": missed}
        for folder, file_id, name, who in files:
            had = idx.get(file_id) or {}
            on_disk = bool(had.get("path")) and (ROOT / APP_DIR / had["path"]).is_file()
            if on_disk:
                # whose it is follows the Documents read on every pass, the bytes only when Drive changed them
                had = idx[file_id] = {**had, **who}
            if on_disk and now - float(had.get("checked_at") or 0) < RECHECK_S:
                report["kept"] += 1
                continue
            try:
                meta = drv.file_meta(file_id, "id,name,mimeType,trashed,size,modifiedTime")
                modified = str(meta.get("modifiedTime") or "")
                if on_disk and modified and modified == had.get("modified"):
                    idx[file_id] = {**had, "checked_at": now}
                    report["kept"] += 1
                    continue
                got = L.doc_bytes(reads, file_id)
            except Exception as exc:  # noqa: BLE001 - Drive's word on one file never stops the others
                report["left"] += 1
                log.info("location docs: %s left to Drive (%s)", file_id, type(exc).__name__)
                continue
            if got.get("refused"):
                report["left"] += 1
                continue
            rel = _place(folder, _file_name(got["name"] or name, got["mime"], file_id), file_id, idx)
            target = ROOT / APP_DIR / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".part")
            tmp.write_bytes(base64.b64decode(got["b64"]))
            os.replace(tmp, target)
            idx[file_id] = {"path": rel, "name": got["name"] or name, "mime": got["mime"], "exported": got["exported"],
                            "size": got["size"], "modified": modified, "saved_at": now, "checked_at": now, **who}
            report["copied"] += 1
        _write_index(idx)
    return report


def where() -> dict[str, Any]:
    """The folder as the server's disk names it, and what it holds per house (Settings › Server Paths)."""
    host = (HOST_ROOT.rstrip("/") or str(ROOT)) + f"/{APP_DIR}"
    idx = index()
    houses: dict[str, dict[str, int]] = {}
    for hit in idx.values():
        top = str(hit.get("path") or "").split("/", 1)[0]
        h = houses.setdefault(top, {"files": 0, "bytes": 0})
        h["files"] += 1
        h["bytes"] += int(hit.get("size") or 0)
    why = problem()
    return {"root": host, "inside": str(ROOT / APP_DIR), "mounted": not why, "why": why,
            "files": sum(h["files"] for h in houses.values()), "bytes": sum(h["bytes"] for h in houses.values()),
            "folders": [{"folder": k, "path": f"{host}/{k}", **v} for k, v in sorted(houses.items())],
            "last_saved": max((float(v.get("saved_at") or 0) for v in idx.values()), default=0.0)}
