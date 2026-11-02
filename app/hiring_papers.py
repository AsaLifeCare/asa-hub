"""A paper on a candidate's hiring record (HubCore.gs resumeUpload, cjisUpload; TableDocs.gs tableDocUpload's paths that
are theirs, and an item with no catalog document) off asa-hub-db: the heavy half the relay asks before each write — the
file filed in the platform's Uploads folder as its own account, every admin and the uploader given a reader seat in
silence, the bytes kept on the server, a résumé's scorecard asked of the model, and the Hiring table's shortcuts placed
(tableDocsMirror_). The answer is sealed for its write (app/hiring_papers_writes.py)."""
from __future__ import annotations

import json
import logging
import time
import urllib.request
from typing import Any, Callable

import candidate_papers as CP
import drive_files as DF
import gsjs
import hubdb
import locations as L
import onboarding as OB
import resume_intake as RI
import screening as SG
from scope import Defer

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
DENIED = SG.DENIED
OCTET = "application/octet-stream"
KEPT_DIR = "hiring-papers"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
NOT_FILED = "The file could not be filed in Drive just now — nothing was written. Try again in a minute."
TABLE_DOOR = "tableDocUpload"


def _refuse(status: int, message: str) -> dict[str, Any]:
    return {"status": status, "message": message}


def _keep_here(fid: str, name: str, mime: str, data: bytes, by: str) -> str:
    return DF.keep(KEPT_DIR, fid, name, mime, data, by)


def drive_file(sess: L.Session, p: dict, default_name: str, force_mime: str,
               keep: Callable[[str, str, str, bytes, str], str], table: bool) -> dict[str, Any]:
    """hubDriveFileObj_: the bytes filed in the platform's Uploads folder as its own account, every admin and the
    uploader a reader (in silence, each gated), and kept on the server; {refused} when the bytes or Drive say no
    (tableDocUpload's catch says 'Upload failed: …' as a 500)."""
    data, why = RI.decoded(p)
    if data is None:
        return {"refused": _refuse(500, "Upload failed: " + why) if table else _refuse(400, why)}
    name = s_(p.get("filename")) or default_name
    mime = force_mime or s_(p.get("mime_type")) or OCTET
    reads, user = sess.reads, sess.user or {}
    drv = reads.need_drive()
    try:
        filed = drv.upload_into(OB.uploads_folder(reads, drv), name, mime, data)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:  # noqa: BLE001 - nothing was filed, said
        log.warning("hiring papers: %s was not filed in Drive (%s)", name[:60], type(exc).__name__)
        return {"refused": _refuse(500, "Upload failed: " + NOT_FILED) if table else _refuse(502, NOT_FILED)}
    fid = s_(filed.get("id"))
    to_admins = SG.share_with_admins(reads, drv, fid)
    who = s_(user.get("email"))
    up = SG.grant_reader(reads, drv, fid, who) if who and "@" in who else {"ok": False, "skipped": True,
                                                                          "reason": "no address to grant"}
    keep(fid, name, mime, data, who)
    return {"id": fid, "url": DF.file_url(fid), "name": name, "mime": mime, "size": len(data),
            "shared": {"admins": to_admins["shared"], "admins_total": to_admins["total"],
                       "admins_failed": to_admins["failed"], "admins_held_why": to_admins["held_why"],
                       "uploader": bool(up.get("ok")), "uploader_skipped": bool(up.get("skipped")),
                       "uploader_held": bool(up.get("held")), "why": "" if up.get("ok") else s_(up.get("reason"))}}


def mirror(drv: Any, fid: str, name: str) -> int:
    """tableDocsMirror_: a shortcut to the file in the Hiring table's folder and beside its two sibling files, as the
    platform's account; one that cannot be placed never costs the upload."""
    homes = [CP.TABLE_DOCS_FOLDER_ID]
    for sib in CP.TABLE_DOCS_SIBLING_FILES:
        try:
            parents = drv.file(sib, "id,parents").get("parents") or []
        except Exception:  # noqa: BLE001 - a sibling Drive will not open places nothing
            continue
        if parents:
            homes.append(str(parents[0]))
    placed = 0
    for home in homes:
        try:
            auth = drv._owner_write("a shortcut is placed in Drive")
            req = urllib.request.Request(f"{SG.DRIVE_API}?supportsAllDrives=true&fields=id",
                                         data=json.dumps({"name": name, "mimeType": SHORTCUT_MIME, "parents": [home],
                                                          "shortcutDetails": {"targetId": fid}}).encode(),
                                         headers={**auth, "Content-Type": "application/json"}, method="POST")
            if s_(SG._send(drv, req).get("id")):
                placed += 1
        except Exception:  # noqa: BLE001 - logged below, never the upload's failure
            continue
    if placed < 3:
        log.info("hiring papers: %d of 3 doors placed for file %s", placed, fid)
    return placed


