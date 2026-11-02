"""Each call-off fill noted once per cell and offered to openShiftCovered until it gets a final answer."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

OHIO = ZoneInfo("America/New_York")
KIND = "open_shift_covered"
DOOR = "openShiftCovered"
CALLOFF_KIND = "call_off"            # shift_requests.KIND_CALLOFF, literal so this file never imports it

MAX_PER_POST = int(os.getenv("HUB_COVERED_MAX_PER_POST", "6"))
RETRY_S = float(os.getenv("HUB_COVERED_RETRY_S", "600"))
DIAL_RETRY_S = float(os.getenv("HUB_COVERED_DIAL_RETRY_S", "120"))
NOT_YET_OFFERS = int(os.getenv("HUB_COVERED_NOT_YET_OFFERS", "12"))
FAILED_OFFERS = int(os.getenv("HUB_COVERED_FAILED_OFFERS", "3"))
STALE_AFTER_END_S = float(os.getenv("HUB_COVERED_STALE_AFTER_END_S", "3600"))

FINAL = frozenset({"told", "rehearsed", "recorded", "partial", "held", "nobody_heard",
                   "ask_dropped", "unknown_audience", "stale", "refused", "duplicate",
                   "gave_up"})
NOT_NOW = frozenset({"refused_quiet", "dial_unknown", "not_yet", "failed"})

LEDGER_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_open_shift_covered ("
    "location TEXT NOT NULL, open_row TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', "
    "shift_start TIMESTAMPTZ, shift_end TIMESTAMPTZ, "
    "filled_by TEXT NOT NULL DEFAULT '', filled_how TEXT NOT NULL DEFAULT '', "
    "decided_by TEXT NOT NULL DEFAULT '', filled_at TIMESTAMPTZ, "
    "noted_by TEXT NOT NULL DEFAULT '', noted_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "state TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '', "
    "count TEXT NOT NULL DEFAULT '', offers INT NOT NULL DEFAULT 0, "
    "failures INT NOT NULL DEFAULT 0, waits INT NOT NULL DEFAULT 0, "
    "offered_at TIMESTAMPTZ, said_at TIMESTAMPTZ, "
    "PRIMARY KEY (location, open_row, col_iso))"
)
# the net never reports fills from before the ledger's birth
BIRTH_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_open_shift_covered_birth ("
    "lane TEXT PRIMARY KEY, born TIMESTAMPTZ NOT NULL DEFAULT now())"
)
DDL = (LEDGER_DDL, BIRTH_DDL)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v: Any) -> str:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v or "")


def _connect(dsn: str):
    import hub_db  # noqa: PLC0415 — the host test imports this file with no driver
    return hub_db.connect(dsn)


def _ddl(cur) -> None:
    for stmt in DDL:
        cur.execute(stmt)
    cur.execute("INSERT INTO asa_open_shift_covered_birth (lane) VALUES (%s) "
                "ON CONFLICT DO NOTHING", (KIND,))


def row_id(location: str, open_row: str, col_iso: str) -> str:
    return f"{location}|{open_row}|{col_iso}"


def _cell_of(rid: str) -> tuple[str, str, str] | None:
    parts = str(rid or "").split("|")
    return (parts[0], parts[1], parts[2]) if len(parts) == 3 else None


def note_filled(dsn: str, row: dict[str, Any], *, person: str, how: str = "",
                by: str = "", now: datetime | None = None) -> dict[str, Any]:
    """Called after `shift_requests.decide` commits; never raises."""
    row = row or {}
    if str(row.get("kind") or "") != CALLOFF_KIND:
        return {"noted": False, "why": "not a call-off — no URGENT OPEN SHIFT went out about it"}
    now = now or _now()
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            _ddl(cur)
            cur.execute(
                "INSERT INTO asa_open_shift_covered (location, open_row, col_iso, value, "
                "shift_start, shift_end, filled_by, filled_how, decided_by, filled_at, noted_by) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'decide') ON CONFLICT DO NOTHING",
                (row.get("location"), row.get("open_row"), row.get("col_iso"),
                 str(row.get("value") or ""), row.get("shift_start"), row.get("shift_end"),
                 str(person or ""), str(how or ""), str(by or ""), now))
            fresh = cur.rowcount
            conn.commit()
        return {"noted": bool(fresh), "why": "" if fresh else "already noted — one follow-up per shift"}
    except Exception as exc:  # noqa: BLE001 — the decision stands; the net is a minute away
        return {"noted": False, "why": f"the ledger could not be written ({type(exc).__name__})"}


# A fill the staff-answers rehearsal played carries its road (filled_how 'rehearsal:…').
REHEARSED_FILL = "rehearsal:%"


def note_from_pool(dsn: str, *, now: datetime | None = None) -> int:
    now = now or _now()
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        cur.execute(
            "INSERT INTO asa_open_shift_covered (location, open_row, col_iso, value, "
            "shift_start, shift_end, filled_by, filled_how, decided_by, filled_at, noted_by) "
            "SELECT p.location, p.open_row, p.col_iso, p.value, p.shift_start, p.shift_end, "
            "p.filled_by, p.filled_how, p.decided_by, p.closed_at, 'pool' "
            "FROM asa_shift_pool p, asa_open_shift_covered_birth b "
            "WHERE b.lane = %s AND p.kind = %s AND p.filled_by <> '' "
            "AND COALESCE(p.filled_how, '') NOT LIKE %s "
            "AND p.closed_at IS NOT NULL AND p.closed_at >= b.born "
            "AND (p.shift_end IS NULL OR p.shift_end > %s) "
            "ON CONFLICT DO NOTHING",
            (KIND, CALLOFF_KIND, REHEARSED_FILL, now))
        added = cur.rowcount
        conn.commit()
    return max(0, added)


def due(row: dict[str, Any], now: datetime, *, quiet: bool) -> str:
    state = str(row.get("state") or "")
    if state in FINAL:
        return "wait"
    end = row.get("shift_end")
    if isinstance(end, datetime) and now - end > timedelta(seconds=STALE_AFTER_END_S):
        return "stale"
    offered = row.get("offered_at") if isinstance(row.get("offered_at"), datetime) else None
    since = (now - offered).total_seconds() if offered else None
    if not state:
        # first offer at once, even at night: the door's stamp drops a held ask
        return "offer"
    if state == "refused_quiet":
        return "wait" if quiet else "offer"
    if state == "dial_unknown":
        return "offer" if since is None or since >= DIAL_RETRY_S else "wait"
    if state == "not_yet":
        if int(row.get("waits") or 0) >= NOT_YET_OFFERS:
            return "gave_up"
        return "offer" if since is None or since >= RETRY_S else "wait"
    if state == "failed":
        if int(row.get("failures") or 0) >= FAILED_OFFERS:
            return "gave_up"
        return "offer" if since is None or since >= RETRY_S else "wait"
    return "wait"


def _quiet(now: datetime) -> bool:
    try:
        import psi_reminders  # noqa: PLC0415
        return bool(psi_reminders.quiet(now))
    except Exception:  # noqa: BLE001 — an unknown window is a quiet one: the door re-checks
        return True


def payload(row: dict[str, Any], homes: dict[str, dict[str, str]]) -> dict[str, Any]:
    loc = str(row.get("location") or "")
    code = loc.split(" - ")[-1].strip().upper() if loc else ""
    home = homes.get(code) or {}
    start = row.get("shift_start")
    end = row.get("shift_end")
    filled = row.get("filled_at")
    return {
        "id": row_id(loc, str(row.get("open_row") or ""), str(row.get("col_iso") or "")),
        "kind": KIND,
        "location": loc, "house": code,
        "house_name": str(home.get("name") or ""),
        "address": str(home.get("address") or ""),
        "open_row": str(row.get("open_row") or ""),
        "called_off_by": str(row.get("open_row") or ""),
        "col_iso": str(row.get("col_iso") or ""),
        "value": str(row.get("value") or ""),
        "shift_start": _iso(start), "shift_end": _iso(end),
        "start_hm": start.astimezone(OHIO).strftime("%H:%M") if isinstance(start, datetime) else "",
        "filled_by": str(row.get("filled_by") or ""),
        "filled_how": str(row.get("filled_how") or ""),
        "decided_by": str(row.get("decided_by") or ""),
        "filled_at": _iso(filled),
    }


def owed(dsn: str, *, now: datetime | None = None, limit: int = MAX_PER_POST) -> list[dict[str, Any]]:
    """Fills to offer now, oldest first; closes stale or spent ones on the way."""
    import psycopg2.extras  # noqa: PLC0415
    now = now or _now()
    quiet = _quiet(now)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT * FROM asa_open_shift_covered WHERE NOT (state = ANY(%s)) "
                    "AND COALESCE(filled_how, '') NOT LIKE %s ORDER BY noted_at",
                    (list(FINAL), REHEARSED_FILL))
        rows = [dict(r) for r in cur.fetchall()]
        picked: list[dict[str, Any]] = []
        for r in rows:
            verdict = due(r, now, quiet=quiet)
            if verdict == "offer":
                if len(picked) < limit:
                    picked.append(r)
            elif verdict in ("gave_up", "stale"):
                why = ("the shift ended before the door could be told — nobody needs telling now"
                       if verdict == "stale" else
                       f"the door never gave a final answer ({r.get('state')}: {r.get('why') or '—'})")
                cur.execute("UPDATE asa_open_shift_covered SET state=%s, why=%s, said_at=now() "
                            "WHERE location=%s AND open_row=%s AND col_iso=%s",
                            (verdict, why[:900], r["location"], r["open_row"], r["col_iso"]))
        conn.commit()
    if not picked:
        return []
    homes: dict[str, dict[str, str]] = {}
    try:
        import house_directory  # noqa: PLC0415
        homes = house_directory.read(dsn)
    except Exception:  # noqa: BLE001 — no directory costs the house's name, never the row
        homes = {}
    return [payload(r, homes) for r in picked]


def mark(dsn: str, rows: list[dict[str, Any]], results: dict[str, Any], *,
         failure: str = "", now: datetime | None = None) -> int:
    """An unanswered row is marked `failed` and offered again."""
    now = now or _now()
    by_id = {str(r.get("id")): r for r in (results or {}).get("results") or [] if isinstance(r, dict)}
    wrote = 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        for offered in rows or []:
            rid = str(offered.get("id") or "")
            cell = _cell_of(rid)
            if not cell:
                continue
            answer = by_id.get(rid) or {}
            state = str(answer.get("state") or "")
            why = str(answer.get("why") or "")
            if state not in FINAL and state not in NOT_NOW:
                state = "failed"
                why = why or failure or "the door gave no answer for this row"
            cur.execute(
                "UPDATE asa_open_shift_covered SET state=%s, why=%s, count=%s, offers=offers+1, "
                "failures=failures + %s, waits=waits + %s, offered_at=%s, "
                "said_at=CASE WHEN %s THEN %s ELSE said_at END "
                "WHERE location=%s AND open_row=%s AND col_iso=%s",
                (state, why[:900], str(answer.get("count") or ""),
                 1 if state == "failed" else 0, 1 if state == "not_yet" else 0, now,
                 state in FINAL, now, *cell))
            wrote += cur.rowcount
        conn.commit()
    return wrote
