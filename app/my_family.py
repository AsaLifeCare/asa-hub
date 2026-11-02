"""My Family (apps-script/MyFamily.gs) off asa-hub-db: My Work, My Calendar and My Inbox for a client-role account — a
client, or a guardian signed in for one — cut to the account's own client. One read, `myFamily {part}`, asked by the
relay's three doors (_my_family_forward) with the person's own session; every source gates on its App Control row
(it must name CLIENT) and says why when it cannot be read."""
from __future__ import annotations

import functools
import hashlib
import json
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import client_sources as CS
import envelope as EV
import gsjs
import locations as L
import scope as sc
import sheet_resources as SR
import smart_comms_desk as SCD
import suggestions as SUG
from gsjs import SheetDate, name_key

APP_ID = "my-family"
PARTS = ("calendar", "work", "inbox")
CACHE_S = 60.0
# CacheService's largest value: an answer past it is read again next time
CACHE_MAX_CHARS = 100000
NEW_STAFF_DAYS = 14
TZ = "America/New_York"
ROW_CAP = 200

# the App Control row that releases each source to a client-role account (it must name CLIENT)
SOURCE_APP = {"appointments": "dr-appointments", "manager": "houses", "suggestions": "suggestions",
              "tasks": "taskboard", "sheet_tasks": "taskboard-sheet", "repairs": "house-repair",
              "shifts": "my-calendar"}
LABEL = {"appointments": "Doctor appointments", "manager": "House manager", "suggestions": "Your suggestions",
         "tasks": "Your task cards", "sheet_tasks": "Your sheet task cards", "repairs": "House repairs",
         "new_staff": "New staff", "shifts": "Shifts at the house"}
TASK_WORDS = {"backlog": "Backlog", "this-week": "This week", "in-progress": "In progress", "review": "Review",
              "done": "Done"}
MONTHS = {"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
          "september": 9, "october": 10, "november": 11, "december": 12, "jan": 1, "feb": 2, "mar": 3, "apr": 4,
          "jun": 6, "jul": 7, "aug": 8, "sept": 9, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_MONTH_RE = ("(january|february|march|april|may|june|july|august|september|october|november|december|"
             "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?")
# a sheet day number (days after 1899-12-30) from 2000 to 2099
SERIAL_FROM, SERIAL_TO = 36526, 73050
# Main.gs RESOURCES: the two personal boards (ownedBy ownerId, else assigneeId; clientOpen)
BOARDS = {"tasks": "tasks", "sheetTasks": "sheet_tasks"}

_RE_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$", re.A)
_RE_ISO_REST = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(.*)$", re.A)
_RE_ZONE_END = re.compile(r"(z|[+-]\d{2}:?\d{2})$", re.A | re.I)
_RE_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})", re.A)
_RE_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", re.A)
_RE_APPT_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\S*(z|[+-]\d{2}:?\d{2})$", re.A | re.I)
_RE_YMD = re.compile(r"(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)", re.A)
_RE_MDY = re.compile(r"(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)", re.A)
_RE_MONTH_DAY = re.compile(r"\b" + _MONTH_RE + r"\s*(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4})\b)?", re.A | re.I)
_RE_DAY_MONTH = re.compile(r"(?:^|\D)(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?" + _MONTH_RE + r"\b(?:,?\s*(\d{4})\b)?",
                           re.A | re.I)
_RE_BARE_MD = re.compile(r"(?:^|[^\d/])(\d{1,2})/(\d{1,2})(?![\d/])", re.A)
_RE_SERIAL = re.compile(r"^\d{5}(\.\d+)?$", re.A)
_RE_MINUTES = re.compile(r"^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s*m?\.?)?$", re.A | re.I)
_RE_STREET_NO = re.compile(r"^\s*([0-9]{2,6})")

_held: dict[str, tuple[float, str]] = {}
_held_lock = threading.Lock()

s_ = gsjs.str_
_soft = L._soft


def _why(e: Any) -> str:
    """myFamilyWhy_."""
    return gsjs.or_text(e or "no answer")[:160]


def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


def _at(line: list, j: int) -> Any:
    return line[j] if 0 <= j < len(line) else None


# ---- days and times ------------------------------------------------------------------------------------------------

def viewer_of(user: dict) -> str:
    """myFamilyViewer_: 'guardian' when the account wears SSA or FAMILY, else 'client'. Wording only."""
    return "guardian" if any(t in sc.FAMILY_TICKS for t in sc.types_from_raw((user or {}).get("types"))) else "client"


