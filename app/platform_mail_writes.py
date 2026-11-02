"""The Mail app's writes on Python (PlatformMail.gs): a message marked seen, filed in Archive or Trash, a letter sent
by hand — through Smart Comms, as every message this platform sends (its own situation, the quiet window not holding a
person who writes by hand) — and a mailbox wired from the screen by the master. Nothing goes through Apps Script or the
relay; the mail itself stays on the mail server."""
from __future__ import annotations

import uuid
from typing import Any, Callable

import candidate_papers as CNDP
import gsjs
import locations as L
import mail_server as MB
import platform_mail as PM
import scope as sc
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Somebody else is changing this mailbox right now — try again."
MARK_GATE = "gate_mail_mark_file"
BY_HAND = "platform_mail_by_hand"

s_ = gsjs.str_


def _held(reads: L.Reads) -> Decision | None:
    """The gate the mail server's flags and folders answer to."""
    why = CNDP.gate_holds(reads, MARK_GATE)
    return Decision({"status": 409, "message": why, "held": True}) if why else None


def mark(sess: L.Session, payload: dict) -> Decision:
    """platformMailMark: the seen flag on up to 50 messages."""
    p = payload if isinstance(payload, dict) else {}
    d = PM.door(sess, p)
    if d.get("refuse"):
        return Decision(d["refuse"])
    items = []
    for it in (p.get("items") or [])[:200]:
        mid = s_((it or {}).get("id")).strip() if isinstance(it, dict) else ""
        if mid and len(items) < 50:
            items.append({"id": mid, "hint": s_(it.get("hint"))[:120]})
    if not items:
        return W.refuse(400, "items: nothing to mark.")
    held = _held(sess.reads)
    if held:
        return held
    try:
        got = MB.mark(d["user"], d["password"], items, p.get("seen") is not False,
                      MB.box_name(p.get("mailbox"), filed=True) if s_(p.get("mailbox")) in ("Archive", "Trash")
                      else "INBOX")
    except Exception as exc:  # noqa: BLE001
        return W.refuse(502, f"imap_failed ({type(exc).__name__})")
    return Decision({"status": 200, "data": got}, subject="", own=True)


def move(sess: L.Session, payload: dict) -> Decision:
    """platformMailMove: one message filed in Archive or Trash, for real."""
    p = payload if isinstance(payload, dict) else {}
    d = PM.door(sess, p)
    if d.get("refuse"):
        return Decision(d["refuse"])
    folder = s_(p.get("folder"))
    if folder not in ("Archive", "Trash"):
        return W.refuse(400, "folder: Archive or Trash.")
    mid = s_(p.get("id")).strip()
    if not mid:
        return W.refuse(400, "id is required.")
    held = _held(sess.reads)
    if held:
        return held
    try:
        got = MB.file_into(d["user"], d["password"], [{"id": mid, "hint": s_(p.get("hint"))[:120]}], folder)
    except Exception as exc:  # noqa: BLE001
        return W.refuse(502, f"imap_failed ({type(exc).__name__})")
    return Decision({"status": 200, "data": got}, subject="", own=True)


def send(sess: L.Session, payload: dict) -> Decision:
    """platformMailSend: a letter written by hand, raised through Smart Comms from the box it names."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "director", "manager", "staff"):
        return Decision({"status": 403, "message": "Requires an admin or manager account"})
    switch = s_(sess.reads.db.hiring_config().get("platform_email_enabled") or "yes").strip().lower()
    if switch == "no":
        return W.refuse(503, "Platform e-mail is switched off in Settings.")
    p = payload if isinstance(payload, dict) else {}
    to, subject, body = s_(p.get("to")).strip(), s_(p.get("subject")).strip(), s_(p.get("body"))
    if "@" not in to:
        return W.refuse(400, "to: a full address is required.")
    if not subject and not body:
        return W.refuse(400, "An empty message is refused.")
    frm = s_(p.get("from_account"))
    if frm == "mine":
        return Decision(dict(PM.NO_OWN))
    box = MB.creds(frm)
    if box is None:
        return Decision(dict(PM.NOT_WIRED))
    key = "pmsend_" + uuid.uuid4().hex
    got = SC.raise_situation(None, situation=BY_HAND, to=to, vars={}, key=key, channel="email", body=body,
                             subject=subject, lane="platform mail", from_account=box["id"], quiet_exempt=True,
                             person=s_(user.get("email")), occasion="sent by " + s_(user.get("email")) +
                             (" as mailbox " + box["id"] if frm else ""))
    state = s_(got.get("state"))
    if state in ("owed", "sent", "queued"):
        return Decision({"status": 200, "data": {"sent": True, "queued": state != "sent", "redirected": False,
                                                 "receipt": s_(got.get("receipt")), "from": box["user"]}},
                        subject="", own=True)
    if state == "failed":
        return W.refuse(502, s_(got.get("why")) or "The send failed.")
    return Decision({"status": 200, "data": {"sent": False, "gated": True, "from": box["user"],
                                             "note": s_(got.get("why")) or "Recorded, not sent — sending is switched "
                                                                            "off or the recipient opted out."}},
                    subject="", own=True)


def account_add(sess: L.Session, payload: dict) -> Decision:
    """platformMailAccountAdd: the master wires one more box (slots 2–5), proved by a login first."""
    user = sess.user or {}
    if not sc.is_real_master(user):
        return Decision(dict(PM.UNKNOWN))
    p = payload if isinstance(payload, dict) else {}
    address, password = s_(p.get("address")).strip(), s_(p.get("password"))
    if "@" not in address:
        return W.refuse(400, "That is not an e-mail address.")
    if not password:
        return W.refuse(400, "The mailbox needs its password.")
    wired = MB.accounts()
    for a in wired:
        if a["user"].lower() == address.lower():
            return W.refuse(409, f"That mailbox is already wired as slot {a['id']}.")
    slot = s_(p.get("slot")).strip()
    taken = {a["id"] for a in wired}
    if slot:
        if slot not in ("2", "3", "4", "5"):
            return W.refuse(400, "Slot must be 2–5 — slot 1 is the platform's own voice.")
        if slot in taken:
            return W.refuse(409, f"Slot {slot} is already wired.")
    else:
        slot = next((str(n) for n in range(2, MB.SLOTS + 1) if str(n) not in taken), "")
        if not slot:
            return W.refuse(409, "All five mailbox slots are wired — free one first.")
    why = MB.verify(address, password)
    if why:
        return W.refuse(502, "The mailserver refused these credentials: " + why)
    MB.add(slot, address, password)
    return Decision({"status": 200, "data": {"added": True, "id": slot, "address": address,
                                             "accounts": MB.addresses()}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "platformMailMark": mark, "platformMailMove": move, "platformMailSend": send,
    "platformMailAccountAdd": account_add}
POLICY: dict[str, dict[str, Any]] = {"platformMailMark": {"roles": ("admin", "manager", "staff")},
                                     "platformMailMove": {"roles": ("admin", "manager", "staff")},
                                     "platformMailSend": {"roles": ("admin", "director", "manager", "staff")},
                                     "platformMailAccountAdd": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.platform_mail_writes and app.platform_mail_receipts, beside the other apps' own; the mail itself stays on the
    mail server and the letters in Smart Comms' outbox."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="platform_mail", label="Mail")
