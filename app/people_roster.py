"""The roster's generic list and get (Main.gs route('people', …) on RESOURCES.people, the People house) read off
asa-hub-db for the person asking — Payroll & Hours and the Training Tracker read `people` through them whenever its
slice cannot answer: the list merged by the roster lens (peopleMerged_) and without the plans' clients
(withoutIspClients_), one row as requireRow_ finds it; a client is shown no one. The slice stays the Dashboard's door
(opsdash.people_slice); a create, update or delete stays Apps Script's."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import opsdash as OD
import scope as sc
import sheet_resources as SR
import staff as SP
from scope import Defer

APP_ID = "people-roster"
RESOURCE = "people"
NO_ID = 'Missing required "id" in payload.'

s_ = gsjs.str_


def _homed_away(user: dict) -> None:
    """route()'s place lane: an account homed away from headquarters reads its place's rows, Apps Script's."""
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")


def people_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('people', 'list'): listRows_ (its offset and limit; a full-text q is not served here), merged by the
    roster lens and without the plans' clients; a client is shown no one (hubClientNarrowList_: `people` is neither
    open to clients nor narrowed to their own rows)."""
    user = sess.user or {}
    if SR._client(user):
        return {"status": 200, "data": []}
    _homed_away(user)
    p = payload if isinstance(payload, dict) else {}
    if p.get("q") is not None and gsjs.trim(gsjs.js_str(p.get("q"))):
        raise Defer("a full-text list is listRows_'s own")
    reads = sess.reads
    rows = SP._people(reads)
    offset = SR._int(p.get("offset"))
    offset = 0 if offset is None or offset < 0 else offset
    limit = SR._int(p.get("limit"))
    rows = rows[offset:] if limit is None or limit < 0 else rows[offset:offset + limit]
    return OD._answer(list(SP.without_isp_clients(reads, SP.people_merged(reads, rows)) or []))


def people_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('people', 'get'): requireRow_ — the first row with this id, as the tab holds it — then "not yours" read
    as "not here" for a client."""
    user = sess.user or {}
    _homed_away(user)
    p = payload if isinstance(payload, dict) else {}
    rid = p.get("id")
    if rid is None or rid == "":
        return {"status": 400, "message": NO_ID}
    want = gsjs.js_str(rid)
    row = next((r for r in SP._people(sess.reads) if "id" in r and gsjs.js_str(r["id"]) == want), None)
    if row is None:
        return {"status": 404, "message": f'No "{RESOURCE}" record with id "{want}".'}
    if SR._client(user):
        return {"status": 404, "message": f'No row "{want}" in {RESOURCE}.'}
    if OD._withheld([row]):
        raise Defer("the copy withholds a cell this row shows")
    return {"status": 200, "data": row}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"peopleList": people_list,
                                                                    "peopleGet": people_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