def shift(iso: str, days: int) -> str:
    """myFamilyShift_."""
    y, m, d = (int(x) for x in str(iso).split("-"))
    return (date(y, m, 1) + timedelta(days=d - 1 + days)).isoformat()


def week_of(asked: Any, today: str) -> str:
    """myFamilyWeek_: the Monday of the asked day's week, or of today's; '' when the day cannot be read."""
    day = s_(asked) or today
    if not _RE_DAY.match(day):
        return ""
    y, m, d = (int(x) for x in day.split("-"))
    try:
        at = date(y, m, d)
    except ValueError:
        return ""
    return shift(day, -at.weekday())


def day_of(v: Any) -> str:
    """myFamilyDay_: a cell as the day it names in New York; '' when it names none."""
    if isinstance(v, SheetDate):
        return v.at.astimezone(gsjs.NY).strftime("%Y-%m-%d")
    s = s_(v)
    if not s:
        return ""
    iso = _RE_ISO_REST.match(s)
    if iso:
        if not iso.group(4) or not _RE_ZONE_END.search(iso.group(4)):
            return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
        t = gsjs.date_parse(s)
        return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(gsjs.NY).strftime("%Y-%m-%d") if t else ""
    us = _RE_US.match(s)
    if us:
        return f"{us.group(3)}-{us.group(1).zfill(2)[-2:]}-{us.group(2).zfill(2)[-2:]}"
    return ""


def ref_of(text: Any) -> str:
    """myFamilyRef_: the first five bytes of the text's MD5, in hex."""
    return hashlib.md5(gsjs.js_str(text).encode("utf-8")).hexdigest()[:10]


def ymd(y: Any, m: Any, d: Any) -> str:
    """myFamilyYmd_: 'YYYY-MM-DD' when the year, month and day make a real day (a two-digit year is this century's)."""
    try:
        yy, mm, dd = int(y), int(m), int(d)
    except (TypeError, ValueError):
        return ""
    if len(str(y)) <= 2:
        yy += 2000
    if not (1900 <= yy <= 2199 and 1 <= mm <= 12 and 1 <= dd <= 31):
        return ""
    try:
        return date(yy, mm, dd).isoformat()
    except ValueError:
        return ""


def nearest(m: int, d: int, today: str) -> str:
    """myFamilyNearest_: a month and day written without a year, in the year that puts it nearest to today."""
    y = int(str(today)[:4])
    at = date.fromisoformat(today)
    best, gap = "", None
    for yy in (y - 1, y, y + 1):
        iso = ymd(yy, m, d)
        g = abs((date.fromisoformat(iso) - at).days) if iso else None
        if g is not None and (gap is None or g < gap):
            gap, best = g, iso
    return best


