"""Docs' Drive folder import (Files.gs docsImportFolder) on Python behind the Docs switch (`docs`): the relay asks
docsImportFolderPrepare first — the folder walked in Drive, read only (a shortcut followed to its target, images and
spreadsheets left out, three levels down when asked) — and docsImportFolder then lists what is new in the library, each
document the row a hand-typed one would be (createRow_ on `documents`, in its own table as docs_writes keeps it).
Files are never copied, moved or renamed: the import writes rows only."""
from __future__ import annotations

import re
import urllib.error
from typing import Any, Callable

import docs as D
import docs_writes as DW
import drive as dr
import drive_files as DF
import gsjs
import locations as L
import resource_rows as RR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

CAP = 300
SHORTCUT = "application/vnd.google-apps.shortcut"
# Shortcuts resolve to their target in the walk; images and spreadsheets stay out.
IMPORT_MIME = {"application/vnd.google-apps.document": "doc", "application/pdf": "pdf",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
               "application/msword": "doc", "text/markdown": "md", "text/x-markdown": "md", "text/plain": "txt",
               "application/rtf": "doc"}
FIELDS = "id,name,mimeType,webViewLink,shortcutDetails(targetId)"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
NO_LINK = "Paste the folder's Drive link (the one with /folders/ in it)."
UNOPENED = ("The platform cannot open that folder — check the link, and that asatech@asalifecare.com has access to "
            "it.")
UNPREPARED = "The folder could not be read just now — nothing was listed. Try again in a minute."

s_ = gsjs.str_


def drive_id_from_url(value: Any) -> str:
    """driveIdFromUrl_."""
    v = gsjs.trim(gsjs.or_text(value))
    if not v:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_-]{16,}", v):
        return v
    m = re.search(r"/folders/([A-Za-z0-9_-]{16,})", v) or re.search(r"/d/([A-Za-z0-9_-]{16,})", v) or \
        re.search(r"[?&]id=([A-Za-z0-9_-]{16,})", v)
    return m.group(1) if m else ""


def _gate(sess: L.Session, p: dict) -> dict[str, Any] | None:
    """The declared role and param, then docsImportFolder's own: an admin alone."""
    user = sess.user or {}
    if p.get("url") is None or p.get("url") == "":
        return {"status": 400, "message": "Missing required parameter: url."}
    if not user or s_(user.get("role")) != "admin":
        return dict(DENIED)
    return None


def walk(drv: Any, folder_id: str, deep: bool, have: set[str]) -> dict[str, Any]:
    """docsImportFolder's walk: what a new row is made of for each document not listed yet, at most CAP, and what was
    left out."""
    added: list[dict[str, str]] = []
    known = kind_out = 0
    refused: dict[str, int] = {}
    seen: set[str] = set()
    have = set(have)

    def go(fid: str, depth: int) -> None:
        nonlocal known, kind_out
        if len(added) >= CAP or fid in seen:
            return
        # a shortcut loop is not a hierarchy
        seen.add(fid)
        for f in drv.children(fid, False, FIELDS):
            if len(added) >= CAP:
                break
            mime = s_(f.get("mimeType"))
            if mime == SHORTCUT:
                target = DF.file(drv, s_((f.get("shortcutDetails") or {}).get("targetId")),
                                 "id,name,mimeType,webViewLink")
                if target is None:
                    kind_out += 1
                    refused["broken shortcut"] = refused.get("broken shortcut", 0) + 1
                    continue
                f, mime = target, s_(target.get("mimeType"))
            if mime not in IMPORT_MIME:
                kind_out += 1
                label = (mime or "unknown").split("/")[-1].replace("vnd.google-apps.", "", 1)
                refused[label] = refused.get(label, 0) + 1
                continue
            did = s_(f.get("id"))
            if did in have:
                known += 1
                continue
            have.add(did)
            added.append({"drive_id": did, "title": s_(f.get("name")), "url": s_(f.get("webViewLink"))})
        if not deep or depth >= 3:
            return
        for sub in drv.children(fid, True, "id,name"):
            if len(added) >= CAP:
                break
            go(s_(sub.get("id")), depth + 1)

    go(folder_id, 0)
    return {"added": added, "known": known, "kind_out": kind_out,
            "refused_kinds": ", ".join(f"{n} {k}" for k, n in refused.items())}


