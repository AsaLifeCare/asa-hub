"""The one send door (Rpc.gs rpcCall_) on Python: every message Apps Script still raises — the hiring lane's outreach,
the attendance texts, the sign-in letters — handed here by its rpcCall_ through the relay once Smart Comms' sending
is Python's (switch `comms-send`), and decided by the same brakes every Python message meets (smart_comms: the
person's opt-out, the quiet window, the test dial, a row's own house, exactly once, the send switch), then sent by the
drain. The answer keeps rpcCall_'s shape, so the lane that asked reads it as it read Apps Script's."""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable

import gsjs
import locations as L
import mail_designs as MD
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
from writes import Decision

BUSY = "Another message is being decided right now — try again."

# Rpc.gs HUB_RPC: each method's parameters (type, required)
CONTRACTS: dict[str, dict[str, tuple[str, bool]]] = {
    "smsSend": {"to": ("string", True), "body": ("string", True), "reason": ("string", True),
                "from_line": ("string", False)},
    "emailSend": {"to": ("string", True), "subject": ("string", True), "body": ("string", True),
                  "html": ("string", False), "from_account": ("string", False), "cc": ("string", False),
                  "reason": ("string", True)},
    "packetRequest": {"candidate_id": ("string", True), "name": ("string", True), "to": ("string", True),
                      "rehearsal_for": ("string", False)},
    "teamAlert": {"subject": ("string", True), "body": ("string", True), "reason": ("string", True),
                  "to": ("string", False), "html": ("string", False), "mail_text": ("string", False),
                  "legs": ("string", False)},
}
# Rpc.gs HUB_QUIET_EXEMPT
QUIET_EXEMPT = ("sign_in", "asked_now", "by_hand")
QUIET_TO = "08:00 America/New_York"
PACKET_SITUATION = ("hiring.packet.request", "hiring_packet_request")
PACKET_TEXT = ("Hi DSP, this is ASA Lifecare. To finish your onboarding we still need your signed New Hire packet. "
               "Please check your inbox for your New Hire packet and complete it.")

s_ = gsjs.str_


def _js_type(v: Any) -> str:
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "object"


def safe_params(p: dict) -> dict[str, str]:
    """rpcSafeParams_: as the params may be logged or returned — a number masked, a body cut, the secrets withheld."""
    out: dict[str, str] = {}
    for k, raw in p.items():
        if k == "withhold":
            continue
        v = "" if raw is None else gsjs.js_str(raw)
        if p.get("withhold") and k in ("body", "subject"):
            v = SC.withheld(v, {"ask": {"withhold": p["withhold"]}})
        out[k] = ("•••" + v[-4:] if len(v) > 4 else "•••") if k == "to" else \
            (v[:80] + ("…" if len(v) > 80 else "")) if k == "body" else v[:120]
    return out


def refused_contract(name: str, p: dict) -> dict[str, Any] | None:
    """rpcCall_'s contract check: undeclared, a required parameter missing, a parameter of the wrong type."""
    spec = CONTRACTS.get(name)
    if spec is None:
        return {"ok": False, "sent": False, "gated": False, "method": name, "error": "undeclared_method",
                "detail": f'No contract for "{name}". Declare HUB_RPC.{name} before anything calls it — an '
                          "undeclared call is one nobody has decided the shape of."}
    for key, (kind, required) in spec.items():
        val = p.get(key)
        missing = val is None or gsjs.js_str(val) == ""
        if required and missing:
            return {"ok": False, "sent": False, "gated": False, "method": name, "error": "missing_param",
                    "detail": "Missing required parameter: " + key, "params": safe_params(p)}
        if not missing and _js_type(val) != kind:
            return {"ok": False, "sent": False, "gated": False, "method": name, "error": "bad_param",
                    "detail": f"{key} must be {kind}, got {_js_type(val)}"}
    return None


