"""PsiAnywhere's pay periods: 14 days, Sunday to Saturday, on the grid its Imported batches follow (06-07, 06-21, …
10-25-2026), computed here and never asked of PsiAnywhere. A week is the Sunday-to-Saturday half of a period. Nothing
here reads or imports anything of the Hub, so any lane may use it."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

PERIOD_ANCHOR = date(2026, 6, 7)
PERIOD_DAYS = 14
NEW_YORK = ZoneInfo("America/New_York")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def today_ny(now: datetime | None = None) -> date:
    """The service day it is in New York."""
    return (now or datetime.now(NEW_YORK)).astimezone(NEW_YORK).date()


def day_of(v: Any) -> date | None:
    """An ISO day ('yyyy-mm-dd'), or None."""
    t = str(v if v is not None else "").strip()
    if not _DAY.match(t):
        return None
    try:
        return date.fromisoformat(t)
    except ValueError:
        return None


def period_start(day: date) -> date:
    """The Sunday the pay period holding `day` starts on."""
    return PERIOD_ANCHOR + timedelta(days=((day - PERIOD_ANCHOR).days // PERIOD_DAYS) * PERIOD_DAYS)


def week_start(day: date) -> date:
    """The Sunday the week holding `day` starts on."""
    return day - timedelta(days=(day.weekday() + 1) % 7)


def label(a: date, b: date) -> str:
    """PsiAnywhere's own period text: 'MM/DD/YY – MM/DD/YY'."""
    return f"{a:%m/%d/%y} – {b:%m/%d/%y}"


def period(day: date, today: date | None = None) -> dict[str, Any]:
    """The pay period holding `day`: id (P + its Sunday), from, to, label, current, and its two weeks."""
    a = period_start(day)
    b = a + timedelta(days=PERIOD_DAYS - 1)
    now = today or day
    return {"id": f"P{a.isoformat()}", "from": a.isoformat(), "to": b.isoformat(), "label": label(a, b),
            "current": a <= now <= b,
            "weeks": [{"from": (a + timedelta(days=7 * k)).isoformat(),
                       "to": (a + timedelta(days=7 * k + 6)).isoformat(),
                       "label": label(a + timedelta(days=7 * k), a + timedelta(days=7 * k + 6))} for k in (0, 1)]}


def periods(today: date, back: int = 12) -> list[dict[str, Any]]:
    """The current pay period and the `back` before it, newest first."""
    start = period_start(today)
    return [period(start - timedelta(days=PERIOD_DAYS * k), today) for k in range(back + 1)]


def period_of_id(pid: Any, today: date) -> dict[str, Any] | None:
    """'P2026-10-25' → that pay period, when it is one of the grid's Sundays."""
    t = str(pid if pid is not None else "").strip()
    d = day_of(t[1:]) if t.startswith("P") else None
    if d is None or period_start(d) != d:
        return None
    return period(d, today)
