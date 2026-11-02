"""Houses (the relay's own houses slice, server/house_slices.py) built on Python off asa-hub-db: one row per house —
its clients, house manager, leads, staff, photo, street and policies — every source said on the row (fresh, stale or
unreadable), never replaced. The slice is read by every app that shows a house; the relay fills it from here while
the Houses app runs on Python, and answers a client's own house (/hub-lanes/houses/mine) from it."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR

APP_ID = "houses"
CLIENT_DB_ID = "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8"
CLIENT_DB_TAB = "Master"
HOUSES_DATA_ID = "1ZL5EHUfx627VFJ9rRlv8D1J8ljZJvns8TZsUKj_oAe0"
ENTITIES_ID = "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI"
ENTITY_HOMES_TAB = "entity_homes"
COMMON_DATA_ID = "1-XgGNQMkHAlGQjqvhg3Ao89pO-8DJoqjIr9ggjAXprE"
POLICIES_TAB = "Company Policies"
HOTLINE_TAB = "Calendar Archive"
HOTLINE_POINTER = "HOTLINE_CALENDAR_ID"
PEOPLE_POINTER = "HUB_HOUSE_PEOPLE_ID"
PEOPLE_TAB = "Data"

STAFF_DAYS = 92
GAP_DAYS = 7
HM_WINDOW_DAYS = 14
STALE_GRACE_S = 600.0
LATE_END_S = 23 * 3600 + 59 * 60
MANAGER_MARK = "**"
LEAD_MARK = "***"
STAFF_LABELS = {"psi": "Worked here — PsiAnywhere punches", "calendar": "Scheduled here — hotline calendar"}
CLIENT_POLICIES = frozenset({"billofrightser", "muihandbook"})
POLICY_ALIASES = {"companypolicies": "asalifecaregeneralpolicies"}

_WEEKDAYS = {"mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun"}
_NOT_PEOPLE = {"nurse", "family"}
_TAB_RE = re.compile(r"^([A-Z]{2,4})\s*-\s*(.+?)\s*-\s*([A-Z]{2,4}\d{3,6})$")
_CODE_RE = re.compile(r"([A-Z]{2,4}\d{3,6})\s*$")
_US_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")
_URL = re.compile(r"https?://[^\s\[\]]+")
_DRIVE_ID = re.compile(r"/d/([A-Za-z0-9_-]{10,})")
# server/house_images.py URL_RE: a photo kept on the server for this house
_KEPT_PHOTO = re.compile(r"^https://[A-Za-z0-9.-]+(?::\d{1,5})?" + re.escape("/hub-lanes/locations/image")
                         + r"/([A-Z]{2,4}\d{3,6})/(\d{8}T\d{9}Z\.(?:jpg|png|webp))$")


def fold(name: Any) -> str:
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
    """calendar_builder_slices._skip_staff, and the two words that are never a person."""
    text = str(name or "").strip()
    low = text.lower()
    return bool(text) and low != "open" and "workshop" not in low and fold(text) not in _NOT_PEOPLE


def parse_tab(tab: str) -> dict | None:
    m = _TAB_RE.match((tab or "").strip())
    if not m:
        return None
    return {"label": tab.strip(), "city": m.group(1), "short": m.group(2).strip(), "code": m.group(3)}


def label_of(home_name: Any, code: Any = "") -> str:
    """house_directory.label_of: "CAN - JH - ABD2704" → "JH"."""
    parts = [p.strip() for p in str(home_name or "").split(" - ") if p.strip()]
    code = str(code or "").strip()
    if parts and code and parts[-1].upper() == code.upper():
        parts = parts[:-1]
    elif len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,4}\d{3,6}", parts[-1]):
        parts = parts[:-1]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{3}", parts[0]):
        parts = parts[1:]
    return " - ".join(parts) or code


def _url(text: Any) -> str:
    m = _URL.search(str(text or ""))
    return m.group(0) if m else ""


def _loc_key(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


def _txt(v: Any) -> str:
    """A copied cell as the master JSON carried it: text, a Date as the day it means."""
    t = hubdb.typed(v, "hub")
    if isinstance(t, gsjs.SheetDate):
        return gsjs.js_str(hubdb.cell_text(t))
    return "" if t is None else gsjs.js_str(t)


def _rows(reads: L.Reads, ref: hubdb.TabRef) -> list[dict[str, str]]:
    return [{h: _txt(raw.get(h)) for h in ref.headers if h} for _rn, raw in reads.db.rows(ref)]


def _iso(at: Any) -> str:
    if isinstance(at, datetime):
        return at.astimezone(timezone.utc).isoformat()
    return str(at or "")


def _epoch(at: Any) -> float:
    if isinstance(at, datetime):
        return at.timestamp()
    try:
        return datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


# ---- the build ------------------------------------------------------------------------------------------------

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


def psi_staff(rows: list[dict], today: date, since: date) -> tuple[dict[str, dict[str, dict]], set[date]]:
    """Same-moment entries at one place are one shift; a midnight entry continues the 11:59 PM one."""
    seen: dict[str, set[str]] = {}
    for r in rows:
        code, where = code_in(r.get("house")), _loc_key(r.get("location_name"))
        if code and where:
            seen.setdefault(where, set()).add(code)
    places = {where: next(iter(codes)) for where, codes in seen.items() if len(codes) == 1}
    out: dict[str, dict[str, dict]] = {}
    days: set[date] = set()
    for r in rows:
        day = day_of(r.get("date_iso")) or day_of(r.get("date_service"))
        if not day or not (since <= day <= today):
            continue
        days.add(day)
        code = code_in(r.get("house")) or places.get(_loc_key(r.get("location_name")), "")
        name = " ".join(str(r.get("employee") or f"{r.get('firstname') or ''} {r.get('lastname') or ''}").split())
        if not code or not is_person(name):
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
    return out, days


def gaps(days: set[date], since: date, today: date) -> list[dict[str, str]]:
    out = []
    edge = since - timedelta(days=1)
    for d in sorted(days) + [today + timedelta(days=1)]:
        if (d - edge).days - 1 >= GAP_DAYS:
            out.append({"from": (edge + timedelta(days=1)).isoformat(), "to": (d - timedelta(days=1)).isoformat()})
        edge = d
    return out


def _staff_list(found: dict[str, dict], managers: set[str], leads: set[str], people: dict[str, dict]) -> list[dict]:
    rows = [{"name": v["name"], "shifts": v["shifts"], "last_day": v["last_day"].isoformat(),
             "avatar": str((people.get(k) or {}).get("avatar") or ""), "hm": k in managers, "lead": k in leads}
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


def _scene_photos(rows: list[dict]) -> dict[str, str]:
    """shift_slices.scene_photos: the first non-hidden scene photo titled with the house code."""
    out: dict[str, str] = {}
    for ph in rows:
        if str(ph.get("kind", "")) != "scene" or str(ph.get("hidden", "")).strip().lower() == "true":
            continue
        code = str(ph.get("title", "")).strip().upper()
        if code and code not in out:
            out[code] = str(ph.get("src", ""))
    return out


def build_rows(reads: L.Reads) -> tuple[list[dict], str | None]:
    """house_slices.build_rows, every source off asa-hub-db or the Hub's own readers."""
    now = reads.now.timestamp()
    today = reads.now.astimezone(gsjs.NY).date()
    since = today - timedelta(days=STAFF_DAYS)
    sources: list[dict] = []
    newest_copy: list[float] = []

    def take(key: str, label: str, sid: str, tab: str | None, why_missing: str = "",
             house: str = "") -> list[dict] | None:
        st: dict[str, Any] = {"key": key, "label": label, "book": "", "tab": tab or "", "rows": 0, "read_at": "",
                              "state": "unreadable", "why": ""}
        sources.append(st)
        kept = HT.resource_in(reads, sid, tab) if sid and tab else None
        if (house and HT.tabled(house)) or kept:
            # a house kept in its own table: Postgres is its record, read as it stands now
            try:
                heads, got = HT.raw(reads, house or tab or "", kept)
            except Exception as exc:  # noqa: BLE001 - said on the row, never replaced
                st["why"] = f"could not be read ({type(exc).__name__})"
                return None
            st.update(book="Postgres", rows=len(got), read_at=reads.now.astimezone(timezone.utc).isoformat(),
                      state="fresh")
            return [{h: _txt(raw.get(h)) for h in heads if h} for _rn, raw in got]
        if not sid:
            st["why"] = why_missing or "no book is declared for it"
            return None
        book = reads.db.book(sid)
        if book is None:
            st["why"] = "asa-hub-db holds no copy of its book"
            return None
        st["book"] = book.name
        refs = [r for (s, t), r in reads.db.catalog()["tabs"].items() if s == sid and (tab is None or t == tab)]
        if not refs:
            st["why"] = f"{book.name or 'its book'} has no tab '{tab}'"
            return None
        st["rows"] = sum(r.row_count for r in refs)
        st["read_at"] = _iso(book.synced_at)
        synced, modified = _epoch(book.synced_at), _epoch(book.modified_time)
        newest_copy.append(synced)
        if modified and synced and modified > synced + STALE_GRACE_S:
            st.update(state="stale", why=f"the sheet changed at {_iso(book.modified_time)} and was last read at "
                                         f"{_iso(book.synced_at)}")
        else:
            st["state"] = "fresh"
        try:
            if tab is not None:
                return _rows(reads, refs[0])
            return [{"tab": r.tab, "header": [str(h) for h in r.headers]} for r in refs]
        except Exception as exc:  # noqa: BLE001 - said on the row, never replaced
            st.update(state="unreadable", why=f"could not be read ({type(exc).__name__})")
            return None

    client_db = take("client_db", "Asa Client Database · Master", CLIENT_DB_ID, CLIENT_DB_TAB)
    if client_db is None:
        raise RuntimeError(f"which houses are active cannot be said — {sources[-1]['why']}")
    calendar = take("calendar", "Hotline calendar · Calendar Archive", reads.db.prop(HOTLINE_POINTER), HOTLINE_TAB,
                    f"the platform declares no {HOTLINE_POINTER}")
    houses_data = take("houses_data", "Houses Data R3.1", HOUSES_DATA_ID, None)
    registry_rows = take("registry", "Client entities · entity_homes", ENTITIES_ID, ENTITY_HOMES_TAB)
    people_rows = take("people", "People", reads.db.prop(PEOPLE_POINTER), PEOPLE_TAB,
                       f"the platform declares no {PEOPLE_POINTER}", house="people")
    policy_rows = take("policies", "Common Data R3.1 · Company Policies", COMMON_DATA_ID, POLICIES_TAB)

    def side(key: str, label: str, read: Callable[[], list[dict]]) -> list[dict] | None:
        st: dict[str, Any] = {"key": key, "label": label, "book": "", "tab": "", "rows": 0,
                              "read_at": reads.now.astimezone(timezone.utc).isoformat(), "state": "fresh", "why": ""}
        sources.append(st)
        try:
            rows = read()
        except Exception as exc:  # noqa: BLE001 - said on the row
            st.update(state="unreadable", why=f"could not be read ({type(exc).__name__})", read_at="")
            return None
        st["rows"] = len(rows)
        return rows

    def psi() -> list[dict]:
        got = reads.punches()
        if got.get("rows") is None:
            raise RuntimeError(got.get("why") or "the punch record could not be read")
        return [{k: _txt(v) for k, v in r.items()} for r in got["rows"]]

    def photos() -> list[dict]:
        return RR.read_all(reads, "photos") if RR.uploaded(reads.db, "photos") else reads.hub_rows("photos")

    psi_rows = side("psi", "PsiAnywhere punches", psi)
    if psi_rows is not None:
        newest = max((d for d in (day_of(r.get("date_iso")) or day_of(r.get("date_service")) for r in psi_rows)
                      if d and d <= today), default=None)
        if newest is None or newest < today - timedelta(days=1):
            st = sources[-1]
            st["state"] = "stale"
            st["why"] = "; ".join(w for w in (st["why"], "the record holds no punch" if newest is None else
                                              f"the newest punch on record is from {newest.isoformat()}") if w)
    photo_rows = side("photos", "Image Bank", photos)
    client_rows = side("clients", "Clients", lambda: list(reads.clients_derived()))
    in_app = side("in_app_policies", "Policies reader", lambda: reads.hub_rows("policies"))
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
    scenes = _scene_photos(photo_rows or [])
    clients_at = _clients_at(client_rows)
    policies = _policies(policy_rows, in_app)
    managers = managers_by_code(calendar or [], today)
    leads = leads_by_code(calendar or [], today, since)
    sched = calendar_staff(calendar or [], today, since)
    worked, psi_days = psi_staff(psi_rows, today, since) if psi_rows is not None else ({}, set())
    psi_gaps = gaps(psi_days, since, today) if psi_rows is not None else []
    psi_why = next((s["why"] for s in sources if s["key"] == "psi"), "")
    cal_why = next((s["why"] for s in sources if s["key"] == "calendar"), "")

    out: list[dict] = []
    for code in sorted(set(registry) | set(tabs) | set(placed) | set(active)):
        reg = registry.get(code) or {}
        tab = tabs.get(code) or {}
        label = label_of(reg.get("home_name"), code) if reg.get("home_name") else tab.get("short") or code
        is_active = code in active
        why_inactive = "" if is_active else ("no active client in the Asa Client Database" if code in placed
                                             else "the Asa Client Database places nobody here")
        scene = scenes.get(code, "")
        thumb = _url(reg.get("thumbnail_url"))
        kept = _KEPT_PHOTO.match(thumb.strip())
        # a photo uploaded from Locations replaces the house's picture, the Image Bank's included
        photo = ({"src": thumb, "source": "upload"} if kept and kept.group(1) == code
                 else {"src": scene, "source": "image bank"} if scene
                 else {"src": thumb, "source": "registry"} if thumb else {"src": "", "source": ""})
        hm_rows = []
        for m in managers.get(code) or []:
            person = people.get(fold(m["name"])) or {}
            hm_rows.append({"name": m["name"], "phone": str(person.get("phone") or "").strip(),
                            "avatar": str(person.get("avatar") or ""), "phone_known": people_rows is not None,
                            "phone_why": ("" if person else f"People could not be read — {people_why}"
                                          if people_rows is None else "no People record carries this name"),
                            "last_day": m["day"].isoformat()})
        hm_why = ("" if hm_rows else f"the hotline calendar could not be read — {cal_why}" if calendar is None
                  else "the hotline calendar has no ** row for this house on or before today")
        lead_rows = sorted(({"name": v["name"], "last_day": v["last_day"].isoformat()}
                            for v in (leads.get(code) or {}).values()), key=lambda x: x["last_day"], reverse=True)
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
        address_why = ("" if address else f"the registry could not be read — {reg_why}" if registry_rows is None
                       else "no registry row carries a street for it")
        out.append({
            "id": code, "code": code, "label": label,
            "title": f"{label} - {code}" if label and label != code else code,
            "city": str(reg.get("region") or "").strip() or tab.get("city", ""), "short": tab.get("short", label),
            "calendar_location": tab.get("label", ""), "active": is_active, "active_why": why_inactive,
            "address": address, "address_why": address_why, "photo": photo,
            "managers": hm_rows, "managers_why": hm_why, "leads": lead_rows,
            "clients": client_list, "client_count": len(client_list),
            "staff": staff, "staff_source": staff_source, "staff_label": STAFF_LABELS.get(staff_source, ""),
            "staff_why": staff_why, "staff_window": {"from": since.isoformat(), "to": today.isoformat()},
            "staff_gaps": psi_gaps if staff_source == "psi" else [],
            "week_notes": tab.get("week_notes", []), "policies": policies, "sources": sources})
    out.sort(key=lambda h: h["title"])
    stamp = max(newest_copy, default=0.0)
    return out, datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if stamp else None


def houses_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The houses slice for the relay's own identity."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "The houses slice is the relay's to build."}
    rows, _stamp = build_rows(sess.reads)
    return {"status": 200, "data": rows}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"housesSlice": houses_slice}
POLICY: dict[str, dict[str, Any]] = {"housesSlice": {}}
