"""Alerts-triage and workforce-forecast slices, read-only from the old platform's own tables."""
from __future__ import annotations

import logging

import lanes_pg as psycopg2

log = logging.getLogger(__name__)

RESOURCES = ("alertsTriage", "workforceForecast")

# Counts only: no alert row content ever leaves the table.
_TRIAGE_SQL = """
    SELECT alert_type, severity, COUNT(*)::int AS count,
           MAX(created_at) AS last_at,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS new_24h
      FROM asa_alerts WHERE acknowledged = FALSE
     GROUP BY alert_type, severity ORDER BY count DESC
"""


def _build_triage(dsn: str) -> tuple[list[dict], str | None]:
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(_TRIAGE_SQL)
        rows = cur.fetchall()
    out: list[dict] = []
    newest: str | None = None
    for r in rows:
        last_at = r.get("last_at")
        last_iso = last_at.isoformat() if last_at else ""
        if last_iso and (newest is None or last_iso > newest):
            newest = last_iso
        out.append({
            "id": f"{r.get('alert_type') or '?'}:{r.get('severity') or '?'}",
            "alert_type": str(r.get("alert_type") or ""),
            "severity": str(r.get("severity") or ""),
            "count": int(r.get("count") or 0),
            "last_at": last_iso,
            "new_24h": int(r.get("new_24h") or 0),
        })
    return out, newest


def _latest_payload(cur, table: str, row_id: str) -> dict | None:
    """Latest payload row, or None when the job has not cached a run yet."""
    try:
        cur.execute(
            f"SELECT payload, computed_at FROM {table} ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
    except Exception as exc:  # noqa: BLE001 — no table, no cached run
        log.warning("[forecast] %s unreadable: %r", table, exc)
        cur.connection.rollback()
        return None
    if not row or not isinstance(row.get("payload"), dict):
        return None
    out = dict(row["payload"])
    out["id"] = row_id
    computed_at = row.get("computed_at")
    out["computed_at"] = computed_at.isoformat() if computed_at else ""
    return out


def _build_forecast(dsn: str) -> tuple[list[dict], str | None]:
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        out = [
            row for row in (
                _latest_payload(cur, "asa_workforce_analysis", "analysis"),
                _latest_payload(cur, "asa_workforce_insights", "insights"),
            )
            if row is not None
        ]
    return out, None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise KeyError(resource)
    if resource == "workforceForecast":
        return _build_forecast(dsn)
    return _build_triage(dsn)
