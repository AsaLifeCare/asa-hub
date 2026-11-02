"""The platform's mailboxes on mail.asaop.org, reached from Python alone (the relay's /mail/* doors, moved): IMAP to
read, flag and file, SMTP to send with a copy filed in Sent. The mail lives on the mail server; nothing here keeps it.

The mailboxes: slot 1 is the platform's own voice, 2–5 more boxes — PLATFORM_EMAIL[_n] and PLATFORM_EMAIL_PASSWORD[_n]
in the app's environment, then a box added from the Mail screen, kept in <documents>/mail/accounts.json (0600). A
password is never logged, answered or written anywhere else."""
from __future__ import annotations

import base64
import imaplib
import json
import os
import re
import smtplib
import time
from email import message_from_bytes, policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Any

import location_docs as LD

HOST = os.getenv("HUB_MAIL_HOST", "mail.asaop.org")
SMTP_PORT = int(os.getenv("HUB_MAIL_SMTP_PORT", "587"))
IMAP_PORT = int(os.getenv("HUB_MAIL_IMAP_PORT", "143"))
DOMAIN = os.getenv("HUB_MAIL_DOMAIN", "asaop.org")
SLOTS = 5
ATTACHMENT_MAX = int(os.getenv("HUB_MAIL_ATTACHMENT_MAX", str(8 * 1024 * 1024)))
# the platform's own folders, as the attendance watcher names them; a caller's string is never a folder
FOLDER_SHAPE = re.compile(r"(?:Staff|Mail) [A-Za-z][A-Za-z0-9 ]{1,40}")


def _added_file() -> Path:
    return LD.ROOT / "mail" / "accounts.json"


def _added() -> dict[str, dict[str, str]]:
    try:
        got = json.loads(_added_file().read_text(encoding="utf-8"))
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def accounts() -> list[dict[str, str]]:
    """platformMailAccounts_: every wired box in slot order, {id, user, password}."""
    added = _added()
    out = []
    for i in range(1, SLOTS + 1):
        sfx = "" if i == 1 else f"_{i}"
        user = os.getenv("PLATFORM_EMAIL" + sfx, "").strip()
        password = os.getenv("PLATFORM_EMAIL_PASSWORD" + sfx, "")
        if not (user and password):
            got = added.get(str(i)) or {}
            user, password = str(got.get("user") or "").strip(), str(got.get("password") or "")
        if user and password:
            out.append({"id": str(i), "user": user, "password": password})
    return out


def creds(slot: Any) -> dict[str, str] | None:
    """platformMailCreds_: the named slot, else the first box; None when none is wired."""
    every = accounts()
    if not every:
        return None
    want = str(slot if slot is not None else "").strip()
    return next((a for a in every if want and a["id"] == want), every[0])


def addresses() -> list[dict[str, Any]]:
    """platformMailAddresses_: the boxes without their passwords."""
    return [{"id": a["id"], "address": a["user"], "primary": a["id"] == "1"} for a in accounts()]


def add(slot: str, user: str, password: str) -> None:
    """A box wired from the screen, kept beside the documents, readable by root alone."""
    target = _added_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    got = _added()
    got[str(slot)] = {"user": user, "password": password}
    tmp = target.with_name(target.name + ".part")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(got, f)
    os.replace(tmp, target)


def box_name(asked: Any, *, filed: bool = False) -> str:
    """The mailbox a read names: Sent, a platform folder (Archive and Trash too where a message can be), else INBOX."""
    a = str(asked or "").strip()
    if a.lower() == "sent":
        return "Sent"
    if FOLDER_SHAPE.fullmatch(a) or (filed and a in ("Archive", "Trash")):
        return a
    return "INBOX"


def _open(user: str, password: str, timeout: float = 20) -> imaplib.IMAP4:
    conn = imaplib.IMAP4(HOST, IMAP_PORT, timeout=timeout)
    conn.starttls()
    conn.login(user, password)
    return conn


def _close(conn: imaplib.IMAP4) -> None:
    try:
        conn.logout()
    except Exception:  # noqa: BLE001
        pass


def _h(raw: Any) -> str:
    try:
        return str(make_header(decode_header(str(raw or ""))))
    except Exception:  # noqa: BLE001 - a mangled header is still a header
        return str(raw or "")


def _raw_of(parts: Any) -> tuple[bytes, str]:
    raw, flags = b"", ""
    for part in parts or []:
        if isinstance(part, tuple):
            flags = str(part[0] or "")
            raw = part[1] or b""
    return raw, flags


def folders(conn: imaplib.IMAP4) -> list[str]:
    """The mailbox's own platform folders, off one LIST."""
    names: list[str] = []
    try:
        _typ, data = conn.list()
        for raw in data or []:
            line = raw.decode("utf-8", "ignore") if isinstance(raw, bytes) else str(raw)
            m = re.search(r'"([^"]+)"\s*$', line)
            name = m.group(1) if m else line.rsplit(" ", 1)[-1]
            if FOLDER_SHAPE.fullmatch(name):
                names.append(name)
    except Exception:  # noqa: BLE001 - a rail without folders beats no inbox
        pass
    return sorted(set(names))


