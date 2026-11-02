"""UI Reports: the estate's unusual incidents (Asa | UIs and MUIs (Responses) › UIs and MUIs) read off asa-hub-db, as
Estate.gs estateRoute_ lists and gets them, a client's list cut to their own rows as hubClientNarrowList_ cuts it; a
row the screen removed (app/ops_stragglers_writes.py) left out until the copy no longer holds it."""
from __future__ import annotations

from typing import Any, Callable

import dr_appointments as DR
import gsjs
import locations as L
import row_ops as RO

APP_ID = "ui-incidents"
RESOURCE = "uiIncidents"


def rows_of(reads: L.Reads) -> list[dict]:
    """estateRows_('uiIncidents') as the sheet will hold them once each delete on its way is carried."""
    prop, tab = L.ESTATE_SOURCES[RESOURCE]
    return RO.unremoved_estate(reads, gsjs.or_blank(reads.db.prop(prop)), tab, reads.estate(RESOURCE))


def _readable(sess: L.Session) -> tuple[dict | None, list[dict]]:
    """(the refusal, the rows this session reads): every row for an employee and the service, a client's own."""
    user = sess.user or {}
    service = user.get("is_service") is True
    role = gsjs.js_str(user.get("role")).lower()
    if not service and role not in DR.EMPLOYEES + DR.CLIENTS:
        return DR.REFUSED, []
    return None, DR.readable_rows(sess, rows_of(sess.reads))


def ui_incidents_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """estateRoute_ list: the rows this session reads, narrowed by `q` across every cell."""
    shut, rows = _readable(sess)
    if shut:
        return shut
    q = gsjs.trim(gsjs.or_text((payload or {}).get("q"))).lower()
    if q:
        rows = [r for r in rows if any(q in gsjs.js_str(v).lower() for v in r.values())]
    return {"status": 200, "data": rows}


def ui_incidents_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """estateRoute_ get: one row by its id (r<sheet row>)."""
    shut, rows = _readable(sess)
    if shut:
        return shut
    rid = gsjs.trim(gsjs.or_text((payload or {}).get("id")))
    hit = next((r for r in rows if r.get("id") == rid), None)
    if hit is None:
        return {"status": 404, "message": f'No row "{rid}" in {RESOURCE}.'}
    return {"status": 200, "data": hit}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"uiIncidentsList": ui_incidents_list,
                                                                    "uiIncidentsGet": ui_incidents_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
