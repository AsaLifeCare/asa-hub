"""The Family Portal on Python (the client portal's home and its letters home): the client directory (route('clients'):
clientsDerived_, the plans with the Hub's clients rows over them, as their owners keep them) and the care letters
(Main.gs RESOURCES.careDocs, a clinical tab), the letters in Postgres (app.resource_rows, uploaded from care_docs as the
app is given to Python) and read and written there alone — a client sees only their own record and their own letters, a
trainee no letter."""
from __future__ import annotations

from typing import Any, Callable

import clients as C
import gsjs
import locations as L
import scope as sc
import sheet_resources as SR
from scope import Defer

APP_ID = "family-portal"
LETTERS = "careDocs"

s_ = gsjs.str_


def _client(user: dict) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (scope.role_counts): its own clients' rows alone."""
    return not user.get("is_service") and (s_(user.get("role")) == "client"
                                           or not sc.role_counts(user.get("types"), user.get("role")))


def _away(user: dict) -> None:
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")


def _theirs(row: dict, key: str) -> bool:
    """hubRowIsClients_ for a client's own key: a client column naming it, or the id the client resources mint."""
    if not key:
        return False
    for k, v in row.items():
        if "client" in str(k).lower() and gsjs.trim(gsjs.or_text(v)) in (key, "CLI_" + key):
            return True
    return s_(row.get("id")) == "CLI_" + key


def _page(rows: list[dict], p: dict) -> list[dict]:
    """listRows_' q, offset and limit."""
    q = gsjs.trim(gsjs.js_str(p.get("q"))).lower() if p.get("q") is not None else ""
    if q:
        rows = [r for r in rows if any(q in gsjs.js_str(v).lower() for v in r.values())]
    try:
        offset = max(0, int(float(p.get("offset") or 0)))
    except (TypeError, ValueError):
        offset = 0
    try:
        limit = int(float(p["limit"])) if p.get("limit") not in (None, "") else -1
    except (TypeError, ValueError):
        limit = -1
    return rows[offset:] if limit < 0 else rows[offset:offset + limit]


def _clients(sess: L.Session) -> list[dict]:
    user = sess.user or {}
    _away(user)
    rows = [dict(r) for r in (C.derived(sess.reads) or [])]
    if _client(user):
        # a client its own record; an SSA or a FAMILY the clients its Clients scope holds
        keys = ([s_(user.get("client_key"))] if s_(user.get("client_key")) else []) \
            if sc.role_counts(user.get("types"), user.get("role")) \
            else sorted(k for k in ((C.reader(sess) or {}).get("keys") or {}) if k)
        rows = [r for r in rows if any(gsjs.trim(gsjs.or_text(r.get("client_key"))) == k or _theirs(r, k)
                                       for k in keys)]
    return rows


def clients_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('clients', 'list')."""
    return {"status": 200, "data": _page(_clients(sess), payload if isinstance(payload, dict) else {})}


def clients_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('clients', 'get')."""
    want = gsjs.js_str((payload or {}).get("id")) if isinstance(payload, dict) else ""
    if not want:
        return {"status": 400, "message": 'Missing required "id" in payload.'}
    hit = next((r for r in _clients(sess) if gsjs.js_str(r.get("id")) == want), None)
    if hit is None:
        return {"status": 404, "message": f'No row "{want}" in clients.'}
    return {"status": 200, "data": hit}


def letters_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('careDocs', 'list'), out of Postgres."""
    return SR.list_rows(sess, LETTERS, payload)


def letters_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('careDocs', 'get'), out of Postgres."""
    return SR.get_row(sess, LETTERS, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "familyPortalClientsList": clients_list, "familyPortalClientsGet": clients_get,
    "careDocsList": letters_list, "careDocsGet": letters_get}
# the generic verbs declare no roles; the door's own reading decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
