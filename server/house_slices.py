"""Houses slice: one row per house; a source that cannot be read is said on the row, never replaced."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import house_directory
import house_images
import master_json
import psi_punches_full
import shift_slices
from calendar_builder_slices import _skip_staff

RESOURCES = ("houses",)

SNAPSHOT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
CLIENT_DB_ID = os.getenv("HUB_CLIENT_DB_SHEET_ID", "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8")
CLIENT_DB_TAB = "Master"
HOUSES_DATA_ID = os.getenv("HUB_HOUSES_DATA_SHEET_ID", "1ZL5EHUfx627VFJ9rRlv8D1J8ljZJvns8TZsUKj_oAe0")
ENTITIES_ID = os.getenv("HUB_CLIENT_ENTITIES_SHEET_ID", "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI")
ENTITY_HOMES_TAB = "entity_homes"
COMMON_DATA_ID = os.getenv("HUB_COMMON_DATA_SHEET_ID", "1-XgGNQMkHAlGQjqvhg3Ao89pO-8DJoqjIr9ggjAXprE")
POLICIES_TAB = "Company Policies"
ESSENCIAL_ID = os.getenv("HUB_ESSENCIAL_SHEET_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
HOTLINE_TAB = os.getenv("HUB_HOTLINE_CALENDAR_TAB", "Calendar Archive")
HOTLINE_POINTER = "HOTLINE_CALENDAR_ID"
PEOPLE_POINTER = "HUB_HOUSE_PEOPLE_ID"
PEOPLE_TAB = "Data"

STAFF_DAYS = 92
GAP_DAYS = 7
HM_WINDOW_DAYS = 14
STALE_GRACE_S = 600.0
MASTER_QUIET_S = 2 * 3600.0
SIDE_QUIET_S = 2 * 3600.0
PSI_QUIET_S = 24 * 3600.0
POINTER_TTL_S = 3600.0
LATE_END_S = 23 * 3600 + 59 * 60

MANAGER_MARK = "**"
LEAD_MARK = "***"
STAFF_LABELS = {"psi": "Worked here — PsiAnywhere punches",
                "calendar": "Scheduled here — hotline calendar"}
CLIENT_POLICIES = frozenset({"billofrightser", "muihandbook"})
POLICY_ALIASES = {"companypolicies": "asalifecaregeneralpolicies"}
# what a client is told may be out of date — never a book, a count or a reason
CLIENT_SOURCES = {"client_db": "the residents", "calendar": "the house manager",
                  "registry": "the street", "people": "the house manager's phone"}

_WEEKDAYS = {"mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun"}
_NOT_PEOPLE = {"nurse", "family"}
_TAB_RE = re.compile(r"^([A-Z]{2,4})\s*-\s*(.+?)\s*-\s*([A-Z]{2,4}\d{3,6})$")
_CODE_RE = re.compile(r"([A-Z]{2,4}\d{3,6})\s*$")
_US_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")
_URL = re.compile(r"https?://[^\s\[\]]+")
_DRIVE_ID = re.compile(r"/d/([A-Za-z0-9_-]{10,})")


def fold(name: Any) -> str:
    """Must match clientNameKey_ in Apps Script."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def code_in(text: Any) -> str:
    m = _CODE_RE.search(str(text or "").strip().upper())
    return m.group(1) if m else ""


def day_of(text: Any) -> date | None:
    raw = str(text or "")
    try:
        m = _US_DAY.match(raw)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        m = _ISO_DAY.match(raw)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return None


def clock_of(text: Any) -> int | None:
    m = _CLOCK.match(str(text or ""))
    if not m:
        return None
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    half = (m.group(4) or "").upper()
    if half:
        if not 1 <= h <= 12:
            return None
        h = h % 12 + (12 if half == "PM" else 0)
    if h > 23 or mi > 59 or s > 59:
        return None
    return h * 3600 + mi * 60 + s


def is_person(name: Any) -> bool:
    text = str(name or "").strip()
    return bool(text) and not _skip_staff(text, "") and fold(text) not in _NOT_PEOPLE


