"""The Texts panel of Requests (server/sms_ears.py replies, with the two words of each row it shows), read off the
reply ear's own ledger in asa-hub-db; the ear itself stays with its clock."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import lanes_db as hub_db
import lanes_pg as psycopg2

ACK_KEEP_H = float(os.getenv("HUB_SMS_EARS_ACK_KEEP_H", "12"))
PANEL_DAYS = int(os.getenv("HUB_SMS_EARS_PANEL_DAYS", "14"))
PANEL_LIMIT = int(os.getenv("HUB_SMS_EARS_PANEL_LIMIT", "300"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _ack_state(r: dict[str, Any], now: datetime) -> str:
    """said | opted_out | rehearsal | not_sent | expired | waiting; only `said` reached the person."""
    import shift_handoff  # noqa: PLC0415
    said = r.get("said") if isinstance(r.get("said"), dict) else {}
    ack = str(r.get("ack") or "")
    if not ack:
        return ""
    entry = said.get(ack)
    if isinstance(entry, str):
        return "said"
    if isinstance(entry, dict):
        state = str(entry.get("state") or "")
        if state in ("told", "duplicate"):
            return "said"
        if state == "opted_out":
            return "opted_out"
    if "expired" in said:
        return "expired"
    heard = r.get("heard_at")
    if isinstance(heard, datetime) and now - heard > timedelta(hours=ACK_KEEP_H):
        return "expired"
    if isinstance(entry, dict):
        return "rehearsal" if str(entry.get("state") or "") in shift_handoff.REHEARSAL \
            else "not_sent"
    return "waiting"


def _ack_note(r: dict[str, Any]) -> str:
    said = r.get("said") if isinstance(r.get("said"), dict) else {}
    if "expired" in said:
        return str(said.get("expired") or "")
    entry = said.get(str(r.get("ack") or ""))
    if isinstance(entry, dict) and str(entry.get("state") or "") not in ("told", "duplicate"):
        why = str(entry.get("why") or "").strip()
        state = str(entry.get("state") or "")
        dial = str(entry.get("dial") or "")
        return why or (f"{state}" + (f" (dial {dial})" if dial else ""))
    return ""


def replies(dsn: str, *, mine: Callable[[Any], bool], everywhere: bool,
            now: datetime | None = None) -> dict[str, Any]:
    """The Texts panel, newest first; an unreadable ledger raises, a missing one is empty."""
    import shift_requests  # noqa: PLC0415
    now = now or _now()
    with hub_db.connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT to_regclass('asa_sms_replies') IS NOT NULL AS here")
        if not (cur.fetchone() or {}).get("here"):
            return {"readable": True, "why": "", "rows": []}
        cur.execute("SELECT * FROM asa_sms_replies WHERE sent_at > %s "
                    "ORDER BY sent_at DESC LIMIT %s",
                    (now - timedelta(days=PANEL_DAYS), PANEL_LIMIT))
        got = [dict(r) for r in cur.fetchall()]
    out = []
    for r in got:
        cands = r.get("candidates") if isinstance(r.get("candidates"), list) else []
        places = [str(r.get("location") or "")] if r.get("location") else \
            [str(c.get("location") or "") for c in cands if c.get("location")]
        if places:
            if not any(mine(loc) for loc in places):
                continue
        elif not everywhere:
            continue
        out.append({
            "id": r["id"], "at": _iso(r.get("sent_at")), "heard_at": _iso(r.get("heard_at")),
            "line": str(r.get("line") or "")[-4:], "person": r.get("person") or "",
            "sender": r.get("sender") or "", "phone_tail": r.get("phone_tail") or "",
            "word": r.get("word") or "", "words": r.get("words") or "",
            "outcome": r.get("outcome") or "", "road": r.get("road") or "",
            "code": r.get("code") or "", "why": r.get("why") or "",
            "location": r.get("location") or "",
            "house": shift_requests.short_house(str(r.get("location") or ""))
            if r.get("location") else "",
            "col_iso": r.get("col_iso") or "", "value": r.get("value") or "",
            "ref": r.get("ref") or "", "request_id": r.get("request_id") or "",
            "handoff_id": r.get("handoff_id") or "", "candidates": cands,
            "ack": r.get("ack") or "", "ack_state": _ack_state(r, now),
            "ack_note": _ack_note(r),
            "rehearsal": bool(r.get("rehearsal"))})
    return {"readable": True, "why": "", "rows": out}
