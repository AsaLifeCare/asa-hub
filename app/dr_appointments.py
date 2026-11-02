"""Dr Appointments: the estate's doctor book (Dr Appointments (Responses)) read off asa-hub-db — the Dr Master roster
(drAppointments) and the booked visits in the Dr Appt Archive (drVisits), their own tables once Postgres keeps them
(app/dr_book.py) — as Estate.gs estateRoute_ lists and gets them, a client's list cut to their own rows as
hubClientNarrowList_ cuts it. Read only here: Clients › Appointments books the visits and adds the doctors."""
from __future__ import annotations

from typing import Any, Callable

import client_sources as CS
import clients as C
import gsjs
import locations as L
import scope as sc
from gsjs import name_key

APP_ID = "dr-appointments"
RESOURCES = ("drAppointments", "drVisits")
EMPLOYEES = ("admin", "director", "manager", "staff")
# a client's own rows, by the key and the name the clients' merge gives it
CLIENTS = ("client", "guardian")
REFUSED = {"status": 403, "message": "These records are for employees on shift."}


def _client_names(reads: L.Reads, key: str) -> set[str]:
    """hubClientIdentity_'s names: the key itself and the name the merge spells for it, folded."""
    names = {key}
    for c in C.derived(reads):
        if gsjs.trim(gsjs.or_text(c.get("client_key"))) == key:
            n = name_key(c.get("name"))
            if n:
                names.add(n)
    return names


def _theirs(row: dict, key: str, names: set[str]) -> bool:
    """hubRowIsClients_'s generic reading: any field whose name speaks of a client names this one."""
    for k, v in row.items():
        if "client" not in str(k).lower():
            continue
        val = gsjs.trim(gsjs.or_text(v))
        if val and (val in (key, "CLI_" + key) or name_key(val) in names):
            return True
    return False


def _readable(sess: L.Session, resource: str) -> tuple[dict | None, list[dict]]:
    """(the refusal, the rows this session reads): every row for an employee and the service, a client's own."""
    user = sess.user or {}
    service = user.get("is_service") is True
    role = gsjs.js_str(user.get("role")).lower()
    if not service and role not in EMPLOYEES + CLIENTS:
        return REFUSED, []
    return None, readable_rows(sess, CS.estate_rows(sess.reads, resource))


def readable_rows(sess: L.Session, rows: list[dict]) -> list[dict]:
    """Every row for an employee and the service; a client's own; an SSA's or a FAMILY's, whatever its role says
    (scope.role_counts), the clients its Clients scope holds (the operator's sheet: only their client)."""
    user = sess.user or {}
    role = gsjs.js_str(user.get("role")).lower()
    counts = sc.role_counts(user.get("types"), user.get("role"))
    if user.get("is_service") is True or (role in EMPLOYEES and counts):
        return rows
    if counts:
        key = gsjs.trim(gsjs.or_text(user.get("client_key")))
        keys = [key] if key else []
    else:
        keys = sorted(k for k in ((C.reader(sess) or {}).get("keys") or {}) if k)
    out: list[dict] = []
    for key in keys:
        names = _client_names(sess.reads, key)
        out += [r for r in rows if _theirs(r, key, names) and not any(r is o for o in out)]
    return out


def _list(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """estateRoute_ list: the rows, narrowed by `q` across every cell."""
        shut, rows = _readable(sess, resource)
        if shut:
            return shut
        q = gsjs.trim(gsjs.or_text((payload or {}).get("q"))).lower()
        if q:
            rows = [r for r in rows if any(q in gsjs.js_str(v).lower() for v in r.values())]
        return {"status": 200, "data": rows}
    return door


def _get(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """estateRoute_ get: one row by its id (r<sheet row>)."""
        shut, rows = _readable(sess, resource)
        if shut:
            return shut
        rid = gsjs.trim(gsjs.or_text((payload or {}).get("id")))
        hit = next((r for r in rows if r.get("id") == rid), None)
        if hit is None:
            return {"status": 404, "message": f'No row "{rid}" in {resource}.'}
        return {"status": 200, "data": hit}
    return door


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "drAppointmentsList": _list("drAppointments"), "drAppointmentsGet": _get("drAppointments"),
    "drVisitsList": _list("drVisits"), "drVisitsGet": _get("drVisits")}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
