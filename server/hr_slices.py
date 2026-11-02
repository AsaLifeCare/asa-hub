"""Staff Issues slice — the live HR tracker, derived from the old platform's mirror.
The RH screen of the old platform's app (pages/RH.tsx, "STAFF ISSUES") is a two-way grid over the estate's…"""
from __future__ import annotations

import re
from datetime import datetime

import psycopg2
import psycopg2.extras

import hr_digest

RESOURCES = ("staffIssues",)

_SCHEMA_KEY = "employee_hr_tracker"

# The sheet's own headers, mapped to the slice's field names.
_FIELDS = (
    ("Date", "date"),
    ("Employees Involved", "employees_involved"),
    ("Situation", "situation"),
    ("Follow up", "follow_up"),
    ("Disciplinary Action", "disciplinary_action"),
    ("Result", "result"),
    ("Termination summary", "termination_summary"),
)

# THE SHEET WRITES TWO YEAR SHAPES, AND ONLY ONE WAS READ.
_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$")

# A two-digit year is read as this century below seventy.
_YEAR_PIVOT = 70


def _sort_key(row: dict) -> tuple[int, float, int]:
    """Newest first; a date the sheet did not fill (or filled oddly) sorts after every real one, in sheet order."""
    m = _DATE_RE.match(str(row.get("date") or "").strip())
    if not m:
        return (1, 0.0, row["_row"])
    month, day, year = (int(g) for g in m.groups())
    if len(m.group(3)) == 2:
        year += 2000 if year < _YEAR_PIVOT else 1900
    try:
        ts = datetime(year, month, day).timestamp()
    except ValueError:
        return (1, 0.0, row["_row"])
    return (0, -ts, row["_row"])


def _build(dsn: str) -> tuple[list[dict], str | None]:
    """Every tracker row, newest first, with the sheet row number as id."""
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(
            "SELECT row_number, data FROM asa_sheets_data "
            "WHERE schema_key = %s ORDER BY row_number",
            (_SCHEMA_KEY,))
        rows: list[dict] = []
        for r in cur.fetchall():
            data = r["data"]
            if not isinstance(data, dict):
                continue
            out = {field: str(data.get(header) or "").strip()
                   for header, field in _FIELDS}
            if not any(out.values()):
                continue
            out["id"] = f"r{r['row_number']}"
            out["_row"] = int(r["row_number"])
            rows.append(out)
    rows.sort(key=_sort_key)
    for row in rows:
        del row["_row"]
    # THE DIGEST RIDES ON THESE ROWS, and it costs this build no model call: `attach` reads the roster once and the…
    try:
        rows = hr_digest.attach(rows, dsn)
        # And the asking happens AFTER this returns, on its own slow clock — never on the thread a page is waiting on.
        hr_digest.top_up(rows, dsn)
    except Exception as exc:  # noqa: BLE001
        # A DIGEST THAT COULD NOT RUN IS NOT A TRACKER WITHOUT ISSUES.
        why = f"{type(exc).__name__}: {str(exc)[:160]}"
        for row in rows:
            row.setdefault("digest_state", "pending")
            row["digest_failed"] = why
    # The freshness stamp is the read, like the finance slices: this is a local re-read of the mirror, current by…
    return rows, None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """build_one's dispatch shape, same as house_slices.build."""
    if resource not in RESOURCES:
        raise KeyError(resource)
    return _build(dsn)
