"""Shift slices from the CALENDAR mirror; a cell with hours anywhere inside it is a worked shift."""
from __future__ import annotations

import json
import os
import re
import time
from collections import Counter
from datetime import date as _date, datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

import effective_roster

try:  # the estate is Eastern; the container is UTC
    from zoneinfo import ZoneInfo
    ESTATE_TZ = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 — fall back to UTC rather than fail to build
    ESTATE_TZ = timezone.utc

# the Saturday-start week the SPA uses
ROSTER_DAYS = ("SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI")

PAST_DAYS = 14
FUTURE_DAYS = 42

# the ingest lane logs every pass, so while it is alive a quiet calendar is current, not old
INGEST_ALIVE_S = 45 * 60

RESOURCES = ("shifts", "shiftCards", "shiftMatrix", "shiftTimeline")

# the first half may drop its meridiem ("230-10p") and borrow the second's
_T = r"(\d{1,2})(?::?(\d{2}))?\s*([AP])M?"
_T1 = r"(\d{1,2})(?::?(\d{2}))?\s*([AP])?M?"
_TIME_RANGE = re.compile(rf"^\*?\s*{_T1}\s*[-–]\s*{_T}(?:\s+[A-Za-z]{{1,4}})?\s*$",
                         re.IGNORECASE)
_NOT_WORKING = {"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"}
_CHAIN = re.compile(r"\s*[><]\s*")


def _hour(h: str, m: str | None, ap: str) -> float:
    out = int(h) % 12 + (12 if ap.upper() == "P" else 0)
    return out + (int(m) / 60 if m else 0)


def _range(segment: str) -> tuple[float, float] | None:
    m = _TIME_RANGE.match(segment.strip())
    if not m:
        return None
    h1, m1, ap1, h2, m2, ap2 = m.groups()
    ap1 = ap1 or ap2
    start, end = _hour(h1, m1, ap1), _hour(h2, m2, ap2)
    if m.group(3) is None and start >= end:
        start = (start - 12) % 24
    if end <= start:
        end += 24
    return start, end


def _kind_for(start: float, end: float) -> str:
    if start >= 19 or end > 24:
        return "overnight"
    if end - start >= 11 and start <= 10:
        return "day"
    if start < 11:
        return "morning"
    if start < 16:
        return "afternoon"
    return "evening"


def classify(raw: str) -> dict | None:
    """`code` stays the cell as written: the chip must say what the sheet says."""
    code = (raw or "").strip()
    if not code:
        return None
    segments = [s for s in _CHAIN.split(code) if s.strip()]
    hours: tuple[float, float] | None = None
    token: str | None = None
    for seg in segments:
        got = _range(seg)
        if got and hours is None:
            hours = got
        elif not got and token is None:
            up = seg.strip().upper().lstrip("*").strip()
            if up not in _NOT_WORKING:
                token = seg.strip()
    shown = code.lstrip("*").strip()
    if hours:
        return {"kind": _kind_for(*hours), "code": shown,
                "start": hours[0], "end": hours[1], "token": token}
    up = shown.upper()
    if up == "OFF":
        return {"kind": "off", "code": "OFF"}
    if up in _NOT_WORKING:
        return {"kind": "ro", "code": up}
    return {"kind": "alias", "code": shown, "token": shown}


_WORKING = {"day", "morning", "afternoon", "evening", "overnight"}
_RANK = {"off": 0, "ro": 1, "alias": 2,
         "day": 3, "morning": 3, "afternoon": 3, "evening": 3, "overnight": 3}


def _slug(name: str) -> str:
    return "sch-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return "".join(p[0].upper() for p in parts[:2])


def _sat_index(d: _date) -> int:
    return (d.weekday() + 2) % 7


# read off the env, not imported: snapshot_service imports this module
_SNAPSHOT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))


def _house_photos() -> dict[str, str]:
    try:
        rows = json.loads((_SNAPSHOT_DIR / "photos.json").read_text()).get("rows", [])
    except Exception:  # noqa: BLE001 — no file, bad JSON: same quiet answer
        return {}
    return scene_photos(rows)


def scene_photos(rows: list[dict]) -> dict[str, str]:
    """Must match ProfileDeep.gs: the first non-hidden scene photo titled with the house code."""
    out: dict[str, str] = {}
    for ph in rows:
        if str(ph.get("kind", "")) != "scene":
            continue
        if str(ph.get("hidden", "")).strip().lower() == "true":
            continue
        code = str(ph.get("title", "")).strip().upper()
        if code and code not in out:
            out[code] = str(ph.get("src", ""))
    return out


