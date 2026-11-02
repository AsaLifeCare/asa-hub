"""Staff as one switchable app: every ported read of its three modules, and the relay's two packs (StaffProfiles.gs)."""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import staff as SP
import staff_comms as SC
import staff_perf as SF
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = SP.APP_ID
# SP_PACK_PARTS, in its order: the audited reads and the words of calls and texts are never packed
PACK_PARTS = ("overview", "edit_profile", "notes", "actions", "activity", "preferences", "shifts", "compliance",
              "documents", "employment", "edit_employment", "edit_compliance")
PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {**SP.PACK_DOORS, **SC.PACK_DOORS}
# SP_CLIENT_PACK_BUDGET_MS for this engine: the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for a whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_STAFF_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"


def _take(parts: dict, status: dict, name: str, got: Any) -> None:
    """The pack's take(): a 200 with data is the part, anything else its status and words."""
    if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
        parts[name] = got["data"]
        status[name] = {"status": 200}
        return
    said = got.get("status") if isinstance(got, dict) else None
    status[name] = {"status": int(said) if isinstance(said, (int, float)) and not isinstance(said, bool) and said
                    else 503,
                    "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}


def _part(parts: dict, status: dict, left: list, name: str, read: Callable[[], Any], caught: bool = True) -> None:
    """One part read: a read this engine cannot answer is left to its own door, which says why."""
    try:
        got = read()
    except (Defer, hubdb.Unreadable) as e:
        status[name] = {"status": 503, "message": NOT_GATHERED}
        left.append(f"{name} ({str(e)[:120]})")
        return
    except Exception as e:  # noqa: BLE001 - the port's own words, as the pack's try/catch
        if not caught:
            raise
        status[name] = {"status": 503, "message": f"This part could not be read just now ({L._why(e)})."}
        return
    _take(parts, status, name, got)


def staff_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPack: every whole section of one staff member, for the relay's service identity alone."""
    if not sess.user or not sess.user.get("is_service"):
        return SP.unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = SP.person(reads, payload.get("staff"))
    if ctx.get("refused"):
        return ctx["refused"]
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    left: list[str] = []
    for name in PACK_PARTS:
        if time.monotonic() - started > PACK_BUDGET_S:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({PAST_BUDGET})")
            continue
        _part(parts, status, left, name, lambda door=PACK_DOORS[name]: door(reads, ctx))
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("staffPack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"staff": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


def staff_client_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffClientPack: one client's own view of Staff, for the relay alone. Staff shows a client or family viewer no
    staff member, so the pack carries no part: its roster says the app's refusal, as the roster door does."""
    if not sess.user or not sess.user.get("is_service"):
        return SP.unknown()
    key = gsjs.trim(gsjs.or_blank(payload.get("client")))
    if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,80}", key, re.A):
        return {"status": 400, "message": "client: a client key."}
    refused = SP.unknown()
    return {"status": 200, "data": {"client": key, "week": [], "built_at": gsjs.iso(sess.reads.now), "parts": {},
                                    "part_status": {"roster": {"status": refused.get("status"),
                                                               "message": refused.get("message")}}}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    **SP.ACTIONS, **SC.ACTIONS, **SF.ACTIONS, "staffPack": staff_pack, "staffClientPack": staff_client_pack}
POLICY: dict[str, dict[str, Any]] = {
    **SP.POLICY, **SC.POLICY, **SF.POLICY, "staffPack": {"roles": ("admin",), "params": {"staff": "string"}},
    "staffClientPack": {"roles": ("admin",), "params": {"client": "string"}}}
