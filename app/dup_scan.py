"""The daily pattern scan on Python (DuplicateScan.gs dupScanRun_, the hiring sweep's dupScanSweepMaybe_): the
accounts read off asa-hub-db's copy of the users tab, grouped by their folded display names — e-mails never compared
— and the day's finding said once through the situation `pattern_scan_daily`, clean or not; a failed read never
becomes an all-clear. The look (dupScanDue) plans the day's messages; app/dup_scan_writes.py says them and writes the
ledger line."""
from __future__ import annotations

import re
from typing import Any, Callable

import clock_sweeps as CS
import gsjs
import locations as L
import smart_clock as SK
import smart_comms as SC
import staff_alerts as SA
from gsjs import NY

APP_ID = "dup-scan"
# DUP_SCAN_SITUATION, DUP_SCAN_LEDGER_PERSON, DUP_SCAN_NAMES_MAX
SITUATION = "pattern_scan_daily"
LEDGER_PERSON = "platform"
NAMES_MAX = 4
# dupScanSweepMaybe_'s script-cache key and how long it holds
THROTTLE_KEY = "dup_scan_ran"
EVERY_S = 3600
LOG_BY = "asa-hub:dupscan"
_INDEX = re.compile(r"^(?:0|[1-9]\d{0,9})$")

s_ = gsjs.str_


def scan_day(reads: L.Reads) -> str:
    """dupScanDay_: today on Ohio's clock."""
    return reads.now.astimezone(NY).strftime("%Y-%m-%d")


def _js_order(keys: list[str]) -> list[str]:
    """A JavaScript object's own keys in the order for…in walks them: array indices first, ascending, then the rest
    as they were added."""
    index = sorted((k for k in keys if _INDEX.match(k) and int(k) < 2 ** 32 - 1), key=int)
    return index + [k for k in keys if k not in set(index)]


def groups_of(rows: list[dict]) -> list[dict]:
    """dupScanGroups_: the accounts that share one folded display name, the largest group first."""
    groups: dict[str, dict] = {}
    for u in rows or []:
        uid, name = s_(u.get("userid")), s_(u.get("displayname"))
        if not uid or not name:
            continue
        key = gsjs.name_key(name)
        if not key:
            continue
        if key not in groups:
            groups[key] = {"name": name, "accounts": []}
        groups[key]["accounts"].append({"id": uid, "email": s_(u.get("email")), "last": s_(u.get("lastlogin"))})
    out = [groups[k] for k in _js_order(list(groups)) if len(groups[k]["accounts"]) > 1]
    out.sort(key=lambda g: -len(g["accounts"]))
    return out


def finding_of(groups: list[dict], scanned: int) -> dict[str, Any]:
    """dupScanFinding_: the day's finding in words, a clean day said too."""
    if not groups:
        return {"clean": True, "count": 0, "scanned": scanned, "finding": "no duplicates in the system",
                "detail": f"{scanned} accounts checked, none of them the same person twice"}
    names = [g["name"] + " (" + str(len(g["accounts"])) + ")" for g in groups[:NAMES_MAX]]
    more = len(groups) - len(names)
    return {"clean": False, "count": len(groups), "scanned": scanned,
            "finding": str(len(groups)) + (" duplicate: " if len(groups) == 1 else " duplicates: ") + ", ".join(names)
                       + (" +" + str(more) if more > 0 else ""),
            "detail": " · ".join(names) + (" and " + str(more) + " more" if more > 0 else "")}


def _situation(reads: L.Reads) -> dict | None:
    """smartSituationOn_(DUP_SCAN_SITUATION); a read that throws is no situation."""
    try:
        row = SC.situation_row(SC.read_situations(reads.db), SITUATION)
    except Exception:  # noqa: BLE001 - dupScanRun_'s catch
        return None
    return row if row is not None and SC.smart_on(row.get("enabled")) else None


def plan(reads: L.Reads) -> dict[str, Any]:
    """dupScanRun_ up to the sending: the accounts read and grouped, the day's ledger key asked, the situation read,
    and each message it would say (rpcCall_'s name, params and idempotency key)."""
    out: dict[str, Any] = {"scanned": 0, "duplicates": 0, "told": 0, "held": 0, "state": "quiet", "why": ""}
    try:
        rows = reads.users()
    except Exception as e:  # noqa: BLE001 - a failed read must never become an all-clear
        out["state"] = "unread"
        out["why"] = "the accounts could not be read — nothing was said"
        return {"out": out, "unread": str(e) or type(e).__name__}
    out["scanned"] = len(rows)
    groups = groups_of(rows)
    out["duplicates"] = len(groups)
    found = finding_of(groups, len(rows))
    day = scan_day(reads)
    told = SA.ledger_keys(reads) or set()
    key = SK.ledger_key(SITUATION, LEDGER_PERSON, day)
    if key in told:
        out["state"] = "already"
        out["why"] = "said once today"
        return {"out": out}
    out["ledger_key"] = key
    sit = _situation(reads)
    if sit is None:
        out["state"] = "wordless"
        out["why"] = "the situation `" + SITUATION + "` is absent or switched off"
        return {"out": out}
    chans = SC.smart_list(sit.get("channels"))
    words = {"finding": found["finding"], "count": str(found["count"]), "scanned": str(found["scanned"]), "day": day,
             "detail": found["detail"], "sender": SC.SENDER_DEFAULT, "name": "", "first_name": ""}
    reason = "pattern scan " + day + ": " + SITUATION
    mail_words = sit.get("email_text") if not gsjs.falsy(sit.get("email_text")) else sit.get("sms_text")
    sends: list[dict] = []
    for i, dest in enumerate(SC.smart_list(sit.get("to"))):
        d = gsjs.trim(dest)
        if not d:
            continue
        if "@" in d:
            if "email" not in chans or not s_(mail_words):
                continue
            sends.append({"name": "emailSend",
                          "params": {"to": d, "subject": SC.render(sit.get("email_subject"), words),
                                     "body": SC.render(mail_words, words), "reason": reason},
                          "opts": {"idempotency_key": f"dupscan_mail{i}_{day}"}})
        else:
            if "sms" not in chans or not s_(sit.get("sms_text")):
                continue
            # Two of the three are company lines, which the outside door drops silently.
            num = SC.team_copy(d)
            if not num:
                continue
            sends.append({"name": "smsSend", "params": {"to": num, "body": SC.render(sit.get("sms_text"), words),
                                                        "reason": reason},
                          "opts": {"idempotency_key": f"dupscan_sms{i}_{day}"}})
    return {"out": out, "day": day, "channel": "+".join(chans) or "sms", "detail": found["detail"], "sends": sends}


def scan_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """dupScanDue: the relay's look before dupScanSweep — nothing while the scan's key holds, else the day's plan."""
    if not CS.service(sess):
        return dict(CS.DENIED)
    reads = sess.reads
    if CS.held(reads, THROTTLE_KEY):
        return {"status": 200, "data": {"due": False, "skipped": "checked recently"}}
    return {"status": 200, "data": {"due": True, **plan(reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"dupScanDue": scan_due}
POLICY: dict[str, dict[str, Any]] = {"dupScanDue": {}}