def listed(reads: L.Reads) -> set[str]:
    """The Drive ids the library's rows already link."""
    return {i for i in (drive_id_from_url(r.get("url")) for r in D.rows(reads)) if i}


def prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docsImportFolder's slow half: the folder opened and walked in Drive, read only."""
    p = payload if isinstance(payload, dict) else {}
    refused = _gate(sess, p)
    if refused:
        return refused
    fid = drive_id_from_url(p.get("url"))
    if not fid:
        return {"status": 400, "message": NO_LINK}
    drv = sess.reads.need_drive()
    try:
        f = drv.file(fid, "id,name,mimeType,trashed")
    except (dr.Gone, urllib.error.HTTPError, Defer):
        f = None
    if f is None or s_(f.get("mimeType")) != dr.FOLDER_MIME:
        return {"status": 404, "message": UNOPENED}
    if f.get("trashed"):
        return {"status": 404, "message": "That folder is in the trash."}
    deep = p.get("include_subfolders") is True or s_(p.get("include_subfolders")) == "true"
    got = walk(drv, fid, deep, listed(sess.reads))
    return {"status": 200, "data": {"folder": s_(f.get("name")), **got}}


def import_folder(sess: L.Session, payload: dict) -> Decision:
    """docsImportFolder: each document the walk found and the library does not list yet made a row — the same door as a
    hand-typed one, so an imported row is indistinguishable — keyed by its Drive id, so a second run adds only what is
    new."""
    p = payload if isinstance(payload, dict) else {}
    refused = _gate(sess, p)
    if refused:
        return Decision(refused)
    prep = p.get("prepared")
    if not isinstance(prep, dict):
        if not drive_id_from_url(p.get("url")):
            return W.refuse(400, NO_LINK)
        return W.refuse(503, UNPREPARED)
    reads = sess.reads
    name = s_(prep.get("folder"))
    category = s_(p.get("category")) or name
    collection = s_(p.get("collection")) or category
    have = listed(reads)
    known, kind_out = int(prep.get("known") or 0), int(prep.get("kind_out") or 0)
    now = W.now_iso(reads)
    found = [a for a in prep.get("added") or [] if isinstance(a, dict)][:CAP]
    rows: list[dict[str, Any]] = []
    for a in found:
        did = s_(a.get("drive_id"))
        if did in have:
            known += 1
            continue
        have.add(did)
        rows.append({"title": s_(a.get("title")), "url": s_(a.get("url")), "category": category,
                     "collection": collection, "addedAt": now, "id": W.mint(), "createdAt": now, "updatedAt": now})
    if rows:
        RR.create_many(reads, D.RESOURCE, [{k: DW.serialize(v) for k, v in r.items()} for r in rows],
                       s_((sess.user or {}).get("email")))
    said = s_(prep.get("refused_kinds"))
    staff_views.record(sess.user, "docs_import_folder",
                       f"{name} → {len(rows)} document(s), {known} already listed, {kind_out} refused" +
                       (f" ({said})" if said else ""))
    answer = {"status": 200, "data": {"folder": name, "added": len(rows), "skipped": known + kind_out,
                                      "already_listed": known, "refused_kind": kind_out, "refused_kinds": said,
                                      "capped": len(found) >= CAP, "titles": [r["title"] for r in rows[:12]]}}
    return Decision(answer, subject="", own=True)


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"docsImportFolderPrepare": prepare}
READ_POLICY: dict[str, dict[str, Any]] = {"docsImportFolderPrepare": {"roles": ("admin",), "params": {"url": "string"}}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"docsImportFolder": import_folder}
POLICY: dict[str, dict[str, Any]] = {"docsImportFolder": {"roles": ("admin",), "params": {"url": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"docsImportFolder": {"status": 409, "message": DW.BUSY}}
