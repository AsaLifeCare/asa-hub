"""The platform mail ledger's rows kept (MailLog.gs mailLogCollectSweep_ and mailLogCollect): what mail_log read off
the mailboxes, appended to the `mail` tab through app.edits — each row by its header name, never a message the ledger
already holds — and the pass said in the log."""
from __future__ import annotations

import logging
from typing import Any, Callable

import gsjs
import locations as L
import mail_log as ML
import recon as R
import staff_views as SV
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")
STALE = "What was read for this change is out of date or was not read here, so nothing was written. Try again."
BY = "auto-mail-log"

s_ = gsjs.str_


def record(reads: L.Reads, got: dict) -> tuple[dict[str, Any], list[dict]]:
    """mailLogAppend_ for each row read, still new under the lock: (the pass's answer, the rows' records)."""
    res = W.tab_of(reads, ML.TAB)
    seen = ML.seen_keys(reads)
    recs: list[dict] = []
    for row in got.get("rows") or []:
        if not isinstance(row, dict):
            continue
        key = s_(row.get("message_key"))
        if not key or key in seen or not s_(row.get("id")):
            continue
        seen.add(key)
        recs.append(W.append_record(res, ML.HEADER, {h: s_(row.get(h)) for h in ML.HEADER}, ""))
    errors = [s_(e) for e in got.get("errors") or []]
    return {"collected": len(recs), "scanned": int(got.get("scanned") or 0), "accounts": int(got.get("accounts") or 0),
            "errors": errors}, recs


def sweep(sess: L.Session, payload: dict) -> Decision:
    """mailLogCollectSweep_: the relay's half-hourly pass, on what mailLogDue read."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(ML.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    got = R.unsealed("mailLogSweep", "service", p.get("prepared"))
    if got is None:
        return W.refuse(409, STALE)
    reads = sess.reads
    W.gate(reads)
    out, recs = record(reads, got)
    if out["collected"] or out["errors"]:
        said = (f"{out['collected']} new of {out['scanned']} scanned across {out['accounts']} mailbox(es)" +
                (" · refused: " + " | ".join(out["errors"]) if out["errors"] else ""))
        (log.warning if out["errors"] else log.info)("%s: mail_log_collect — %s", BY, said[:600])
    return W.final({"status": 200, "data": out}, recs, "")


def collect(sess: L.Session, payload: dict) -> Decision:
    """mailLogCollect: an admin's press, on what mailLogCollectPrepare read."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(ML.DENIED))
    p = payload if isinstance(payload, dict) else {}
    got = R.unsealed("mailLogCollect", R.actor(user), p.get("prepared"))
    if got is None:
        return W.refuse(409, STALE)
    reads = sess.reads
    W.gate(reads)
    out, recs = record(reads, got)
    SV.record(user, "mail_log_collect_manual", f"{out['collected']} new message(s)")
    return W.final({"status": 200, "data": out}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"mailLogSweep": sweep, "mailLogCollect": collect}
POLICY: dict[str, dict[str, Any]] = {"mailLogSweep": {}, "mailLogCollect": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