def _today() -> _date:
    """Today where the houses are: the container runs UTC."""
    return datetime.now(ESTATE_TZ).date()


def _fetch(dsn: str) -> tuple[list[dict], dict[str, str], str | None, bool]:
    today = _today()
    lo, hi = today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(
            f"""
            select id, house, staff_name, shift_date, shift_raw,
                   max(updated_at) over () as newest
              from {effective_roster.SCHEDULES}
             where tab_name = 'CALENDAR'
               and shift_date between %s and %s
               and coalesce(staff_name, '') <> ''
             order by shift_date, house, staff_name
            """,  # noqa: S608 — the table's one name, never an input
            (lo, hi),
        )
        rows = cur.fetchall()
        # the copy's own newest edit, read before anything is laid over it
        newest = rows[0]["newest"].isoformat() if rows else None
        rows = effective_roster.lay(cur, rows, lo, hi)
        cur.execute("select location from public.asa_house_calendar_live")
        short_by_code: dict[str, str] = {}
        for r in cur.fetchall():
            parts = [p.strip() for p in str(r["location"]).split(" - ")]
            if len(parts) >= 3:
                short_by_code[parts[-1]] = " - ".join(parts[1:-1])
        cur.execute(
            "select max(created_at) as at from public.asa_ingest_log "
            "where source_type = 'calendar'"
        )
        got = cur.fetchone()
    beat = got and got.get("at")
    alive = bool(beat and (datetime.now(timezone.utc) - beat).total_seconds() <= INGEST_ALIVE_S)
    return rows, short_by_code, newest, alive


def _marked(entry: dict, cell: dict | None) -> dict:
    if cell and cell.get("published"):
        entry["published"] = cell["published"]
    return entry


