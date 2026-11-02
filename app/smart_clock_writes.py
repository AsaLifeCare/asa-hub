"""Smart Comms' clock carried (smart_clock plans each telling): under the platform's write lock, each plan's messages
through the one send door and its ledger line, as smartEventSweep_, smartCommsSweep_ and smartDigestSweep_ judged
rpcCall_'s answers; a pass stops in time and hands what is left back to the relay for the next one."""
from __future__ import annotations

import time
from typing import Any, Callable

import comms_rpc as CR
import gsjs
import locations as L
import resource_rows as RR
import smart_clock as SK
import smart_comms as SC
from writes import Decision

PASS_S = 4.0
BUSY = "Another write holds the platform's lock; the clock rings again."

s_ = gsjs.str_


def _judge_team(res: dict, out: dict, plan: dict) -> str:
    """smartEventSweep_'s reading of one teamAlert: 'told', 'rehearsed' or ''."""
    if res.get("ok") and (res.get("sent") or res.get("recorded_to")) and not res.get("redirected"):
        return "told"
    if res.get("redirected"):
        return "rehearsed"
    if res.get("ok") and res.get("gated"):
        out["would"].append(plan["sit"] + " → " + plan["name"])
    elif res.get("ok") and res.get("deduplicated"):
        out["deduplicated"] += 1
    else:
        out["failed"].append(plan["sit"] + " → " + plan["name"] + ": " + s_(res.get("error")))
    return ""


def _judge_subject(got: list[tuple[dict, dict]], out: dict, plan: dict) -> str:
    """The `to_subject` legs: told when one reached the person (a row's own house counts), copies aside."""
    reached = redirected = False
    failed = ""
    for send, res in got:
        if send["role"] != "subject":
            continue
        if res.get("ok") and res.get("sent"):
            reached = True
            redirected = redirected or bool(res.get("redirected"))
        elif res.get("ok") and res.get("recorded_to"):
            reached = True
        elif res.get("ok") and res.get("gated"):
            out["would"].append(plan["sit"] + " → " + plan["name"] + (" (email)" if send["name"] == "emailSend" else ""))
        elif not res.get("ok"):
            failed = s_(res.get("error"))
    if reached and not redirected:
        return "told"
    if redirected:
        return "rehearsed"
    if failed:
        out["failed"].append(plan["sit"] + " → " + plan["name"] + ": " + failed)
    return ""


def _judge_reminder(got: list[tuple[dict, dict]], out: dict, plan: dict) -> str:
    """smartCommsSweep_'s legs: the channels that really delivered name the ledger line."""
    reached = redirected = False
    delivered: list[str] = []
    for send, res in got:
        if res.get("ok") and res.get("sent"):
            out["sms" if send["name"] == "smsSend" else "email"] += 1
        if send["role"] == "copy":
            if not res.get("ok"):
                out["failed"].append(plan["sit"] + " → cc: " + s_(res.get("error")))
            continue
        if res.get("ok") and res.get("sent"):
            reached = True
            if res.get("redirected"):
                redirected = True
            else:
                delivered.append(send["role"])
        elif res.get("ok") and res.get("gated"):
            out["would"].append(plan["sit"] + " → " + plan["name"] + (" (email)" if send["role"] == "email" else ""))
        elif not res.get("ok"):
            out["failed"].append(plan["sit"] + " → " + plan["name"] + ": " + s_(res.get("error")))
    if reached and not redirected:
        plan["record"]["channel"] = "+".join(delivered) or "sms"
        return "told"
    return "rehearsed" if redirected else ""


def _judge_digest(got: list[tuple[dict, dict]], out: dict, plan: dict) -> str:
    """smartDigestSweep_: recorded once whatever the recipient count, when one letter landed."""
    landed = False
    for send, res in got:
        if res.get("ok") and res.get("sent"):
            out["email"] += 1
            landed = True
        elif res.get("ok") and res.get("deduplicated"):
            landed = True
        elif res.get("ok") and res.get("gated"):
            out["would"].append(plan["sit"] + " -> " + s_(send["params"].get("to")))
        elif not res.get("ok"):
            out["failed"].append(plan["sit"] + " -> " + s_(send["params"].get("to")) + ": " + s_(res.get("error")))
    return "told" if landed else ""


def clock_send(sess: L.Session, payload: dict) -> Decision:
    """smartClockSend: the plans smartClockDue made, each checked against the ledger again, told and recorded."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(SK.DENIED))
    reads = sess.reads
    plans = [p for p in ((payload or {}).get("plans") or []) if isinstance(p, dict) and p.get("sends") is not None]
    by_sit = {s_(s.get("id")): s for s in SC.read_situations(reads.db)}
    stats = SK.ledger_stats(reads)
    now = SK.now_ms(reads)
    out: dict[str, Any] = {"told": 0, "rehearsed": 0, "sms": 0, "email": 0, "deduplicated": 0, "would": [],
                           "failed": [], "lost": 0, "left": []}
    started = time.time()
    seen: set[str] = set()
    for i, plan in enumerate(plans):
        if time.time() - started > PASS_S:
            out["left"] = plans[i:]
            break
        key, sit = s_(plan.get("key")), by_sit.get(s_(plan.get("sit")))
        if not key or key in seen or sit is None or not SC.smart_on(sit.get("enabled")):
            continue
        seen.add(key)
        a = plan.get("allow") or {}
        if a.get("digest") and stats["sent"].get(key):
            continue
        if not a.get("digest") and not SK.attempts_allow(stats["attempts"], sit, s_(a.get("who")), a.get("expires"),
                                                          now, s_(a.get("slot"))):
            continue
        got = [(send, CR.call(reads, send["name"], send["params"], send.get("opts") or {})) for send in plan["sends"]]
        rule = plan.get("rule")
        if rule == "team":
            verdict = _judge_team(got[0][1], out, plan) if got else ""
        elif rule == "subject":
            verdict = _judge_subject(got, out, plan)
        elif rule == "reminder":
            verdict = _judge_reminder(got, out, plan)
        else:
            verdict = _judge_digest(got, out, plan)
        rec = plan["record"]
        if verdict == "told":
            out["told"] += 1
            if not SC.record_ledger(key, rec["situation"], rec["person"], rec["expires"], rec["channel"], reads.db):
                out["lost"] += 1
        elif verdict == "rehearsed":
            out["rehearsed"] += 1
            SC.record_ledger(SK.rehearsal_key(key), rec["situation"], rec["person"], rec["expires"], "rehearsal",
                             reads.db)
    return Decision({"status": 200, "data": out}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"smartClockSend": clock_send}
POLICY: dict[str, dict[str, Any]] = {"smartClockSend": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"smartClockSend": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.smart_clock_writes and _receipts; the messages Smart Comms' outbox's, the ledger app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="smart_clock", label="Smart Comms' clock")
