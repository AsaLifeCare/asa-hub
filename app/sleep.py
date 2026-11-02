"""Sleep on Python (Wellbeing.gs sleepProfilesDerived_): each client's sleep profile worked out from their service plan
(the isps tab, off asa-hub-db) on every read — no tab of its own. The averages and the quality are derived from the
plan's target, not logged sleep, as Apps Script derived them. A client reads only their own plan's row."""
from __future__ import annotations

import math
import re
import struct
from typing import Any, Callable

import clients as C
import gsjs
import locations as L
import scope as sc
import sheet_resources as SR
from scope import Defer

APP_ID = "sleep"
RESOURCE = "sleepProfiles"

s_ = gsjs.str_


def js_hash(key: Any) -> int:
    """wbHash_: the 32-bit ((h << 5) - h + code) | 0 over the key's UTF-16 units, made positive."""
    raw = s_(key).encode("utf-16-le")
    h = 0
    for unit in struct.unpack(f"<{len(raw) // 2}H", raw):
        h = ((h << 5) - h + unit) & 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return abs(h)


def _round1(x: float) -> float | int:
    """Math.round(x * 10) / 10, as JSON.stringify writes it."""
    n = math.floor(x * 10 + 0.5) / 10
    return int(n) if float(n).is_integer() else n


def sleep_target(text: str) -> float | int:
    """wbParseSleepTarget_: the hours the plan names, held to 6–12; 8 when it names none."""
    m = re.search(r"(\d(?:\.\d)?)\s*(?:hours?|hrs?|h)\b", text, re.I)
    if m:
        n = max(6.0, min(12.0, float(m.group(1))))
        return int(n) if n.is_integer() else n
    return 8


def sleep_notes(text: str) -> str:
    """wbSleepNotes_."""
    s = text.strip()
    if not s:
        return "Sleep routine not detailed in the ISP — follow the house bedtime protocol."
    return s if len(s) <= 220 else s[:200] + "…"


def _isps(sess: L.Session) -> list[dict]:
    """wbIspsForUser_: every plan, a client's own alone."""
    rows = C._hub(sess.reads, "isps")
    user = sess.user or {}
    # a client, or an SSA or a FAMILY whatever its role says: its own clients' plans (sheet_resources.own_keys)
    if not user or not SR._client(user):
        return rows
    keys = set(SR.own_keys(sess))
    return [r for r in rows if s_(r.get("client_key")) in keys]


def derived(sess: L.Session) -> list[dict[str, Any]]:
    """sleepProfilesDerived_."""
    out = []
    for isp in _isps(sess):
        key = s_(isp.get("client_key"))
        if not key.strip():
            continue
        combined = s_(isp.get("personal_care")) + " " + s_(isp.get("behaviors"))
        target = sleep_target(combined)
        h = js_hash(key)
        avg = _round1(target - 0.3 + (h % 5) * 0.15)
        out.append({"id": "slp-" + key, "clientId": "CLI_" + key.strip(), "client_key": isp.get("client_key"),
                    "clientName": s_(isp.get("client_name") or key), "targetHours": target, "avgHours": avg,
                    "quality": 55 + (h % 35), "bedtime": "21:30", "wakeTime": "06:30",
                    "notes": sleep_notes(combined),
                    "trend": "up" if avg >= target else ("down" if avg < target - 0.5 else "flat")})
    return out


def _away(user: dict) -> None:
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")


def profiles_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('sleepProfiles', 'list'): the derived rows."""
    _away(sess.user or {})
    return {"status": 200, "data": derived(sess)}


def profiles_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('sleepProfiles', 'get'): one derived row by its id."""
    _away(sess.user or {})
    want = gsjs.js_str((payload or {}).get("id")) if isinstance(payload, dict) else ""
    hit = next((r for r in derived(sess) if gsjs.js_str(r["id"]) == want), None)
    if hit is None:
        return {"status": 404, "message": f'No row "{want}" in {RESOURCE}.'}
    return {"status": 200, "data": hit}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"sleepProfilesList": profiles_list,
                                                                    "sleepProfilesGet": profiles_get}
# the generic verbs declare no roles; the door's own reading decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
