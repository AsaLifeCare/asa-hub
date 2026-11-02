"""Academy on Python (Main.gs RESOURCES.videos and Prefs.gs docFeedback): the lessons read from Postgres through the
generic list and get (sheet_resources, uploaded from the videos sheet), the thumbs every reader gives a lesson or a
document (app.resource_rows `docFeedback`, uploaded from doc_feedback), and each lesson's video file kept on the
server, in the project's documents folder:

    <root>/academy/<drive id>/<name>    the file a lesson links in Drive, brought by the relay's own pass

academyFetch (the relay's own, on its clock while the app is Python's) brings what a lesson links and the server does
not hold yet; academyKeep (academy_writes) records it in app.academy_files (db/academy.sql). A lesson whose file the
server holds is listed `kept`, and the player asks academyVideoFile for it instead of Drive's preview; a file Drive
will not hand over stays on Drive's preview."""
from __future__ import annotations

import base64
import os
import re
import time
from typing import Any, Callable

import candidates as CND
import drive as dr
import gsjs
import location_docs as LD
import locations as L
import resource_rows as RR
import sheet_resources as SR
from scope import Defer

APP_ID = "academy"
RESOURCE = "videos"
FEEDBACK = "docFeedback"
FEEDBACK_TAB = "doc_feedback"
FILES = "app.academy_files"
APP_DIR = "academy"
MAX_BYTES = 200 * 1024 * 1024
# what the viewer's door hands over whole, as one answer; a longer file plays from Drive's preview
SERVE_MAX_BYTES = int(os.getenv("HUB_ACADEMY_SERVE_MAX_BYTES", str(40 * 1024 * 1024)))
FETCH_BUDGET_S = float(os.getenv("HUB_ACADEMY_FETCH_BUDGET_S", "25"))
_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")

s_ = gsjs.str_


def base() -> Any:
    return LD.ROOT / APP_DIR


def kept_files(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """The video files the server holds, by Drive id."""
    cols = ("drive_id", "name", "mime", "size_bytes", "modified", "path", "why")
    return {r[0]: dict(zip(cols, r)) for r in RR._q(reads, f"select {', '.join(cols)} from {FILES}")}


def _served(kept: dict | None) -> bool:
    return bool(kept and kept.get("path") and int(kept.get("size_bytes") or 0) <= SERVE_MAX_BYTES)


def _marked(rows: list[dict], kept: dict[str, dict]) -> list[dict]:
    out = []
    for r in rows:
        k = kept.get(s_(r.get("driveId")))
        out.append({**r, "kept": True, "keptMime": s_(k.get("mime"))} if _served(k) else r)
    return out


def videos_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    got = SR.list_rows(sess, RESOURCE, payload)
    if got.get("status") == 200 and isinstance(got.get("data"), list):
        got = {**got, "data": _marked(got["data"], kept_files(sess.reads))}
    return got


def videos_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    got = SR.get_row(sess, RESOURCE, payload)
    if got.get("status") == 200 and isinstance(got.get("data"), dict):
        got = {**got, "data": _marked([got["data"]], kept_files(sess.reads))[0]}
    return got


# ---- the thumbs ------------------------------------------------------------------------------------------------------

def votes(reads: L.Reads) -> list[dict]:
    """The doc_feedback rows in the order they were written."""
    return RR.read_all(reads, FEEDBACK)


def tally(reads: L.Reads, doc_id: str) -> dict[str, Any]:
    """docFeedbackTally_."""
    up = down = 0
    for r in votes(reads):
        if doc_id and s_(r.get("doc_id")) != doc_id:
            continue
        if s_(r.get("vote")) == "up":
            up += 1
        elif s_(r.get("vote")) == "down":
            down += 1
    return {"doc_id": doc_id or "", "up": up, "down": down, "total": up + down}


def feedback_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docFeedbackList: every vote, newest first — who, when, which way."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": "Requires an admin or manager account"}
    doc_id = s_((payload or {}).get("doc_id"))
    out = []
    for r in reversed(votes(sess.reads)):
        if doc_id and s_(r.get("doc_id")) != doc_id:
            continue
        out.append({"item_kind": s_(r.get("item_kind")) or "doc", "doc_id": s_(r.get("doc_id")),
                    "doc_title": s_(r.get("doc_title")), "collection": s_(r.get("collection")),
                    "vote": s_(r.get("vote")), "user_email": s_(r.get("user_email")),
                    "user_name": s_(r.get("user_name")), "user_role": s_(r.get("user_role")),
                    "created_at": s_(r.get("created_at")), "when": CND.when_label(s_(r.get("created_at")))})
    return {"status": 200, "data": {"votes": out, "tally": tally(sess.reads, doc_id)}}


