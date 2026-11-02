"""The Technology workspace on Python (server/technology_docs.py, server/technology_slices.py): the Technology Drive
folder kept on the server, in the project's documents folder, and listed from Postgres (app.tech_docs, db/technology.sql)
— the screen's three slices are filled here and a document opens from the server's copy, never from Drive.

    <root>/technology/drive/<file id>/<name>    a file of the folder: a Google file as its Office export (Docs .docx,
                                                Sheets .xlsx, Slides .pptx) with its PDF beside it for the viewer, any
                                                other file as itself; .kept.json beside it says what was kept

techDocsFetch is the relay's own read, on its clock while the app is Python's: the folder's tree walked a few folders a
pass (.walk.json holds the walk between passes, .listing.json the last complete one), what is new or changed in it
recorded by techDocsKeep (technology_writes), then its files brought onto the disk, a few a pass. A file Drive cannot
export (a form) is listed with its Drive link and nothing kept. A project's status and the projects added by hand live
in app.tech_project_status and app.tech_manual_projects."""
from __future__ import annotations

import base64
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import drive as dr
import gsjs
import location_docs as LD
import locations as L
import resource_rows as RR
import technology_curated as TC
from scope import Defer

APP_ID = "technology"
DOCS = "app.tech_docs"
STATUS = "app.tech_project_status"
MANUAL = "app.tech_manual_projects"
CHANGES = "app.tech_changes"
APP_DIR = "technology"
WALK = ".walk.json"
LISTING = ".listing.json"
RECORDED = ".recorded"
KEPT = ".kept.json"
FOLDER_PROP = "TECH_DOCS_FOLDER_ID"
FOLDER_DEFAULT = "14HGIPBe5KcQg6gr9Dd9wHBh_Aq1DG0PA"
# the largest file of the folder is a 235 MB video
MAX_BYTES = 256 * 1024 * 1024
# a document handed to the viewer travels as base64 in one answer: past this it opens in Drive's preview
SERVE_MAX_BYTES = int(os.getenv("HUB_TECH_SERVE_MAX_BYTES", str(40 * 1024 * 1024)))
# the relay waits HUB_APP_PACK_TIMEOUT_S for a pass; what is left is walked or brought on the next one
FETCH_BUDGET_S = float(os.getenv("HUB_TECH_FETCH_BUDGET_S", "25"))
WALK_BUDGET_S = float(os.getenv("HUB_TECH_WALK_BUDGET_S", "15"))
# a complete walk is taken again after this long
LISTING_EVERY_S = float(os.getenv("HUB_TECH_LISTING_EVERY_S", "900"))
MAX_FOLDERS = 2000
FOLDER_TRIES = 3
# rows handed to techDocsKeep in one pass: its write is decided inside the platform's write budget
ITEMS_CAP = 250
FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink"
PDF = "application/pdf"
EXPORTS = {
    "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                             "docx"),
    "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                                "xlsx"),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"),
    "application/vnd.google-apps.drawing": (PDF, "pdf"),
}
# shown by the browser as themselves
VIEWABLE = re.compile(r"^(application/pdf|image/(png|jpeg|gif|webp)|text/plain|text/markdown|video/(mp4|webm|quicktime))$")
# the same table TechnologyDocs.gs carried, so the badges never change spelling
KIND_BY_EXT = {
    ".pdf": "pdf",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".doc": "word", ".docx": "word",
    ".xls": "sheet", ".xlsx": "sheet", ".csv": "sheet",
    ".md": "text", ".txt": "text",
    ".mov": "video", ".mp4": "video", ".m4v": "video", ".webm": "video",
}
GOOGLE_KIND = {
    "application/vnd.google-apps.document": "word",
    "application/vnd.google-apps.spreadsheet": "sheet",
    "application/vnd.google-apps.presentation": "pdf",
}
TECH_STATUSES = ("Not started", "In progress", "Blocked", "Done", "Retired")
COLUMNS = ("drive_id", "name", "rel", "category", "case_name", "trail", "kind", "google_mime", "google_size",
           "google_modified", "web_view_link", "mime", "size_bytes", "path", "view_path", "view_mime",
           "kept_modified", "why", "gone_at")
LISTED_FIELDS = ("name", "rel", "category", "case_name", "trail", "kind", "google_mime", "google_size",
                 "google_modified", "web_view_link")