def inbox(user: str, password: str, limit: int, mailbox: str = "INBOX") -> dict[str, Any]:
    """The newest messages of one mailbox, read only: looking never marks anything seen."""
    conn = _open(user, password)
    try:
        found = folders(conn)
        conn.select('"%s"' % mailbox.replace('"', ''), readonly=True)
        _typ, data = conn.uid("search", None, "ALL")
        uids = (data[0] or b"").split()
        rows: list[dict[str, Any]] = []
        for uid in reversed(uids[-limit:]):
            _t, parts = conn.uid("fetch", uid, "(BODY.PEEK[] FLAGS)")
            raw, flags = _raw_of(parts)
            if not raw:
                continue
            m = message_from_bytes(raw, policy=policy.default)
            snippet = ""
            try:
                bp = m.get_body(preferencelist=("plain",))
                snippet = str(bp.get_content())[:400] if bp is not None else ""
            except Exception:  # noqa: BLE001
                snippet = ""
            try:
                has_attachment = next(m.iter_attachments(), None) is not None
            except Exception:  # noqa: BLE001 - a broken part is not a verdict
                has_attachment = False
            try:
                when = parsedate_to_datetime(str(m.get("Date"))).isoformat()
            except Exception:  # noqa: BLE001
                when = str(m.get("Date") or "")
            frm_name, frm_addr = parseaddr(_h(m.get("From")))
            rows.append({"id": str(m.get("Message-ID") or uid.decode()), "from_name": frm_name or frm_addr,
                         "from_addr": frm_addr, "to": _h(m.get("To")), "subject": _h(m.get("Subject")) or "(no subject)",
                         "date": when, "snippet": snippet.strip(), "unread": "\\Seen" not in flags,
                         "has_attachment": has_attachment})
        return {"threads": rows, "folders": found, "mailbox": mailbox,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    finally:
        _close(conn)


def locate(conn: imaplib.IMAP4, mid: str, hint: str) -> list[bytes]:
    """UIDs for one message: its Message-ID, else its subject, else the UID the listing minted."""
    uids: list[bytes] = []
    if "@" in mid:
        try:
            _typ, data = conn.uid("search", None, "HEADER", "Message-ID", '"%s"' % mid.replace('"', ""))
            uids = (data[0] or b"").split()
        except Exception:  # noqa: BLE001
            uids = []
    if not uids and hint:
        needle = "".join(ch for ch in hint if " " <= ch <= "~").strip()
        if needle:
            try:
                _typ, data = conn.uid("search", None, "SUBJECT", '"%s"' % needle.replace('"', ""))
                uids = (data[0] or b"").split()
            except Exception:  # noqa: BLE001
                uids = []
    if not uids and mid.isdigit():
        try:
            _typ, data = conn.uid("search", None, "UID", mid)
            uids = (data[0] or b"").split()
        except Exception:  # noqa: BLE001
            uids = [mid.encode()]
    return uids


def _fetch_one(conn: imaplib.IMAP4, mailbox: str, mid: str, hint: str) -> Any:
    conn.select('"%s"' % mailbox.replace('"', ''), readonly=True)
    uids = locate(conn, mid, hint)
    if not uids:
        return None
    _t, parts = conn.uid("fetch", uids[0], "(BODY.PEEK[])")
    raw, _f = _raw_of(parts)
    return message_from_bytes(raw, policy=policy.default) if raw else None


def message(user: str, password: str, mid: str, mailbox: str, hint: str) -> dict[str, Any]:
    """One message whole: its text, its HTML alternative, its attachments by walk position."""
    conn = _open(user, password)
    try:
        m = _fetch_one(conn, mailbox, mid, hint)
        if m is None:
            return {"found": False}
        text, html = "", ""
        try:
            bp = m.get_body(preferencelist=("plain",))
            text = str(bp.get_content())[:200_000] if bp is not None else ""
        except Exception:  # noqa: BLE001
            text = ""
        try:
            bh = m.get_body(preferencelist=("html",))
            html = str(bh.get_content())[:800_000] if bh is not None else ""
        except Exception:  # noqa: BLE001
            html = ""
        attachments: list[dict[str, Any]] = []
        for idx, part in enumerate(m.walk()):
            if part.is_multipart():
                continue
            fname = part.get_filename() or ""
            if part.get_content_disposition() != "attachment" and not fname:
                continue
            try:
                size = len(part.get_payload(decode=True) or b"")
            except Exception:  # noqa: BLE001
                size = 0
            attachments.append({"part": idx, "filename": str(fname or ("part-%d" % idx)),
                                "mime": part.get_content_type(), "size": size})
        return {"found": True, "text": text, "html": html, "attachments": attachments}
    finally:
        _close(conn)


def attachment(user: str, password: str, mid: str, want: int, mailbox: str, hint: str) -> dict[str, Any]:
    """One attachment's bytes, base64, bounded."""
    conn = _open(user, password, 30)
    try:
        m = _fetch_one(conn, mailbox, mid, hint)
        if m is None:
            return {"found": False}
        for idx, part in enumerate(m.walk()):
            if idx != want or part.is_multipart():
                continue
            payload = part.get_payload(decode=True) or b""
            if len(payload) > ATTACHMENT_MAX:
                return {"found": True, "too_big": True, "size": len(payload)}
            return {"found": True, "filename": str(part.get_filename() or ("part-%d" % idx)),
                    "mime": part.get_content_type(), "b64": base64.b64encode(payload).decode()}
        return {"found": False}
    finally:
        _close(conn)


def mark(user: str, password: str, items: list[dict], seen: bool, mailbox: str) -> dict[str, Any]:
    """The seen flag, set or cleared."""
    marked: list[str] = []
    conn = _open(user, password)
    try:
        conn.select('"%s"' % mailbox.replace('"', ''))
        for item in items:
            mid = str(item.get("id") or "").strip()
            if not mid:
                continue
            try:
                uids = locate(conn, mid, str(item.get("hint") or ""))
                for uid in uids:
                    conn.uid("store", uid, "+FLAGS" if seen else "-FLAGS", "(\\Seen)")
                if uids:
                    marked.append(mid)
            except Exception:  # noqa: BLE001 - one stubborn message, not the batch
                continue
        return {"marked": len(marked), "marked_ids": marked}
    finally:
        _close(conn)


def unread_count(user: str, password: str) -> int:
    """UNSEEN in the inbox, via STATUS: nothing fetched, no flag touched."""
    conn = _open(user, password, 15)
    try:
        _typ, data = conn.status("INBOX", "(UNSEEN)")
        m = re.search(rb"UNSEEN (\d+)", (data or [b""])[0] or b"")
        return int(m.group(1)) if m else 0
    finally:
        _close(conn)


def file_into(user: str, password: str, items: list[dict], folder: str) -> dict[str, Any]:
    """Messages moved from INBOX into `folder`, made when missing."""
    moved: list[str] = []
    missing: list[str] = []
    conn = _open(user, password, 30)
    try:
        mbox = '"%s"' % folder.replace('"', '')
        for verb in (conn.create, conn.subscribe):
            try:
                verb(mbox)
            except Exception:  # noqa: BLE001 - an existing folder is not a failure
                pass
        conn.select("INBOX")
        for item in items:
            mid = str(item.get("id") or "").strip()
            hint = "".join(ch for ch in str(item.get("hint") or "") if " " <= ch <= "~").strip()
            if not mid:
                continue
            try:
                uids = locate(conn, mid, hint)
                if not uids:
                    missing.append(mid)
                    continue
                ok = False
                for uid in uids:
                    t1, _r1 = conn.uid("copy", uid, mbox)
                    if t1 == "OK":
                        conn.uid("store", uid, "+FLAGS", "(\\Deleted \\Seen)")
                        ok = True
                (moved if ok else missing).append(mid)
            except Exception:  # noqa: BLE001 - one stubborn message keeps no other in the inbox
                continue
        try:
            conn.expunge()
        except Exception:  # noqa: BLE001
            pass
        return {"moved": len(moved), "moved_ids": moved, "not_found": missing, "folder": folder}
    finally:
        _close(conn)


def verify(user: str, password: str) -> str:
    """'' when the mail server takes these credentials, else why not (never the credentials)."""
    try:
        _close(_open(user, password, 15))
        return ""
    except Exception as exc:  # noqa: BLE001 - the class of the refusal, never its words
        return f"the mail server refused the login ({type(exc).__name__})"


def compose(user: str, to: str, subject: str, text: str, html: str, cc: str, from_name: str, message_id: str,
            date: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, user)) if from_name else user
    msg["To"] = to
    msg["Message-ID"] = message_id
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = subject
    msg["Date"] = date
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    return msg


def send(user: str, password: str, to: str, subject: str, text: str, html: str = "", cc: str = "",
         from_name: str = "") -> dict[str, str]:
    """One letter out over SMTP, then a copy filed in the box's Sent: {receipt, message_id}."""
    message_id = make_msgid(domain=(user.partition("@")[2] or DOMAIN))
    msg = compose(user, to, subject, text, html, cc, from_name, message_id, formatdate(localtime=True))
    with smtplib.SMTP(HOST, SMTP_PORT, timeout=20) as s:
        s.starttls()
        s.login(user, password)
        s.send_message(msg)
    try:
        conn = _open(user, password)
        try:
            conn.append("Sent", "\\Seen", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        finally:
            _close(conn)
    except Exception:  # noqa: BLE001 - delivered all the same
        return {"receipt": "queued (not filed in Sent)", "message_id": message_id}
    return {"receipt": "queued", "message_id": message_id}