def appt_day(v: Any, today: str) -> str:
    """myFamilyApptDay_: the day an appointment's date cell names, however it was written; '' when none."""
    if isinstance(v, SheetDate):
        return day_of(v)
    s = re.sub(r"\s+", " ", s_(v))
    if not s:
        return ""
    on = today or gsjs.today_ny()
    if _RE_APPT_INSTANT.match(s):
        return day_of(s)
    m = _RE_YMD.search(s)
    if m:
        return ymd(m.group(1), m.group(2), m.group(3))
    m = _RE_MDY.search(s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return ymd(m.group(3), b, a) if a > 12 and b <= 12 else ymd(m.group(3), a, b)
    m = _RE_MONTH_DAY.search(s)
    if m:
        mm = MONTHS[m.group(1).lower()]
        return ymd(m.group(3), mm, m.group(2)) if m.group(3) else nearest(mm, int(m.group(2)), on)
    m = _RE_DAY_MONTH.search(s)
    if m:
        mm = MONTHS[m.group(2).lower()]
        return ymd(m.group(3), mm, m.group(1)) if m.group(3) else nearest(mm, int(m.group(1)), on)
    m = _RE_BARE_MD.search(s)
    if m:
        return nearest(int(m.group(1)), int(m.group(2)), on)
    if _RE_SERIAL.match(s):
        n = int(float(s))
        if SERIAL_FROM <= n <= SERIAL_TO:
            return (date(1899, 12, 30) + timedelta(days=n)).isoformat()
    return ""


def minutes(t: Any) -> int:
    """myFamilyMinutes_: minutes after midnight of '9:00 AM', '9 pm' or '14:30'; 9999 for a time it cannot read."""
    m = _RE_MINUTES.match(s_(t))
    if not m:
        return 9999
    h, mi = int(m.group(1)), int(m.group(2)) if m.group(2) else 0
    if mi > 59:
        return 9999
    if m.group(3):
        if h < 1 or h > 12:
            return 9999
        return ((h % 12) + (12 if m.group(3).lower() == "p" else 0)) * 60 + mi
    if not m.group(2) or h > 23:
        return 9999
    return h * 60 + mi


def clock(v: Any, tz: str = "") -> str:
    """myFamilyClock_: a time of day as 'HH:mm' — a time cell, an instant, '7:00 AM' or '19:00'; '' when none."""
    at = None
    if isinstance(v, SheetDate):
        at = v.at
    elif _RE_INSTANT.match(s_(v)):
        t = gsjs.date_parse(s_(v))
        if t is None:
            return ""
        at = datetime.fromtimestamp(t / 1000.0, timezone.utc)
    if at is not None:
        return at.astimezone(gsjs.zone(tz or TZ)).strftime("%H:%M")
    n = minutes(v)
    return "" if n == 9999 else f"{n // 60:02d}:{n % 60:02d}"


# ---- who the client is, and what is open to the account -------------------------------------------------------------

def source(key: str, state: str, why: str = "", count: int = 0) -> dict[str, Any]:
    """myFamilySource_."""
    return {"key": key, "label": LABEL.get(key) or key, "state": state, "why": why or "",
            "count": (count or 0) if state in ("ok", "empty") else None}


def identity(reads: L.Reads, key: str) -> dict[str, Any]:
    """hubClientIdentity_: the client in every spelling the platform uses — the key, the folded names, the house's
    street (6+ characters) and its street number."""
    out: dict[str, Any] = {"key": key, "names": {key: True}, "addrs": {}, "houses": {}}

    def derived() -> None:
        for r in reads.clients_derived():
            if s_(r.get("client_key")) != key:
                continue
            n = name_key(s_(r.get("name")))
            if n:
                out["names"][n] = True
            a = L.addr_key(r.get("home_address"))
            if a and len(a) >= 6:
                out["addrs"][a] = True
            num = _RE_STREET_NO.match(s_(r.get("home_address")))
            if num:
                out["houses"][num.group(1)] = True

    _ok, why = _soft(derived)
    if why:
        def plans() -> None:
            for r in reads.hub_rows("isps"):
                if s_(r.get("client_key")) != key:
                    continue
                n2 = name_key(s_(r.get("client_name")))
                if n2:
                    out["names"][n2] = True
        _soft(plans)
    return out


def access(reads: L.Reads, user: dict) -> dict[str, Any]:
    """myFamilyAccess_: which source apps are open to this account, by appBadgeAccessGet's rules (its own My Work cut
    taken), the account's own denials and the tenant rows."""
    def read() -> dict[str, Any]:
        rules = reads.app_rules()
        cut = sc.my_work_apps_cut_for(user, reads.config())
        return {"rules": {k: v for k, v in rules["rules"].items() if k not in cut},
                "tenants": {k: v for k, v in rules["tenants"].items() if k not in cut}}

    got, why = _soft(read)
    if got is None:
        return {"readable": False, "why": f"Whether this is open to this account could not be read ({_why(why)})."}
    denied = user.get("app_denials") if isinstance(user.get("app_denials"), list) else []
    home = s_(user.get("home_tenant"))

    def opens(app_id: str) -> bool:
        if app_id in denied:
            return False
        if "CLIENT" not in (got["rules"].get(app_id) or []):
            return False
        t = got["tenants"].get(app_id) or []
        return not (home and t and home not in t)

    return {"readable": True, "why": "", "opens": opens}


def gate(key: str, acc: dict) -> dict | None:
    """myFamilyGate_: None when the source is open, else its source line."""
    if not acc["readable"]:
        return source(key, "unreadable", acc["why"])
    if not acc["opens"](SOURCE_APP[key]):
        return source(key, "not_applicable", "This is not open to this account in App Control.")
    return None


def _guarded(read: Callable[[], dict]) -> dict:
    """myFamilyRows_'s catch: a source that throws is 'could not be read', with why."""
    got, why = _soft(read)
    return got if got is not None else {"error": f"could not be read ({_why(why)})"}


def ward(reads: L.Reads, key: str) -> str:
    """myFamilyWard_: the name the clients' list gives the account's own client ('' when it cannot be read)."""
    rows, _w = _soft(reads.clients_derived)
    for r in rows or []:
        if s_(r.get("client_key")) == key:
            return s_(r.get("name"))
    return ""


def board_rows(reads: L.Reads, resource: str, user: dict) -> list[dict]:
    """route(resource, 'list') for a personal board: the account's own cards (hubOwnerOf_), whole (clientOpen)."""
    me = "" if user.get("is_service") else s_(user.get("id"))
    rows = reads.hub_rows(BOARDS[resource])
    return [r for r in rows if me and SR.owner_of(resource, r) == me]


def repair_rows(reads: L.Reads, ident: dict) -> list[dict]:
    """route('workOrders', 'list') for a client: the estate's repairs filed at the client's own street
    (clientByAddress select_address_vehicle)."""
    return [r for r in reads.estate("workOrders")
            if L.addr_key(r.get("select_address_vehicle")) and L.addr_key(r.get("select_address_vehicle"))
            in ident["addrs"]]


def manager_rows(people: list[dict], ident: dict) -> list[dict]:
    """hubClientNarrowList_('hotlineManagers', {clientScoped, clientByHouse: ['house']}): the managers of a house whose
    code carries the client's street number."""
    out = []
    for p in people or []:
        hv = s_(p.get("house"))
        if hv and any(re.search(r"(^|\D)" + re.escape(nk) + r"(\D|$)", hv, re.A) for nk in ident["houses"]):
            out.append(p)
    return out


# ---- calendar: the week at their own house and their own doctor appointments, and the manager ------------------------

def appointments(reads: L.Reads, ctx: dict, week: str, to: str) -> dict[str, Any]:
    """myFamilyAppointments_: the client's own doctor appointments in the week, from Clients' appointment source
    (csApptBuild_): a booked visit, and a doctor's next visit that is not one."""
    appts: dict[str, Any] = {"rows": [], "next": None, "undated": 0}
    shut = gate("appointments", ctx["access"])
    if shut:
        appts["source"] = shut
        return appts

    def unread(why: str) -> dict[str, Any]:
        appts["source"] = source("appointments", "unreadable", why)
        return appts

    client = CS.appt_client(reads, ctx["key"])
    if client.get("refused"):
        return unread(f"The appointments could not be read ({gsjs.or_text(client['refused'].get('message'))[:160]}).")
    data, why = _soft(lambda: CS._appt_build(reads, client))
    if data is None:
        return unread(f"The appointments could not be read ({_why(why)}).")
    tabs = (data or {}).get("tabs") or {}
    visits, doctors = tabs.get("visits") or {}, tabs.get("doctors") or {}
    whys = [w for w in (s_(visits.get("why")), s_(doctors.get("why"))) if w]
    if not visits.get("kpis") and not doctors.get("kpis"):
        return unread(" ".join(whys) or "The appointments could not be read.")
    by_id = {d.get("id"): d for d in doctors.get("rows") or []}
    booked: dict[str, bool] = {}
    every: list[dict] = []
    for v in visits.get("rows") or []:
        d = by_id.get(v.get("doctor_id")) if v.get("doctor_id") else None
        a = {"day": appt_day(v.get("date_written"), ctx["today"]),
             "title": (d and s_(d.get("specialist"))) or "Doctor appointment", "doctor": s_(v.get("dr_name")),
             "time": s_(v.get("time")), "place": s_(v.get("dr_address")), "status": ""}
        if d and a["day"]:
            booked[f"{d.get('id')}|{a['day']}"] = True
        every.append(a)
    for d in doctors.get("rows") or []:
        if re.search("discon", s_(d.get("active_or_discontinued")), re.I):
            continue
        written = s_(d.get("next_visit"))
        # a doctor with no next visit of its own but a booked one is that booked visit
        if not written and d.get("next_booked"):
            continue
        day = appt_day(written, ctx["today"])
        if day and booked.get(f"{d.get('id')}|{day}"):
            continue
        every.append({"day": day, "title": s_(d.get("specialist")) or "Doctor appointment",
                      "doctor": s_(d.get("dr_name")), "time": "", "place": s_(d.get("address")), "status": ""})

    def order(a: dict, b: dict) -> int:
        if a["day"] != b["day"]:
            return -1 if a["day"] < b["day"] else 1
        return minutes(a["time"]) - minutes(b["time"])

    for a in every:
        if not a["day"]:
            appts["undated"] += 1
        elif week <= a["day"] <= to:
            appts["rows"].append(a)
        elif a["day"] > to and (not appts["next"] or order(a, appts["next"]) < 0):
            appts["next"] = a
    appts["rows"].sort(key=_cmp(order))
    appts["source"] = source("appointments", "ok" if appts["rows"] else "empty",
                             " ".join(whys) + " What could be read is shown." if whys else "", len(appts["rows"]))
    return appts


def shifts(reads: L.Reads, ctx: dict, week: str, to: str) -> dict[str, Any]:
    """myFamilyShifts_ (FAIL-CLOSED): the staff shifts of the week at the houses this client lives in
    (hubViewerHousesOf_), from the house calendar."""
    out: dict[str, Any] = {"rows": [], "drawn": [], "houses": []}
    shut = gate("shifts", ctx["access"])
    if shut:
        out["source"] = shut
        return out
    houses = reads.houses_of([ctx["key"]])
    if not houses.get("codes"):
        out["source"] = source("shifts", "unreadable", " ".join(houses.get("why") or []) or
                               "The house on this record cannot be matched to a house on the calendar, so no shift is "
                               "shown.")
        return out
    out["houses"] = list(houses["codes"])
    got = reads.calendar()
    if not got or not got.get("cal") or not got["cal"].get("values"):
        why = s_((got or {}).get("why"))
        out["source"] = source("shifts", "unreadable", "The house calendar could not be read" +
                               (f" ({why[:160]})" if why else "") + ".")
        return out
    want = set(out["houses"])
    values, tz = got["cal"]["values"], got["cal"].get("tz")
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in (values[0] or [])]

    def col(names: tuple[str, ...], fb: int) -> int:
        return next((head.index(n) for n in names if n in head), fb)

    c_loc, c_name, c_date = col(("location",), 0), col(("employee",), 1), col(("date",), 4)
    c_start = col(("start time", "start", "shift start", "time in"), -1)
    c_end = col(("end time", "end", "shift end", "time out"), -1)
    drawn: dict[str, bool] = {}
    seen: set[str] = set()
    for line in values[1:]:
        line = line or []
        day = L.broadcast_day(_at(line, c_date), tz)
        if not day or day < week or day > to:
            continue
        drawn[day] = True
        if L.code_of(_at(line, c_loc)) not in want:
            continue
        name = gsjs.text(_at(line, c_name), 80)
        if not reads.is_person(name):
            continue
        start = "" if c_start == -1 else clock(_at(line, c_start), tz)
        end = "" if c_end == -1 else clock(_at(line, c_end), tz)
        k = f"{day}|{name_key(name)}|{start}|{end}"
        if k in seen:
            continue
        seen.add(k)
        out["rows"].append({"day": day, "staff": name, "start": start, "end": end})

    def order(a: dict, b: dict) -> int:
        if a["day"] != b["day"]:
            return -1 if a["day"] < b["day"] else 1
        if a["start"] != b["start"]:
            return 1 if not a["start"] else -1 if not b["start"] else -1 if a["start"] < b["start"] else 1
        return gsjs.locale_cmp(a["staff"], b["staff"])

    out["rows"].sort(key=_cmp(order))
    out["drawn"] = sorted(drawn)
    out["source"] = source("shifts", "ok" if out["rows"] else "empty", "", len(out["rows"]))
    return out


