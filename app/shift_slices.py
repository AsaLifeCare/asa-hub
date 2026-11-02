"""Shift slices from the house books' CALENDAR grids as asa-hub-db keeps them; a cell with hours anywhere inside it is
a worked shift."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections import Counter
from datetime import date as _date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import effective_roster
import hubdb
import lanes_db as hub_db
import lanes_pg as psycopg2
import lanes_sheets
import scheduling_seed

try:  # the estate is Eastern; the container is UTC
    from zoneinfo import ZoneInfo
    ESTATE_TZ = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 — fall back to UTC rather than fail to build
    ESTATE_TZ = timezone.utc

# the Saturday-start week the SPA uses
ROSTER_DAYS = ("SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI")

PAST_DAYS = 14
FUTURE_DAYS = 42

# the house books named by the Dashboard index's links, each one's CALENDAR grid as the sheet keeper keeps it
# (app.sheet_grids), read by the calendar ingest's rules: the row of real dates, the name in B, the phone in C, a shift
# from D on; a name that is only OPEN or WORKSHOP is no one's row
GRIDS = "sheet_grids"
INDEX_PROP = "RECON_INDEX_ID"
_NO_ONE = {"OPEN", "WORKSHOP"}
# a grid kept before its book last changed by more than this is behind the book
GRID_SLACK_S = 60

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


def _kept_grids() -> tuple[list[dict], dict[str, dict]]:
    """The index's house books ({label, id, code, short}) and each kept grid by book id ({cells, modified_time,
    read_at}); no books when the index's links are not kept."""
    index_id = lanes_sheets._db().prop(INDEX_PROP)  # noqa: SLF001 - the process's one reader of asa-hub-db
    with hub_db.connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"select sheet_id, kind, cells, modified_time, read_at from {GRIDS}")  # noqa: S608 - one name
        got = cur.fetchall()
    grids = {str(r["sheet_id"]): dict(r, cells=scheduling_seed._cells(r["cells"]))  # noqa: SLF001
             for r in got if r["kind"] == "calendar"}
    index = next((scheduling_seed._cells(r["cells"]) for r in got  # noqa: SLF001
                  if r["kind"] == "links" and str(r["sheet_id"]) == index_id), None)
    if not index_id or index is None:
        return [], grids
    links: list[dict] = []
    seen: set[str] = set()
    for _tab, _i, _j, label, link in index.get("links") or []:
        for url in [u for u in (str(link or "").strip(), str(label or "").strip()) if u]:
            m = scheduling_seed.LINK.search(url)
            if m and m.group(1) != index_id and m.group(1) not in seen:
                seen.add(m.group(1))
                links.append({"label": str(label or "").strip() or m.group(1), "id": m.group(1)})
                break
    return scheduling_seed.seed_links(links), grids


def _cell_id(house: str, staff: str, iso: str) -> str:
    return hashlib.sha1(f"{house}|{effective_roster.fold(staff)}|{iso}".encode()).hexdigest()[:12]  # noqa: S324


def _read_grid(kept: dict) -> tuple[list[tuple[int, _date]], list[tuple[int, str, str]], Any]:
    """One kept grid: its dated columns under the first row carrying real dates, each person's line under that row
    (row, the name in B, the phone in C) and the cell reader; nothing when no row carries dates."""
    grid = kept["cells"]
    shown = grid.get("shown") or []
    days = {(int(r), int(c)): str(iso) for r, c, iso in grid.get("dates") or []}

    def text(r: int, c: int) -> str:
        line = shown[r] if 0 <= r < len(shown) else []
        return str(line[c] if 0 <= c < len(line) and line[c] is not None else "").strip()

    heads = sorted({r for (r, c) in days if c >= 3})
    head = next((r for r in heads if sum(1 for (r2, c) in days if r2 == r and c >= 3) >= 3), None)
    if head is None:
        return [], [], text
    cols = [(c, _date.fromisoformat(iso)) for (r, c), iso in sorted(days.items()) if r == head and c >= 3]
    lines = [(r, text(r, 1), text(r, 2)) for r in range(head + 1, len(shown))]
    return cols, [(r, s, p) for r, s, p in lines if s and s.upper() not in _NO_ONE], text


