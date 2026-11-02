"""The Cortex app's one read on Python: who a session is, as the cortex is told it (the relay's _cortex_caller asked
Apps Script's authMe for it). The chat, the voice, the dialogs and the mesh are the intelligence platform's own and stay
there; the relay passes them through."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L

APP_ID = "cortex"

s_ = gsjs.str_


def who(sess: L.Session, payload: dict) -> dict[str, Any]:
    """cortexWho: the session's account email (else its id), the identity the cortex keeps its dialogs under."""
    user = sess.user or {}
    if user.get("is_service"):
        return {"status": 403, "message": "A session is asked for, not the relay."}
    ident = s_(user.get("email")).strip() or s_(user.get("id")).strip()
    if not ident:
        return {"status": 404, "message": "This session names no account."}
    return {"status": 200, "data": {"who": ident}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"cortexWho": who}
POLICY: dict[str, dict[str, Any]] = {"cortexWho": {}}
