"""Suggestions' one write (Suggestions.gs suggestionCreate): what a person says kept in app.suggestions — the Hub's
database alone, never a sheet — and its copy raised as a letter to the platform's own mailbox through Smart Comms
(`suggestion_mailbox_note`), in the same write: a suggestion that is not kept sends nothing, and one whose letter is
held stays kept."""
from __future__ import annotations

import os
import secrets
from typing import Any, Callable

import gsjs
import locations as L
import smart_comms as SC
import suggestions as SG
import writes as W
from scope import Defer

ACTION = "suggestionCreate"
ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
LETTER = "suggestion_mailbox_note"
TEXT_MAX = 4000

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> W.Decision:
    """suggestionCreate: the words kept, then their copy to the platform's mailbox."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) not in ROLES:
        return W.Decision({"status": 403, "message": "Requires a signed-in account"})
    text = s_((payload or {}).get("text"))[:TEXT_MAX]
    if len(text) < 3:
        return W.refuse(400, "Write the suggestion first.")
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a suggestion is kept only under the platform's write lock")
    sid = "SUG_" + secrets.token_hex(5).upper()
    email, name, role = s_(user.get("email")), s_(user.get("display_name")), s_(user.get("role"))
    cur.execute(f"insert into {SG.TABLE} (suggestion_id, by_email, by_name, role, text, write_id)"
                " values (%s, %s, %s, %s, %s, %s)", (sid, email, name, role, text, SC.write_id()))
    # the platform's own mailbox, as platformMailCreds_ names it; none wired, no letter (the suggestion stands)
    mailbox = os.getenv("PLATFORM_EMAIL", "").strip()
    if mailbox:
        SC.raise_situation(None, situation=LETTER, to=mailbox, channel="email", key="suggestion|" + sid,
                           vars={"who": name or email or "somebody", "name": name, "role": role, "email": email,
                                 "text": text}, person=name or email, lane="suggestions",
                           at_ms=int(sess.reads.now.timestamp() * 1000), prune=False)
    return W.Decision({"status": 200, "data": {"sent": True}}, subject=sid, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], W.Decision]] = {ACTION: create}
POLICY: dict[str, dict[str, Any]] = {ACTION: {"params": {"text": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.suggestions_writes and app.suggestions_receipts beside the other apps' own; the suggestions are
    app.suggestions'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="suggestions", label="Suggestions")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """The relay's word on a write; a void also takes back the suggestion kept under it."""
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"delete from {SG.TABLE} where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("suggestions: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
