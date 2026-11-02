"""The master's vital signs (Master.gs masterOverview) off asa-hub-db: the send switch and test mode as Smart Comms
reads them, the live sessions of the users book's hub_sessions copy, the armed situations and the admins. The master's
own session alone (hubIsRealMaster_: never a visit, never the service); every other admin is told the action does not
exist, as Master.gs tells them."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import comm_replies as CR
import door_gate as DG
import gsjs
import locations as L
import scope as sc
import smart_comms as SC

log = logging.getLogger("asa-hub-app")

APP_ID = "master-overview"
# Main.gs SESSIONS_TAB
SESSIONS_TAB = "hub_sessions"
SESSIONS_SHOWN = 30
NOT_HERE = {"status": 404, "message": 'Unknown action: "masterOverview".'}
KILL_SWITCH = "Script Property HUB_RPC_SEND (off stops every send, any lane)"
# AlertsConfig.gs hubCfgOn_
CFG_ON = ("on", "true", "1", "yes")

s_ = gsjs.str_


def send_enabled(db: Any) -> bool:
    """rpcSendEnabled_: HUB_RPC_SEND says on, and Settings has not paused (an unreadable pause never widens)."""
    try:
        if SC.read_rpc_send(db) not in SC.SEND_ON:
            return False
    except Exception:  # noqa: BLE001 - an unread switch is off
        return False
    try:
        paused = gsjs.trim(gsjs.or_blank(SC.read_config(db).get("messages_paused"))).lower() in CFG_ON
    except Exception:  # noqa: BLE001 - hubCfgOn_ reads an unreadable config as not paused
        paused = False
    return not paused


def test_redirect(db: Any) -> dict[str, Any] | None:
    """hubTestRedirect_: None while test mode is off; a switch that cannot be read holds, as on."""
    try:
        cfg = SC.read_config(db)
    except Exception:  # noqa: BLE001 - read as the switch unreadable
        cfg = None
    try:
        return CR.test_redirect(cfg)
    except Exception as exc:  # noqa: BLE001 - hubSwitchHeldRedirect_
        return {"sms": [], "emails": [], "sheet": True, "unreadable": True, "why": str(exc)[:200]}


def sessions(reads: L.Reads) -> list[dict[str, str]]:
    """The live sessions, newest first, at most thirty, each named by its account's e-mail."""
    email_by_id = {s_(u.get("userid")): s_(u.get("email")) for u in reads.users()}
    res = reads.db.resolve(SESSIONS_TAB)
    if res.ref is None:
        raise RuntimeError("the sessions tab is not in asa-hub-db")
    now = time.time() * 1000.0
    out = []
    for s in reads.db.normalized_rows(res.ref):
        exp = gsjs.date_parse(s_(s.get("expiresat")))
        if exp is not None and exp > now:
            uid = s_(s.get("userid"))
            who = email_by_id.get(uid) or uid
            # an acting session is the master, not its target signing in
            real = s_(s.get("actingrealuserid"))
            if real:
                who = f"{email_by_id.get(real) or real} — acting as {who}"
            out.append({"email": who, "last_seen": s_(s.get("lastseen"))})
    out.sort(key=lambda x: x["last_seen"], reverse=True)
    return out[:SESSIONS_SHOWN]


def armed_situations(db: Any) -> list[dict[str, str]]:
    return [{"id": s_(s.get("id")), "to": s_(s.get("to")), "channels": s_(s.get("channels"))}
            for s in SC.read_situations(db) if gsjs.or_blank(s.get("enabled")).lower() == "yes"]


def admins(reads: L.Reads) -> list[str]:
    return [s_(u.get("email")) for u in reads.users()
            if s_(u.get("role")) == "admin" and not sc.is_master_email(s_(u.get("email")))]


def _soft(fn: Callable[[], Any]) -> Any:
    """A feed that could not be read is None — unreadable, never empty."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - said as unreadable on the panel
        log.warning("masterOverview: a feed was not read (%s)", type(exc).__name__)
        return None


def master_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """masterOverview: the platform's vital signs, for the master in its own session alone."""
    refused = DG.refusal(sess, "masterOverview", payload, GS_POLICY)
    if refused:
        return refused
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DG.DENIED)
    if not sc.is_real_master(user):
        return dict(NOT_HERE)
    reads = sess.reads
    sending = send_enabled(reads.db)
    redirect = test_redirect(reads.db)
    told = [gsjs.or_blank(x) for x in list(redirect.get("sms") or []) + list(redirect.get("emails") or [])] \
        if redirect else []
    return {"status": 200, "data": {
        "master": sc.MASTER_ACCOUNT,
        "transport": {"sending": "on" if sending else "off",
                      "test_mode": ("on — redirecting to " + ", ".join(told)) if redirect
                      else "off — REAL recipients",
                      "kill_switch": KILL_SWITCH},
        "sessions": _soft(lambda: sessions(reads)),
        "armedSituations": _soft(lambda: armed_situations(reads.db)),
        "admins": _soft(lambda: admins(reads))}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"masterOverview": master_overview}
# HUB_POLICY as Master.gs declares it, asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {"masterOverview": {"roles": ("admin",)}}
# main.policy_gate asks nothing: the door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