def calendar(reads: L.Reads, ctx: dict, week: str, out: dict) -> None:
    """myFamilyCalendar_."""
    to = shift(week, 6)
    out["week"] = {"from": week, "to": to, "prev": shift(week, -7), "next": shift(week, 7),
                   "this": week_of("", ctx["today"])}
    got, why = _soft(lambda: shifts(reads, ctx, week, to))
    out["shifts"] = got if got is not None else {
        "rows": [], "drawn": [], "houses": [],
        "source": source("shifts", "unreadable", f"The shifts could not be read ({_why(why)}).")}
    got, why = _soft(lambda: appointments(reads, ctx, week, to))
    out["appointments"] = got if got is not None else {
        "rows": [], "next": None, "undated": 0,
        "source": source("appointments", "unreadable", f"The appointments could not be read ({_why(why)}).")}
    mgr: dict[str, Any] = {"rows": []}
    shut = gate("manager", ctx["access"])
    if shut:
        mgr["source"] = shut
    elif not ctx["id"]["houses"]:
        mgr["source"] = source("manager", "unreadable", "The house on this record cannot be matched to a house on the "
                                                        "hotline calendar, so no manager is named.")
    else:
        every, why_m = _soft(lambda: SCD.hotline_house_managers(reads))
        if every is None:
            every = {"readable": False, "why": _why(why_m)}
        if not every.get("readable"):
            said = s_(every.get("why"))
            mgr["source"] = source("manager", "unreadable", "The hotline calendar could not be read" +
                                   (f" ({said[:160]})" if said else "") + ".")
        else:
            seen: set[str] = set()
            for p in manager_rows(every.get("people") or [], ctx["id"]):
                k = s_(p.get("name")).lower() + "|" + s_(p.get("phone"))
                if not s_(p.get("name")) or k in seen:
                    continue
                seen.add(k)
                mgr["rows"].append({"name": s_(p.get("name")), "phone": s_(p.get("phone"))})
            mgr["source"] = source("manager", "ok" if mgr["rows"] else "empty",
                                   "" if mgr["rows"] else "The hotline calendar names no manager for this house.",
                                   len(mgr["rows"]))
    out["manager"] = mgr