def _grid_rows(book: dict, kept: dict, lo: _date, hi: _date) -> list[dict]:
    """One book's grid as roster rows ({id, house, staff_name, phone, shift_date, shift_raw, source_id, updated_at}):
    every cell in the window under the row of real dates is one row."""
    cols, lines, text = _read_grid(kept)
    cols = [(c, d) for c, d in cols if lo <= d <= hi]
    at = kept.get("modified_time") or kept.get("read_at")
    out: list[dict] = []
    for r, staff, phone in lines:
        for c, day in cols:
            raw = text(r, c)
            if raw:
                out.append({"id": _cell_id(book["code"], staff, day.isoformat()), "house": book["code"],
                            "staff_name": staff, "phone": phone, "shift_date": day, "shift_raw": raw,
                            "source_id": book["id"], "updated_at": at})
    return out


def roster(lo: _date, hi: _date) -> list[dict]:
    """Every cell from lo to hi on the index's house calendars, in asa_schedules' columns (house, staff_name, phone,
    shift_date, shift_raw), published cells laid as the board lays them, by day and then name."""
    books, grids = _kept_grids()
    rows: list[dict] = []
    for book in books:
        kept = grids.get(book["id"])
        if kept is not None:
            rows += _grid_rows(book, kept, lo, hi)
    with psycopg2.connect("asa-hub-db") as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        rows = _laid(cur, rows, lo, hi)
    return sorted(rows, key=lambda r: (r["shift_date"], str(r.get("staff_name") or "")))


def staff_phones() -> list[tuple[str, str]]:
    """(name, phone) of every person's line that carries a phone on the index's house calendars, as asa-hub-db keeps
    their grids."""
    books, grids = _kept_grids()
    out: list[tuple[str, str]] = []
    for book in books:
        kept = grids.get(book["id"])
        if kept is not None:
            out += [(staff, phone) for _r, staff, phone in _read_grid(kept)[1] if phone]
    return out


def _laid(cur, rows: list[dict], lo: _date, hi: _date) -> list[dict]:
    """effective_roster.lay with the grids as the copy: a published cell stands unless its grid, kept since, says
    something else."""
    cells = effective_roster.effective_cells(cur, lo, hi)
    if not cells:
        return rows
    newest: dict = {}
    facts: dict = {}
    for r in rows:
        k = effective_roster.row_key(r)
        facts[(k[0], k[1])] = {"staff_name": r["staff_name"], "phone": r["phone"], "source_id": r["source_id"],
                               "house": r["house"]}
        newest[k] = (r["updated_at"], r["shift_raw"])
    return effective_roster.lay_rows(rows, effective_roster.decide(cells, newest), facts=facts)


def _fetch(dsn: str) -> tuple[list[dict], dict[str, str], str | None, bool]:
    """The rows, each house code's short name, when the copy is good as of (the oldest grid behind its book, else the
    oldest kept) and whether every grid holds its book as it stands."""
    today = _today()
    lo, hi = today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)
    books, grids = _kept_grids()
    db = lanes_sheets._db()  # noqa: SLF001
    rows: list[dict] = []
    behind: list[datetime] = []
    kept_at: list[datetime] = []
    missing = not books
    for book in books:
        kept = grids.get(book["id"])
        if kept is None:
            missing = True
            continue
        rows += _grid_rows(book, kept, lo, hi)
        kept_at.append(kept["read_at"])
        held = db.book(book["id"])
        moved = hubdb._epoch(held.modified_time) if held is not None else 0.0  # noqa: SLF001
        if kept.get("modified_time") is None or moved > kept["modified_time"].timestamp() + GRID_SLACK_S:
            behind.append(kept["read_at"])
    rows.sort(key=lambda r: (r["shift_date"], r["house"], r["staff_name"]))
    with psycopg2.connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        rows = _laid(cur, rows, lo, hi)
    short_by_code = {b["code"]: b["short"] for b in books}
    oldest = min(behind or kept_at) if (behind or kept_at) else None
    return rows, short_by_code, oldest.isoformat() if oldest else None, not behind and not missing


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


def finish(resource: str, rows: list[dict]) -> list[dict]:
    """The events slice its Python door filled: the Hub's own dated events, then the roster's real hours (the relay's
    _events_with_roster); without the roster the Hub's own still stand."""
    if resource != "events":
        raise KeyError(resource)
    rows = [r for r in rows if str(r.get("date") or "").strip()]
    try:
        derived, _at = build_schedule_events("asa-hub-db")
    except Exception as exc:  # noqa: BLE001 - the Hub's own events still stand
        import logging  # noqa: PLC0415

        logging.getLogger("hub.shift-slices").warning("schedule events unavailable, the Hub's own stand: %s", exc)
        return rows
    return rows + derived


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