# ---- the video files on the server -----------------------------------------------------------------------------------

def video_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """academyVideoFile: a lesson's video off the server's own copy, for whoever may open the lesson."""
    p = payload if isinstance(payload, dict) else {}
    got = SR.get_row(sess, RESOURCE, {"id": p.get("id")})
    if got.get("status") != 200:
        return got
    did = s_((got.get("data") or {}).get("driveId"))
    k = kept_files(sess.reads).get(did)
    if not _served(k):
        return {"status": 404, "message": "This lesson's video is not kept on the server — it plays from Drive."}
    try:
        data = (base() / s_(k["path"])).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept video could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(k.get("name")), "mime": s_(k.get("mime")) or "video/mp4",
                                    "size": len(data), "b64": base64.b64encode(data).decode("ascii")}}


def safe_name(name: str) -> str:
    return (_UNSAFE.sub("_", (name or "video").strip()).strip(" ._") or "video")[:150]


def fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """academyFetch (the relay's own): every video a lesson links that the server does not hold yet, or that changed
    in Drive since, brought onto the disk, as many as the pass has time for."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    why = LD.problem()
    if why:
        return {"status": 503, "message": why}
    reads = sess.reads
    drv = reads.need_drive()
    have = kept_files(reads)
    wanted: list[str] = []
    for r in SR.rows(reads, RESOURCE):
        did = s_(r.get("driveId"))
        if did and did not in wanted:
            wanted.append(did)
    started = time.monotonic()
    items: list[dict] = []
    more = False
    for did in wanted:
        had = have.get(did)
        if time.monotonic() - started > FETCH_BUDGET_S:
            more = True
            break
        try:
            meta = drv.file_meta(did, "id,name,mimeType,size,modifiedTime,trashed")
        except (Defer, dr.Gone) as exc:
            if had is None or had.get("why") != str(exc)[:200]:
                items.append({"drive_id": did, "why": str(exc)[:200] or type(exc).__name__})
            continue
        modified = s_(meta.get("modifiedTime"))
        if had is not None and s_(had.get("modified")) == modified and had.get("path") and \
                (base() / s_(had["path"])).is_file():
            continue
        name, mime, size = s_(meta.get("name")), s_(meta.get("mimeType")), int(meta.get("size") or 0)
        if meta.get("trashed") or not mime.startswith("video/") or size > MAX_BYTES:
            why = "trashed in Drive" if meta.get("trashed") else ("not a video file" if not mime.startswith("video/")
                                                                  else "past the size the server keeps")
            if had is None or had.get("why") != why or s_(had.get("modified")) != modified:
                items.append({"drive_id": did, "name": name, "mime": mime, "size_bytes": size, "modified": modified,
                              "why": why})
            continue
        try:
            data = drv.media(did, MAX_BYTES)
        except Exception as exc:  # noqa: BLE001 - one file Drive will not hand over leaves the others
            items.append({"drive_id": did, "name": name, "mime": mime, "modified": modified,
                          "why": f"Drive did not hand it over ({type(exc).__name__})"})
            continue
        rel = f"{did}/{safe_name(name)}"
        target = base() / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        items.append({"drive_id": did, "name": name, "mime": mime, "size_bytes": len(data), "modified": modified,
                      "path": rel, "why": ""})
    return {"status": 200, "data": {"wanted": len(wanted), "items": items, "more": more}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "videosList": videos_list, "videosGet": videos_get, "docFeedbackList": feedback_list,
    "academyVideoFile": video_file, "academyFetch": fetch}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["docFeedbackList"] = {"roles": ("admin", "manager")}