# ---- work: what this account filed, and the repairs at the house ---------------------------------------------------

def suggestions_of(reads: L.Reads, user: dict) -> dict[str, Any]:
    """myFamilySuggestions_: this account's own suggestions, matched on the e-mail it signed in with."""
    mine = s_(user.get("email")).lower()
    if not mine:
        return {"why": "This account carries no e-mail, so no suggestion can be tied to it."}
    rows = []
    # in the order they were filed, as the tab holds them
    for r in reversed(SUG.kept(reads)):
        if not s_(r.get("id")) or s_(r.get("email")).lower() != mine:
            continue
        rows.append({"id": "sug:" + s_(r["id"]), "title": s_(r.get("text"))[:160] or "Suggestion", "status": "Sent",
                     "at": day_of(r.get("at"))})
    return {"rows": rows}


def tasks_of(reads: L.Reads, resource: str, user: dict) -> dict[str, Any]:
    """myFamilyTasks_: the account's own cards, each with its column's word and its last day."""
    def read() -> dict[str, Any]:
        out = []
        for r in board_rows(reads, resource, user):
            col = s_(r.get("column")).lower()
            stamp = r.get("updatedAt")
            out.append({"id": ("task:" if resource == "tasks" else "sheet:") + s_(r.get("id")),
                        "title": s_(r.get("title")) or "Task card",
                        "status": TASK_WORDS.get(col) or s_(r.get("column")) or "Open",
                        "at": day_of(r.get("createdAt") if gsjs.falsy(stamp) else stamp)})
        return {"rows": out}
    return _guarded(read)