DENIED = {"status": 403, "message": "admins and managers only"}
NO_FILE = "No such file — or the platform cannot see it."
_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def problem() -> str:
    """Why the workspace's folder cannot be written just now; '' when it can."""
    try:
        base().mkdir(parents=True, exist_ok=True)
        probe = base() / ".write-probe"
        probe.write_bytes(b"")
        probe.unlink()
        return ""
    except OSError as exc:
        return f"the server's documents folder is not writable ({type(exc).__name__})"


def safe_name(name: str, ext: str = "") -> str:
    stem = _UNSAFE.sub("_", (name or "document").strip()).strip(" ._") or "document"
    if ext and not stem.lower().endswith("." + ext):
        stem = f"{stem}.{ext}"
    return stem[:150]


def put(rel: str, data: bytes) -> None:
    """One file onto the disk whole, or not at all."""
    target = base() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)


def _read_json(name: str) -> dict[str, Any] | None:
    try:
        got = json.loads((base() / name).read_text(encoding="utf-8"))
        return got if isinstance(got, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(name: str, data: dict[str, Any]) -> None:
    put(name, json.dumps(data, separators=(",", ":")).encode("utf-8"))


def kind_of(name: str, mime: str) -> str:
    if mime in GOOGLE_KIND:
        return GOOGLE_KIND[mime]
    dot = name.rfind(".")
    return KIND_BY_EXT.get(name[dot:].lower(), "") if dot != -1 else ""


def _gate(user: dict | None) -> dict[str, Any] | None:
    """The screen is for admins and managers; the relay's own identity fills its slices."""
    u = user or {}
    if u.get("is_service") is True or s_(u.get("role")) in ("admin", "manager"):
        return None
    return dict(DENIED)


def rows(reads: L.Reads, *, gone: bool = False) -> list[dict[str, Any]]:
    """The folder's files as kept, in the folder's order (the live ones, or every one)."""
    where = "" if gone else " where gone_at is null"
    got = RR._q(reads, f"select {', '.join(COLUMNS)} from {DOCS}{where} order by category, rel")
    return [dict(zip(COLUMNS, r)) for r in got]


def row(reads: L.Reads, drive_id: str) -> dict[str, Any] | None:
    got = RR._q(reads, f"select {', '.join(COLUMNS)} from {DOCS} where drive_id = %s", (drive_id,))
    return dict(zip(COLUMNS, got[0])) if got else None


def _served(r: dict[str, Any], rel: str) -> bool:
    """Whether this copy can be handed to the viewer: kept, and small enough to travel in one answer."""
    if not rel:
        return False
    try:
        return (base() / rel).stat().st_size <= SERVE_MAX_BYTES
    except OSError:
        return False


def viewable(r: dict[str, Any]) -> bool:
    if r.get("view_path"):
        return _served(r, s_(r.get("view_path")))
    return bool(VIEWABLE.match(s_(r.get("mime")))) and _served(r, s_(r.get("path")))


def file_row(r: dict[str, Any]) -> dict[str, Any]:
    """One techDocs row as the relay's walk shaped it, and whether the server holds it."""
    return {"id": s_(r.get("drive_id")), "kind": "file", "name": s_(r.get("name")), "rel": s_(r.get("rel")),
            "category": s_(r.get("category")), "case": s_(r.get("case_name")), "trail": s_(r.get("trail")),
            "ext": s_(r.get("kind")), "size_bytes": int(r.get("google_size") or r.get("size_bytes") or 0),
            "modified_time": s_(r.get("google_modified")), "web_view_link": s_(r.get("web_view_link")),
            "mime": s_(r.get("mime")) or s_(r.get("google_mime")), "kept": bool(r.get("path")),
            "viewable": viewable(r)}


def _recorded() -> bool:
    return (base() / RECORDED).exists()


def docs_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """techDocs: one meta row, then the folder's files, out of Postgres."""
    denied = _gate(sess.user)
    if denied:
        return denied
    if not _recorded():
        raise Defer("the Technology folder has not been brought onto the server yet")
    listing = _read_json(LISTING) or {}
    root = listing.get("root") or {}
    files = [file_row(r) for r in rows(sess.reads)]
    meta: dict[str, Any] = {"id": "meta", "kind": "meta", "configured": True, "kept_on_server": True,
                            "folder_id": s_(root.get("id")), "folder_name": s_(root.get("name")),
                            "folder_url": s_(root.get("webViewLink")), "updated_at": s_(listing.get("at")),
                            "truncated": False,
                            "kept": sum(1 for f in files if f["kept"])}
    failed = listing.get("failed") or []
    if failed:
        meta["partial"] = True
        meta["partial_reason"] = f"{len(failed)} of {int(listing.get('folders') or 0)} folder listing(s) failed"
    return {"status": 200, "data": [meta] + files}


def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """techDocFile: a kept document's bytes — its PDF for the viewer (`as` view), or the document itself."""
    u = sess.user or {}
    if u.get("is_service") or s_(u.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    fid = s_(p.get("file_id"))
    if not fid:
        return {"status": 400, "message": "file_id is required"}
    r = row(sess.reads, fid)
    if r is None or r.get("gone_at") is not None:
        return {"status": 404, "message": NO_FILE}
    if not r.get("path"):
        return {"status": 404, "message": "This one is not kept on the server yet — Drive's preview shows it."}
    view = s_(p.get("as") or "view") == "view" and bool(r.get("view_path"))
    rel = s_(r.get("view_path")) if view else s_(r.get("path"))
    mime = s_(r.get("view_mime")) if view else s_(r.get("mime"))
    if not _served(r, rel):
        return {"status": 413, "message": "This file is too large to open here — Drive's preview shows it."}
    try:
        data = (base() / rel).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    name = s_(r.get("name")) or "document"
    ext = rel.rsplit(".", 1)[-1] if "." in rel.rsplit("/", 1)[-1] else ""
    if ext and not name.lower().endswith("." + ext.lower()):
        name = f"{name}.{ext}"
    return {"status": 200, "data": {"name": name, "mime": mime or "application/octet-stream", "size": len(data),
                                    "exported": view, "kept": True, "b64": base64.b64encode(data).decode("ascii")}}


# ---- the projects and the engineering assessment ----------------------------------------------------------------

def slug(name: str) -> str:
    """The SAME id tools/import_projects.py minted for the `projects` rows: PRJ_ + name lowercased, non-alnum as _."""
    return "PRJ_" + "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")[:32]


def project_stats(reads: L.Reads) -> dict[str, dict]:
    """A top-level folder is a project; under "Automation Projects" the second level is."""
    stats: dict[str, dict] = {}
    for r in rows(reads):
        cat = s_(r.get("category"))
        if not cat:
            continue
        project = s_(r.get("case_name")) if cat == "Automation Projects" else cat
        if not project:
            continue
        entry = stats.setdefault(project, {"files": 0, "size": 0, "recent": []})
        entry["files"] += 1
        entry["size"] += int(r.get("google_size") or 0)
        if len(entry["recent"]) < 5:
            entry["recent"].append(s_(r.get("name")))
    return stats


def overrides(reads: L.Reads) -> dict[str, str]:
    """The statuses picked on the cards."""
    return {s_(n): s_(st) for n, st in RR._q(reads, f"select name, status from {STATUS}")}


def manual(reads: L.Reads) -> list[dict[str, str]]:
    """The projects added by hand."""
    return [{"name": s_(n), "category": s_(c), "status": s_(st), "blurb": s_(b)}
            for n, c, st, b in RR._q(reads, f"select name, category, status, blurb from {MANUAL} order by created_at")]


def _entry(name: str, meta: dict, *, files: int, size: int, recent: list[str], live: bool,
           over: dict[str, str]) -> dict[str, Any]:
    curated = s_(meta.get("status")) or "unassessed"
    ov = over.get(name)
    return {"id": slug(name), "name": name, "category": s_(meta.get("category")), "status": ov or curated,
            "status_default": curated, "status_source": "user" if ov else "auto", "blurb": s_(meta.get("blurb")),
            "strengths": " · ".join(meta.get("strengths") or []), "gaps": " · ".join(meta.get("gaps") or []),
            "file_count": files, "size_bytes": size, "recent_files": ", ".join(recent),
            "assessed": "yes" if name in TC.PROJECT_META else "", "platform": "yes" if meta.get("platform") else "",
            "live": "yes" if live else "", "manual": "", "origin": "imported:tech_assessment + drive_folder_absorb_registry"}


def _manual_entry(m: dict[str, str], over: dict[str, str]) -> dict[str, Any]:
    name = m["name"].strip()
    curated = m["status"].strip() or "Not started"
    ov = over.get(name)
    return {"id": slug(name), "name": name, "category": m["category"].strip() or "Manual", "status": ov or curated,
            "status_default": curated, "status_source": "user" if ov else "manual", "blurb": m["blurb"].strip(),
            "strengths": "", "gaps": "", "file_count": 0, "size_bytes": 0, "recent_files": "", "assessed": "",
            "platform": "", "live": "", "manual": "yes", "origin": "imported:asa_tech_manual_projects"}


def projects_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """techProjects: the folder's projects with the curated assessment over them, then the ones added by hand."""
    denied = _gate(sess.user)
    if denied:
        return denied
    if not _recorded():
        raise Defer("the Technology folder has not been brought onto the server yet")
    reads = sess.reads
    stats = project_stats(reads)
    over = overrides(reads)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in sorted(stats):
        seen.add(name)
        s = stats[name]
        out.append(_entry(name, TC.PROJECT_META.get(name, {}), files=s["files"], size=s["size"], recent=s["recent"],
                          live=True, over=over))
    for name, meta in TC.PROJECT_META.items():
        if name in seen:
            continue
        seen.add(name)
        out.append(_entry(name, meta, files=int(meta.get("baked_files") or 0), size=0, recent=[], live=False,
                          over=over))
    for m in manual(reads):
        if not m["name"].strip() or m["name"].strip() in seen:
            continue
        seen.add(m["name"].strip())
        out.append(_manual_entry(m, over))
    # the platform's card first, then by maturity, archived last
    out.sort(key=lambda p: (-1 if p["platform"] else TC.STATUS_RANK.get((p["status"] or "").lower(), 6),
                            -int(p["file_count"])))
    return {"status": 200, "data": out}


def engineering_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """techEngineering: the engineering assessment as rows of four kinds (meta, figure, strength, issue)."""
    denied = _gate(sess.user)
    if denied:
        return denied
    by_status: dict[str, int] = {}
    for it in TC.ISSUES:
        by_status[it["status"]] = by_status.get(it["status"], 0) + 1
    out: list[dict[str, Any]] = [{
        "id": "assessment", "kind": "meta", "version": TC.ASSESSMENT_VERSION, "audit_date": TC.AUDIT_DATE,
        "verified_date": TC.VERIFIED_DATE, "state": TC.STATE_PARAGRAPH, "recently_fixed": TC.RECENTLY_FIXED,
        "issues_total": len(TC.ISSUES), "strengths_total": len(TC.STRENGTHS),
        "open_gaps": by_status.get("open", 0) + by_status.get("partial", 0) + by_status.get("ambiguous", 0)}]
    for i, f in enumerate(TC.FIGURES):
        out.append({"id": f"figure-{i}", "kind": "figure", "label": f["label"], "value": f["value"],
                    "hint": f.get("hint", "")})
    for i, st in enumerate(TC.STRENGTHS):
        out.append({"id": f"strength-{i}", "kind": "strength", "title": st["title"], "detail": st.get("detail", ""),
                    "section": st.get("section", "")})
    for it in TC.ISSUES:
        out.append({"id": f"issue-{it['id']}", "kind": "issue", "severity": it["severity"], "area": it.get("area", ""),
                    "title": it.get("title", ""), "detail": it.get("detail", ""), "evidence": it.get("evidence", ""),
                    "status": it.get("status", "open"), "verified": "yes" if it.get("verified") else ""})
    return {"status": 200, "data": out}


# ---- the Drive folder brought onto the server -------------------------------------------------------------------

def _walk_step(drv: Any, folder: str, budget_s: float) -> dict[str, Any] | None:
    """The folder's tree walked as far as the budget goes, kept in .walk.json between passes; the complete listing
    (written to .listing.json) once the last folder answered, else None while folders are left."""
    walk = _read_json(WALK)
    if walk is None:
        root = drv.file_meta(folder, "id,name,webViewLink")
        walk = {"started": now_iso(), "root": root, "queue": [[folder, [], 0]], "seen": [folder], "files": {},
                "failed": [], "folders": 0}
    seen = set(walk["seen"])
    started = time.monotonic()
    while walk["queue"] and time.monotonic() - started < budget_s:
        fid, trail, tries = walk["queue"].pop(0)
        try:
            subs = drv.children(fid, True, "id,name")
            files = drv.children(fid, False, FILE_FIELDS)
        except Exception as exc:  # noqa: BLE001 - a folder that did not answer is asked again, then said
            if tries + 1 < FOLDER_TRIES:
                walk["queue"].append([fid, trail, tries + 1])
            else:
                walk["failed"].append({"id": fid, "trail": " / ".join(trail), "why": type(exc).__name__})
            continue
        walk["folders"] += 1
        for f in subs:
            if f.get("id") and f["id"] not in seen and len(seen) < MAX_FOLDERS:
                seen.add(f["id"])
                walk["queue"].append([f["id"], trail + [s_(f.get("name"))], 0])
        for f in files:
            name, gmime = s_(f.get("name")), s_(f.get("mimeType"))
            walk["files"][s_(f.get("id"))] = {
                "name": name, "rel": "/".join(trail + [name]), "category": trail[0] if trail else "",
                "case_name": trail[1] if len(trail) > 1 else "", "trail": " / ".join(trail),
                "kind": kind_of(name, gmime), "google_mime": gmime, "google_size": int(f.get("size") or 0),
                "google_modified": s_(f.get("modifiedTime")), "web_view_link": s_(f.get("webViewLink"))}
    walk["seen"] = sorted(seen)
    if walk["queue"]:
        _write_json(WALK, walk)
        return None
    listing = {"at": now_iso(), "root": walk["root"], "files": walk["files"], "failed": walk["failed"],
               "folders": walk["folders"]}
    _write_json(LISTING, listing)
    try:
        (base() / WALK).unlink()
    except OSError:
        pass
    return listing


def _listing_due(listing: dict[str, Any] | None) -> bool:
    if listing is None:
        return True
    try:
        at = datetime.strptime(s_(listing.get("at")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - at).total_seconds() > LISTING_EVERY_S


def _kept_here(fid: str, modified: str) -> dict[str, Any] | None:
    """What an earlier pass kept for this file at this version, when every file it names is still on the disk."""
    got = _read_json(f"drive/{fid}/{KEPT}")
    if not got or s_(got.get("kept_modified")) != modified:
        return None
    for k in ("path", "view_path"):
        if got.get(k) and not (base() / s_(got[k])).is_file():
            return None
    return got


def bring(drv: Any, fid: str, f: dict[str, Any]) -> dict[str, Any]:
    """One Drive file onto the disk: a Google file as its Office export and its PDF, any other as itself; a file Drive
    cannot export, or one past the size limit, kept as a row with why."""
    name, gmime, modified = s_(f.get("name")), s_(f.get("google_mime")), s_(f.get("google_modified"))
    got = _kept_here(fid, modified)
    if got is not None:
        return got
    item = {"kept_modified": modified, "mime": gmime, "size_bytes": int(f.get("google_size") or 0), "path": "",
            "view_path": "", "view_mime": "", "why": ""}
    folder = f"drive/{fid}"
    if gmime in EXPORTS:
        omime, ext = EXPORTS[gmime]
        data = drv.export(fid, omime, MAX_BYTES)
        rel = f"{folder}/{safe_name(name, ext)}"
        put(rel, data)
        item.update(mime=omime, size_bytes=len(data), path=rel)
        if omime != PDF:
            try:
                pdf = drv.export(fid, PDF, MAX_BYTES)
                vrel = f"{folder}/{safe_name(name, 'pdf')}"
                put(vrel, pdf)
                item.update(view_path=vrel, view_mime=PDF)
            except (Defer, dr.Gone, OSError, ValueError) as exc:
                item["why"] = f"no PDF for the viewer ({type(exc).__name__})"
    elif gmime.startswith(dr.GOOGLE_NATIVE):
        item["why"] = "a Google file Drive cannot export — it stays in Drive"
    elif item["size_bytes"] > MAX_BYTES:
        item["why"] = "past the size the server keeps"
    else:
        data = drv.media(fid, MAX_BYTES)
        if len(data) > MAX_BYTES:
            item["why"] = "past the size the server keeps"
        else:
            rel = f"{folder}/{safe_name(name)}"
            put(rel, data)
            item.update(size_bytes=len(data), path=rel)
    if item["path"] or item["why"]:
        _write_json(f"{folder}/{KEPT}", item)
    return item


def fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """techDocsFetch (the relay's own): the folder's tree walked a few folders a pass, what is new or changed in it
    handed over to be recorded, then its files brought onto the disk, as many as the pass has time for."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    folder = s_(reads.db.prop(FOLDER_PROP)) or FOLDER_DEFAULT
    why = problem()
    if why:
        return {"status": 503, "message": why}
    drv = reads.need_drive()
    started = time.monotonic()
    listing = _read_json(LISTING)
    walking = (base() / WALK).exists() or _listing_due(listing)
    if walking:
        done = _walk_step(drv, folder, WALK_BUDGET_S)
        if done is not None:
            listing, walking = done, False
    if listing is None:
        return {"status": 200, "data": {"items": [], "gone": [], "more": True, "walking": True}}
    listed: dict[str, dict] = listing.get("files") or {}
    have = {s_(r["drive_id"]): r for r in rows(reads, gone=True)}
    items: list[dict] = []
    for fid, f in sorted(listed.items(), key=lambda kv: s_(kv[1].get("rel"))):
        had = have.get(fid)
        if had is None or had.get("gone_at") is not None or any(
                s_(had.get(k)) != s_(f.get(k)) for k in LISTED_FIELDS):
            items.append({"drive_id": fid, **f})
    gone = [] if listing.get("failed") else [fid for fid, r in have.items()
                                              if r.get("gone_at") is None and fid not in listed]
    more = len(items) > ITEMS_CAP or len(gone) > ITEMS_CAP
    items, gone = items[:ITEMS_CAP], gone[:ITEMS_CAP]
    if not items and not gone and not walking and not _recorded():
        (base() / RECORDED).write_text(now_iso(), encoding="utf-8")
    # the files: what the disk does not hold at the version Drive lists, smallest first
    wanted = []
    for fid, f in listed.items():
        had = have.get(fid)
        if had is not None and s_(had.get("kept_modified")) == s_(f.get("google_modified")) and (
                (had.get("path") and (base() / s_(had["path"])).is_file()) or (not had.get("path") and had.get("why"))):
            continue
        wanted.append((int(f.get("google_size") or 0), fid, f))
    wanted.sort(key=lambda x: (x[0], x[1]))
    left: list[str] = []
    brought = 0
    by_id = {it["drive_id"]: it for it in items}
    for _size, fid, f in wanted:
        if time.monotonic() - started > FETCH_BUDGET_S or len(by_id) >= ITEMS_CAP:
            more = True
            break
        try:
            kept = bring(drv, fid, f)
        except (Defer, dr.Gone) as exc:
            # Drive refuses this file (its export ceiling, a download it forbids): kept as a row with why, and asked
            # again only once it changes
            kept = {"kept_modified": s_(f.get("google_modified")), "mime": s_(f.get("google_mime")),
                    "size_bytes": int(f.get("google_size") or 0), "path": "", "view_path": "", "view_mime": "",
                    "why": str(exc)[:200] or type(exc).__name__}
        except Exception as exc:  # noqa: BLE001 - a file Drive did not hand over this time is asked again next pass
            left.append(f"{s_(f.get('name'))[:60]} ({type(exc).__name__})")
            continue
        by_id[fid] = {**by_id.get(fid, {"drive_id": fid, **f}), **kept, "fetched": True}
        brought += 1
    return {"status": 200, "data": {"items": list(by_id.values()), "gone": gone, "more": more or walking,
                                    "walking": walking, "listed": len(listed), "wanted": len(wanted),
                                    "brought": brought, "left": left}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "techDocsList": docs_list, "techProjectsList": projects_list, "techEngineeringList": engineering_list,
    "techDocFile": doc_file, "techDocsFetch": fetch}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {"techDocsList": {}, "techProjectsList": {}, "techEngineeringList": {},
                                     "techDocFile": {"roles": _ROLES, "params": {"file_id": "string"}},
                                     "techDocsFetch": {}}
