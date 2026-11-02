"""Settings › Platform health on Python (Resolver.gs resolverAudit / resolverHealth, Rpc.gs rpcAbilities), in the
shapes the screen reads: the doors asa-hub-app answers now and the relay's maps the relay hands in (`relay`), and
what Smart Comms in Python may send. Apps Script's own tables are no longer what answers, so none of them is read."""
from __future__ import annotations

from typing import Any, Callable

import comms_rpc as CR
import gsjs
import locations as L
import smart_comms as SC
import smart_comms_desk as SCD

APP_ID = "resolver"
LANES = ("read", "write", "tool", "auth")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# Rpc.gs HUB_RPC: each method's channel and what it does; every one reaches a person
METHODS = {"smsSend": ("openphone", "One SMS to one number."),
           "emailSend": ("gmail", "One email to one address."),
           "packetRequest": ("openphone", "Ask a new hire to sign the New Hire packet."),
           "teamAlert": ("openphone+gmail", "Tell the hiring team something changed.")}
# Rpc.gs HUB_AUTH_LETTERS and HUB_QUIET_EXEMPT, by name
QUIET_EXEMPT = ("password_reset", "invitation") + CR.QUIET_EXEMPT

s_ = gsjs.str_


def _admin(user: dict[str, Any] | None) -> bool:
    """The handlers' own check: an admin, or the service."""
    return bool(user) and (gsjs.or_blank((user or {}).get("role")) == "admin" or (user or {}).get("is_service") is True)


# ---- what answers now ------------------------------------------------------------------------------------------------

def census(apps: dict[str, Any], writes: dict[str, Any]) -> dict[str, dict[str, set[str]]]:
    """Every door asa-hub-app answers, per app: its reads, its writes and the policies its modules declare."""
    out: dict[str, dict[str, set[str]]] = {}
    for side, table in (("reads", apps), ("writes", writes)):
        for app_id, module in table.items():
            entry = out.setdefault(app_id, {"reads": set(), "writes": set(), "policy": set()})
            entry[side].update(getattr(module, "ACTIONS", None) or {})
            entry["policy"].update(getattr(module, "POLICY", None) or {})
    return out


def _routes(relay: dict[str, Any]) -> list[tuple[str, str, str]]:
    """(what, app, door) for every door the relay's maps send to Python."""
    out = [(a, str(app), a) for key in ("reads", "writes", "tools") for a, app in (relay.get(key) or {}).items()]
    for resource, pair in (relay.get("slices") or {}).items():
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            out.append((f"slice {resource}", str(pair[0]), str(pair[1])))
    return out


def audit(doors: dict[str, dict[str, set[str]]], relay: dict[str, Any]) -> dict[str, Any]:
    """resolverAudit_ over what answers now: each door's declaration, every route the relay's maps name checked
    against a door that exists, and the lane each door's action is declared in (by its side when undeclared there)."""
    side: dict[str, str] = {}
    declared: set[str] = set()
    policies: set[str] = set()
    for d in doors.values():
        for a in d["reads"]:
            side.setdefault(a, "read")
        for a in d["writes"]:
            side[a] = "write"
        declared |= d["policy"] & (d["reads"] | d["writes"])
        policies |= d["policy"]
    undeclared = sorted(a for a in side if a not in declared)
    invalid = [f"{a}: declared but no handler" for a in sorted(policies - set(side))]
    for what, app_id, door in _routes(relay):
        d = doors.get(app_id)
        if d is None or door not in d["reads"] | d["writes"]:
            invalid.append(f"{what}: the relay sends it to {app_id}/{door}, which Python does not answer")
    lanes = relay.get("lanes") or {}
    by_lane: dict[str, int] = {}
    for a, s in side.items():
        lane = str(lanes.get(a) or "")
        lane = lane if lane in LANES else s
        by_lane[lane] = by_lane.get(lane, 0) + 1
    switch = relay.get("switch") or {}
    return {"mode": "audit", "actions_total": len(side), "declared": len(side) - len(undeclared),
            "undeclared_count": len(undeclared), "undeclared": undeclared, "invalid": invalid, "by_lane": by_lane,
            "engine": "python", "apps": len(doors),
            "routes": len(_routes(relay)),
            "apps_script_apps": sorted(a for a, b in switch.items() if str(b) != "python")}


def _doors() -> dict[str, dict[str, set[str]]]:
    import main  # noqa: PLC0415 - the registry is main's, read at the moment of asking
    return census(main.APPS, main.WRITES)


def _relay(payload: dict) -> dict[str, Any]:
    got = (payload or {}).get("relay") if isinstance(payload, dict) else None
    return got if isinstance(got, dict) else {}


def resolver_audit(sess: L.Session, payload: dict) -> dict[str, Any]:
    """HUB_ACTIONS.resolverAudit."""
    if not _admin(sess.user):
        return dict(DENIED)
    return {"status": 200, "data": audit(_doors(), _relay(payload))}


def checks(got: dict[str, Any]) -> dict[str, Any]:
    """The platform's own checks, as the self-test screens draw them (ran, failures, failed, live): every route the
    relay sends to Python against a door that answers it, every declaration against its handler, and every app's
    switch against Python."""
    failed = []
    for line in got["invalid"]:
        what, _sep, detail = str(line).partition(": ")
        failed.append({"check": what, "detail": detail or what})
    for app_id in got["apps_script_apps"]:
        failed.append({"check": f"{app_id} is not on Python",
                       "detail": "Settings › Back-end does not name Python for it, and nothing else answers it."})
    return {"ran": got["routes"] + got["actions_total"] + len(got["apps_script_apps"]), "failures": len(failed),
            "failed": failed, "live": {"apps": got["apps"], "doors": got["actions_total"], "routes": got["routes"]}}