def envelope(name: str, p: dict, got: dict[str, Any]) -> dict[str, Any]:
    """Smart Comms' decision as rpcCall_ answers it."""
    state, held, why = s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))
    base = {"method": name, "receipt": s_(got.get("receipt")), "redirected": False}
    if state == "sent":
        return {**base, "ok": True, "sent": True, "gated": False, "queued": True, "detail": why}
    if state == "already":
        return {**base, "ok": True, "sent": False, "gated": False, "deduplicated": True,
                "detail": "This exact request was already made — not sent again."}
    if state == "refused":
        return {**base, "ok": True, "sent": False, "gated": True, "reason": "opted_out", "detail": why,
                "would_have": safe_params(p)}
    if state == "held" and held == "quiet":
        return {**base, "ok": True, "sent": False, "gated": True, "quiet": True, "reason": "quiet_hours",
                "retry_after": QUIET_TO, "detail": why, "would_have": safe_params(p)}
    if state == "held" and held == "test_mode":
        return {**base, "ok": True, "sent": False, "gated": True, "rehearsed": True, "reason": "rehearsal_sheet",
                "rehearsal_recorded": True, "detail": why}
    if state == "held" and held == "recorded":
        return {**base, "ok": True, "sent": False, "gated": True, "recorded_to": why, "detail": why}
    if state == "held":
        return {**base, "ok": True, "sent": False, "gated": True, "reason": "HUB_RPC_SEND is off", "detail": why,
                "would_have": safe_params(p)}
    if state in ("no_phone", "no_address"):
        return {**base, "ok": False, "sent": False, "gated": False, "error": state, "detail": why}
    return {**base, "ok": False, "sent": False, "gated": False, "error": "transport", "detail": why or state}


def _situation(reads: L.Reads, reason: str) -> str:
    """commMockSituationFrom_: the situation a reason names, '' when it names none."""
    try:
        return SC.situation_from(reason, SC.read_situations(reads.db))
    except Exception:  # noqa: BLE001 - the message stands without one
        return ""


def packet_text(reads: L.Reads, name: str) -> str:
    """rpcPacketMessage_: the packet request's text, the situation row's words else the floor, {name} filled."""
    try:
        rows = SC.read_situations(reads.db)
        sid = MD.situation_id(reads, rows, *PACKET_SITUATION)
        sit = SC.situation_row(rows, sid) or {}
    except Exception:  # noqa: BLE001 - the floor's words stand
        sit = {}
    tpl = s_(sit.get("sms_text")) or PACKET_TEXT
    return re.sub(r"\{(\w+)\}", lambda m: name if m.group(1) == "name" else m.group(0), tpl)


def _one(name: str, p: dict, opts: dict, reads: L.Reads, *, to: Any, key: str, channel: str = "sms",
         body: str = "", subject: str = "", team: Any = False) -> dict[str, Any]:
    reason = s_(p.get("reason"))
    return SC.raise_situation(
        None, situation=_situation(reads, reason), to=to, vars={}, key=key, lane=reason or name, prune=False,
        channel=channel, body=body, subject=subject or None, team=team, transport=True,
        from_line=p.get("from_line") if name == "smsSend" else None, auth_letter=p.get("auth_letter"),
        withhold=p.get("withhold"), html=p.get("html") if channel == "email" else None,
        cc=p.get("cc") if channel == "email" else None, from_account=p.get("from_account"),
        quiet_exempt=s_(opts.get("quiet_exempt")) in QUIET_EXEMPT,
        person=s_(opts.get("person")) or None, occasion=s_(opts.get("occasion")) or None)


