"""Prefs.gs's doors Python answers behind their switch (`prefs`): the document collections (collectionsList; a new one
is app/prefs_writes.py's collectionCreate) and the master's Potential Clients views policy (potClientsViewsPolicy),
off asa-hub-db. The preferences blob, the sidebar shelf, the company menu, the access matrices and hubBoot stay Apps
Script's (their writers, and sign-in, are still there)."""
from __future__ import annotations

import math
import re
from typing import Any, Callable

import app_control as AC
import candidates as CND
import door_gate as DG
import gsjs
import locations as L

APP_ID = "prefs"
COLLECTIONS_TAB = "document_collections"
COLLECTIONS_HEADER = ("id", "label", "icon", "tint", "sort", "created_at", "created_by")
# THE SAME FOUR THE SHELL KNOWS.
POTCLIENTS_VIEW_IDS = ("unique", "pipeline", "compare", "funnel")
POTCLIENTS_VIEWS_KEY = "potclients_views_master"

s_ = gsjs.str_


def or_number(v: Any, fallback: Any) -> Any:
    """Number(v) || fallback."""
    n = CND.js_number(v)
    if n != n or n == 0:
        return fallback
    return int(n) if math.isfinite(n) and n == int(n) and abs(n) < 1e15 else n


def collections(reads: L.Reads) -> list[dict[str, Any]]:
    """collectionsList's list: each row with an id, sorted by its sort (99 when none)."""
    out = []
    for r in AC.tab_rows(reads, COLLECTIONS_TAB):
        rid = s_(r.get("id"))
        if not rid:
            continue
        out.append({"id": rid, "label": s_(r.get("label")) or rid, "icon": s_(r.get("icon")) or "folder",
                    "tint": s_(r.get("tint")) or "blue", "sort": or_number(r.get("sort"), 99)})
    out.sort(key=lambda c: c["sort"])
    for c in out:
        # JSON.stringify writes an infinite number as null
        if isinstance(c["sort"], float) and not math.isfinite(c["sort"]):
            c["sort"] = None
    return out


def collections_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """collectionsList: the Documents app's collections."""
    refused = DG.refusal(sess, "collectionsList", payload, GS_POLICY)
    if refused:
        return refused
    return {"status": 200, "data": {"collections": collections(sess.reads)}}


def pot_clients_views_policy(sess: L.Session, payload: dict) -> dict[str, Any]:
    """potClientsViewsPolicy: which Potential Clients views exist for anybody — the master's config row, else all four;
    a row naming none of them leaves the pipeline. A config that cannot be read is no answer here, never every view."""
    refused = DG.refusal(sess, "potClientsViewsPolicy", payload, GS_POLICY)
    if refused:
        return refused
    raw = s_((sess.reads.config() or {}).get(POTCLIENTS_VIEWS_KEY))
    if raw:
        views = [v for v in (gsjs.trim(x).lower() for x in re.split(r"[,;|]", raw)) if v in POTCLIENTS_VIEW_IDS]
    else:
        views = list(POTCLIENTS_VIEW_IDS)
    if not views:
        views = ["pipeline"]
    return {"status": 200, "data": {"views": views}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "collectionsList": collections_list, "potClientsViewsPolicy": pot_clients_views_policy}
# HUB_POLICY as Prefs.gs declares it, asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {"collectionsList": {}, "potClientsViewsPolicy": {},
                                        "collectionCreate": {"roles": ("admin", "manager")}}
# main.policy_gate asks nothing: each door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
