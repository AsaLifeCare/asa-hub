"""The platform mail ledger's collector (MailLog.gs mailLogCollect_) on Python: each wired mailbox's inbox and Sent read
straight off the mail server (mail_server.py), and every message the ledger (the `mail` tab of the Apps book) does not
hold yet made into its row — the envelope and a capped plain-text preview, never a body. mailLogDue is the relay's
half-hourly look (mailLogCollectSweep_), mailLogCollectPrepare an admin's press (mailLogCollect); each hands its write
(mail_log_writes) what it read, sealed."""
from __future__ import annotations

import re
import secrets
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import mail_server as MB
import recon as R
import writes as W

APP_ID = "hiring"
TAB = "mail"
HEADER = ("id", "at", "direction", "account", "address", "box", "from", "to", "cc", "subject", "preview", "lane",
          "reason", "receipt", "message_key", "collected_at")
PREVIEW_CHARS = 300
# a box read takes this many of its newest messages, never past 100
PER_BOX = 50
BOXES = ("", "sent")
SENT_REASON = "sent box: the words are on the transport's own row"
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own door."}
DENIED = {"status": 403, "message": "Requires an admin account"}

s_ = gsjs.str_


def preview(text: Any) -> str:
    """mailLogPreview_: tags out, whitespace folded, capped."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", gsjs.or_blank(text))).strip()[:PREVIEW_CHARS]


def message_key(account: str, box: str, msg: dict) -> str:
    """mailLogKey_: scoped by mailbox and box — one message in two boxes is two facts, not a duplicate."""
    mid = s_(msg.get("id") or msg.get("uid") or msg.get("message_id"))
    if mid:
        return f"{account}/{box}/{mid}"
    return f"{account}/{box}/{s_(msg.get('date'))}/{s_(msg.get('from_addr'))}/{s_(msg.get('subject'))[:80]}"


def seen_keys(reads: L.Reads) -> set[str]:
    """mailLogSeenKeys_: every message_key the ledger holds, the kept rows laid on; a tab not made yet holds none."""
    res = HT.where(reads, TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {TAB}")
        return set()
    col = W.header_of(res.ref, "message_key")
    if col is None:
        return set()
    return {gsjs.trim(gsjs.js_str(hubdb.typed(raw.get(col), "hub"))) for _rn, raw in reads.db.rows(res.ref)} - {""}


def collect(reads: L.Reads, per_box: Any) -> dict[str, Any]:
    """mailLogCollect_'s reading: a mailbox the mail server refuses is reported, never skipped silently."""
    try:
        limit = int(float(per_box))
    except (TypeError, ValueError):
        limit = 0
    limit = min(limit or PER_BOX, 100)
    accounts = MB.accounts()
    if not accounts:
        return {"rows": [], "collected": 0, "scanned": 0, "accounts": 0, "errors": ["no mailbox is configured"]}
    seen = seen_keys(reads)
    rows: list[dict[str, str]] = []
    scanned = 0
    errors: list[str] = []
    now = W.now_iso(reads)
    for acct in accounts:
        for box in BOXES:
            named = box or "inbox"
            try:
                threads = MB.inbox(acct["user"], acct["password"], limit, MB.box_name(box)).get("threads") or []
            except Exception as exc:  # noqa: BLE001 - the class, never the conversation
                errors.append(f"{acct['user']}/{named}: " + f"imap_failed ({type(exc).__name__})"[:80])
                continue
            sent = box == "sent"
            for msg in threads:
                scanned += 1
                key = message_key(acct["id"], named, msg)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "id": "ML_" + secrets.token_hex(5).upper(), "at": s_(msg.get("date")),
                    "direction": "out" if sent else "in", "account": acct["id"], "address": acct["user"],
                    "box": named, "from": s_(msg.get("from_addr")),
                    "to": s_(msg.get("to_addr")) or ("" if sent else acct["user"]), "cc": s_(msg.get("cc_addr")),
                    "subject": s_(msg.get("subject")),
                    "preview": "" if sent else preview(msg.get("snippet") or msg.get("preview") or msg.get("body")),
                    "lane": "mailbox", "reason": SENT_REASON if sent else "",
                    "receipt": "unread" if msg.get("unread") is True or s_(msg.get("unread")) == "true" else "",
                    "message_key": key, "collected_at": now})
    return {"rows": rows, "collected": len(rows), "scanned": scanned, "accounts": len(accounts), "errors": errors}


def due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """mailLogCollectSweep_'s look, on the relay's half-hourly clock: what the mailboxes hold that the ledger does not
    (sealed for mailLogSweep); due when there is a row to keep or a refusal to say."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(SERVICE_ONLY)
    got = collect(sess.reads, PER_BOX)
    return {"status": 200, "data": R.seal("mailLogSweep", "service",
                                          {**got, "due": len(got["rows"]) + len(got["errors"])})}


def collect_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """mailLogCollect's reading, asked first by the relay: an admin's press, on the same lane as the sweep."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    return {"status": 200, "data": R.seal("mailLogCollect", R.actor(user), collect(sess.reads, p.get("limit")))}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "mailLogDue": due, "mailLogCollectPrepare": collect_prepare}
POLICY: dict[str, dict[str, Any]] = {"mailLogDue": {}, "mailLogCollectPrepare": {"roles": ("admin",)}}