def _build(dsn: str) -> dict[str, tuple[list[dict], str | None]]:
    raw_rows, short_by_code, newest, lane_alive = _fetch(dsn)
    today = _today()
    week0 = today - timedelta(days=_sat_index(today))
    code_by_short = {v.upper(): k for k, v in short_by_code.items()}

    # `newest` is the last edit, not the copy's age: stamp it only when the lane stalls
    source_at = None if lane_alive else newest

    def short(house_code: str) -> str:
        return short_by_code.get(house_code, house_code)

    # names: case variants of one person fold onto the most common spelling
    spellings: dict[str, Counter] = {}
    for r in raw_rows:
        name = (r["staff_name"] or "").strip()
        if name:
            spellings.setdefault(" ".join(name.lower().split()), Counter())[name] += 1
    canonical = {k: c.most_common(1)[0][0] for k, c in spellings.items()}
    def person(name: str) -> str:
        return canonical.get(" ".join((name or "").strip().lower().split()), (name or "").strip())

    # dedup: best cell per (house, person, day)
    cells: dict[tuple[str, str, str], dict] = {}
    for r in raw_rows:
        parsed = classify(r["shift_raw"])
        if not parsed:
            continue
        who = person(r["staff_name"])
        key = (r["house"], who, r["shift_date"].isoformat())
        held = cells.get(key)
        if held and _RANK[held["kind"]] >= _RANK[parsed["kind"]]:
            continue
        cells[key] = dict(parsed, house=r["house"], staff=who,
                          date=r["shift_date"], src_id=r["id"])
        if r.get("published"):
            cells[key]["published"] = r["published"]

    # shiftMatrix
    matrix = [
        _marked({
            "id": f"sm-{c['src_id']}",
            "houseId": c["house"],
            "houseName": short(c["house"]),
            "staffName": c["staff"],
            "date": c["date"].isoformat(),
            "dayIndex": _sat_index(c["date"]),
            "code": c["code"],
            "kind": c["kind"],
        }, c)
        for c in cells.values()
    ]

    # shiftCards
    by_person_day: dict[tuple[str, str], dict] = {}
    for c in cells.values():
        key = (c["staff"], c["date"].isoformat())
        held = by_person_day.get(key)
        if held and _RANK[held["kind"]] >= _RANK[c["kind"]]:
            continue
        by_person_day[key] = c

    def works(c: dict) -> bool:
        return c["kind"] in _WORKING or c["kind"] == "alias"

    def house_of(c: dict) -> str:
        if c["kind"] == "alias":
            return code_by_short.get(str(c.get("token") or c["code"]).upper(), c["house"])
        return c["house"]

    people = sorted({c["staff"] for c in cells.values()})
    cards = []
    for name in people:
        mine = [c for k, c in by_person_day.items() if k[0] == name]
        working = sorted((c for c in mine if works(c)), key=lambda c: c["date"])
        week = []
        for i in range(7):
            day = (week0 + timedelta(days=i)).isoformat()
            got = by_person_day.get((name, day))
            week.append(_marked({"day": ROSTER_DAYS[i],
                                 "code": got["code"] if got else "—",
                                 "kind": got["kind"] if got else "off"}, got))
        upcoming = next((c for c in working if c["date"] >= today), None)
        cards.append({
            "id": _slug(name),
            "personId": _slug(name),
            "personName": name,
            "initials": _initials(name),
            "avatar": "",
            "totalShifts": len(working),
            "houseCount": len({house_of(c) for c in working}),
            "week": week,
            "next": {
                "date": upcoming["date"].strftime("%b %d").replace(" 0", " "),
                "code": upcoming["code"],
                "houseCode": short(house_of(upcoming)),
            } if upcoming else {"date": "—", "code": "—", "houseCode": ""},
        })

    # shiftTimeline
    timeline = [
        _marked({
            "id": f"stl-{c['src_id']}",
            "houseId": c["house"],
            "houseCode": c["house"],
            "houseName": short(c["house"]),
            "staffName": c["staff"],
            "clientName": "",
            "date": c["date"].isoformat(),
            "startHour": c["start"],
            "endHour": c["end"],
            "kind": c["kind"],
        }, c)
        for c in cells.values()
        if c["kind"] in _WORKING and "start" in c
    ]

    # shifts
    label = {"day": "Day", "morning": "Morning", "afternoon": "Afternoon",
             "evening": "Evening", "overnight": "Overnight", "ro": "R/O", "off": "OFF"}
    def hhmm(h: float) -> str:
        return f"{int(h) % 24:02d}:{int(round(h % 1 * 60)):02d}"
    house_photo = _house_photos()
    flat = [
        _marked({
            "id": f"sh-{c['src_id']}",
            "staff": c["staff"],
            "house": short(house_of(c)),
            "role": "",
            "date": c["date"].isoformat(),
            "start": hhmm(c["start"]) if "start" in c else "",
            "end": hhmm(c["end"]) if "end" in c else "",
            "status": f"@ {c['code']}" if c["kind"] == "alias" else label[c["kind"]],
            "houseCode": house_of(c),
            "housePhoto": house_photo.get(house_of(c).strip().upper(), ""),
        }, c)
        for c in cells.values()
        if c["kind"] != "off"
    ]

    return {
        "shifts": (flat, source_at),
        "shiftCards": (cards, source_at),
        "shiftMatrix": (matrix, source_at),
        "shiftTimeline": (timeline, source_at),
    }


def build_schedule_events(dsn: str) -> tuple[list[dict], str | None]:
    data = _cached(dsn)
    rows, source_at = data["shiftTimeline"]
    events = [
        {
            "id": f"ev-{r['id']}",
            "title": r["houseName"],
            "personId": _slug(r["staffName"]),
            "personName": r["staffName"],
            "date": r["date"],
            "start": f"{int(r['startHour']) % 24:02d}:{int(round(r['startHour'] % 1 * 60)):02d}",
            "durationMin": int(round((r["endHour"] - r["startHour"]) * 60)),
            "type": "shift",
            "attendees": [],
            "notes": f"{r['houseId']} · roster",
            # a mirror row has no home in the events tab: a drag would 404 and snap back
            "readOnly": True,
        }
        for r in rows
    ]
    return events, source_at


# the TTL stays under the rebuild floor, so a write's rebuild never serves an older copy
_memo: dict = {"at": 0.0, "data": None, "day": None}


def _cached(dsn: str) -> dict[str, tuple[list[dict], str | None]]:
    day = _today()
    if _memo["data"] is None or time.time() - _memo["at"] > 20 or _memo["day"] != day:
        _memo["data"] = _build(dsn)
        _memo["at"] = time.time()
        _memo["day"] = day
    return _memo["data"]


def forget() -> None:
    _memo["data"] = None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    return _cached(dsn)[resource]
