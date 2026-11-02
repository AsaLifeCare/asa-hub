"""The hotline's two remaining lanes (Estate.gs ESTATE_SOURCES supportQueue, dailyNotes) read off asa-hub-db, as
estateRoute_ lists and gets them: the support queue (EMP360_WORK_QUEUE_ID › Requests) and the daily notes
(ESTATE_NOTES_ID › Notes). Read only: the hotline's filing (hotline_file) is their writer."""
from __future__ import annotations

from typing import Any, Callable

import dr_appointments as DR
import gsjs
import hubdb
import locations as L
import slice_gate

APP_ID = "hotline"
LANES = {"supportQueue": ("EMP360_WORK_QUEUE_ID", "Requests"), "dailyNotes": ("ESTATE_NOTES_ID", "Notes")}


def rows(reads: L.Reads, resource: str) -> list[dict]:
    """estateRows_: the lane's tab, header-keyed, each row its r<sheet row> id; no tab, no rows."""
    def read() -> list[dict]:
        prop, tab = LANES[resource]
        sid = gsjs.trim(reads.db.prop(prop))
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot")
        return reads.db.estate_rows(reads.tab_of(sid, tab, f"the estate's {tab}"))
    return reads.once("estate:" + resource, read)


def _readable(sess: L.Session, resource: str) -> tuple[dict | None, list[dict]]:
    user = sess.user or {}
    if user.get("is_service") is not True and gsjs.js_str(user.get("role")).lower() not in DR.EMPLOYEES:
        return DR.REFUSED, []
    # the support queue follows its slice's verdict (slice_gate.OWNERS: the support-desk row), whatever the role says
    if user.get("is_service") is not True and resource in slice_gate.OWNERS_ALONE and not slice_gate.opens(sess, resource):
        return DR.REFUSED, []
    return None, rows(sess.reads, resource)


def _list(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """estateRoute_ list: the lane's rows, narrowed by `q` across every cell."""
        shut, got = _readable(sess, resource)
        if shut:
            return shut
        q = gsjs.trim(gsjs.or_text((payload or {}).get("q"))).lower()
        if q:
            got = [r for r in got if any(q in gsjs.js_str(v).lower() for v in r.values())]
        return {"status": 200, "data": got}
    return door


def _get(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """estateRoute_ get: one row by its id (r<sheet row>)."""
        shut, got = _readable(sess, resource)
        if shut:
            return shut
        rid = gsjs.trim(gsjs.or_text((payload or {}).get("id")))
        hit = next((r for r in got if r.get("id") == rid), None)
        if hit is None:
            return {"status": 404, "message": f'No row "{rid}" in {resource}.'}
        return {"status": 200, "data": hit}
    return door


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "supportQueueList": _list("supportQueue"), "supportQueueGet": _get("supportQueue"),
    "dailyNotesList": _list("dailyNotes"), "dailyNotesGet": _get("dailyNotes")}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
