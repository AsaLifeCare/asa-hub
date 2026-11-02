"""The Medications app's writes on Python (Meds.gs emarMedAdd / emarMedDelete, the generic verbs on medications and
medCatalog), kept in Postgres alone (app.resource_rows): a medicine added to a client's chart under the next Id - Auto,
one taken off by that id — the Clients page's door when it names its client. medicationsUpload brings both tabs into
Postgres as the app is given to Python."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import client_writes as CW
import gsjs
import locations as L
import medications as M
import resource_rows as RR
import sheet_resources as SR
import staff_views
import writes as W
from gsjs import name_key
from writes import Decision

BUSY = "The chart is busy — try again in a moment."
ID_H = "Id - Auto"

s_ = gsjs.str_


def door(sess: L.Session, key: Any) -> dict[str, Any]:
    """medsClientDoor_: the chart's writers as before, else a clients.medication edition holder for a client they read;
    a key → its client."""
    writer = CW.meds_may_write(sess.user)
    if not writer:
        shut = CW.edit_door(sess, {"client": key}, CW.EDITION["meds"])
        if shut:
            return {"refused": CW.door_refused(shut)}
    if not gsjs.falsy(key):
        ctx = CW.client_of(sess.reads, key)
        return {"refused": CW.door_refused(ctx["refused"])} if ctx.get("refused") else ctx
    return {} if writer else {"refused": W.refuse(400, "client: the client key the roster gives.")}


def _row_of(reads: L.Reads, mid: str) -> tuple[str, dict] | None:
    return next(((k, c) for k, c in RR.table_rows(reads, M.MEDS) if s_(c.get(ID_H)) == mid), None)


def med_add(sess: L.Session, payload: dict) -> Decision:
    """emarMedAdd: a row appended to the chart, its Id - Auto the next one."""
    p = payload if isinstance(payload, dict) else {}
    ctx = door(sess, p.get("client_key"))
    if ctx.get("refused"):
        return ctx["refused"]
    client = s_(ctx.get("name") or p.get("client")).strip()
    name = s_(p.get("name")).strip()
    if not client:
        return W.refuse(400, "Which client?")
    if not name:
        return W.refuse(400, "The medicine needs a name.")
    reads, user = sess.reads, sess.user or {}
    top = 0
    for _k, c in RR.table_rows(reads, M.MEDS):
        try:
            top = max(top, int(float(s_(c.get(ID_H)))))
        except ValueError:
            continue
    times = re.findall(r"\d{3,4}", s_(p.get("times")))
    mid = str(top + 1)
    cells = {ID_H: mid, "Client": client, "PrescriptionName": name, "Dosage": s_(p.get("dose")).strip(),
             "AdministrationTimes": " ".join('"' + t.zfill(4)[-4:] + '"' for t in times),
             "MedType": s_(p.get("route")).strip() or "Tablet",
             "PRN": s_(p.get("freq")).strip() or ("PRN" if s_(p.get("prn")) == "true" else "Daily"),
             "Added": s_(user.get("display_name")) or s_(user.get("email")),
             "Added Date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    RR.create(reads, M.MEDS, {k: v for k, v in cells.items() if v != ""}, s_(user.get("email")))
    if not ctx.get("key"):
        return Decision({"status": 200, "data": {"id": mid}}, subject="", own=True)
    return Decision(CW.edit_steps({"status": 200, "data": {"id": mid, "written": ["name", "dose", "times", "route",
                                                                                   "freq"]}}, "meds"),
                    subject=s_(ctx.get("key")), own=True)


def med_delete(sess: L.Session, payload: dict) -> Decision:
    """emarMedDelete: the row with this Id - Auto taken off the chart (the client's own when the call names one)."""
    p = payload if isinstance(payload, dict) else {}
    ctx = door(sess, p.get("client"))
    if ctx.get("refused"):
        return ctx["refused"]
    mid = s_(p.get("id"))
    if not mid:
        return W.refuse(400, "Which medicine?")
    reads, user = sess.reads, sess.user or {}
    cols = RR.columns(reads, M.MEDS)
    if ID_H not in cols or not RR.table_rows(reads, M.MEDS):
        return W.refuse(404, "The chart holds no such row.")
    hit = _row_of(reads, mid)
    if hit is None:
        return W.refuse(404, f'No medicine with id "{mid}" on the chart.')
    key, cells = hit
    if ctx.get("key") and name_key(cells.get("Client")) != name_key(ctx.get("name")):
        return W.refuse(409, "This medicine is not on this client's chart (it has moved) — nothing was removed.")
    RR.remove(reads, M.MEDS, key, cells, s_(user.get("email")))
    staff_views.record(user, "emarMedDelete", s_(cells.get("PrescriptionName")) if "PrescriptionName" in cols else mid)
    if not ctx.get("key"):
        return Decision({"status": 200, "data": {"removed": mid}}, subject="", own=True)
    return Decision(CW.edit_steps({"status": 200, "data": {"removed": mid, "written": ["removed"], "refused": []}},
                                  "meds"), subject=s_(ctx.get("key")), own=True)


def med_update(sess: L.Session, payload: dict) -> Decision:
    """emarMedUpdate on the kept chart: the Clients page's edit of one medicine, written into its row."""
    shut = CW.edit_door(sess, payload, CW.EDITION["meds"])
    if shut:
        return CW.door_refused(shut)
    reads, user = sess.reads, sess.user or {}
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    mid = gsjs.trim(s_(payload.get("id")))
    if not CW.MED_ID.match(mid):
        return W.refuse(400, "id: the medicine's chart id.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    hits = [(k, c) for k, c in RR.table_rows(reads, M.MEDS) if s_(c.get(ID_H)) == mid]
    if len(hits) != 1:
        return W.refuse(409 if hits else 404, "Two chart rows carry this id; neither was edited — reload the chart."
                        if hits else "No medicine with this id is on the chart.")
    key, cells = hits[0]
    if name_key(cells.get("Client")) != name_key(ctx["name"]):
        return W.refuse(409, "This medicine is not on this client's chart (it has moved) — nothing was written.")
    cols = RR.columns(reads, M.MEDS)
    row = RR.shown(cols, cells) or {}
    live = CW.C.scrub(CW.C.meds_edit_raw(row))
    out: dict[str, str] = {}
    written, refused, stale = [], [], {}
    for c in changes:
        f = c["field"]
        col = CW.C.MEDS_EDIT_COLUMNS.get(f)
        if not col:
            refused.append({"field": f, "why": "Not a field this panel edits."})
            continue
        if col not in cols:
            refused.append({"field": f, "why": "The chart has no " + col + " column."})
            continue
        now = CW.witness(c["expected"], live.get(f))
        if now is not None:
            stale[f] = now
            continue
        if f == "name" and not c["value"]:
            refused.append({"field": f, "why": "The medicine needs a name."})
            continue
        if f == "times":
            value = " ".join('"' + t.replace(":", "") + '"' for t in CW.C.meds_times(c["value"]))
        else:
            value = CW.js_cut(CW.fold_ws(c["value"]), 500)
        out[col] = value
        written.append({"field": f, "before": c["expected"], "after": value})
    answer = CW.stale_answer({"written": [w["field"] for w in written], "refused": refused}, stale, written, "meds")
    if written:
        RR.update(reads, M.MEDS, key, cells, out, s_(user.get("email")))
        staff_views.record(user, "emarMedUpdate",
                           s_(ctx.get("key")) + " #" + mid + ": " + ", ".join(w["field"] for w in written))
    return Decision(answer, subject=s_(ctx.get("key")), own=True)


def _kept(sess: L.Session) -> bool:
    return RR.uploaded(sess.reads.db, M.MEDS)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "emarMedAdd": med_add, "emarMedDelete": med_delete,
    "medicationsCreate": lambda s, p: SR.create_row(s, M.MEDS, p),
    "medicationsUpdate": lambda s, p: SR.update_row(s, M.MEDS, p),
    "medicationsDelete": lambda s, p: SR.delete_row(s, M.MEDS, p),
    "medCatalogCreate": lambda s, p: SR.create_row(s, M.CATALOG, p),
    "medCatalogUpdate": lambda s, p: SR.update_row(s, M.CATALOG, p),
    "medCatalogDelete": lambda s, p: SR.delete_row(s, M.CATALOG, p),
    "medicationsUpload": RR.upload_door({r: SR.SPECS[r] for r in (M.MEDS, M.CATALOG)})}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["emarMedAdd"] = {"roles": ("admin", "manager", "staff")}
POLICY["emarMedDelete"] = {"roles": ("admin", "manager", "staff")}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.medications_writes and app.medications_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="medications", label="Medications")
