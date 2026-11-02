"""Policies on Python (Policies.gs, Main.gs RESOURCES.policies / contactLists / policyAcks): the policies' sections, the
contact list and the read receipts in Postgres (app.resource_rows, uploaded from their tabs as the app is given to
Python) — a client never reads the policies, a client or a trainee never the contact list. Each original document of the
policies folder is kept on the server (documents/policies/<drive id>/, app.policy_files) and handed over from there.

policiesFetch is the import's Drive half, asked by the relay for the admin who pressed Import: every document of the
folder read as text and cut into sections, and its original brought onto the disk; policiesKeep (policies_writes)
then rewrites both resources wholesale, as a mirror of the folder."""
from __future__ import annotations

import base64
import os
import re
from pathlib import Path
from typing import Any, Callable

import drive as dr
import gsjs
import location_docs as LD
import locations as L
import resource_rows as RR
import sheet_resources as SR
from scope import Defer

APP_ID = "policy-acks"
FILES = "app.policy_files"
APP_DIR = "policies"
FOLDER_PROP = "POLICIES_FOLDER_ID"
CELL_MAX = 40000
TEXT_MAX = 8 * 1024 * 1024
FILE_MAX = 25 * 1024 * 1024
PDF = "application/pdf"
GOOGLE_DOC = "application/vnd.google-apps.document"
_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def slug(title: str) -> str:
    """policySlug_."""
    s = re.sub(r"\.(pdf|docx?)$", "", s_(title), flags=re.I).lower()
    return "pol-" + re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s))[:60]


def is_heading(line: str) -> bool:
    """policyIsHeading_."""
    s = line.strip()
    if len(s) < 2 or len(s) > 70 or re.search(r"[.,;:]$", s) or re.match(r"\d", s) or len(s.split()) > 9:
        return False
    return s == s.upper() or bool(re.match(r"[A-Z]", s))


def sections(text: str) -> list[dict[str, str]]:
    """policySections_: a heading and the lines under it."""
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] = {"heading": "", "body": []}
    for raw in text.replace(" ", " ").splitlines():
        line = raw.strip()
        if not line:
            continue
        if is_heading(line):
            if cur["heading"] or cur["body"]:
                out.append(cur)
            cur = {"heading": line, "body": []}
        else:
            cur["body"].append(line)
    if cur["heading"] or cur["body"]:
        out.append(cur)
    return [{"heading": c["heading"], "text": "\n".join(c["body"])} for c in out if c["body"] or c["heading"]]


def kept_files(reads: L.Reads) -> dict[str, dict[str, Any]]:
    cols = ("doc_id", "drive_id", "name", "mime", "size_bytes", "path")
    return {r[0]: dict(zip(cols, r)) for r in RR._q(reads, f"select {', '.join(cols)} from {FILES}")}


def _list(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        got = SR.list_rows(sess, resource, payload)
        if resource != "policies" or got.get("status") != 200:
            return got
        # the original each section belongs to, when the server keeps it
        kept = kept_files(sess.reads)
        return {**got, "data": [{**r, "originalKept": True} if s_(r.get("doc_id")) in kept else r
                                for r in got["data"]]}
    return door


def _get(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        return SR.get_row(sess, resource, payload)
    return door


def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """policyDocFile: a policy's original off the server's copy, for whoever reads the policies."""
    refused = SR.gate(sess, "policies", "get")
    if refused:
        return refused
    want = s_((payload or {}).get("doc_id")) if isinstance(payload, dict) else ""
    k = kept_files(sess.reads).get(want)
    if not k or not k.get("path"):
        return {"status": 404, "message": "This original is not kept on the server — open it in Drive."}
    try:
        data = (base() / s_(k["path"])).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(k.get("name")), "mime": s_(k.get("mime")) or PDF, "size": len(data),
                                    "b64": base64.b64encode(data).decode("ascii")}}


