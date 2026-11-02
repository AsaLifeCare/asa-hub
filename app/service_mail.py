"""The relay's mail doors (/mail/send, /mail/inbox, /mail/message, /mail/attachment, /mail/mark, /mail/unread,
/mail/file) answered here in its words: the service secret in the body, a mailbox named by its credentials or by a
provisioned `account` (the mail server's own credentials file, read-only here), the mail server reached as
mail_server.py reaches it. Moving and flagging messages answers to the Desk's mail gate."""
from __future__ import annotations

import asyncio
import imaplib
import json
import logging
import os
import re
import smtplib
import time
from email import message_from_bytes, policy
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import Response

import mail_reach
import mail_server as MB
import service_doors as SD

log = logging.getLogger("asa-hub-app.service-mail")

# the mail server's config beside the relay's (its postfix accounts and the provisioned boxes' passwords)
CFG_DIR = Path(os.getenv("HUB_MAIL_CFG", "/srv/mailcfg"))
CREDS_FILE = CFG_DIR / "hub-mail-creds.json"
MARK_GATE = "gate_mail_mark_file"
# a retried send under one send_id is one letter, for ten minutes
SEND_DEDUP_S = 600
_SENT: dict[str, float] = {}

INVALID = {"status": 400, "message": "invalid body"}
NO_SERVICE = {"status": 401, "message": "service identity required"}
NO_CREDS = {"status": 400, "message": "mailbox credentials are required"}


def ready() -> bool:
    """The provisioned boxes' credentials are readable here: their `account` callers (a person's own mailbox, the
    unread badges) name nothing else."""
    return CREDS_FILE.is_file() and os.access(CREDS_FILE, os.R_OK)


def own_creds(body: dict[str, Any]) -> tuple[str, str]:
    """_mail_own_creds: explicit credentials win; a bare `account` names a provisioned mailbox."""
    user = str(body.get("user") or "")
    password = str(body.get("password") or "")
    if user and password:
        return user, password
    account = str(body.get("account") or "").strip().lower()
    if account and CREDS_FILE.exists():
        try:
            pw = str(json.loads(CREDS_FILE.read_text()).get(account) or "")
            if pw:
                return account, pw
        except Exception:  # noqa: BLE001
            pass
    return user, password


async def _service_body(request: Request, door: str,
                        said_refusal: bool) -> tuple[dict[str, Any] | None, Response | None]:
    """The relay's write guard, the body, then the service secret, each refused in its words."""
    refused = await SD.write_refusal(request)
    if refused is not None:
        return None, refused
    body = await SD.body_of(request)
    if body is None:
        return None, SD.said(dict(INVALID))
    if not SD.secret_ok(body):
        if said_refusal:
            log.warning("%s: refused, bad or missing service secret", door)
        return None, SD.said(dict(NO_SERVICE))
    return body, None


# ---- sending ---------------------------------------------------------------------------------------------------------

def smtp_send(user: str, password: str, to: str, subject: str, text: str, html: str = "", cc: str = "",
              from_name: str = "", withhold: list[str] | None = None) -> tuple[str, str]:
    """(receipt, message_id): the letter over SMTP, then its copy filed in Sent with the withheld words taken out."""
    message_id = make_msgid(domain=(user.partition("@")[2] or MB.DOMAIN))
    date = formatdate(localtime=True)
    msg = MB.compose(user, to, subject, text, html, cc, from_name, message_id, date)
    with smtplib.SMTP(MB.HOST, MB.SMTP_PORT, timeout=20) as s:
        s.starttls()
        s.login(user, password)
        s.send_message(msg)
    secrets = [str(x) for x in (withhold or []) if len(str(x or "")) >= 4]
    filed = msg
    if secrets:
        filed = MB.compose(user, to, mail_reach.withhold(subject, secrets), mail_reach.withhold(text, secrets),
                           mail_reach.withhold(html, secrets) if html else "", cc, from_name, message_id, date)
    try:
        conn = MB._open(user, password)
        try:
            conn.append("Sent", "\\Seen", imaplib.Time2Internaldate(time.time()), filed.as_bytes())
        finally:
            MB._close(conn)
    except Exception:  # noqa: BLE001 - delivered all the same
        return "queued (not filed in Sent)", message_id
    return "queued", message_id