def parse_tab(tab: str) -> dict | None:
    m = _TAB_RE.match((tab or "").strip())
    if not m:
        return None
    return {"label": tab.strip(), "city": m.group(1), "short": m.group(2).strip(), "code": m.group(3)}


def _epoch(text: Any) -> float:
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _url(text: Any) -> str:
    m = _URL.search(str(text or ""))
    return m.group(0) if m else ""


def _loc_key(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


class Master:
    def __init__(self, root: Path | str, now: float) -> None:
        self.root = Path(root)
        self.now = now
        self.manifest = json.loads((self.root / "manifest.json").read_bytes())
        self.books = {str(b.get("id")): b for b in self.manifest.get("books") or []}
        self._held: dict[str, dict] = {}

    def state(self, key: str, label: str, sid: str, tab: str | None) -> dict[str, Any]:
        out: dict[str, Any] = {"key": key, "label": label, "book": "", "tab": tab or "",
                               "rows": 0, "read_at": "", "state": "unreadable", "why": ""}
        if not sid:
            out["why"] = "no book is declared for it"
            return out
        book = self.books.get(sid)
        if book is None:
            out["why"] = "the master JSON holds no copy of its book"
            return out
        out["book"] = str(book.get("name") or "")
        tabs = [t for t in book.get("tabs") or [] if tab is None or t.get("tab") == tab]
        if not tabs:
            out["why"] = f"{out['book'] or 'its book'} has no tab '{tab}'"
            return out
        out["rows"] = sum(int(t.get("rows") or 0) for t in tabs)
        out["read_at"] = max(str(t.get("read_at") or "") for t in tabs)
        why = []
        if any(t.get("stale") for t in tabs):
            why.append("its newest rows could not be written into the master JSON")
        if book.get("owed"):
            why.append("Drive holds changes the mirror has not read yet")
        newest = max((_epoch(t.get("read_at")) for t in book.get("tabs") or []), default=0.0)
        modified = _epoch(book.get("modified_time"))
        if modified and newest and modified > newest + STALE_GRACE_S:
            why.append(f"the sheet changed at {book.get('modified_time')} and was last read "
                       f"at {datetime.fromtimestamp(newest, timezone.utc).isoformat()}")
        written = _epoch(self.manifest.get("written_at"))
        if written and self.now - written > MASTER_QUIET_S:
            why.append(f"the master JSON has written no round since {self.manifest.get('written_at')}")
        out["state"] = "stale" if why else "fresh"
        out["why"] = "; ".join(why)
        return out

    def book(self, sid: str) -> dict:
        if sid not in self._held:
            self._held[sid] = master_json.read_book(self.root, sid)
        return self._held[sid]

    def rows(self, sid: str, tab: str) -> list[dict]:
        for t in self.book(sid)["tabs"]:
            if t["tab"] == tab:
                return t["rows"]
        raise KeyError(tab)

    def stamp(self) -> str | None:
        at = _epoch(self.manifest.get("written_at"))
        return datetime.fromtimestamp(at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if at else None


_POINTERS: dict[str, Any] = {"at": 0.0, "values": None}
_POINTERS_LOCK = threading.Lock()


def pointers(master: Master, *, fresh: bool = False) -> dict[str, str]:
    with _POINTERS_LOCK:
        held = _POINTERS["values"]
        if held is not None and not fresh and master.now - float(_POINTERS["at"]) < POINTER_TTL_S:
            return dict(held)
    wanted = {HOTLINE_POINTER, PEOPLE_POINTER}
    doc = json.loads((master.root / master_json.book_file(ESSENCIAL_ID)).read_bytes())
    tab = next(t for t in doc["tabs"] if t.get("tab") == "Facts")
    segs = ([json.loads((master.root / f).read_bytes()) for f in tab["parts"]]
            if "parts" in tab else [tab])
    found: dict[str, tuple[int, str]] = {}
    for seg in segs:
        head = list(seg.get("header") or [])
        if "Subject ID" not in head or "Value" not in head:
            continue
        i_s, i_v = head.index("Subject ID"), head.index("Value")
        for r in seg.get("rows") or []:
            cells = r[1:]
            subj = cells[i_s] if i_s < len(cells) else None
            if subj not in wanted:
                continue
            value = str((cells[i_v] if i_v < len(cells) else "") or "").strip()
            if value and (subj not in found or int(r[0]) > found[subj][0]):
                found[subj] = (int(r[0]), value)
    values = {k: v for k, (_, v) in found.items()}
    with _POINTERS_LOCK:
        _POINTERS["at"], _POINTERS["values"] = master.now, values
    return dict(values)


def forget_pointers() -> None:
    with _POINTERS_LOCK:
        _POINTERS["at"], _POINTERS["values"] = 0.0, None


def _file_rows(path: Path) -> tuple[list[dict] | None, str, str]:
    try:
        doc = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        return None, "", f"{path.name} could not be read ({type(exc).__name__})"
    rows = doc.get("rows") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return None, "", f"{path.name} holds no rows"
    stamp = str(doc.get("built_at") or doc.get("generated_at") or "")
    return rows, stamp, ""


def roster(rows: list[dict]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    active: dict[str, list[str]] = {}
    placed: dict[str, list[str]] = {}
    for r in rows:
        code = str(r.get("House") or "").strip().upper()
        name = " ".join(str(r.get("Client") or "").split())
        if not code or not name:
            continue
        placed.setdefault(code, [])
        if name not in placed[code]:
            placed[code].append(name)
        if str(r.get("Status") or "").strip().lower() == "active":
            active.setdefault(code, [])
            if name not in active[code]:
                active[code].append(name)
    for names in list(active.values()) + list(placed.values()):
        names.sort()
    return active, placed


def managers_by_code(rows: list[dict], today: date) -> dict[str, list[dict[str, Any]]]:
    """A one-day cover is dropped when someone else carries more than one ** day in the window."""
    seen: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        if str(r.get("Designation") or "").strip() != MANAGER_MARK:
            continue
        code, name, day = code_in(r.get("Location")), " ".join(str(r.get("Employee") or "").split()), day_of(r.get("Date"))
        if not code or not day or day > today or not is_person(name):
            continue
        seen.setdefault(code, {}).setdefault(fold(name), {"name": name, "days": set()})["days"].add(day)
    out: dict[str, list[dict[str, Any]]] = {}
    for code, people in seen.items():
        edge = max(max(p["days"]) for p in people.values()) - timedelta(days=HM_WINDOW_DAYS - 1)
        found = [{"name": p["name"], "day": max(p["days"]), "days": sum(1 for d in p["days"] if d >= edge)}
                 for p in people.values()]
        found = [f for f in found if f["days"]]
        keep = [f for f in found if f["days"] > 1] or found
        keep.sort(key=lambda f: (-f["days"], -f["day"].toordinal(), f["name"]))
        out[code] = keep
    return out


def leads_by_code(rows: list[dict], today: date, since: date) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        if str(r.get("Designation") or "").strip() != LEAD_MARK:
            continue
        code, name, day = code_in(r.get("Location")), " ".join(str(r.get("Employee") or "").split()), day_of(r.get("Date"))
        if not code or not day or not (since <= day <= today) or not is_person(name):
            continue
        held = out.setdefault(code, {}).setdefault(fold(name), {"name": name, "last_day": day})
        held["last_day"] = max(held["last_day"], day)
    return out


def calendar_staff(rows: list[dict], today: date, since: date) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        code, name, day = code_in(r.get("Location")), " ".join(str(r.get("Employee") or "").split()), day_of(r.get("Date"))
        if not code or not day or not (since <= day <= today) or not is_person(name):
            continue
        held = out.setdefault(code, {}).setdefault(fold(name), {"name": name, "shifts": 0, "last_day": day})
        held["shifts"] += 1
        held["last_day"] = max(held["last_day"], day)
    return out


def psi_locations(rows: list[dict]) -> dict[str, str]:
    seen: dict[str, set[str]] = {}
    for r in rows:
        code, where = code_in(r.get("house")), _loc_key(r.get("location_name"))
        if code and where:
            seen.setdefault(where, set()).add(code)
    return {where: next(iter(codes)) for where, codes in seen.items() if len(codes) == 1}


def psi_staff(rows: list[dict], today: date, since: date) -> tuple[dict[str, dict[str, dict]], set[date], int]:
    """Same-moment entries at one place are one shift; a midnight entry continues the 11:59 PM one."""
    places = psi_locations(rows)
    out: dict[str, dict[str, dict]] = {}
    days: set[date] = set()
    unplaced = 0
    for r in rows:
        day = day_of(r.get("date_iso")) or day_of(r.get("date_service"))
        if not day or not (since <= day <= today):
            continue
        days.add(day)
        code = code_in(r.get("house")) or places.get(_loc_key(r.get("location_name")), "")
        name = " ".join(str(r.get("employee") or f"{r.get('firstname') or ''} {r.get('lastname') or ''}").split())
        if not code or not is_person(name):
            unplaced += 1
            continue
        held = out.setdefault(code, {}).setdefault(fold(name), {"name": name, "starts": set(), "late": set(),
                                                                "last_day": day})
        held["starts"].add((day, clock_of(r.get("start_time"))))
        end = clock_of(r.get("end_time"))
        if end is not None and end >= LATE_END_S:
            held["late"].add(day)
        held["last_day"] = max(held["last_day"], day)
    for people in out.values():
        for held in people.values():
            starts, late = held.pop("starts"), held.pop("late")
            held["shifts"] = sum(1 for d, s in starts if not (s == 0 and d - timedelta(days=1) in late))
    return out, days, unplaced


def gaps(days: set[date], since: date, today: date) -> list[dict[str, str]]:
    out = []
    edge = since - timedelta(days=1)
    for d in sorted(days) + [today + timedelta(days=1)]:
        if (d - edge).days - 1 >= GAP_DAYS:
            out.append({"from": (edge + timedelta(days=1)).isoformat(),
                        "to": (d - timedelta(days=1)).isoformat()})
        edge = d
    return out


def _staff_list(found: dict[str, dict], managers: set[str], leads: set[str],
                people: dict[str, dict]) -> list[dict]:
    rows = [{"name": v["name"], "shifts": v["shifts"], "last_day": v["last_day"].isoformat(),
             "avatar": str((people.get(k) or {}).get("avatar") or ""),
             "hm": k in managers, "lead": k in leads}
            for k, v in found.items()]
    rows.sort(key=lambda s: (s["last_day"], s["shifts"]), reverse=True)
    return rows


def _people(rows: list[dict] | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows or []:
        k = fold(r.get("name"))
        if not k:
            continue
        if k not in out or (str(r.get("status") or "").lower() == "active"
                            and str(out[k].get("status") or "").lower() != "active"):
            out[k] = r
    return out


def _clients_at(rows: list[dict] | None) -> dict[str, dict[str, list[dict]]]:
    """A key two rows carry names nobody; the name only pairs a row within its own house."""
    seen: dict[str, int] = {}
    for c in rows or []:
        k = str(c.get("client_key") or "").strip()
        if k:
            seen[k] = seen.get(k, 0) + 1
    out: dict[str, dict[str, list[dict]]] = {}
    for c in rows or []:
        k = str(c.get("client_key") or "").strip()
        code = str(c.get("house") or "").strip().upper()
        if k and seen[k] == 1 and code:
            out.setdefault(code, {}).setdefault(fold(c.get("name")), []).append(c)
    return out


def _policies(rows: list[dict] | None, in_app: list[dict] | None) -> list[dict]:
    by_drive: dict[str, dict] = {}
    by_title: dict[str, dict] = {}
    for r in in_app or []:
        m = _DRIVE_ID.search(str(r.get("driveUrl") or ""))
        if m:
            by_drive.setdefault(m.group(1), r)
        by_title.setdefault(fold(r.get("title")), r)
    out = []
    for r in rows or []:
        title = " ".join(str(r.get("Title") or "").split())
        url = _url(r.get("Link"))
        if not title or not url:
            continue
        m = _DRIVE_ID.search(url)
        drive_id = m.group(1) if m else ""
        doc = by_drive.get(drive_id) or by_title.get(POLICY_ALIASES.get(fold(title), fold(title)))
        out.append({"title": title, "url": url, "drive_id": drive_id,
                    "in_app_doc": str((doc or {}).get("doc_id") or ""),
                    "audience": "all" if fold(title) in CLIENT_POLICIES else "staff"})
    return out


def build_rows(*, root: Path | str | None = None, snapshot_dir: Path | str | None = None,
               psi_path: Path | str | None = None, now: float | None = None) -> tuple[list[dict], str | None]:
    now = time.time() if now is None else float(now)
    today = datetime.fromtimestamp(now, shift_slices.ESTATE_TZ).date()
    since = today - timedelta(days=STAFF_DAYS)
    snap = Path(snapshot_dir) if snapshot_dir else SNAPSHOT_DIR
    master = Master(root if root is not None else master_json.ROOT, now)
    sources: list[dict] = []

    def take(key: str, label: str, sid: str, tab: str | None, why_missing: str = "") -> list[dict] | None:
        st = master.state(key, label, sid, tab)
        rows = None
        if not sid and why_missing:
            st["why"] = why_missing
        elif st["state"] != "unreadable":
            try:
                rows = master.rows(sid, tab) if tab else [t for t in master.book(sid)["tabs"]]
            except Exception as exc:  # noqa: BLE001
                st.update(state="unreadable", why=f"could not be read ({type(exc).__name__})")
        sources.append(st)
        return rows

    client_db = take("client_db", "Asa Client Database · Master", CLIENT_DB_ID, CLIENT_DB_TAB)
    if client_db is None:
        raise RuntimeError(f"which houses are active cannot be said — {sources[-1]['why']}")
    try:
        ptr, ptr_why = pointers(master), ""
    except Exception as exc:  # noqa: BLE001
        ptr, ptr_why = {}, f"the Essencial's pointers could not be read ({type(exc).__name__})"
    calendar = take("calendar", "Hotline calendar · Calendar Archive", ptr.get(HOTLINE_POINTER, ""),
                    HOTLINE_TAB, ptr_why or f"the platform declares no {HOTLINE_POINTER}")
    houses_data = take("houses_data", "Houses Data R3.1", HOUSES_DATA_ID, None)
    registry_rows = take("registry", "Client entities · entity_homes", ENTITIES_ID, ENTITY_HOMES_TAB)
    people_rows = take("people", "People", ptr.get(PEOPLE_POINTER, ""), PEOPLE_TAB,
                       ptr_why or f"the platform declares no {PEOPLE_POINTER}")
    policy_rows = take("policies", "Common Data R3.1 · Company Policies", COMMON_DATA_ID, POLICIES_TAB)

    def side(key: str, label: str, path: Path, quiet_s: float, quiet_why: str) -> list[dict] | None:
        rows, stamp, why = _file_rows(path)
        st = {"key": key, "label": label, "book": "", "tab": "", "rows": len(rows or []), "read_at": stamp,
              "state": "unreadable" if rows is None else "fresh", "why": why}
        if rows is not None:
            at = _epoch(stamp)
            if not at:
                st.update(state="stale", why=f"{path.name} carries no stamp")
            elif now - at > quiet_s:
                st.update(state="stale", why=f"{quiet_why} {stamp}")
        sources.append(st)
        return rows

    psi_rows = side("psi", "PsiAnywhere punches",
                    Path(psi_path) if psi_path else psi_punches_full.FULL_DIR / psi_punches_full.ROWS_FILE,
                    PSI_QUIET_S, "the punch record has not changed since")
    if psi_rows is not None:
        newest = max((d for d in (day_of(r.get("date_iso")) or day_of(r.get("date_service")) for r in psi_rows)
                      if d and d <= today), default=None)
        if newest is None or newest < today - timedelta(days=1):
            st = sources[-1]
            st["state"] = "stale"
            st["why"] = "; ".join(w for w in (st["why"], "the record holds no punch" if newest is None else
                                              f"the newest punch on record is from {newest.isoformat()}") if w)
    photo_rows = side("photos", "Image Bank", snap / "photos.json", SIDE_QUIET_S, "the slice was last built at")
    client_rows = side("clients", "Clients", snap / "clients.json", SIDE_QUIET_S, "the slice was last built at")
    in_app = side("in_app_policies", "Policies reader", snap / "policies.json", SIDE_QUIET_S,
                  "the slice was last built at")
    reg_why = next(s["why"] for s in sources if s["key"] == "registry")
    people_why = next(s["why"] for s in sources if s["key"] == "people")

    active, placed = roster(client_db)
    registry: dict[str, dict] = {}
    for r in registry_rows or []:
        code = str(r.get("abbreviation") or "").strip().upper() or code_in(r.get("home_name"))
        if code:
            registry[code] = r
    tabs: dict[str, dict] = {}
    for t in houses_data or []:
        parsed = parse_tab(str(t.get("tab") or ""))
        if parsed:
            parsed["week_notes"] = sorted(h.strip() for h in t.get("header") or []
                                          if h.strip() and h.strip().lower() not in _WEEKDAYS)[:12]
            tabs[parsed["code"]] = parsed
    people = _people(people_rows)
    scenes = shift_slices.scene_photos(photo_rows or [])
    clients_at = _clients_at(client_rows)
    policies = _policies(policy_rows, in_app)

    managers = managers_by_code(calendar or [], today)
    leads = leads_by_code(calendar or [], today, since)
    sched = calendar_staff(calendar or [], today, since)
    worked, psi_days, _ = psi_staff(psi_rows, today, since) if psi_rows is not None else ({}, set(), 0)
    psi_gaps = gaps(psi_days, since, today) if psi_rows is not None else []
    psi_why = next((s["why"] for s in sources if s["key"] == "psi"), "")
    cal_why = next((s["why"] for s in sources if s["key"] == "calendar"), "")

    out: list[dict] = []
    for code in sorted(set(registry) | set(tabs) | set(placed) | set(active)):
        reg = registry.get(code) or {}
        tab = tabs.get(code) or {}
        label = (house_directory.label_of(reg.get("home_name"), code) if reg.get("home_name")
                 else tab.get("short") or code)
        is_active = code in active
        why_inactive = "" if is_active else (
            "no active client in the Asa Client Database" if code in placed
            else "the Asa Client Database places nobody here")

        scene = scenes.get(code, "")
        thumb = _url(reg.get("thumbnail_url"))
        # a photo uploaded from Locations replaces the house's picture, the Image Bank's included
        photo = ({"src": thumb, "source": "upload"} if house_images.url_house(thumb) == code
                 else {"src": scene, "source": "image bank"} if scene
                 else {"src": thumb, "source": "registry"} if thumb else {"src": "", "source": ""})

        hm_rows = []
        for m in managers.get(code) or []:
            person = people.get(fold(m["name"])) or {}
            hm_rows.append({"name": m["name"], "phone": str(person.get("phone") or "").strip(),
                            "avatar": str(person.get("avatar") or ""),
                            "phone_known": people_rows is not None,
                            "phone_why": ("" if person else
                                          f"People could not be read — {people_why}" if people_rows is None else
                                          "no People record carries this name"),
                            "last_day": m["day"].isoformat()})
        hm_why = ("" if hm_rows else
                  f"the hotline calendar could not be read — {cal_why}" if calendar is None else
                  "the hotline calendar has no ** row for this house on or before today")
        lead_rows = sorted(({"name": v["name"], "last_day": v["last_day"].isoformat()}
                            for v in (leads.get(code) or {}).values()),
                           key=lambda x: x["last_day"], reverse=True)

        client_list = []
        for name in active.get(code, []):
            found = (clients_at.get(code) or {}).get(fold(name)) or []
            c = found[0] if len(found) == 1 else {}
            client_list.append({"name": name, "client_id": str(c.get("id") or ""),
                                "client_key": str(c.get("client_key") or "").strip(),
                                "avatar": str(c.get("avatar") or "")})

        hm_keys = {fold(m["name"]) for m in hm_rows}
        lead_keys = {fold(x["name"]) for x in lead_rows}
        staff: list[dict] = []
        staff_source, staff_why = "", ""
        if not is_active:
            staff_why = "the house is not active"
        elif worked.get(code):
            staff_source = "psi"
            staff = _staff_list(worked[code], hm_keys, lead_keys, people)
        else:
            staff_why = (f"the punch record could not be read — {psi_why}" if psi_rows is None
                         else f"no PsiAnywhere punch is placed at this house since {since.isoformat()}")
            if calendar is None:
                staff_why += f"; the hotline calendar could not be read either — {cal_why}"
            else:
                staff_source = "calendar"
                staff = _staff_list(sched.get(code) or {}, hm_keys, lead_keys, people)
                if not staff:
                    staff_why += "; the hotline calendar schedules nobody here either"

        address = " ".join(str(reg.get("address") or "").split())
        address_why = ("" if address else
                       f"the registry could not be read — {reg_why}" if registry_rows is None else
                       "no registry row carries a street for it")
        out.append({
            "id": code, "code": code, "label": label,
            "title": f"{label} - {code}" if label and label != code else code,
            "city": str(reg.get("region") or "").strip() or tab.get("city", ""),
            "short": tab.get("short", label),
            "calendar_location": tab.get("label", ""),
            "active": is_active, "active_why": why_inactive,
            "address": address, "address_why": address_why,
            "photo": photo,
            "managers": hm_rows, "managers_why": hm_why,
            "leads": lead_rows,
            "clients": client_list, "client_count": len(client_list),
            "staff": staff, "staff_source": staff_source,
            "staff_label": STAFF_LABELS.get(staff_source, ""), "staff_why": staff_why,
            "staff_window": {"from": since.isoformat(), "to": today.isoformat()},
            "staff_gaps": psi_gaps if staff_source == "psi" else [],
            "week_notes": tab.get("week_notes", []),
            "policies": policies,
            "sources": sources,
        })
    out.sort(key=lambda h: h["title"])
    return out, master.stamp()


def client_view(rows: list[dict], client_key: Any) -> tuple[dict | None, str]:
    """Matched by the exact client key, never a name or a street."""
    key = str(client_key or "").strip()
    if not key:
        return None, "this account carries no client key"
    hits = []
    for h in rows:
        if not h.get("active"):
            continue
        mine = [c for c in h.get("clients") or [] if str(c.get("client_key") or "").strip() == key]
        if mine:
            hits.append((h, mine))
    if not hits:
        return None, "no active house in the Asa Client Database lists this account's client"
    if len(hits) > 1:
        return None, "this account's client is listed in more than one house"
    h, mine = hits[0]
    cal_read = all(s.get("state") != "unreadable" for s in h.get("sources") or [] if s.get("key") == "calendar")
    return {
        "code": h.get("code"), "title": h.get("title"), "label": h.get("label"),
        "city": h.get("city"), "address": h.get("address"), "photo": h.get("photo"),
        "managers": [{"name": m.get("name"), "phone": m.get("phone"), "last_day": m.get("last_day"),
                      "phone_known": m.get("phone_known", True)}
                     for m in h.get("managers") or []],
        "managers_why": ("" if h.get("managers") else "none is on the calendar" if cal_read
                         else "the calendar could not be read just now"),
        "you": [{"name": c.get("name"), "avatar": c.get("avatar")} for c in mine],
        "resident_count": int(h.get("client_count") or 0),
        "policies": [p for p in h.get("policies") or [] if p.get("audience") == "all"],
        "sources": [{"key": s.get("key"), "label": CLIENT_SOURCES[s.get("key")], "state": s.get("state")}
                    for s in h.get("sources") or [] if s.get("key") in CLIENT_SOURCES],
    }, ""


def client_answer(held: dict, build_error: str, client_key: Any, now: float | None = None) -> dict:
    now = time.time() if now is None else float(now)
    view, why = client_view(held.get("rows") or [], client_key)
    built = _epoch(held.get("built_at"))
    if view is not None and (build_error or not built or now - built > MASTER_QUIET_S):
        view["sources"] = [*view["sources"], {"key": "build", "label": "this page", "state": "stale"}]
    return {"house": view, "why": why, "built_at": held.get("built_at")}


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise KeyError(resource)
    return build_rows()