def _filed(got: dict) -> dict[str, Any]:
    return {k: got[k] for k in ("url", "name", "mime", "size", "shared")} | {"file_id": got["id"]}


def resume_prepare(sess: L.Session, payload: dict, door: str = "resumeUpload", table: bool = False) -> dict[str, Any]:
    """resumeUpload's heavy half: the résumé filed and kept, the Hiring table's shortcuts placed when the table filed
    it, and its scorecard read (rubricEnsureForCandidate_ — the nota can wait, the upload cannot). A candidate the
    record does not hold is refused before anything is filed."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not SG.CID.match(cid):
        return _refuse(400, "invalid candidate_id")
    reads = sess.reads
    cand = CP.cand_row(reads, cid)
    if not cand:
        return _refuse(404, 'No candidate "' + cid + '".')
    got = drive_file(sess, p, "resume.pdf", "", RI.keep, table)
    if got.get("refused"):
        return got["refused"]
    mirrored = mirror(reads.need_drive(), got["id"], got["name"]) if table else 0
    deadline = time.monotonic() + SG.PREPARE_BUDGET_S
    rubric = RI.soft_rubric(lambda: RI.rubric_ensure(reads, cid, got["id"], deadline, cand=cand))
    return {"status": 200, "data": SG.seal(door, SG.actor(sess.user), {
        "item": "resume", "cid": cid, **_filed(got), "mirrored": mirrored, "rubric": rubric})}


def cjis_prepare(sess: L.Session, payload: dict, door: str = "cjisUpload", table: bool = False) -> dict[str, Any]:
    """cjisUpload's heavy half: the result in the engine's vocabulary, the report filed as a PDF whose name starts
    with CJIS, and kept."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not SG.CID.match(cid):
        return _refuse(400, "invalid candidate_id")
    status = s_(p.get("status")) or "Clear"
    if status not in ("Pending", "Clear", "Verified", "Disqualified"):
        return _refuse(400, "invalid status — engine vocabulary is Pending/Clear/Verified/Disqualified")
    got = drive_file(sess, {"base64": p.get("base64"), "filename": CP.cjis_name(s_(p.get("filename")))},
                     "cjis-report.pdf", "application/pdf", _keep_here, table)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": SG.seal(door, SG.actor(sess.user), {
        "item": "cjis", "cid": cid, "status": status, **_filed(got)})}


def item_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tableDocUpload for an item with no catalog document: its file in the platform's Uploads folder, shared with the
    admins and the uploader, kept, and its shortcuts placed beside the Hiring table."""
    p = payload if isinstance(payload, dict) else {}
    cid, item = s_(p.get("candidate_id")), s_(p.get("item_id"))
    if not cid:
        return _refuse(400, "candidate_id is required.")
    name = s_(p.get("filename")) or (item + ".bin")
    got = drive_file(sess, p, item + "-" + cid + "-" + name, "", _keep_here, True)
    if got.get("refused"):
        return got["refused"]
    mirrored = mirror(sess.reads.need_drive(), got["id"], got["name"])
    return {"status": 200, "data": SG.seal(TABLE_DOOR, SG.actor(sess.user), {
        "item": item, "cid": cid, "label": name, **_filed(got), "mirrored": mirrored})}


def table_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tableDocUpload's paths that are not a catalog document (app/files_docs.py asks this once its own gate let the
    press in): a résumé as resumeUpload files it, a CJIS report as cjisUpload does, any other item in Uploads."""
    p = payload if isinstance(payload, dict) else {}
    item = s_(p.get("item_id"))
    if item == "resume":
        return resume_prepare(sess, p, TABLE_DOOR, True)
    if item == "cjis":
        return cjis_prepare(sess, p, TABLE_DOOR, True)
    return item_prepare(sess, p)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "resumeUploadPrepare": lambda sess, p: resume_prepare(sess, p),
    "cjisUploadPrepare": lambda sess, p: cjis_prepare(sess, p)}
POLICY: dict[str, dict[str, Any]] = {
    "resumeUploadPrepare": {"roles": ("admin", "manager")}, "cjisUploadPrepare": {"roles": ("admin", "manager")}}
