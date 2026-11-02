"""Settings › Alerts I receive's save on Python behind the `alert-receive` switch (AlertReceive.gs alertReceiveSet):
one of the caller's own three choices, decided under the platform's write lock on the house as the copy holds it, the
caller's row (`receive_off:<uid>`) upserted by its key (sdUpsert_) and kept in app.edits — the row is always the
caller's, never a payload's."""
from __future__ import annotations

from typing import Any, Callable

import alert_receive as AR
import door_gate as DG
import locations as L
import support_desk_writes as SDW
import writes as W
from scope import Defer
from writes import Decision

s_ = AR.s_


def receive_set(sess: L.Session, payload: dict) -> Decision:
    """alertReceiveSet: one part on or off for the caller; 404 for anybody who does not hold the section."""
    refused = DG.refusal(sess, "alertReceiveSet", payload, AR.GS_POLICY)
    if refused:
        return Decision(refused)
    reads = sess.reads
    g = AR.gate(reads, sess.user)
    if not g:
        return Decision(dict(DG.UNKNOWN))
    p = payload if isinstance(payload, dict) else {}
    part = s_(p.get("part"))
    if not AR.is_part(part):
        return W.refuse(400, "Choose one of " + ", ".join(AR.PARTS) + ".")
    if not isinstance(p.get("receive"), bool):
        return W.refuse(400, "receive must be true or false.")
    fresh = AR.stored(reads)
    if not fresh["readable"]:
        return W.refuse(503, "Your alert choices could not be read (" + fresh["why"] + ") — nothing was changed.")
    if not fresh["set_up"]:
        return W.refuse(503, "The Support Requests settings are not set up yet, so the choice cannot be kept — "
                             "nothing was changed.")
    mine = fresh["off"].get(g["uid"]) or {}
    off = {q: True for q in AR.PARTS if mine.get(q)}
    if p["receive"]:
        off.pop(part, None)
    else:
        off[part] = True
    # sdWrite_: while the book-write funnel is armed, Apps Script answers
    W.gate(reads)
    try:
        sid, tab = SDW.where(reads, AR.SETTINGS)
        held: dict[str, dict] = {}
        for r in SDW.tab_rows(reads, AR.SETTINGS):
            # sdWrite_ writes over the first row with the key
            held.setdefault(r["key"], r)
    except Defer as exc:
        return W.refuse(503, "Your choice could not be written (" + str(exc)[:240] + ") — nothing was changed.")
    key = AR.KEY_PREFIX + g["uid"]
    row = {"key": key, "value": ", ".join(q for q in AR.PARTS if off.get(q)),
           "note": g["name"] + " (" + g["as"] + ") — the alerts turned off in Settings",
           "updated_at": SDW.iso_now(reads), "updated_by": g["name"]}
    rec = SDW.settings_record(sid, tab, row, held.get(key), "")
    return SDW.kept({"status": 200, "data": AR.answer(g, off, True)}, [rec], "settings", (sid,))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"alertReceiveSet": receive_set}
# main.policy_gate asks nothing: the door asks door_gate first, with AlertReceive.gs's declaration
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# sdLock_'s own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": SDW.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.alert_receive_writes and app.alert_receive_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="alert_receive", label="Alerts I receive")