def imap_bounce(user: str, password: str, address: str, days: int) -> dict[str, str] | None:
    """The newest delivery report in the mailbox that says a letter to `address` failed, or None."""
    conn = MB._open(user, password, 15)
    try:
        for folder in (["INBOX"] + MB.folders(conn))[:12]:
            try:
                typ, _ = conn.select('"%s"' % folder.replace('"', ''), readonly=True)
                if typ != "OK":
                    continue
                _t, data = conn.uid("search", None, "SINCE", mail_reach.since_date(days),
                                    "FROM", '"MAILER-DAEMON"', "TEXT", '"%s"' % address)
            except Exception:  # noqa: BLE001 - one folder that will not answer is not the mailbox's answer
                continue
            for uid in list(reversed((data[0] or b"").split()))[:5]:
                _t, parts = conn.uid("fetch", uid, "(BODY.PEEK[])")
                raw, _flags = MB._raw_of(parts)
                if raw:
                    hit = mail_reach.bounce_for(message_from_bytes(raw, policy=policy.default), address)
                    if hit:
                        return hit
        return None
    finally:
        MB._close(conn)


def reach(user: str, password: str, address: str) -> dict[str, Any]:
    """_mail_reach: can a letter reach `address`?"""
    domain = mail_reach.address_domain(address)
    if not domain:
        return {"deliverable": None, "why": ""}
    try:
        state = mail_reach.mx_lookup(domain)
    except Exception:  # noqa: BLE001
        state = "unknown"
    bounce = None
    if state not in mail_reach.DEAD_DOMAIN:
        try:
            bounce = imap_bounce(user, password, address.strip().lower(), mail_reach.BOUNCE_DAYS)
        except Exception as exc:  # noqa: BLE001 - the mailbox not answering is not a bounce
            log.warning("mail/send: bounce lookup failed (%s)", type(exc).__name__)
    return mail_reach.verdict(state, bounce)


