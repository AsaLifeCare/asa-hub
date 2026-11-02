"""Settings › Alerts I receive on Python behind its switch (`alert-receive`): each director, and the master, reads and
sets for themselves whether No Call No Show, "<person> is not punching in" and Incident filed reach them
(AlertReceive.gs). Kept in the Support Requests settings house, one row per person (`receive_off:<uid>`, the parts
turned off) — the house app/support_desk_writes.py reads and writes; a save is app/alert_receive_writes.py's."""
from __future__ import annotations

import re
from typing import Any, Callable

import door_gate as DG
import locations as L
import scope as sc
import support_desk_writes as SDW
from scope import Defer

APP_ID = "alert-receive"
PARTS = ("no_call", "punch", "incident")
KEY_PREFIX = "receive_off:"
SETTINGS = SDW.TABS["settings"]
NOT_SET_UP = "The Support Requests settings are not set up yet, so a choice cannot be kept."
UNREAD = "Your alert choices could not be read just now ({}) — every alert still reaches you."
_ROLES = ("admin", "director", "manager", "staff")

s_ = SDW.s_


def is_part(part: Any) -> bool:
    """arIsPart_."""
    return s_(part) in PARTS


def parts_of(raw: Any) -> list[str]:
    """arPartsOf_: the parts a stored cell names, in catalogue order, each once; anything else in it is ignored."""
    named = re.split(r"[,;\s]+", s_(raw).lower())
    return [p for p in PARTS if p in named]


def stored(reads: L.Reads) -> dict[str, Any]:
    """arStoredRead_: {readable, set_up, why, off: {uid: {part: True}}} as the house keeps them."""
    out: dict[str, Any] = {"readable": True, "set_up": reads.db.house_moved(SETTINGS), "why": "", "off": {}}
    if not out["set_up"]:
        return out
    try:
        rows = SDW.tab_rows(reads, SETTINGS)
    except Defer as exc:
        return {"readable": False, "set_up": True, "off": {},
                "why": f'The Support Requests house "{SETTINGS}" could not be read: {str(exc)[:200]}'[:240]}
    for r in rows:
        key = s_(r.get("key"))
        if not key.startswith(KEY_PREFIX):
            continue
        uid = key[len(KEY_PREFIX):]
        parts = parts_of(r.get("value"))
        if not uid or not parts:
            continue
        out["off"][uid] = {p: True for p in parts}
    return out


def gate(reads: L.Reads, user: dict[str, Any] | None) -> dict[str, str] | None:
    """arGate_: the master's own session, or a director on the list; None for anybody else, the service and a visit."""
    if not user or user.get("is_service") or SDW.visiting(user):
        return None
    uid = s_(user.get("id"))
    if not uid:
        return None
    if sc.is_real_master(user):
        return {"uid": uid, "as": "master", "name": SDW.actor_name(user)}
    if any(d.get("uid") == uid for d in SDW.directors(reads).get("list") or []):
        return {"uid": uid, "as": "director", "name": SDW.actor_name(user)}
    return None


def answer(g: dict[str, str], off: dict[str, bool] | None, set_up: Any) -> dict[str, Any]:
    """arAnswer_."""
    return {"as": g["as"], "receive": {p: not (off and off.get(p) is True) for p in PARTS},
            "saveable": set_up is not False, "why": NOT_SET_UP if set_up is False else ""}


def receive_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """alertReceiveGet: the caller's own three choices; 404 for anybody who does not hold the section."""
    refused = DG.refusal(sess, "alertReceiveGet", payload, GS_POLICY)
    if refused:
        return refused
    g = gate(sess.reads, sess.user)
    if not g:
        return dict(DG.UNKNOWN)
    st = stored(sess.reads)
    if not st["readable"]:
        return {"status": 503, "message": UNREAD.format(st["why"])}
    return {"status": 200, "data": answer(g, st["off"].get(g["uid"]), st["set_up"])}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"alertReceiveGet": receive_get}
# HUB_POLICY as AlertReceive.gs declares it, asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {
    "alertReceiveGet": {"roles": _ROLES},
    "alertReceiveSet": {"roles": _ROLES, "params": {"part": {"type": "string"}, "receive": {"type": "boolean"}}}}
# main.policy_gate asks nothing: each door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