def _safe(name: str, ext: str = "") -> str:
    stem = _UNSAFE.sub("_", (name or "policy").strip()).strip(" ._") or "policy"
    if ext and not stem.lower().endswith("." + ext):
        stem = f"{stem}.{ext}"
    return stem[:150]


def _keep_original(drv: Any, f: dict[str, Any], doc_id: str, title: str) -> dict[str, Any] | None:
    """The original onto the disk: a Google Doc as its PDF, any other file as itself; None past the size kept."""
    fid, name, mime = s_(f.get("id")), s_(f.get("name")), s_(f.get("mimeType"))
    if mime == GOOGLE_DOC:
        data, mime, name = drv.export(fid, PDF, FILE_MAX), PDF, _safe(name, "pdf")
    else:
        if int(f.get("size") or 0) > FILE_MAX:
            return None
        data, name = drv.media(fid, FILE_MAX), _safe(name)
    if len(data) > FILE_MAX:
        return None
    rel = f"{fid}/{name}"
    target = base() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    return {"doc_id": doc_id, "drive_id": fid, "title": title, "name": name, "mime": mime, "size_bytes": len(data),
            "path": rel, "modified": s_(f.get("modifiedTime"))}


def fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """policiesImport's Drive half: every document of the folder as text, cut into sections, and its original kept."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) != "admin":
        return {"status": 403, "message": "Requires an admin or manager account"}
    reads = sess.reads
    folder = s_((payload or {}).get("folder_id")) or s_(reads.db.prop(FOLDER_PROP))
    if not folder:
        return {"status": 503, "message": f"The policies folder is not configured ({FOLDER_PROP})."}
    drv = reads.need_drive()
    rows: list[dict] = []
    contacts: list[dict] = []
    titles: list[str] = []
    skipped: list[str] = []
    files: list[dict] = []
    for f in drv.children(folder, False, "id,name,mimeType,modifiedTime,webViewLink,size"):
        name = s_(f.get("name"))
        title = re.sub(r"\.(pdf|docx?)$", "", name, flags=re.I)
        try:
            text = drv.export(s_(f.get("id")), "text/plain", TEXT_MAX).decode("utf-8", "replace") \
                if s_(f.get("mimeType")) == GOOGLE_DOC else drv.converted_text(s_(f.get("id")), TEXT_MAX)
        except (Defer, dr.Gone, OSError, ValueError):
            text = ""
        if not text:
            skipped.append(name)
            continue
        doc_id = slug(name)
        is_contacts = bool(re.search(r"contact list", title, re.I))
        target = contacts if is_contacts else rows
        meta = {"doc_id": doc_id, "title": title, "collection": "contacts" if is_contacts else "policies",
                "updatedAt": s_(f.get("modifiedTime")), "driveUrl": s_(f.get("webViewLink"))}
        for k, sec in enumerate(sections(text)):
            body, part = sec["text"], 0
            while True:
                piece, body = body[:CELL_MAX], body[CELL_MAX:]
                target.append({"id": f"{doc_id}-{k + 1}" + (f"-{part}" if part else ""), **meta,
                               "seq": len(target) + 1, "heading": sec["heading"] if part == 0 else "", "text": piece})
                part += 1
                if not body:
                    break
        titles.append(title)
        try:
            kept = _keep_original(drv, f, doc_id, title)
        except (Defer, dr.Gone, OSError, ValueError):
            kept = None
        if kept:
            files.append(kept)
    return {"status": 200, "data": {"policies": rows, "contacts": contacts, "titles": titles, "skipped": skipped,
                                    "files": files}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "policiesList": _list("policies"), "policiesGet": _get("policies"),
    "contactListsList": _list("contactLists"), "contactListsGet": _get("contactLists"),
    "policyAcksList": _list("policyAcks"), "policyAcksGet": _get("policyAcks"),
    "policyDocFile": doc_file, "policiesFetch": fetch}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