async def mail_send(request: Request) -> Response:
    """One e-mail out of a platform mailbox."""
    body, refused = await _service_body(request, "mail/send", True)
    if refused is not None:
        return refused
    user, password = own_creds(body)
    to = str(body.get("to") or "").strip()
    subject = str(body.get("subject") or "").strip()
    text = str(body.get("body") or "")
    html = str(body.get("html") or "")
    cc = str(body.get("cc") or "").strip()
    send_id = str(body.get("send_id") or "")
    from_name = re.sub(r"[\r\n\"<>]", "", str(body.get("from_name") or "")).strip()[:60]
    withhold = body.get("withhold") or []
    if not isinstance(withhold, list):
        withhold = [withhold]
    withhold = [str(x) for x in withhold][:8]
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    if "@" not in to:
        return SD.said({"status": 400, "message": "to: a full address is required"})
    if not subject and not text:
        return SD.said({"status": 400, "message": "an empty message is refused"})
    now = time.time()
    for k in [k for k, t in _SENT.items() if now - t > SEND_DEDUP_S]:
        _SENT.pop(k, None)
    if send_id and send_id in _SENT:
        return SD.said({"status": 200, "data": {"receipt": "deduplicated"}})
    if body.get("check_reach") is True and "," not in to and ";" not in to:
        got = await asyncio.to_thread(reach, user, password, to)
        if got.get("deliverable") is False:
            log.info("mail/send: undeliverable (%s), not sent", got.get("why"))
            return SD.said({"status": 422, "message": f"undeliverable ({got.get('why')})",
                            "data": {"undeliverable": str(got.get("why") or "undeliverable"),
                                     "bounced_at": str(got.get("bounced_at") or "")}})
    if send_id:
        _SENT[send_id] = now
    try:
        receipt, message_id = await asyncio.to_thread(smtp_send, user, password, to, subject, text, html, cc,
                                                      from_name, withhold)
    except Exception as exc:  # noqa: BLE001 - the class of the failure, never the conversation (it may hold the login)
        if send_id:
            _SENT.pop(send_id, None)
        log.warning("mail/send: smtp_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"smtp_failed ({type(exc).__name__})"})
    return SD.said({"status": 200, "data": {"receipt": receipt, "message_id": message_id}})


# ---- reading -----------------------------------------------------------------------------------------------------------

async def mail_inbox(request: Request) -> Response:
    """A mailbox's newest messages, as a view: read-only IMAP, nothing marked seen."""
    body, refused = await _service_body(request, "mail/inbox", True)
    if refused is not None:
        return refused
    user, password = own_creds(body)
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    limit = max(1, min(int(body.get("limit") or 30), 500))
    mailbox = MB.box_name(body.get("mailbox"))
    try:
        out = await asyncio.to_thread(MB.inbox, user, password, limit, mailbox)
    except Exception as exc:  # noqa: BLE001
        log.warning("mail/inbox: imap_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"imap_failed ({type(exc).__name__})"})
    return SD.said({"status": 200, "data": {"threads": out["threads"], "folders": out["folders"], "mailbox": mailbox,
                                            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}})


async def mail_message(request: Request) -> Response:
    """One message whole: its text, its HTML alternative, its attachments."""
    body, refused = await _service_body(request, "mail/message", False)
    if refused is not None:
        return refused
    user, password = own_creds(body)
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    mid = str(body.get("id") or "").strip()
    if not mid:
        return SD.said({"status": 400, "message": "id is required"})
    mailbox = MB.box_name(body.get("mailbox"), filed=True)
    try:
        out = await asyncio.to_thread(MB.message, user, password, mid, mailbox, str(body.get("hint") or ""))
    except Exception as exc:  # noqa: BLE001
        log.warning("mail/message: imap_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"imap_failed ({type(exc).__name__})"})
    if not out.get("found"):
        return SD.said({"status": 404, "message": "message not found"})
    return SD.said({"status": 200, "data": out})


async def mail_attachment(request: Request) -> Response:
    """One attachment's bytes, base64, bounded."""
    body, refused = await _service_body(request, "mail/attachment", False)
    if refused is not None:
        return refused
    user, password = own_creds(body)
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    mid = str(body.get("id") or "").strip()
    part = int(body.get("part") or -1)
    if not mid or part < 0:
        return SD.said({"status": 400, "message": "id and part are required"})
    mailbox = MB.box_name(body.get("mailbox"), filed=True)
    try:
        out = await asyncio.to_thread(MB.attachment, user, password, mid, part, mailbox, str(body.get("hint") or ""))
    except Exception as exc:  # noqa: BLE001
        log.warning("mail/attachment: imap_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"imap_failed ({type(exc).__name__})"})
    if not out.get("found"):
        return SD.said({"status": 404, "message": "attachment not found"})
    if out.get("too_big"):
        return SD.said({"status": 413, "message": f"attachment is {out.get('size', 0)} bytes — past the "
                                                  f"{MB.ATTACHMENT_MAX}-byte door; fetch it in webmail"})
    return SD.said({"status": 200, "data": out})


async def mail_unread(request: Request) -> Response:
    """UNSEEN per mailbox, several at once; a box that does not answer counts -1."""
    body, refused = await _service_body(request, "mail/unread", False)
    if refused is not None:
        return refused
    jobs: list[tuple[str, str, str]] = []
    for p in (body.get("pairs") or [])[:8]:
        if isinstance(p, dict) and p.get("user") and p.get("password"):
            jobs.append((str(p.get("label") or p["user"]), str(p["user"]), str(p["password"])))
    for name in (body.get("accounts") or [])[:8]:
        u, pw = own_creds({"account": str(name)})
        if u and pw:
            jobs.append((str(name), u, pw))
    if not jobs:
        return SD.said({"status": 400, "message": "nothing to count"})
    counts = []
    for label, u, pw in jobs:
        try:
            counts.append({"address": label, "unread": await asyncio.to_thread(MB.unread_count, u, pw)})
        except Exception:  # noqa: BLE001 - one dead box must not blank the badge row
            counts.append({"address": label, "unread": -1})
    return SD.said({"status": 200, "data": {"counts": counts}})


# ---- the live mutations: seen flags and folders ----------------------------------------------------------------------

async def mail_mark(request: Request) -> Response:
    """Seen or unseen for up to fifty messages."""
    body, refused = await _service_body(request, "mail/mark", False)
    if refused is not None:
        return refused
    held = await SD.lane_refusal(MARK_GATE)
    if held is not None:
        return SD.said(held)
    user, password = own_creds(body)
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    items = [{"id": str(x.get("id") or ""), "hint": str(x.get("hint") or "")}
             for x in (body.get("items") or []) if isinstance(x, dict)][:50]
    if not items:
        return SD.said({"status": 400, "message": "nothing to mark"})
    seen = str(body.get("seen", "yes")).strip().lower() not in ("no", "false", "0")
    asked = str(body.get("mailbox") or "").strip()
    mailbox = asked if asked in ("Archive", "Trash") else "INBOX"
    try:
        out = await asyncio.to_thread(MB.mark, user, password, items, seen, mailbox)
    except Exception as exc:  # noqa: BLE001
        log.warning("mail/mark: imap_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"imap_failed ({type(exc).__name__})"})
    return SD.said({"status": 200, "data": out})


async def mail_file(request: Request) -> Response:
    """Inbox messages filed into a platform folder ("Staff …", "Mail …", Archive, Trash), made when missing."""
    body, refused = await _service_body(request, "mail/file", True)
    if refused is not None:
        return refused
    held = await SD.lane_refusal(MARK_GATE)
    if held is not None:
        return SD.said(held)
    user, password = own_creds(body)
    if not user or not password:
        return SD.said(dict(NO_CREDS))
    folder = str(body.get("folder") or "")
    if not MB.FOLDER_SHAPE.fullmatch(folder) and folder not in ("Archive", "Trash"):
        return SD.said({"status": 400, "message": "unknown folder shape"})
    items = [{"id": str(x.get("id") or ""), "hint": str(x.get("hint") or "")}
             for x in (body.get("items") or []) if isinstance(x, dict)]
    if not items:
        items = [{"id": str(x), "hint": ""} for x in (body.get("ids") or []) if str(x).strip()]
    items = items[:50]
    if not items:
        return SD.said({"status": 400, "message": "nothing to file"})
    try:
        out = await asyncio.to_thread(MB.file_into, user, password, items, folder)
    except Exception as exc:  # noqa: BLE001
        log.warning("mail/file: imap_failed (%s)", type(exc).__name__)
        return SD.said({"status": 502, "message": f"imap_failed ({type(exc).__name__})"})
    return SD.said({"status": 200, "data": {**out, "folder": folder}})


# ---- one personal mailbox, made on the mail server --------------------------------------------------------------------

ACCOUNTS_FILE = CFG_DIR / "postfix-accounts.cf"


def provision_ready() -> bool:
    """The mail server's accounts file and the boxes' credentials can be written here (the config mounted rw)."""
    return (ACCOUNTS_FILE.is_file() and os.access(ACCOUNTS_FILE, os.W_OK) and os.access(CFG_DIR, os.W_OK)
            and (not CREDS_FILE.exists() or os.access(CREDS_FILE, os.W_OK)))


PROVISION_RETIRED = {"status": 410, "message": "retired: nobody is given a mailbox of their own any more — the platform's "
                                               "mail is the master's alone"}


async def mail_provision(request: Request) -> Response:
    """Retired (the operator, 2026-10-28: "mais ninguém vai ganhar email"): the route stays, and answers that no
    personal mailbox is made; the mail server's accounts file is never written from here."""
    _body, refused = await _service_body(request, "mail/provision", True)
    if refused is not None:
        return refused
    return SD.said(dict(PROVISION_RETIRED))


ROUTES = (("/mail/send", mail_send), ("/mail/inbox", mail_inbox), ("/mail/message", mail_message),
          ("/mail/attachment", mail_attachment), ("/mail/mark", mail_mark), ("/mail/unread", mail_unread),
          ("/mail/file", mail_file))