def team_alert(p: dict, opts: dict, reads: L.Reads, key: str) -> dict[str, Any]:
    """hubTeamNotify_: a text to each number on the team list (and the ones the call adds), a letter to each address,
    each leg only when the row names it."""
    team = SCD.team_recipients(reads, reads.config())
    if not team["readable"]:
        return {"ok": False, "sent": False, "gated": False, "method": "teamAlert", "error": "no_recipient_reached",
                "detail": "the team list could not be read"}
    legs = [x.strip() for x in re.split(r"[,;|\s]+", s_(p.get("legs"))) if x.strip()] or ["sms", "email"]
    sms = list(team["sms"]) if "sms" in legs else []
    have = {SCD.digits(n)[-10:] for n in sms}
    for n in [x.strip() for x in re.split(r"[,;]+", s_(p.get("to"))) if x.strip()] if "sms" in legs else []:
        k = SCD.digits(n)[-10:]
        if k and k not in have:
            have.add(k)
            sms.append(n)
    emails = list(team["emails"]) if "email" in legs else []
    got = []
    for n in sms:
        got.append(_one("teamAlert", p, opts, reads, to=n, key=key + "|sms|" + SCD.digits(n)[-10:],
                        body=s_(p.get("body")), team="group"))
    for e in emails:
        got.append(_one("teamAlert", p, opts, reads, to=e, key=key + "|email|" + e.lower(), channel="email",
                        body=s_(p.get("mail_text")) or s_(p.get("body")), subject=s_(p.get("subject"))))
    if not got:
        return {"ok": False, "sent": False, "gated": False, "method": "teamAlert", "error": "no_recipient_reached",
                "detail": "neither an SMS nor an e-mail reached anybody"}
    sent = [g for g in got if s_(g.get("state")) == "sent"]
    if sent:
        n_sms = sum(1 for g in got[:len(sms)] if s_(g.get("state")) == "sent")
        return {"ok": True, "sent": True, "gated": False, "method": "teamAlert", "redirected": False, "queued": True,
                "receipt": f"team:{n_sms}sms+{len(sent) - n_sms}email"}
    return envelope("teamAlert", p, got[0])


def rpc(sess: L.Session, payload: dict) -> Decision:
    """commsRpc (the relay's own, for Apps Script's rpcCall_): {method, params, opts} → rpcCall_'s answer."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own door."})
    pl = payload if isinstance(payload, dict) else {}
    name = s_(pl.get("method"))
    p = pl.get("params") if isinstance(pl.get("params"), dict) else {}
    opts = pl.get("opts") if isinstance(pl.get("opts"), dict) else {}
    refused = refused_contract(name, p)
    if refused:
        return Decision({"status": 200, "data": refused}, subject="", own=True)
    if opts.get("dry_run") is True:
        return Decision({"status": 200, "data": {"ok": True, "sent": False, "gated": True, "method": name,
                                                 "reason": "dry_run", "params": safe_params(p)}}, subject="", own=True)
    return Decision({"status": 200, "data": call(sess.reads, name, p, opts)}, subject="", own=True)


def call(reads: L.Reads, name: str, p: dict, opts: dict) -> dict[str, Any]:
    """rpcCall_(name, params, opts) inside the write being decided: rpcCall_'s answer, the message in Smart Comms'
    outbox under its idempotency key."""
    key = s_(opts.get("idempotency_key")) or "rpc_" + uuid.uuid4().hex
    if name == "teamAlert":
        return team_alert(p, opts, reads, key)
    if name == "packetRequest":
        return envelope(name, p, _one(name, {**p, "reason": "packet request: " + s_(p.get("candidate_id"))}, opts,
                                      reads, to=p.get("to"), key=key, body=packet_text(reads, s_(p.get("name")))))
    if name == "emailSend":
        return envelope(name, p, _one(name, p, opts, reads, to=p.get("to"), key=key, channel="email",
                                      body=s_(p.get("body")), subject=s_(p.get("subject"))))
    return envelope(name, p, _one(name, p, opts, reads, to=p.get("to"), key=key, body=s_(p.get("body"))))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commsRpc": rpc}
POLICY: dict[str, dict[str, Any]] = {"commsRpc": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commsRpc": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comms_rpc_writes and _receipts; the messages Smart Comms' outbox's."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comms_rpc", label="Smart Comms sending")
