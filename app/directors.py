"""Directors on Python (Directors.gs directorsRoute_'s reads): the directory's `directors` tab, off asa-hub-db, shaped
as directorPublic_ shapes it. Its slice is filled by directorsList for the relay; a client reads none of it, as
hubClientNarrowAnswer_ answers a resource no client is declared on."""
from __future__ import annotations

import json
import math
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import smart_comms_desk as SCD

APP_ID = "directors"
RESOURCE = "directors"
DIRECTORS_TAB = "directors"
DIRECTORY_PROP = "HUB_DIRECTORY_ID"
BIO_LABELS = ("Background", "Leadership", "Today")
BIO_TINTS = ("lavender", "blue", "mint")

s_ = gsjs.str_


def _num(v: Any) -> int | float:
    """Number(v) || 0."""
    n = SCD.js_number(v)
    if math.isnan(n) or math.isinf(n) or not n:
        return 0
    return int(n) if n.is_integer() else n


def _parsed(raw: str) -> tuple[bool, Any]:
    try:
        return True, json.loads(raw)
    except ValueError:
        return False, None


def public(u: dict[str, Any]) -> dict[str, Any]:
    """directorPublic_."""
    ok, bio = _parsed(s_(u.get("bio")) or "[]")
    if not ok:
        bio = [s_(u.get("bio"))] if s_(u.get("bio")) else []
    if not isinstance(bio, list):
        bio = [gsjs.js_str(bio)]
    ok, career = _parsed(s_(u.get("career")) or "[]")
    if not ok or not isinstance(career, list):
        career = []
    avatar = s_(u.get("avatar"))
    return {
        "id": s_(u.get("id")), "name": s_(u.get("name")), "title": s_(u.get("title")),
        "avatar": avatar, "photo": avatar,
        "email": s_(u.get("email")), "phone": s_(u.get("phone")), "office": s_(u.get("office")),
        "status": s_(u.get("status")) or "active",
        "tenure": s_(u.get("tenure")), "tenureYears": _num(u.get("tenureyears")),
        "focusAreas": [p.strip() for p in s_(u.get("focusareas")).split("|") if p.strip()],
        "bio": bio,
        "bioEntries": [{"time": BIO_LABELS[i] if i < len(BIO_LABELS) else f"Part {i + 1}",
                        "text": gsjs.js_str(t), "tint": BIO_TINTS[i % len(BIO_TINTS)]}
                       for i, t in enumerate(bio)],
        "career": career,
        "directReports": _num(u.get("directreports")),
        "housesOverseen": _num(u.get("housesoverseen")),
    }


def normalized(reads: L.Reads) -> list[dict[str, Any]]:
    """readTabNormalized_ of the directors: their own table once kept there, else the Directory's tab."""
    if HT.tabled(DIRECTORS_TAB):
        return hubdb.normalize(*HT.raw(reads, DIRECTORS_TAB))
    sid = reads.db.prop(DIRECTORY_PROP)
    ref = reads.tab_of(sid, DIRECTORS_TAB, "the directory") if sid else None
    if ref is None:
        raise LookupError("Talent tab missing: " + DIRECTORS_TAB)
    return reads.db.normalized_rows(ref)


def all_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """directorsAll_: every director with an id and a name, in the tab's order."""
    return [d for d in (public(u) for u in normalized(reads)) if d["id"] and d["name"]]


def _client(user: dict[str, Any] | None) -> bool:
    """hubClientNarrowAnswer_ narrows a client's session, or an SSA or a FAMILY whatever its role says (scope.role_counts), never the service's."""
    return bool(user) and not user.get("is_service") and (s_(user.get("role")) == "client"
                                                          or not sc.role_counts(user.get("types"), user.get("role")))


def directors_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('directors', 'list'): directorsRoute_ list, narrowed for a client to nothing."""
    try:
        rows = all_rows(sess.reads)
    except LookupError as exc:
        return {"status": 500, "message": str(exc)}
    return {"status": 200, "data": [] if rows and _client(sess.user) else rows}


def directors_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('directors', 'get'): directorById_, a client told the row is not here."""
    want = s_((payload or {}).get("id")) if isinstance(payload, dict) else ""
    try:
        hit = next((d for d in all_rows(sess.reads) if d["id"] == want), None)
    except LookupError as exc:
        return {"status": 500, "message": str(exc)}
    if hit is None:
        return {"status": 404, "message": f'No director "{want}".'}
    if _client(sess.user):
        return {"status": 404, "message": f'No "{RESOURCE}" record here.'}
    return {"status": 200, "data": hit}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"directorsList": directors_list,
                                                                    "directorsGet": directors_get}
# the generic verbs declare no roles; the door's own reading decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
