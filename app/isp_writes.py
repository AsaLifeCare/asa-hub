"""The ISP Library's writes (the generic create, update and delete on `isps`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a plan's fields edited, a plan added or removed, a client writing only their own (clientScoped);
ispIntakeKeep files what the intake read (isp_intake). ispsUpload brings the isps and isp_sections sheets into Postgres
again for the relay (rows nothing here has touched), and hands them back as the app returns to Apps Script."""
from __future__ import annotations

import time
from typing import Any, Callable

import gsjs
import isp as ISP
import isp_intake as II
import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing the service plans right now — try again."

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, ISP.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, ISP.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, ISP.RESOURCE, payload)


def intake_keep(sess: L.Session, payload: dict) -> Decision:
    """ispIntakeKeep (the relay's own): what ispIntakeFetch read, filed — a new plan's row and its sections, a plan's
    sections replaced, a failed try counted toward its next one — and the answer the person who asked is given."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    II.owned(reads)
    p = payload if isinstance(payload, dict) else {}
    items = [i for i in p.get("items") or [] if isinstance(i, dict)]
    answer: dict[str, Any] = {"status": 200, "data": {"items": 0}}
    tried: dict[str, dict | None] = {}
    held = II.tries(reads)
    now_ms = int(time.time() * 1000)
    for it in items:
        kind = s_(it.get("kind"))
        if kind == "plan":
            rec = dict(it.get("record") or {})
            key = s_(rec.get("client_key"))
            if not it.get("redo") and any(s_(r.get("client_key")) == key for r in SR.rows(reads, ISP.RESOURCE)):
                answer = {"status": 409, "message": s_(rec.get("client_name")) + " already has a plan on file. Filing"
                          " \"" + s_(rec.get("source_file")) + "\" would be a second row for one person — use "
                          "ispIntakeRedo to replace the one that is there.", "data": {"filed": ""}}
                continue
            now = II._now_iso()
            RR.create(reads, ISP.RESOURCE, {**rec, "createdAt": now, "updatedAt": now}, II.INTAKE_ACTOR["email"])
            II.log_line(II.INTAKE_ACTOR, "isp_filed", f"{s_(rec.get('client_name'))} — {s_(rec.get('source_file'))}"
                        f" ({s_(rec.get('page_count'))} pages)")
            # every new plan also files its sections (routines, important people, supports) for the Clients app
            got = II.write_sections(reads, key, s_(rec.get("isp_year")), s_(rec.get("source_file")),
                                    it.get("cut") or {}, II.INTAKE_ACTOR["email"])
            answer = {"status": 200, "data": {
                "filed": s_(rec.get("client_name")), "source_file": s_(rec.get("source_file")),
                "pages": int(s_(rec.get("page_count")) or 0) or "", "pending": it.get("pending"),
                "seen": it.get("seen"), "empty_sections": it.get("empty_sections") or [],
                "sections_filed": got.get("rows", 0), "sections_why": s_((got.get("refused") or {}).get("message"))}}
        elif kind == "sections":
            key = s_(it.get("key"))
            got = II.write_sections(reads, key, s_(it.get("isp_year")), s_(it.get("source")), it.get("cut") or {},
                                    s_(p.get("by")) if p.get("asked") and s_(p.get("by")) else II.SWEEP_ACTOR["email"])
            if got.get("refused"):
                answer = got["refused"]
                continue
            if key in held:
                tried[key] = None
            if p.get("asked"):
                book = II.plans_book(reads)
                pending = sum(1 for r in book["plans"] if not book["filed"].get(II._js_trim(r.get("client_key"))))
                II.log_line({"email": s_(p.get("by")), "display_name": s_(p.get("by"))}, "clientProfileIspSections",
                            key)
                answer = {"status": 200, "data": {
                    "filed": s_(it.get("client_name")), "client_key": key, "isp_year": s_(it.get("isp_year")),
                    "source_file": s_(it.get("source")), "rows": got["rows"], "sections": got["sections"],
                    "absent": got["absent"], "pending": pending}}
        elif kind == "refused":
            key = s_(it.get("key"))
            status = int(it.get("status") or 500)
            if p.get("asked"):
                answer = {"status": status, "message": s_(it.get("message"))}
                continue
            n = int((held.get(key) or {}).get("n") or 0) + 1
            wait = min(II.WAIT_S * 2 ** (n - 1), II.WAIT_CAP_S)
            tried[key] = {"n": n, "next": now_ms + wait * 1000, "status": status}
            II.log_line(II.SWEEP_ACTOR, "clientIspSectionsSweep", key)
    if tried:
        II.keep_tries(reads, tried)
    if not p.get("asked") and not any(s_(i.get("kind")) == "plan" for i in items):
        answer = {"status": 200, "data": {"filed": sum(1 for i in items if s_(i.get("kind")) == "sections"),
                                          "failed": sum(1 for i in items if s_(i.get("kind")) == "refused")}}
    return Decision(answer, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "ispsCreate": create, "ispsUpdate": update, "ispsDelete": delete, "ispIntakeKeep": intake_keep,
    "ispsUpload": RR.upload_door({ISP.RESOURCE: SR.SPECS[ISP.RESOURCE],
                                  II.SECTIONS: SR.SPECS[II.SECTIONS]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.isp_writes and app.isp_receipts; the plans app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="isp", label="ISP Library")
