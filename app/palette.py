"""The search bar's fallback on Python behind its switch (`palette`, Palette.gs paletteResolve): when the typed words
match no label, the model picks up to three of the destinations the browser offered, through screenAiChat_ as
app/client_care_sweeps.py asks it (its `ai_palette_search` row in Smart Comms' situations). Nothing is written and
nothing is sent: the model may only name ids the browser offered."""
from __future__ import annotations

import json
import time
from typing import Any, Callable

import client_care_sweeps as CCS
import door_gate as DG
import gsjs
import locations as L

APP_ID = "palette"
MAX_CHOICES = 60
REQUEST_ID = "ai_palette_search"
# the model is asked no longer than this, inside the relay's own wait for the answer
DEADLINE_S = 25.0
NOTHING = {"status": 400, "message": "Nothing to look for."}
NONE_OFFERED = {"status": 400, "message": "No destinations were offered."}
# a bare object's inherited names answer as present when looked up on it (byId)
_JS_INHERITED = frozenset({"constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString",
                           "valueOf", "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__",
                           "__lookupGetter__", "__lookupSetter__"})

s_ = gsjs.str_


def _field(item: Any, name: str) -> Any:
    """item && item[name]: a falsy item is itself, a record its field, anything else has none."""
    if gsjs.falsy(item):
        return item
    return item.get(name) if isinstance(item, dict) else None


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def palette_resolve(sess: L.Session, payload: dict) -> dict[str, Any]:
    """paletteResolve: up to three of the offered ids, best first, or none; the model's own name for itself in `via`."""
    refused = DG.refusal(sess, "paletteResolve", payload, GS_POLICY)
    if refused:
        return refused
    user = sess.user or {}
    if not user or user.get("is_service"):
        return dict(DG.DENIED)
    p = payload if isinstance(payload, dict) else {}
    phrase = s_(_field(p, "q"))[:120]
    if not phrase:
        return dict(NOTHING)
    raw = p.get("choices")
    if not isinstance(raw, list) or not raw:
        return dict(NONE_OFFERED)
    choices: list[dict[str, str]] = []
    by_id: set[str] = set()
    for item in raw:
        if len(choices) >= MAX_CHOICES:
            break
        cid, label = s_(_field(item, "id")), s_(_field(item, "label"))
        if not cid or cid in by_id or cid in _JS_INHERITED:
            continue
        by_id.add(cid)
        choices.append({"id": cid, "label": label or cid, "note": s_(_field(item, "note"))[:120]})
    if not choices:
        return dict(NONE_OFFERED)
    lines = "\n".join("- " + c["id"] + ": " + c["label"] + (" — " + c["note"] if c["note"] else "") for c in choices)
    ask = ("A person typed this into the search bar of a care-provider work platform:\n"
           '"' + phrase + '"\n\n'
           "Here are the ONLY places they can be sent. Choose the ones that answer "
           "what they typed — in the language they used or any other.\n"
           + lines + "\n\n"
           "Rules: choose ONLY from the ids above. Choose NOTHING rather than "
           "something loosely related. At most three, best first.\n"
           'Reply with JSON only: {"ids":["<id>", ...]}')
    try:
        res = CCS.ai_chat(sess.reads, ask, 0.1, REQUEST_ID, time.monotonic() + DEADLINE_S)
    except Exception:  # noqa: BLE001 - as Apps Script: a model that throws matches nothing
        res = None
    if not res or not res.get("ok"):
        return {"status": 200, "data": {"matches": [], "via": ""}}
    try:
        parsed = json.loads(s_(res.get("content")), parse_constant=_no_constant)
    except (ValueError, RecursionError):
        parsed = None
    ids = (parsed.get("ids") if isinstance(parsed, dict) else None) or []
    out: list[str] = []
    for one in (ids if isinstance(ids, (list, str)) else []):
        if len(out) >= 3:
            break
        pick = s_(one)
        if (pick in by_id or pick in _JS_INHERITED) and pick not in out:
            out.append(pick)
    return {"status": 200, "data": {"matches": out, "via": s_(res.get("via"))}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"paletteResolve": palette_resolve}
# HUB_POLICY as Palette.gs declares it (any session), asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {"paletteResolve": {}}
# main.policy_gate asks nothing: the door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
