"""Builder call-offs owed to callOffFromCalendar; told only when the door names them filed."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

OHIO = ZoneInfo("America/New_York")
DOOR = "callOffFromCalendar"

MAX_PER_POST = int(os.getenv("HUB_CALLOFF_ROAD_MAX_PER_POST", "4"))
RETRY_S = float(os.getenv("HUB_CALLOFF_ROAD_RETRY_S", "300"))
# matches CommCallOff.gs COMM_CALLOFF_CARRY_HORIZON_MS
GIVE_UP_S = float(os.getenv("HUB_CALLOFF_ROAD_GIVE_UP_S", str(36 * 3600)))
REASON_MAX = 1000

OWED, TOLD, GAVE_UP = "owed", "told", "gave_up"

DDL = (
    "CREATE TABLE IF NOT EXISTS asa_calendar_calloff_road ("
    "ref TEXT PRIMARY KEY, location TEXT NOT NULL, employee TEXT NOT NULL, "
    "col_iso TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', "
    "shift_start TIMESTAMPTZ, reason TEXT NOT NULL DEFAULT '', "
    "actor TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'owed', "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), tried_at TIMESTAMPTZ, "
    "told_at TIMESTAMPTZ, tries INT NOT NULL DEFAULT 0, "
    "last_error TEXT NOT NULL DEFAULT '', answer JSONB NOT NULL DEFAULT '{}')"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _connect(dsn: str):
    import hub_db  # noqa: PLC0415 — the pure half is tested with no driver
    return hub_db.connect(dsn)


def ensure(cur) -> None:
    cur.execute(DDL)


def owe(cur, *, ref: str, location: str, employee: str, col_iso: str, value: str,
        shift_start: datetime | None, reason: str, actor: str) -> None:
    ensure(cur)
    cur.execute(
        "INSERT INTO asa_calendar_calloff_road (ref, location, employee, col_iso, value, "
        "shift_start, reason, actor) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (ref) DO NOTHING",
        (ref, location, employee, col_iso, value, shift_start,
         str(reason or "")[:REASON_MAX], str(actor or "")[:200]))


def due(row: dict[str, Any], now: datetime) -> str:
    created = row.get("created_at")
    if isinstance(created, datetime) and (now - created).total_seconds() > GIVE_UP_S:
        return "give_up"
    tried = row.get("tried_at")
    if isinstance(tried, datetime) and (now - tried).total_seconds() < RETRY_S:
        return "wait"
    return "offer"


def _clock(at: Any) -> str:
    if not isinstance(at, datetime):
        return ""
    local = at.astimezone(OHIO) if at.tzinfo else at.replace(tzinfo=OHIO)
    return local.strftime("%H:%M")


def payload(row: dict[str, Any], manager: dict[str, Any] | None = None) -> dict[str, Any]:
    manager = manager or {}
    return {"instance": str(row.get("ref") or ""),
            "employee_name": str(row.get("employee") or ""),
            "date": str(row.get("col_iso") or ""),
            "house": str(row.get("location") or ""),
            "shift": str(row.get("value") or ""),
            "shift_start": _clock(row.get("shift_start")),
            "reason": str(row.get("reason") or "")[:REASON_MAX],
            "marked_by": str(row.get("actor") or ""),
            "manager_name": str(manager.get("name") or ""),
            "manager_phone": str(manager.get("phone") or "")}


def owed(dsn: str, *, now: datetime | None = None, limit: int = MAX_PER_POST) -> list[dict[str, Any]]:
    import psycopg2.extras  # noqa: PLC0415
    now = now or _now()
    out: list[dict[str, Any]] = []
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        ensure(cur)
        cur.execute("SELECT * FROM asa_calendar_calloff_road WHERE state=%s "
                    "ORDER BY created_at", (OWED,))
        for r in cur.fetchall():
            r = dict(r)
            said = due(r, now)
            if said == "give_up":
                cur.execute("UPDATE asa_calendar_calloff_road SET state=%s, last_error=%s "
                            "WHERE ref=%s AND state=%s",
                            (GAVE_UP, (r.get("last_error") or "never filed") +
                             f" — given up {int(GIVE_UP_S // 3600)} h after the press",
                             r["ref"], OWED))
                continue
            if said == "offer" and len(out) < limit:
                out.append(r)
        conn.commit()
    return out


def results_of(env: Any) -> tuple[dict[str, dict[str, Any]], str]:
    env = env if isinstance(env, dict) else {}
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        return {}, str(env.get("message") or env.get("status") or "no answer")[:300]
    out: dict[str, dict[str, Any]] = {}
    for r in env["data"].get("rows") or []:
        if isinstance(r, dict) and str(r.get("instance") or ""):
            out[str(r["instance"])] = r
    return out, ""


def filed(answer: dict[str, Any] | None) -> bool:
    a = answer or {}
    return bool(a.get("ok")) and bool(a.get("recorded"))


def mark(dsn: str, rows: list[dict[str, Any]], env: Any, *, failure: str = "",
         now: datetime | None = None) -> dict[str, int]:
    now = now or _now()
    answers, why = results_of(env)
    why = failure or why
    counts = {"told": 0, "owed": 0}
    with _connect(dsn) as conn, conn.cursor() as cur:
        ensure(cur)
        for r in rows:
            ref = str(r.get("ref") or "")
            a = answers.get(ref)
            if filed(a):
                cur.execute("UPDATE asa_calendar_calloff_road SET state=%s, told_at=%s, "
                            "tried_at=%s, tries=tries+1, last_error='', answer=%s "
                            "WHERE ref=%s AND state=%s",
                            (TOLD, now, now, json.dumps(a, default=str)[:20000], ref, OWED))
                counts["told"] += 1
            else:
                said = why or str((a or {}).get("why") or "the door did not name this call-off")
                cur.execute("UPDATE asa_calendar_calloff_road SET tried_at=%s, tries=tries+1, "
                            "last_error=%s, answer=%s WHERE ref=%s AND state=%s",
                            (now, said[:500], json.dumps(a or {}, default=str)[:20000], ref, OWED))
                counts["owed"] += 1
        conn.commit()
    return counts


def state_of(dsn: str, ref: str) -> dict[str, Any] | None:
    import psycopg2.extras  # noqa: PLC0415
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        ensure(cur)
        cur.execute("SELECT ref, state, tries, last_error, told_at, answer "
                    "FROM asa_calendar_calloff_road WHERE ref=%s", (ref,))
        got = cur.fetchone()
        conn.commit()
    return dict(got) if got else None
