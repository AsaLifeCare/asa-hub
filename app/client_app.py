"""Clients as one switchable app: every ported read of its three modules, and the relay's pack (ClientProfiles.gs)."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable

import client_meds as CM
import client_sources as CS
import clients as C
import gsjs
import hubdb
import locations as L
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = C.APP_ID
# CP_PACK_PARTS, in its order: a client's own cut follows the part it cuts
PACK_PARTS = ("roster_own", "details", "care_plans", "care_team", "care_daily", "care_health", "care_goals",
              "care_home", "meds", "reviews", "incidents", "activity", "activity_own", "appointments", "transport",
              "transport_own", "mar", "mar_own", "refills", "funds", "billing")
PACK_DOORS: dict[str, Callable[..., dict[str, Any]]] = {**C.PACK_DOORS, **CS.PACK_DOORS, **CM.PACK_DOORS}
# the own cuts that read the part this pack gathered already (cpPackDoors_ own())
OWN_CUTS = frozenset({"transport_own", "mar_own"})
# CP_PACK_BUDGET_MS for this engine: the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for the whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_CLIENT_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"


def client_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientPack: every section's private part of one client, for the relay's service identity alone."""
    if not sess.user or not sess.user.get("is_service"):
        return C.unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = C.client_ctx(reads, payload.get("client"))
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
        door = PACK_DOORS[name]
        try:
            got = door(reads, ctx, parts) if name in OWN_CUTS else door(reads, ctx)
        except (Defer, hubdb.Unreadable) as e:
            # not this engine's answer: the section reads on its own door, which says why
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({str(e)[:120]})")
            continue
        except Exception as e:  # noqa: BLE001 - the port's own words, as the pack's try/catch
            status[name] = {"status": 503, "message": f"This part could not be read just now ({L._why(e)})."}
            continue
        if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
            parts[name] = got["data"]
            status[name] = {"status": 200}
            continue
        said = got.get("status") if isinstance(got, dict) else None
        status[name] = {"status": int(said) if isinstance(said, (int, float)) and not isinstance(said, bool) and said
                        else 503,
                        "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("clientPack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"client": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    **C.ACTIONS, **CM.ACTIONS, **CS.ACTIONS, "clientPack": client_pack}
POLICY: dict[str, dict[str, Any]] = {
    **C.POLICY, **CM.POLICY, **CS.POLICY, "clientPack": {"roles": ("admin",), "params": {"client": "string"}}}