def resolver_health(sess: L.Session, payload: dict) -> dict[str, Any]:
    """HUB_ACTIONS.resolverHealth: the health as the relay measured it (its traffic, handed in) beside the audit's
    count and the platform's own checks; no report tab is written, as nothing ever read one back."""
    if not _admin(sess.user):
        return dict(DENIED)
    relay = _relay(payload)
    got = audit(_doors(), relay)
    traffic = relay.get("traffic") if isinstance(relay.get("traffic"), dict) else {}
    return {"status": 200, "data": {"health": {"ok": True, "undeclared": got["undeclared_count"], **traffic},
                                    "inventory": None, "checks": checks(got)}}


# ---- what may be sent --------------------------------------------------------------------------------------------

def _armed(db: Any) -> bool:
    """smart_comms.armed on the read connection: no row, no table or no answer is off."""
    try:
        got = db.query(f"select armed from {SC.ARM} where id = 1")
    except Exception:  # noqa: BLE001 - an arm that cannot be read is off
        return False
    return bool(got) and got[0][0] is True


def sending(reads: L.Reads) -> dict[str, Any]:
    """smart_comms.brakes' send half: HUB_RPC_SEND, messages_paused and the arm, each off unless it plainly says on."""
    try:
        rpc_send = SC.read_rpc_send(reads.db) in SC.SEND_ON
    except Exception:  # noqa: BLE001 - an unread switch is off
        rpc_send = False
    try:
        word = gsjs.trim(gsjs.or_blank(SC.read_config(reads.db).get("messages_paused"))).lower()
        paused = word not in SC.PAUSE_OFF
    except Exception:  # noqa: BLE001 - an unread pause holds
        paused = True
    armed = _armed(reads.db)
    why = SC.SWITCH_OFF if not rpc_send else ("messages_paused is not off" if paused else
                                              ("" if armed else SC.NOT_ARMED))
    return {"on": rpc_send and not paused and armed, "why": why}


def test_mode(reads: L.Reads) -> dict[str, Any]:
    """hubTestModeState_ as smart_comms.brakes holds it: on or at the sheet records and sends to nobody, off sends,
    anything else holds and is said unreadable."""
    try:
        cfg = SC.read_config(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unread switch holds
        return {"on": False, "sms": 0, "emails": 0, "dropped": [], "shared": [], "unreadable": True,
                "position": "unreadable", "why": f"test mode could not be read ({type(exc).__name__})"}
    st = SCD.test_mode_state(cfg)
    tm: dict[str, Any] = {"on": st["on"], "sms": len(st["sms"]), "emails": len(st["emails"]),
                          "dropped": st["dropped"], "shared": st["shared"]}
    w = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()
    if w in SC.TEST_ON or w in SC.TEST_SHEET:
        tm.update(on=True, position="sheet")
    elif w in SC.TEST_OFF:
        tm["position"] = "production"
    else:
        tm.update(unreadable=True, position="unreadable",
                  why=f'test_mode reads "{w[:40]}"' if w else "test_mode is blank — held as on")
    return tm


def abilities(reads: L.Reads) -> dict[str, Any]:
    """rpcAbilities' answer, from the contracts and the brakes Python's sender meets."""
    send = sending(reads)
    tm = test_mode(reads)
    to_sheet = tm["position"] == "sheet"
    house = SC.REHEARSAL_TAB
    note = ("THE SWITCH COULD NOT BE READ — every message below is HELD and sent to nobody, until the configuration "
            f"answers again ({tm.get('why') or 'unreadable'})." if tm["position"] == "unreadable"
            else f"THE DIAL IS AT THE SHEET — every message below is written into the {house} house as a row and "
                 "reaches nobody: no phone, no inbox, not a tester." if to_sheet
            else "production — messages reach their real recipients")
    return {
        "sending": "on" if send["on"] else "off", "sending_why": send["why"], "engine": "python",
        "test_mode": tm, "test_mode_note": note, "test_mode_shared_warning": "",
        "quiet_window": {"from": SCD.QUIET_FROM, "to": SCD.QUIET_TO, "tz": SC.QUIET_TZ, "words": SCD.quiet_words(),
                         "now": SCD.quiet_now(reads), "exempt": list(QUIET_EXEMPT)},
        "sending_governs": "everything declared below — every message Smart Comms in Python sends passes its outbox",
        "always_sends": [],
        "always_sends_note": "nothing — every message passes the outbox and is held by the switch, the quiet window "
                             "and the receipt like every other message",
        "direct_doors": [],
        "methods": {k: {"channel": ch, "what": what, "reaches_a_person": True,
                        "required": [p for p, (_t, req) in CR.CONTRACTS.get(k, {}).items() if req]}
                    for k, (ch, what) in METHODS.items()},
    }


def rpc_abilities(sess: L.Session, payload: dict) -> dict[str, Any]:
    """HUB_ACTIONS.rpcAbilities."""
    if not _admin(sess.user):
        return dict(DENIED)
    return {"status": 200, "data": abilities(sess.reads)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"resolverAudit": resolver_audit,
                                                                    "resolverHealth": resolver_health,
                                                                    "rpcAbilities": rpc_abilities}
# HUB_POLICY: admins (the service passes)
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin",)} for a in ACTIONS}
