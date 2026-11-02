"""The Mail app on Python (PlatformMail.gs): the platform's mailboxes read straight off the mail server (mail_server.py) —
the inbox, a message, an attachment, the unread badges — for the master alone (the operator, 2026-10-28: "SOMENTE O
MASTER DEVERÁ TER ACESSO AOS EMAILS", "somente EU"): a master-only app (app_control.MASTER_ONLY_APPS), so no badge,
switch, App Control row or seen list opens it to anybody else, a Director or a Platform Lead included; nobody has a
mailbox of their own any more: none is minted at sign-in. Nothing goes through Apps Script or the relay."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import mail_server as MB
import scope as sc

APP_ID = "mail"
UNKNOWN = {"status": 404, "message": "Unknown action."}
NOT_WIRED = {"status": 503, "message": "PLATFORM_EMAIL is not configured"}

s_ = gsjs.str_


def can_read(reads: L.Reads, user: dict | None) -> bool:
    """The master in their own session, and nobody else."""
    u = user or {}
    return bool(u) and not u.get("is_service") and sc.is_real_master(u)


def accounts_for(reads: L.Reads, user: dict | None) -> list[dict[str, Any]]:
    """The platform boxes, to the master alone."""
    return MB.addresses() if can_read(reads, user) else []


def door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMailDoor_: {refuse} or {user, password} for the box the call names."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    if not can_read(sess.reads, user):
        return {"refuse": dict(UNKNOWN)}
    box = MB.creds(p.get("account"))
    if box is None:
        return {"refuse": dict(NOT_WIRED)}
    return {"user": box["user"], "password": box["password"]}


def _failed(what: str, exc: Exception) -> dict[str, Any]:
    return {"status": 502, "message": f"imap_failed ({type(exc).__name__})"}


def _limit(p: dict) -> int:
    try:
        n = int(float(p.get("limit") or 30))
    except (TypeError, ValueError):
        n = 30
    return max(1, min(n, 100))


def inbox(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMailInbox: one mailbox's newest messages, and the boxes this caller may switch between."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    d = door(sess, p)
    if d.get("refuse"):
        return d["refuse"]
    try:
        got = MB.inbox(d["user"], d["password"], _limit(p), MB.box_name(p.get("box")))
    except Exception as exc:  # noqa: BLE001 - the class, never the conversation
        return _failed("inbox", exc)
    account = s_(p.get("account"))
    return {"status": 200, "data": {"address": d["user"], "account": account or "1",
                                    "accounts": accounts_for(sess.reads, user), "threads": got["threads"],
                                    "folders": got["folders"], "mailbox": got["mailbox"],
                                    "fetched_at": got["fetched_at"]}}


def message(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMailMessage: the whole message."""
    p = payload if isinstance(payload, dict) else {}
    d = door(sess, p)
    if d.get("refuse"):
        return d["refuse"]
    mid = s_(p.get("id")).strip()
    if not mid:
        return {"status": 400, "message": "id is required."}
    try:
        got = MB.message(d["user"], d["password"], mid, MB.box_name(p.get("mailbox"), filed=True),
                         s_(p.get("hint"))[:120])
    except Exception as exc:  # noqa: BLE001
        return _failed("message", exc)
    if not got.get("found"):
        return {"status": 404, "message": "message not found"}
    return {"status": 200, "data": got}


def attachment(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMailAttachment: one attachment's bytes, bounded."""
    p = payload if isinstance(payload, dict) else {}
    d = door(sess, p)
    if d.get("refuse"):
        return d["refuse"]
    mid = s_(p.get("id")).strip()
    try:
        part = int(float(p.get("part")))
    except (TypeError, ValueError):
        part = -1
    if not mid or part < 0:
        return {"status": 400, "message": "id and part are required."}
    try:
        got = MB.attachment(d["user"], d["password"], mid, part, MB.box_name(p.get("mailbox"), filed=True),
                            s_(p.get("hint"))[:120])
    except Exception as exc:  # noqa: BLE001
        return _failed("attachment", exc)
    if not got.get("found"):
        return {"status": 404, "message": "attachment not found"}
    if got.get("too_big"):
        return {"status": 413, "message": f"attachment is {got.get('size', 0)} bytes — past the "
                                          f"{MB.ATTACHMENT_MAX}-byte door; fetch it in webmail"}
    return {"status": 200, "data": got}


def unread(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMailUnread: UNSEEN per box this caller may read; a box that will not answer counts -1."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return dict(UNKNOWN)
    if not can_read(sess.reads, user):
        return {"status": 200, "data": {"counts": []}}
    counts = []
    for a in MB.accounts():
        try:
            n = MB.unread_count(a["user"], a["password"])
        except Exception:  # noqa: BLE001 - one dead box never blanks the row
            n = -1
        counts.append({"account": a["id"], "unread": n})
    return {"status": 200, "data": {"counts": counts}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "platformMailInbox": inbox, "platformMailMessage": message, "platformMailAttachment": attachment,
    "platformMailUnread": unread}
_ROLES = ("admin", "manager", "staff")
POLICY: dict[str, dict[str, Any]] = {a: {"roles": _ROLES} for a in ACTIONS}
