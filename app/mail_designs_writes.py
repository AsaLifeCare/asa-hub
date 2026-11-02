"""Email Designs' one write (StaffAlerts.gs mailPreviewSend): "send me this one" — the design, rendered as the screen
shows it, to the mailbox of the person pressing, through Smart Comms (email_design_preview), never straight to the
mail server. The quiet window does not hold a person who just asked."""
from __future__ import annotations

import uuid
from typing import Any, Callable

import gsjs
import locations as L
import mail_designs as MD
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Another send is being decided right now — try again."
SITUATION = "email_design_preview"

s_ = gsjs.str_


def send(sess: L.Session, payload: dict) -> Decision:
    """mailPreviewSend: one design to the asker's own address."""
    user = sess.user or {}
    if not MD.writer(user):
        return Decision(dict(MD.DENIED))
    to = s_(user.get("email"))
    if "@" not in to:
        return W.refuse(400, "Your sign-in has no mailbox to send to.")
    did = s_((payload or {}).get("design_id"))
    hit = next((d for d in MD.preview_all(sess.reads) if d.get("id") == did), None)
    if hit is None:
        return W.refuse(404, f'No design called "{did}".')
    got = SC.raise_situation(None, situation=SITUATION, to=to, vars={}, key="mdprev_" + uuid.uuid4().hex,
                             channel="email", subject=hit.get("subject"), body=hit.get("text"), html=hit.get("html"),
                             lane="design preview", quiet_exempt=True, person=to,
                             occasion="design preview: " + did)
    state = s_(got.get("state"))
    if state in ("owed", "sent", "queued"):
        return Decision({"status": 200, "data": {"to": to, "redirected": False}}, subject="", own=True)
    return Decision({"status": 502, "message": "The send was refused: " + (s_(got.get("why")) or state)},
                    subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"mailPreviewSend": send}
POLICY: dict[str, dict[str, Any]] = {"mailPreviewSend": {"roles": ("admin", "manager"),
                                                         "params": {"design_id": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.mail_designs_writes and app.mail_designs_receipts; the letter Smart Comms' outbox's."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="mail_designs", label="Email Designs")