def repairs_of(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """myFamilyRepairs_: repairs filed against the house on this record — the status and the day, nothing of the job."""
    if not ctx["id"]["addrs"]:
        return {"why": "No home address on this record can be matched to a repair, so none is listed."}

    def read() -> dict[str, Any]:
        out = []
        for r in repair_rows(reads, ctx["id"]):
            stamp = r.get("timestamp")
            out.append({"id": "rep:" + ref_of(s_(r.get("timestamp")) + "|" + s_(r.get("select_address_vehicle"))),
                        "title": "A repair at the house", "status": s_(r.get("status")) or "Filed",
                        "at": day_of(r.get("date") if gsjs.falsy(stamp) else stamp)})
        return {"rows": out}
    return _guarded(read)


def work(reads: L.Reads, ctx: dict, out: dict) -> None:
    """myFamilyWork_."""
    sources: list[dict] = []
    rows: list[dict] = []

    def add(key: str, fn: Callable[[], dict]) -> None:
        shut = gate(key, ctx["access"])
        if shut:
            sources.append(shut)
            return
        got, why = _soft(fn)
        if got is None:
            got = {"error": f"could not be read ({_why(why)})"}
        if got.get("error"):
            sources.append(source(key, "unreadable", f"{LABEL[key]} {got['error']}."))
            return
        if got.get("why"):
            sources.append(source(key, "unreadable", got["why"]))
            return
        for r in got["rows"]:
            r["source"] = key
            rows.append(r)
        sources.append(source(key, "ok" if got["rows"] else "empty", "", len(got["rows"])))

    add("suggestions", lambda: suggestions_of(reads, ctx["user"]))
    add("tasks", lambda: tasks_of(reads, "tasks", ctx["user"]))
    add("sheet_tasks", lambda: tasks_of(reads, "sheetTasks", ctx["user"]))
    add("repairs", lambda: repairs_of(reads, ctx))
    rows.sort(key=_cmp(lambda a, b: 1 if a["at"] < b["at"] else -1 if a["at"] > b["at"] else 0))
    out["sources"] = sources
    out["rows"] = rows[:ROW_CAP]
    out["capped"] = len(rows) > ROW_CAP
    out["actions"] = {"state": "not_applicable",
                      "why": "Actions are asked of staff; nothing is asked of this account here."}
    # Settings › My Work's hides reach a client or a guardian as they reach staff (never the master's own mass view)
    import my_work as MW  # noqa: PLC0415 - My Work's own reading of the switches
    out["display"] = MW.display_for(MW.MODE_OWN, MW.hide_from_lane(MW.hide_lane(reads)))


# ---- inbox: the staff new to the houses the client lives in now; nothing else -------------------------------------

def inbox(reads: L.Reads, ctx: dict, out: dict) -> None:
    """myFamilyInbox_: the staff who serve the client's houses (hubStaffVisibleForHouses_) whose first day at one of
    them, on the Calendar Archive or the PSI punches, falls in the last NEW_STAFF_DAYS days."""
    out.update(heads=[], items=[], house_codes=[], houses_why="", window_days=NEW_STAFF_DAYS)

    def said(state: str, why: str = "", count: int = 0, gap: str = "") -> None:
        h = source("new_staff", state, why, count)
        h["gap"] = gap or ""
        out["heads"].append(h)

    houses, why_h = _soft(lambda: reads.houses_of([ctx["key"]]))
    if houses is None:
        houses = {"codes": [], "why": [f"The houses on this record could not be read ({why_h[:120]})."]}
    codes = [c for c in houses.get("codes") or [] if L.house_code(c)]
    houses_why = " ".join(houses.get("why") or [])
    if not codes:
        out["houses_why"] = houses_why or ("No house on record is where this client lives now, so nothing at a house "
                                           "is listed.")
        said("unreadable", out["houses_why"])
        return
    out["house_codes"] = codes
    out["houses_why"] = houses_why
    first: dict[str, dict] = {}

    def read() -> tuple[dict, dict, dict]:
        seen = L.staff_visible(reads, codes)
        cal, psi = reads.calendar(), reads.punches()
        for code in codes:
            if not cal["cal"] and not psi["rows"]:
                continue
            for p in L.staff_merge(reads, code, cal["cal"], psi["rows"], ctx["today"], {})["staff"]:
                was = first.get(p["key"])
                if not was or p["first_day"] < was["day"]:
                    first[p["key"]] = {"day": p["first_day"], "name": p["name"], "code": code}
        return seen, cal, psi

    got, why = _soft(read)
    if got is None:
        said("unreadable", f"The staff at the house could not be read ({_why(why)}).")
        return
    seen, cal, psi = got
    if not cal["cal"] and not psi["rows"]:
        said("unreadable", "Neither the Calendar Archive nor the PSI punches could be read, so no first day is known.")
        return
    serves = set((seen or {}).get("keys") or [])
    since = shift(ctx["today"], 1 - NEW_STAFF_DAYS)
    if ctx["viewer"] == "guardian":
        where = ctx["ward"] + "’s house" if ctx["ward"] else "the house"
    else:
        where = "your house"
    for k, f in first.items():
        if k not in serves or not f["day"] or f["day"] < since or f["day"] > ctx["today"]:
            continue
        out["items"].append({"id": "fam:staff:" + ref_of(f"{f['code']}|{k}|{f['day']}"), "type": "new_staff",
                             "title": f"New staff at {where}: {gsjs.text(f['name'], 80)}", "at": f["day"],
                             "flag": False, "staff": k})
    out["items"].sort(key=_cmp(lambda a, b: 1 if a["at"] < b["at"] else -1 if a["at"] > b["at"] else 0))
    said("ok" if out["items"] else "empty", "", len(out["items"]),
         " ".join(w for w in (houses_why, s_((seen or {}).get("why"))) if w))


# ---- the read --------------------------------------------------------------------------------------------------------

def answer(reads: L.Reads, part: str, user: dict, today: str, week: str) -> dict[str, Any]:
    """myFamilyAnswer_."""
    key = sc.client_key_of(user)
    viewer = viewer_of(user)
    gone = ""
    if key:
        # a client set inactive, or archived, is no longer reached through its link, as on Clients (FAIL-CLOSED)
        got = reads.viewer_live_keys([key])
        if key not in (got.get("keys") or []):
            key, gone = "", got.get("why") or ("The client linked to this account is no longer live, so nothing "
                                               "about anybody is shown.")
    keys = [key] if key else []
    if not key and not gone and viewer == "guardian":
        # an SSA or a FAMILY with no client linked: every client its Clients scope holds (the FIX BADGES sheet)
        import clients as C  # noqa: PLC0415 - the Clients module reads My Work's lanes
        keys = sorted(k for k in ((C.reader(L.Session(reads, user)) or {}).get("keys") or {}) if k)
        key = keys[0] if keys else ""
    out: dict[str, Any] = {"family": True, "part": part, "viewer": viewer, "linked": bool(key), "ward": {"name": ""},
                           "why": "", "today": today, "read_at": gsjs.iso(reads.now)}
    if not key:
        out["why"] = gone or ("This account is not linked to a client yet, so nothing about anybody is shown. "
                              "The office links it.")
        return out
    out["ward"]["name"] = ", ".join(n for n in (ward(reads, k) for k in keys) if n)
    # one identity over all its clients: their names, their houses' streets and numbers
    ident = identity(reads, key)
    for k in keys[1:]:
        more = identity(reads, k)
        for part_of in ("names", "addrs", "houses"):
            ident[part_of].update(more[part_of])
    ctx = {"user": user, "key": key, "id": ident, "viewer": viewer, "ward": out["ward"]["name"],
           "today": today, "access": access(reads, user)}
    if part == "calendar":
        calendar(reads, ctx, week, out)
    elif part == "work":
        work(reads, ctx, out)
    else:
        inbox(reads, ctx, out)
    return out


def _cached(ck: str) -> dict | None:
    with _held_lock:
        hit = _held.get(ck)
    if hit is None or time.time() - hit[0] >= CACHE_S:
        return None
    return json.loads(hit[1])


def _keep(ck: str, data: dict) -> None:
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(blob) > CACHE_MAX_CHARS:
        return
    now = time.time()
    with _held_lock:
        for k in [k for k, (at, _b) in _held.items() if now - at >= CACHE_S]:
            _held.pop(k, None)
        _held[ck] = (now, blob)


def my_family(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myFamily: a client's or a guardian's own My Work, My Calendar or My Inbox, cut to the account's own client;
    the same answer for a minute per part, account and week."""
    user = sess.user or {}
    # a client, and an SSA or a FAMILY whatever its role says (scope.role_counts)
    if not user or user.get("is_service") or (s_(user.get("role")) != "client"
                                              and sc.role_counts(user.get("types"), user.get("role"))):
        return {"status": 403, "message": "This read is for client and guardian accounts."}
    if s_(user.get("visiting_member")):
        return {"status": 403, "message": "This read answers the signed-in account; it is not drawn inside a visit."}
    p = payload if isinstance(payload, dict) else {}
    part = s_(p.get("part"))
    if part not in PARTS:
        return {"status": 400, "message": "part is calendar, work or inbox."}
    if EV.place_of(user):
        # doPost's default deny away from headquarters (tenantActionAllowed_): myFamily is not a place's door; an
        # account homed at headquarters reads as headquarters
        return dict(EV.UNKNOWN)
    reads = sess.reads
    today = reads.today()
    week = ""
    if part == "calendar":
        week = week_of(p.get("week"), today)
        if not week:
            return {"status": 400, "message": "week is a day written YYYY-MM-DD."}
    ck = f"myfam|{part}|{s_(user.get('id'))}|{week}"
    held = _cached(ck)
    if held is not None:
        return {"status": 200, "data": held}
    data = answer(reads, part, user, today, week)
    _keep(ck, data)
    return {"status": 200, "data": data}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"myFamily": my_family}
# staff too: an SSA or a FAMILY on role staff reads its own client here (the door refuses any other staff account)
POLICY: dict[str, dict[str, Any]] = {"myFamily": {"roles": ("client", "staff")}}
