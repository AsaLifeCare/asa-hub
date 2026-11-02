"""The Meal tracker (Meals.gs) on Python behind its switch (`meals`): each person's own log (`mealLog`, kinds meal,
water and supplement) and goals (`mealProfile`) kept in Postgres once uploaded; the day's totals are computed, never
stored. mealDay is here; the writes are in app/meals_writes.py."""
from __future__ import annotations

import functools
import re
from typing import Any, Callable

import candidates as CND
import finance as FIN
import gsjs
import locations as L
import resource_rows as RR

APP_ID = "meals"
LOG, PROFILE = "mealLog", "mealProfile"
KINDS = ("meal", "water", "supplement")
TIMES = ("Breakfast", "Lunch", "Dinner", "Snack")
MACROS = ("calories", "protein", "carbs", "fat", "fiber")
SEED = {"goalCalories": 2000, "goalProtein": 0, "goalCarbs": 0, "goalFat": 0, "goalFiber": 0, "goalWaterOz": 64}
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def goal(m: str) -> str:
    return "goal" + m[:1].upper() + m[1:]


def may_use(user: dict | None) -> bool:
    """mealMayUse_: a person signed in, never the service."""
    u = user or {}
    return bool(u) and not u.get("is_service") and bool(s_(u.get("id")))


def today(reads: L.Reads) -> str:
    """mealToday_: the platform's day, never UTC's."""
    return reads.now.astimezone(CND._zone_of(reads)).strftime("%Y-%m-%d")


def profile_row(reads: L.Reads, user: dict) -> tuple[str, dict, dict] | None:
    """The person's own goals row, the last one listed: its key, cells and readAll_ row."""
    me, hit = s_(user.get("id")), None
    cols = RR.columns(reads, PROFILE)
    for key, cells in RR.table_rows(reads, PROFILE):
        row = RR.shown(cols, cells)
        if row is not None and s_(row.get("ownerId")) == me:
            hit = (key, cells, row)
    return hit


def profile_of(row: dict | None) -> dict[str, Any]:
    """mealProfileOf_'s answer; no row yet reads as the seed's goals with no id behind them."""
    src = row if row is not None else {**SEED, "id": ""}
    out: dict[str, Any] = {"id": s_(src.get("id"))}
    for m in MACROS:
        out[goal(m)] = FIN.num(src.get(goal(m)))
    out["goalWaterOz"] = FIN.num(src.get("goalWaterOz"))
    return out


def day_of(reads: L.Reads, user: dict, day: str, profile: dict | None = None) -> dict[str, Any]:
    """mealDay_: the day's entries, newest first, and its totals."""
    me = s_(user.get("id"))
    totals: dict[str, float] = {"waterOz": 0.0, **{m: 0.0 for m in MACROS}}
    entries = []
    for r in RR.read_all(reads, LOG):
        if s_(r.get("ownerId")) != me or s_(r.get("day")) != day:
            continue
        kind = s_(r.get("kind")) or "meal"
        if kind == "water":
            totals["waterOz"] += FIN.num(r.get("amountOz"))
        elif kind == "meal":
            for m in MACROS:
                totals[m] += FIN.num(r.get(m))
        e: dict[str, Any] = {"id": s_(r.get("id")), "kind": kind, "day": s_(r.get("day")), "at": s_(r.get("at")),
                             "description": s_(r.get("description")), "mealTime": s_(r.get("mealTime")),
                             "amountOz": FIN.num(r.get("amountOz")), "notes": s_(r.get("notes"))}
        for m in MACROS:
            e[m] = FIN.num(r.get(m))
        entries.append(e)
    entries.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(b["at"], a["at"])))
    if profile is None:
        hit = profile_row(reads, user)
        profile = profile_of(hit[2] if hit else None)
    return {"day": day, "entries": entries, "totals": totals, "profile": profile}


def meal_day(sess: L.Session, payload: dict) -> dict[str, Any]:
    """mealDay: a person's own day (today when none is named)."""
    if not may_use(sess.user):
        return dict(DENIED)
    day = s_((payload or {}).get("day"))
    reads = sess.reads
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        day = today(reads)
    return {"status": 200, "data": {**day_of(reads, sess.user or {}, day), "kinds": list(KINDS), "times": list(TIMES)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"mealDay": meal_day}
POLICY: dict[str, dict[str, Any]] = {"mealDay": {}}
