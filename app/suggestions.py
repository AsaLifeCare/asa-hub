"""Suggestions (Suggestions.gs suggestionsList): the box the master alone reads — every suggestion kept in
app.suggestions, and any the entity_suggestions tab holds, newest first. Anybody else is told the door does not
exist."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import scope as sc

APP_ID = "suggestions"
TABLE = "app.suggestions"
TAB = "entity_suggestions"
UNKNOWN = {"status": 404, "message": "Unknown action."}

s_ = gsjs.str_


def kept(reads: L.Reads) -> list[dict[str, str]]:
    """The suggestions the Hub's database keeps, and the tab's rows when the copy holds the tab."""
    out: dict[str, dict[str, str]] = {}
    res = reads.db.resolve(TAB)
    if res.ref is not None and not res.runtime:
        for r in reads.db.normalized_rows(res.ref):
            sid = s_(r.get("suggestionid"))
            if sid:
                out[sid] = {"id": sid, "at": s_(r.get("createdat")), "by": s_(r.get("byname")) or s_(r.get("byemail")),
                            "email": s_(r.get("byemail")), "role": s_(r.get("role")), "text": s_(r.get("text"))}
    for sid, at, email, name, role, text in reads.db.query(
            f"select suggestion_id, created_at, by_email, by_name, role, text from {TABLE}"):
        out[sid] = {"id": sid, "at": gsjs.iso(at), "by": name or email, "email": email, "role": role, "text": text}
    return sorted(out.values(), key=lambda r: r["at"], reverse=True)


def suggestions_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """suggestionsList: the master's own session alone; a 404 that never says the box exists for anybody else."""
    user = sess.user or {}
    if not sc.is_real_master(user):
        return UNKNOWN
    return {"status": 200, "data": {"rows": kept(sess.reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"suggestionsList": suggestions_list}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
