"""One signed packet form attached (Onboarding.gs packetUpload) on Python alone: the relay asks packetUploadPrepare
first — the file filed in the person's own folder under Onboarding Documents (made, and named on their candidate row,
when there is none) as the platform's account, and kept on the server — and packetUpload then records it on the packet
row, the file id before the signed flag, and answers the six forms' state as packetState does."""
from __future__ import annotations

import base64
import binascii
import logging
from datetime import timezone
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CDW
import candidates as CND
import drive_files as DF
import files_docs as FD
import hubdb
import locations as L
import onboarding as OB
import onboarding_writes as OW
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

ACTION, PREPARE = "packetUpload", "packetUploadPrepare"
ITEMS = {i[0]: {"id": i[0], "label": i[1], "col": i[2], "file": i[3]} for i in OB.PACKET_ITEMS}
NOT_INVITED = "No onboarding row for this person yet — they have not been invited."
UNREAD = "This could not be done just now — nothing was saved. Try again in a moment."

s_ = CND.s_


def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def _checked(sess: L.Session, p: dict) -> tuple[dict | None, dict | None, str, str, dict[str, Any] | None]:
    """The handler's refusals before the file: the gate, the form, and the person's packet row (the payload's person
    only for a caller entitled to name one) — (item, row, email, candidate id, refusal)."""
    shut = OB.lane(sess)
    if shut:
        return None, None, "", "", shut
    item = ITEMS.get(s_(p.get("item_id")))
    if item is None:
        return None, None, "", "", {"status": 400, "message": "Unknown packet form: " + s_(p.get("item_id"))}
    email, cid = OB.asked_for(sess, p)
    found = OB.find_row(sess.reads, email, cid)
    if found is None:
        return item, None, email, cid, {"status": 404, "message": NOT_INVITED}
    return item, found, email, cid, None


def state_of(found: dict | None) -> dict[str, Any]:
    """packetState's answer for one row: signed only with a file attached."""
    items = []
    for iid, label, col, fcol in OB.PACKET_ITEMS:
        if not found:
            items.append({"id": iid, "label": label, "status": "missing", "file_url": ""})
            continue
        signed = CND.packet_truthy(OB.field(found, col))
        fid = OB.field(found, fcol)
        items.append({"id": iid, "label": label, "status": ("signed" if fid else "claimed") if signed else "missing",
                      "file_url": OB.drive_url(fid) if fid else ""})
    return {"status": 200, "data": {"found": bool(found), "candidate_name": OB.field(found, "CandidateName"),
                                    "items": items, "done": sum(1 for i in items if i["status"] == "signed"),
                                    "total": len(items)}}


def prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetUpload's slow half: the file filed as item__day__name in the person's own folder (filesCandidateFolder_)
    and kept on the server; the write then records it."""
    try:
        return _prepare(sess, _payload(payload))
    except (Defer, hubdb.Unreadable) as exc:
        log.info("packet upload: not prepared (%s)", exc)
        return {"status": 503, "message": UNREAD}


def _prepare(sess: L.Session, p: dict) -> dict[str, Any]:
    item, found, email, cid, refused = _checked(sess, p)
    if refused:
        return refused
    b64 = s_(p.get("base64"))
    if not b64 or b64 == "kept":
        return {"status": 400, "message": "No file attached"}
    try:
        data = base64.b64decode("".join(b64.split()), validate=True)
    except (binascii.Error, ValueError):
        return {"status": 500, "message": "Internal error: Could not decode string."}
    if not data:
        return {"status": 400, "message": "The file is empty"}
    if len(data) > OB.MAX_BYTES:
        return {"status": 400, "message": "The file is over 15MB"}
    reads = sess.reads
    key = cid or email
    c = CP.cand_row(reads, key)
    if not c:
        return {"status": 500, "message": "Internal error: Unknown candidate: " + key}
    original = s_(p.get("filename")) or (item["id"] + ".pdf")
    mime = s_(p.get("mime_type")) or OB.OCTET
    name = item["id"] + "__" + reads.now.astimezone(timezone.utc).strftime("%Y-%m-%d") + "__" + original
    try:
        drv = reads.need_drive()
        folder = DF.folder(drv, c.get("docsfolderid"))
        if folder is None:
            label = s_(c.get("candidatename")) or key
            folder = DF.child(drv, s_(DF.branch(reads, drv, FD.DOCS_NAME, FD.DOCS_PROP).get("id")),
                              label + " — " + key)
        filed = drv.upload_into(s_(folder.get("id")), name, mime, data)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.warning("packet upload: the form was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": OW.NOT_FILED}
    fid = s_(filed.get("id"))
    path = OB.keep(found["subject"], item["id"], fid, name, mime, data, s_((sess.user or {}).get("email")))
    return {"status": 200, "data": {"item_id": item["id"], "drive_id": fid, "candidate": key,
                                    "folder_id": s_(folder.get("id")), "name": name, "mime": mime,
                                    "size": len(data), "path": path}}


def upload(sess: L.Session, payload: dict) -> Decision:
    """packetUpload: the signed form the relay filed (packetUploadPrepare) recorded on the packet row — the file id
    before the signed flag, so a crash leaves "no file", never "signed, file missing" — and the six forms' state."""
    try:
        return _upload(sess, _payload(payload))
    except (Defer, hubdb.Unreadable) as exc:
        log.info("packet upload: not kept (%s)", exc)
        return W.refuse(503, UNREAD)


def _upload(sess: L.Session, p: dict) -> Decision:
    item, found, email, cid, refused = _checked(sess, p)
    if refused:
        return Decision(refused)
    b64 = s_(p.get("base64"))
    if not b64:
        return W.refuse(400, "No file attached")
    prep = OW._prepared(p, "base64", found["subject"], item["id"])
    key = cid or email
    if prep is None or s_(prep.get("item_id")) != item["id"] or s_(prep.get("candidate")) != key:
        return W.refuse(409, OW.MISMATCH)
    if not found.get("subject"):
        return W.refuse(503, UNREAD)
    reads = sess.reads
    now = W.now_iso(reads)
    fid = s_(prep.get("drive_id"))
    by = OW._who(sess)
    cells = {item["file"]: fid, item["col"]: "TRUE", "updated_by": by, "updated_at": now}
    recs = OW._packet_facts(reads, found, cells, now)
    folder = s_(prep.get("folder_id"))
    if folder and folder != s_(CP.cand_row(reads, key).get("docsfolderid")):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, key, {"docs_folder_id": folder}, "runtime-sheet", key, "", at=now)
    staff_views.record(sess.user, "packet_upload", item["label"])
    return OW._final(state_of(OB.laid(found, cells)), recs, found["subject"])


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {PREPARE: prepare}
READ_POLICY: dict[str, dict[str, Any]] = {PREPARE: {}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {ACTION: upload}
POLICY: dict[str, dict[str, Any]] = {ACTION: {}}
BUSY_OF: dict[str, dict[str, Any]] = {ACTION: {"status": 409, "message": W.BUSY}}
