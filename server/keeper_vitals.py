"""The two keepers' vitals the Guardian reads, measured where they now run (asa-hub-worker's GET /vitals, asked by
asa-hub-app's /health): the sheet keeper's own state and the digester's queue. Counts, ages and the books that
failed only — nothing a paper or a person said. Each is held a minute; None when it cannot be measured, never
green."""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("hub.keeper_vitals")

PG_DSN = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL", "")
HUB_DB_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
HELD_S = 60.0
_HELD: dict[str, tuple[float, Any]] = {}


def _held(name: str, fn) -> Any:
    hit = _HELD.get(name)
    if hit is not None and time.time() - hit[0] < HELD_S:
        return hit[1]
    try:
        data = fn()
    except Exception as exc:  # noqa: BLE001 - unknown, never green
        log.warning("%s vitals unavailable: %s", name, type(exc).__name__)
        data = None
    _HELD[name] = (time.time(), data)
    return data


def _kept_here() -> dict[str, Any]:
    """The keeper with its mirror off (it left the old platform): its passes over the calendars' grids and live copy
    (app.sheet_keeper_state), and the essential sheets' last sweep (app.essential_sweeps), all read in asa-hub-db."""
    import psycopg2.extras  # noqa: PLC0415

    import hub_db  # noqa: PLC0415

    with hub_db.connect("") as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("select last_pass_at, last_pass_grids, last_pass_errors, live_read_at from app.sheet_keeper_state"
                    " where id = 1")
        st = cur.fetchone() or {}
        cur.execute("select started_at, result from app.essential_sweeps order by started_at desc limit 1")
        sweep = cur.fetchone() or {}
        cur.execute("select count(*) as n from app.hub_session_vouch where seen_at > now() - interval '2 hours'")
        vouch = cur.fetchone() or {}
    result = sweep.get("result") if isinstance(sweep.get("result"), dict) else {}
    skipped = [{"name": r, "error": str(c.get("skipped"))[:160]} for r, c in result.items()
               if isinstance(c, dict) and c.get("skipped")]
    pa = st.get("last_pass_at")
    swept = sweep.get("started_at")
    return {
        "mirror": "retired with the old platform",
        "last_pass_at": pa.isoformat() if pa else None,
        "last_pass_age_s": round((datetime.now(timezone.utc) - pa).total_seconds()) if pa else None,
        "last_pass_books": int(st.get("last_pass_grids") or 0),
        "last_pass_errors": int(st.get("last_pass_errors") or 0),
        "live_read_at": st["live_read_at"].isoformat() if st.get("live_read_at") else None,
        "essential_swept_at": swept.isoformat() if swept else None,
        "books_ok": len(result) - len(skipped),
        "books_error": len(skipped),
        "books_fresh_2h": None,
        "error_books": skipped[:5],
        "session_mirror_age_s": None,
        "vouch_live_2h": int(vouch.get("n") or 0),
    }


def _sheet_sync() -> dict[str, Any]:
    """The sheets⇄Postgres keeper's own state (its tables), as the relay measured it; with the mirror off, as
    asa-hub-db holds it (_kept_here)."""
    import psycopg2  # noqa: PLC0415
    import psycopg2.extras  # noqa: PLC0415

    import hub_db  # noqa: PLC0415
    import hub_sheet_sync  # noqa: PLC0415

    if not hub_sheet_sync.MIRROR_ON:
        return _kept_here()
    with psycopg2.connect(PG_DSN) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("select watermark, last_pass_at, last_pass_books, last_pass_errors from hub_sheet_sync_state"
                    " where id = 1")
        st = cur.fetchone() or {}
        cur.execute("select count(*) filter (where last_sync_status = 'ok') as ok,"
                    " count(*) filter (where last_sync_status = 'error') as err,"
                    " count(*) filter (where last_sync_at > now() - interval '2 hours') as fresh_2h"
                    " from asa_drive_sheets_meta")
        agg = cur.fetchone() or {}
        cur.execute("select name, left(coalesce(last_sync_error, ''), 160) as error from asa_drive_sheets_meta"
                    " where last_sync_status = 'error' order by last_sync_at desc limit 5")
        errs = cur.fetchall()
        cur.execute("select extract(epoch from now() - max(ingested_at)) as age from asa_drive_sheets_rows"
                    " where sheet_id = %s and tab_name = 'hub_sessions'", (HUB_DB_SHEET_ID,))
        sess = cur.fetchone() or {}
        got = hub_db.own(cur, "select count(*) as n from hub_session_vouch where seen_at > now() - interval '2 hours'")
        vouch = got[0] if got else {}
    pa = st.get("last_pass_at")
    if pa is not None and pa.tzinfo is None:
        pa = pa.replace(tzinfo=timezone.utc)
    return {
        "last_pass_at": pa.isoformat() if pa else None,
        "last_pass_age_s": round((datetime.now(timezone.utc) - pa).total_seconds()) if pa else None,
        "last_pass_books": int(st.get("last_pass_books") or 0),
        "last_pass_errors": int(st.get("last_pass_errors") or 0),
        "books_ok": int(agg.get("ok") or 0),
        "books_error": int(agg.get("err") or 0),
        "books_fresh_2h": int(agg.get("fresh_2h") or 0),
        "error_books": [dict(e) for e in errs],
        "session_mirror_age_s": round(float(sess["age"])) if sess.get("age") is not None else None,
        "vouch_live_2h": int(vouch.get("n") or 0),
    }


def _form_digest() -> dict[str, Any]:
    """The digester's queue, read off the record it keeps (asa-hub-db's copy of the house ledger, through hub_rows)."""
    import form_digest  # noqa: PLC0415
    import hub_rows  # noqa: PLC0415

    house = form_digest._house_id()  # noqa: SLF001
    if not house:
        raise RuntimeError("the depot names no form_files house")
    counts: dict[str, int] = {}
    oldest = ""
    errs: list[dict[str, str]] = []
    for _n, row in hub_rows.numbered(house, "form_files",
                                     fields=["id", "digest_state", "createdAt", "file_name", "digest_error"]):
        if not hub_rows.cell(row.get("id")):
            continue
        st = str(hub_rows.cell(row.get("digest_state")) or "").strip() or "pending"
        counts[st] = counts.get(st, 0) + 1
        made = str(hub_rows.cell(row.get("createdAt")) or "")
        if st == "pending" and made and (not oldest or made < oldest):
            oldest = made
        if st == "error":
            errs.append({"file_name": str(hub_rows.cell(row.get("file_name")) or "")[:60],
                         "error": str(hub_rows.cell(row.get("digest_error")) or "")[:160]})
    age = None
    if oldest:
        try:
            age = round((datetime.now(timezone.utc) - datetime.fromisoformat(oldest.replace("Z", "+00:00")))
                        .total_seconds())
        except ValueError:
            age = None
    return {"counts": counts, "oldest_pending_age_s": age, "error_items": errs[-5:][::-1],
            "engine": "form_digest on asa-hub-worker"}


def vitals() -> dict[str, Any]:
    """Blocking: both, each held a minute."""
    return {"sheet_sync": _held("sheet-sync", _sheet_sync), "form_digest": _held("form-digest", _form_digest)}
