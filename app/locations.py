"""Locations' reads (apps-script/Locations.gs), the same answers off asa-hub-db: one house at a time, cut to the viewer."""
from __future__ import annotations

import base64
import functools
import re
from datetime import datetime, timezone
from typing import Any, Callable

import drive as dr
import editions
import gsjs
import hubdb
import scope as sc
from gsjs import cell, locale_cmp, name_key, text, when
from scope import Defer

APP_ID = "locations"
SUPPLY_ORDER_DAYS = 7
LEAD_DAYS = 92
NOTES_TAB = "house_notes"
SUPPLY_TAB = "houseSupplies"
SUPPLY_KINDS = ("count", "delivery", "par")
# an entry's correction; a removed entry keeps its row with this kind, which no reader lists
SUPPLY_EDIT_FIELDS = ("qty", "category", "note", "on_hand_after")
SUPPLY_REMOVED = "removed"
STAFF_OFF_TAB = "house_staff_off"
ENTITIES_PROP, ENTITIES_FALLBACK = "HUB_CLIENT_ENTITIES_SHEET_ID", "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI"
HOMES_TAB = "entity_homes"
# a house's type: the registry has no column for it, so the Hub keeps it in its own table (House Details › Type)
HOUSE_TYPES_TABLE = "app.house_types"
HOUSE_TYPES_SQL = f"select code, type from {HOUSE_TYPES_TABLE}"
HOUSE_TYPE_MAX = 60
COMMON_PROP, COMMON_FALLBACK = "HUB_COMMON_DATA_SHEET_ID", "1-XgGNQMkHAlGQjqvhg3Ao89pO-8DJoqjIr9ggjAXprE"
POLICIES_TAB = "Company Policies"
HOTLINE_CALENDAR_TAB = "Calendar Archive"
PSI_PUNCHES_FULL_TAB = "psi_punches_full"
HOUSE_FIELDS = ("home_name", "address", "region", "telephone", "manager_name", "manager_phone", "calendar_link")
CLIENT_POLICIES = ("billofrightser", "muihandbook")
PACK_PARTS = ("overview", "staff", "notes", "supplies", "guidebook", "repairs", "incidents", "client_views")
VIEW_SOURCES = ("overview", "staff", "incidents")
EDITION = {"house": "locations.house", "staffRemove": "locations.staffRemove", "incidents": "locations.incidents",
           "incidentsNew": "locations.incidentsNew", "documents": "locations.documents", "notesAny": "locations.notesAny", "clientsAdd": "locations.clientsAdd",
           "assets": "locations.assets"}
INCIDENT_COLUMNS = ("timestamp", "your_name", "client_name", "incident_category", "incident_location",
                    "incident_date", "incident_time", "incident_reported_date", "incident_reported_time",
                    "employees_involved", "summary_of_incident", "immediate_action_taken",
                    "cause_and_contributing_factors", "prevention_plan")
# Estate.gs ESTATE_SOURCES for the three this app reads
ESTATE_SOURCES = {"workOrders": ("ESTATE_REPAIRS_ID", "Repairs"),
                  "houseInventory": ("ESTATE_REPAIRS_ID", "House Inventory List"),
                  "uiIncidents": ("ESTATE_UI_ID", "UIs and MUIs")}
# Clients.gs ISP_CONTACT_LABELS, and the ones read as a single line
ISP_CONTACT_LABELS = ("Name", "Preferred Name", "Date of Birth", "Address", "City, State, Zip", "County", "Email",
                      "Phone", "Status", "Sex", "Medicaid #", "Funding Sources", "Best way to connect",
                      "Additional Information", "DODD #")
ISP_ONE_LINE = ("DODD #", "Medicaid #", "Phone", "Email", "County", "Sex", "Status", "Date of Birth")
# ClientProfiles.gs: the save columns a cleared marker blanks, with the columns that carry the same value
CP_SAVE_FIELDS = ("dob", "house", "home_address", "client_number", "initials", "medicaid_id", "house_manager",
                  "house_manager_phone", "house_manager_email", "guardianName", "guardian_relationship",
                  "guardian_email", "guardian_phone", "guardian_address", "ssa_name", "ssa_email", "ssa_phone",
                  "outcome", "ama_date", "start_date", "isp_signed_date", "self_admin_assessment",
                  "self_admin_expires", "media_release", "medical_supply", "truelink_consent", "guardianship_papers",
                  "workshop", "workshop_phone", "workshop_address", "transportation", "transportation_phone",
                  "payee_rep", "payee_rep_phone", "payee_rep_email", "food_stamp", "spending_limit")
CP_FIELD_NAMES = {"house": ("house", "houseName"), "guardianName": ("guardianName", "guardian_name")}
IST_NON_PERSON_SHIPPED = {"ist_non_person_names": "OPEN, NEW, FAMILY, LOCATION, NURSE, STAFF, TBD, AGENCY, VACANT, TBA, PRN",
                          "ist_non_person_contains": "workshop"}
IST_CONFIG_TAB = "ist_config"
# locationDocFile: LOCATION_DOC_MAX_BYTES, LOCATION_OFFICE_TO_GOOGLE, ComplianceDocs.gs CERT_DOC_TYPES
DOC_MAX_BYTES = 15 * 1024 * 1024
DOC_TOO_BIG = "This file is larger than 15MB, so it is not shown here."
_GDOC, _GSHEET, _GSLIDES = ("application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet",
                            "application/vnd.google-apps.presentation")
OFFICE_TO_GOOGLE = {"application/msword": _GDOC,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": _GDOC,
                    "application/rtf": _GDOC, "application/vnd.oasis.opendocument.text": _GDOC,
                    "application/vnd.ms-excel": _GSHEET,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": _GSHEET,
                    "application/vnd.ms-powerpoint": _GSLIDES,
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation": _GSLIDES}
DOC_TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
             "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}
_RE_FILE_ID = re.compile(r"[A-Za-z0-9_-]{10,}")

_JS_WS = "\\s\\xa0\\ufeff\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
_RE_CODE = re.compile(r"([A-Z]{2,4}\d{3,6})[" + _JS_WS + r"]*$")
_RE_HOUSE = re.compile(r"^[A-Z]{2,4}\d{3,6}$")
_RE_URL = re.compile(r"https?://[^" + _JS_WS + r"\[\]]+")
_RE_DRIVE = (re.compile(r"/d/([A-Za-z0-9_-]{10,})"), re.compile(r"[?&]id=([A-Za-z0-9_-]{10,})"))
_RE_UNIT = (re.compile(r"(?:^|[" + _JS_WS + r",(])(?:apt|apartment|unit|suite|ste)\b\.?[" + _JS_WS + r"]*#?["
                       + _JS_WS + r"]*([a-z0-9]+)\b", re.ASCII),
            re.compile(r"#[" + _JS_WS + r"]*([a-z0-9]+)\b", re.ASCII))
_RE_UNIT_CUT = re.compile(r"(?:^|[" + _JS_WS + r",])(?:apt|apartment|unit|suite|ste)\b|#", re.ASCII)
_RE_NUM = re.compile(r"^[" + _JS_WS + r"]*(\d{2,6})\b", re.ASCII)


def _why(e: BaseException) -> str:
    """String((e && e.message) || e).slice(0, 120)."""
    return str(e)[:120]


def _soft(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of the Apps Script code: its own failures become words; the database's are never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return None, _why(e)


def by_name(key: Callable[[Any], Any]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(lambda a, b: locale_cmp(key(a), key(b)))


def copy(o: dict | None) -> dict:
    return dict(o or {})


def code_of(v: Any) -> str:
    """locationsCode_: the trailing house code of a label."""
    m = _RE_CODE.search(gsjs.trim(gsjs.or_blank(v)).upper())
    return m.group(1) if m else ""


def house_code(v: Any) -> str:
    """locationsHouseCode_: a cell that is exactly a house code."""
    s = gsjs.trim(gsjs.or_blank(v)).upper()
    return s if _RE_HOUSE.match(s) else ""


def home_code(abbreviation: Any, home_name: Any) -> str:
    return house_code(abbreviation) or code_of(home_name)


def first_url(v: Any) -> str:
    m = _RE_URL.search(gsjs.or_text(v))
    return m.group(0) if m else ""


def drive_id(v: Any) -> str:
    s = gsjs.or_text(v)
    for rx in _RE_DRIVE:
        m = rx.search(s)
        if m:
            return m.group(1)
    return ""


def num(v: Any) -> float | None:
    """locationsNum_: a plain number or None; words and blanks are never 0."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(str(v)).replace(",", "")
    return float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def addr_key(v: Any) -> str:
    """hubAddrKey_: house number and street words, before the first comma."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_text(v).split(",")[0].lower())


def addr(v: Any) -> dict[str, str]:
    """locationsAddr_: street key, unit and house number."""
    s = gsjs.or_blank(v).lower()
    m = _RE_UNIT[0].search(s) or _RE_UNIT[1].search(s)
    street = re.sub(r"\([^)]*\)", " ", s)
    cut = _RE_UNIT_CUT.search(street)
    if cut and cut.start() > 0:
        street = street[:cut.start()]
    n = _RE_NUM.match(street)
    return {"key": addr_key(street), "unit": m.group(1) if m else "", "num": n.group(1) if n else ""}


def addr_index(homes: list[dict], clients: list[dict]) -> dict[str, list[dict]]:
    by: dict[str, list[dict]] = {}

    def add(code: str, value: Any) -> None:
        if not code or not gsjs.trim(gsjs.or_text(value)):
            return
        a = addr(value)
        if a["key"] or a["num"]:
            by[code].append(a)

    for h in homes or []:
        if not h or not h.get("code"):
            continue
        by.setdefault(h["code"], [])
        add(h["code"], h.get("address"))
    for c in clients or []:
        code = house_code((c or {}).get("house"))
        if not code:
            continue
        by.setdefault(code, [])
        add(code, c.get("home_address"))
    return by


def addr_owner(index: dict[str, list[dict]], value: Any) -> dict[str, str]:
    """locationsAddrOwner_: street and unit exactly, else a house number no other house shares."""
    a = addr(value)
    none = {"code": "", "how": ""}
    codes = list(index or {})
    exact = [c for c in codes if any(bool(a["key"]) and x["key"] == a["key"] and x["unit"] == a["unit"]
                                     for x in index[c])]
    if len(exact) == 1:
        return {"code": exact[0], "how": "exact"}
    if len(exact) > 1 or not a["num"]:
        return none
    near = [c for c in codes if any(x["num"] == a["num"] and (not a["unit"] or x["unit"] == a["unit"])
                                    for x in index[c])]
    return {"code": near[0], "how": "street_number"} if len(near) == 1 else none


def client_current(c: dict | None) -> bool:
    s = gsjs.trim(gsjs.or_text((c or {}).get("status"))).lower()
    return not s or s == "active"


def clients_at(code: str, home: dict | None, clients: list[dict]) -> list[dict]:
    """locationsClientsAt_: its code on the client, else the registry street and unit exactly."""
    home_addr = addr(home["address"]) if home and home.get("address") else None
    out = []
    for c in clients or []:
        if not client_current(c):
            continue
        hc = house_code(c.get("house"))
        if hc:
            if hc == code:
                out.append(c)
            continue
        if not home_addr or not home_addr["key"]:
            continue
        a = addr(c.get("home_address"))
        if a["key"] == home_addr["key"] and a["unit"] == home_addr["unit"]:
            out.append(c)
    return out


def loc_key(v: Any) -> str:
    return re.sub(r"[" + _JS_WS + r"]+", " ", gsjs.or_text(v).lower()).strip(gsjs._TRIM)


def psi_places(rows: list[dict]) -> dict[str, str]:
    """locationsPsiPlaces_: a PSI place that only ever carried one house code."""
    seen: dict[str, dict[str, bool]] = {}
    for r in rows or []:
        c, w = code_of((r or {}).get("house")), loc_key((r or {}).get("location_name"))
        if c and w:
            seen.setdefault(w, {})[c] = True
    return {w: next(iter(codes)) for w, codes in seen.items() if len(codes) == 1}


def broadcast_day(value: Any, tz: str = "America/New_York") -> str:
    """commBroadcastDay_: month/day/year or ISO text as yyyy-MM-dd ('' otherwise)."""
    if isinstance(value, gsjs.SheetDate):
        return value.at.astimezone(gsjs.NY).strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(value))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
    if m:
        y = int(m.group(3))
        if y < 100:
            y += 2000
        return f"{y}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""


def row_day(v: Any) -> str:
    """hotlineRowDay_."""
    s = gsjs.trim(gsjs.or_text(v))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)[-2:]}-{m.group(2).zfill(2)[-2:]}"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else ""


def managers_by_house(data: list[list[Any]], today_iso: str) -> dict[str, dict[str, Any]]:
    """hotlineManagersByHouse_: ** rows per location — the anchor, and everyone current within seven days."""
    head = [gsjs.trim(gsjs.or_text(h)).lower() for h in ((data[0] if data else []) or [])]
    date_col = head.index("date") if "date" in head else -1
    lo, hi = gsjs.day_shift(today_iso, -7), gsjs.day_shift(today_iso, 7)
    per: dict[str, list[dict]] = {}
    for i in range(1, len(data or [])):
        line = data[i]

        def at(j: int) -> Any:
            return line[j] if j < len(line) else ""

        if gsjs.trim(gsjs.or_text(at(2))) != "**":
            continue
        loc = gsjs.trim(gsjs.or_text(at(0)))
        row = {"name": gsjs.trim(gsjs.or_text(at(1))), "phone": gsjs.trim(gsjs.or_text(at(3))), "house": loc,
               "order": i}
        if not loc or not row["name"]:
            continue
        cv = at(date_col) if date_col >= 0 else ""
        row["day"] = cv.at.astimezone(gsjs.NY).strftime("%Y-%m-%d") if isinstance(cv, gsjs.SheetDate) else row_day(cv)
        per.setdefault(loc, []).append(row)
    out: dict[str, dict[str, Any]] = {}
    for loc, rows in per.items():
        past = ahead = last = None
        near = []
        for r in rows:
            last = r
            if not r["day"]:
                continue
            if r["day"] <= today_iso:
                if not past or r["day"] >= past["day"]:
                    past = r
            elif not ahead or r["day"] < ahead["day"]:
                ahead = r
            if lo <= r["day"] <= hi:
                near.append(r)
        anchor = past or ahead or last
        near.sort(key=functools.cmp_to_key(lambda a, b: (b["order"] - a["order"]) if a["day"] == b["day"]
                                           else (1 if a["day"] < b["day"] else -1)))
        current, seen = [anchor], {anchor["name"].lower() + "|" + anchor["phone"]}
        for r in near:
            k = r["name"].lower() + "|" + r["phone"]
            if k not in seen:
                seen.add(k)
                current.append(r)
        out[loc] = {"anchor": anchor, "current": current}
    return out


def managers(values: list[list[Any]], code: str, today_iso: str) -> dict[str, Any]:
    """locationsManagers_: the latest anchor on or before today, and everyone current, for one house code."""
    try:
        by = managers_by_house(values or [], today_iso)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the port: an unreadable calendar names nobody
        by = {}
    best, current, seen = None, [], set()

    def rank(r: dict | None) -> str:
        return r["day"] if r and r.get("day") and r["day"] <= today_iso else ""

    for loc, got in by.items():
        if code_of(loc) != code:
            continue
        a = got["anchor"]
        if a and (not best or rank(a) > rank(best)):
            best = a
        for r in got["current"]:
            k = name_key(r["name"])
            if k and k not in seen:
                seen.add(k)
                current.append(r)

    def shape(r: dict) -> dict:
        return {"name": gsjs.or_text(r.get("name")), "phone": gsjs.or_text(r.get("phone")),
                "day": gsjs.or_text(r.get("day"))}

    return {"anchor": shape(best) if best else None, "current": [shape(r) for r in current]}


def categories(v: Any) -> list[str]:
    """locationsCategories_: only commas outside parentheses separate them."""
    def clean(items: list[Any]) -> list[str]:
        return [x for x in (gsjs.trim(gsjs.or_blank(i)) for i in items) if x]

    if isinstance(v, list):
        return clean(v)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return []
    if s[0] == "[":
        try:
            import json  # noqa: PLC0415
            arr = json.loads(s)
            if isinstance(arr, list):
                return clean(arr)
        except ValueError:
            pass
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        cur += ch
    out.append(cur)
    return clean(out)


def status_fold(v: Any) -> str:
    return gsjs.trim(re.sub(r"[\s_-]+", " ", gsjs.or_blank(v).lower()))


def repairs_for(rows: list[dict], code: str, index: dict) -> list[dict]:
    """locationsRepairsFor_: the house's own street, the unique street-number fallback, and every ALL row."""
    out = []
    for r in rows or []:
        where = cell(r.get("select_address_vehicle"))
        whole = bool(re.fullmatch(r"all", where, re.I))
        how = "all"
        if not whole:
            owner = addr_owner(index, where)
            if owner["code"] != code:
                continue
            how = owner["how"]
        st = status_fold(r.get("status"))
        out.append({"id": cell(r.get("id")), "timestamp": cell(r.get("timestamp")), "select_address_vehicle": where,
                    "repair_type": cell(r.get("repair_type")), "urgency_level": cell(r.get("urgency_level")),
                    "please_describe_the_issue": cell(r.get("please_describe_the_issue")),
                    "status": cell(r.get("status")), "resolution_notes": cell(r.get("resolution_notes")),
                    "whole_estate": whole, "match": how,
                    "resolved": st in ("completed", "cancelled", "canceled")})
    out.sort(key=lambda r: -when(r["timestamp"]))
    return out


def incidents_for(rows: list[dict], clients: list[dict]) -> list[dict]:
    """locationsIncidentsFor_: the incidents of the house's current clients, joined by the folded name."""
    by_key = {name_key(c.get("name")): c for c in clients or []}
    out = []
    for r in rows or []:
        c = by_key.get(name_key(r.get("client_name")))
        if not c:
            continue
        full = {"id": cell(r.get("id"))}
        for k in INCIDENT_COLUMNS:
            full[k] = cell(r.get(k))
        out.append({"id": full["id"], "your_name": full["your_name"], "client_name": full["client_name"],
                    "client_key": gsjs.or_text(c.get("client_key")), "incident_category": full["incident_category"],
                    "categories": categories(r.get("incident_category")),
                    "incident_location": full["incident_location"], "incident_date": full["incident_date"],
                    "incident_time": full["incident_time"], "row": full})
    out.sort(key=lambda r: (-when(r["incident_date"]), -when(r["row"]["timestamp"])))
    return out


def supply_item(entries: list[dict], order_days: Any) -> dict[str, Any]:
    """locationsSupplyItem_: one consumable's figures since its last delivery."""
    items = sorted(entries or [], key=lambda e: str(e.get("at")))

    def last(pred: Callable[[dict], bool]) -> dict | None:
        for e in reversed(items):
            if pred(e):
                return e
        return None

    par = last(lambda e: e["kind"] == "par")
    d = last(lambda e: e["kind"] == "delivery")
    latest = last(lambda e: e["kind"] == "count")
    out: dict[str, Any] = {"in_stock": None, "par": par["qty"] if par else None, "status": None, "checked": "",
                           "consumption": None, "rate_per_day": None, "days_of_cover": None, "last_delivery": None,
                           "measured": False}
    current, checked = None, ""
    if d:
        out["last_delivery"] = {"at": d["at"], "qty": d["qty"], "on_hand_after": d["on_hand_after"]}
        base = d["on_hand_after"]
        if base is None:
            before = last(lambda e: e["kind"] == "count" and str(e["at"]) <= str(d["at"]))
            base = before["qty"] + d["qty"] if before else None
        c = last(lambda e: e["kind"] == "count" and str(e["at"]) > str(d["at"]))
        if c:
            current, checked = c["qty"], c["at"]
        elif base is not None:
            current, checked = base, d["at"]
        if c and base is not None:
            out["consumption"] = base - c["qty"]
            out["measured"] = True
            days = (when(c["at"]) - when(d["at"])) / 86400000
            if days > 0:
                rate = out["consumption"] / days
                out["rate_per_day"] = gsjs.js_round(rate * 100) / 100
                if rate > 0:
                    out["days_of_cover"] = gsjs.js_round((c["qty"] / rate) * 10) / 10
    elif latest:
        current, checked = latest["qty"], latest["at"]
    out["in_stock"] = current
    out["checked"] = checked
    if current is not None:
        limit = float(order_days or SUPPLY_ORDER_DAYS)
        if current <= 0 or (out["days_of_cover"] is not None and out["days_of_cover"] < limit):
            out["status"] = "order_now"
        elif out["par"] is not None and current < out["par"]:
            out["status"] = "low"
        else:
            out["status"] = "in_stock"
    return out


def supplies(rows: list[dict], code: str, order_days: Any) -> list[dict]:
    """locationsSupplies_: the ledger of one house, one line per item, the newest category kept."""
    items: dict[str, dict] = {}
    for r in rows or []:
        if house_code(r.get("house")) != code:
            continue
        kind = gsjs.trim(gsjs.or_text(r.get("kind"))).lower()
        if kind not in SUPPLY_KINDS:
            continue
        qty = num(r.get("qty"))
        k = name_key(r.get("item"))
        if not k or qty is None:
            continue
        at = cell(r.get("at"))
        it = items.setdefault(k, {"item": text(r.get("item")), "category": "", "category_at": "", "entries": []})
        if gsjs.trim(gsjs.or_text(r.get("category"))) and at >= it["category_at"]:
            it["category"], it["category_at"] = text(r.get("category")), at
        it["entries"].append({"id": cell(r.get("id")), "kind": kind, "qty": qty, "on_hand_after": num(r.get("on_hand_after")),
                              "at": at, "by": text(r.get("by")), "category": text(r.get("category")),
                              "note": text(r.get("note"))})
    out = []
    for it in items.values():
        fig = supply_item(it["entries"], order_days)
        fig["item"] = it["item"]
        fig["category"] = it["category"]
        fig["entries"] = sorted(it["entries"], key=functools.cmp_to_key(
            lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
        out.append(fig)
    out.sort(key=by_name(lambda f: f["item"]))
    return out


def ist_cell(row: dict | None, client: dict) -> dict[str, Any]:
    """locationsIstCell_."""
    r = row
    return {"client": gsjs.or_text(client.get("name")), "client_key": gsjs.or_text(client.get("client_key")),
            "id": cell(r.get("id")) if r else "",
            "status": (cell(r.get("status")).lower() or "owed") if r else None,
            "trainedAt": cell(r.get("trainedAt")) if r else "", "docUrl": cell(r.get("docUrl")) if r else "",
            "docFileId": cell(r.get("docFileId")) if r else "", "docAt": cell(r.get("docAt")) if r else "",
            "docBy": cell(r.get("docBy")) if r else ""}


def ist_index(rows: list[dict], code: str, clients: list[dict]) -> dict[str, dict[str, dict]]:
    """locationsIstIndex_: the IST row per staff key and client at this house."""
    by_name = {name_key(c.get("name")): c for c in clients or []}
    out: dict[str, dict[str, dict]] = {}
    for r in rows or []:
        if house_code(r.get("house")) != code:
            continue
        c = by_name.get(name_key(r.get("clientName")))
        sk = name_key(r.get("staffName"))
        if not c or not sk:
            continue
        ck = gsjs.or_text(c.get("client_key") or name_key(c.get("name")))
        slot = out.setdefault(sk, {})
        if ck not in slot:
            slot[ck] = r
    return out


def mine(items: list[dict] | None, scope: dict) -> list[dict]:
    """locationsMine_: the viewer's own clients among these."""
    keys = (scope or {}).get("client_keys") or []
    return [c for c in items or [] if c and gsjs.or_text(c.get("client_key")) in keys]


def narrowed(scope: dict | None) -> bool:
    return not scope or scope.get("kind") not in ("master", "all")


def cut_viewer(scope: dict | None) -> bool:
    return not scope or scope.get("kind") in ("client", "guardian", "ssa")


def unknown() -> dict[str, Any]:
    return {"status": 404, "message": "Unknown action."}


def _ladder(block: Any) -> dict[str, str]:
    """ispContactLadder_: the labelled lines of the plan's Contact Information page."""
    whole = gsjs.or_text(block)
    cut = whole.find("Important People")
    part = whole[:cut] if cut > 0 else whole
    lines = [gsjs.trim(s) for s in part.split("\n")]
    at = []
    for i, line in enumerate(lines):
        bare = gsjs.trim(re.sub(r":$", "", line))
        if line[-1:] == ":" and bare in ISP_CONTACT_LABELS:
            at.append((i, bare))
    out: dict[str, str] = {}
    for n, (i, label) in enumerate(at):
        if label in out:
            continue
        stop = at[n + 1][0] if n + 1 < len(at) else len(lines)
        vals = [v for v in lines[i + 1:stop] if v]
        out[label] = gsjs.trim(" ".join(vals[:1] if label in ISP_ONE_LINE else vals))
    return out


def isp_home_address(block: Any) -> str | None:
    """ispDemographics_'s home_address; None when the plan has no contact page."""
    if not gsjs.or_text(block):
        return None
    lad = _ladder(block)
    street = lad.get("Address") or ""
    csz = (lad.get("City, State, Zip") or "").replace(" ,", ",", 1)
    home = ", ".join(x for x in (street, csz) if x)
    return re.sub(r",$", "", gsjs.trim(re.sub(r"[" + _JS_WS + r"]+", " ", home)))


def ist_list(raw: Any, key: str) -> list[str]:
    """istCfgList_ for the two non-person lists: the cell's usable entries, else the shipped ones."""
    def bits(v: Any) -> list[str]:
        return [b for b in (gsjs.trim(x) for x in re.split(r"[,;\n]+", gsjs.or_blank(v))) if b]

    least = 4 if key == "ist_non_person_contains" else 0
    entries = bits(raw)
    kept = [e for e in entries if not (least and len(e) < least)]
    value = ", ".join(kept) if kept else IST_NON_PERSON_SHIPPED[key]
    return bits(value) or bits(IST_NON_PERSON_SHIPPED[key])


class Reads:
    """One request's sources, each read once — LOCATION_PACK_MEMO_ for every read, not only the pack."""

    def __init__(self, db: hubdb.HubDb, drive: Any = None, now: datetime | None = None) -> None:
        self.db = db
        self.drive = drive
        self.now = now or datetime.now(timezone.utc)
        self.memo: dict[str, Any] = {}

    def once(self, name: str, read: Callable[[], Any]) -> Any:
        if name not in self.memo:
            self.memo[name] = read()
        return self.memo[name]

    def today(self) -> str:
        return gsjs.today_ny(self.now)

    def prop_book(self, prop: str, fallback: str) -> str:
        return self.db.prop(prop) or fallback

    def tab_of(self, sheet_id: str, tab: str, missing: str) -> hubdb.TabRef | None:
        """A book's tab; a book the database does not hold is not Apps Script's failure to copy."""
        ref = self.db.tab(sheet_id, tab)
        if ref is None and self.db.book(sheet_id) is None:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {missing}")
        self.db.note_book(sheet_id)
        return ref

    # -- the stores --
    def house_types(self) -> dict[str, str]:
        """code → the house's type (app.house_types, the Hub's own table); none answering is no type, never a fault."""
        def read() -> dict[str, str]:
            try:
                return {str(code).upper(): text(kind) for code, kind in self.db.query(HOUSE_TYPES_SQL)}
            except hubdb.Unreadable:
                return {}
        return self.once("house_types", read)

    def house_type(self, code: Any) -> str:
        return self.house_types().get(str(code or "").strip().upper(), "")

    def homes(self) -> list[dict]:
        def read() -> list[dict]:
            import house_tables as HT  # noqa: PLC0415 - it imports this module
            sid = self.prop_book(ENTITIES_PROP, ENTITIES_FALLBACK)
            # the registry as it stands: its own table once kept there
            ref = HT.tab_of(self, sid, HOMES_TAB, "the house registry")
            if ref is None:
                raise RuntimeError("the registry has no " + HOMES_TAB + " tab")
            out = []
            for r in self.db.locations_rows(ref):
                edit = {f: text(r.get(f)) for f in (*HOUSE_FIELDS, "abbreviation", "thumbnail_url")}
                h = {"code": home_code(r.get("abbreviation"), r.get("home_name")), "home_name": text(r.get("home_name")),
                     "address": text(r.get("address")), "region": text(r.get("region")),
                     "telephone": text(r.get("telephone")), "manager_name": text(r.get("manager_name")),
                     "manager_phone": text(r.get("manager_phone")), "calendar_link": first_url(r.get("calendar_link")),
                     "thumbnail_url": first_url(r.get("thumbnail_url")), "edit": edit}
                if h["code"]:
                    out.append(h)
            return out
        return self.once("homes", read)

    def policies(self) -> list[dict]:
        def read() -> list[dict]:
            sid = self.prop_book(COMMON_PROP, COMMON_FALLBACK)
            import house_tables as HT  # noqa: PLC0415 - it imports this module
            ref = HT.tab_of(self, sid, POLICIES_TAB, "the company policies")
            if ref is None:
                raise RuntimeError("the common data book has no " + POLICIES_TAB + " tab")
            out = []
            for r in self.db.locations_rows(ref):
                title, url = text(r.get("Title")), first_url(r.get("Link"))
                if title and url:
                    out.append({"title": title, "url": url, "drive_id": drive_id(url)})
            return out
        return self.once("policies", read)

    def hub_rows(self, tab: str) -> list[dict]:
        """listRows_ of a hub tab (readAll_); a tab not there reads as none, as sheetFor_ makes it; a tab an app keeps
        in Postgres read from there once uploaded."""
        import sheet_resources  # noqa: PLC0415 — it imports this module
        kept = sheet_resources.kept_rows(self, tab)
        if kept is not None:
            return kept
        res = self.db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        return self.db.sheetdb_rows(res.ref)

    def clients_derived(self) -> list[dict]:
        """clientsDerived_(null), the columns Locations reads: the plans, the Hub's clients rows layered on top."""
        def read() -> list[dict]:
            derived: dict[str, dict] = {}
            for r in self.hub_rows("isps"):
                key = gsjs.trim(gsjs.or_text(r.get("client_key")))
                if not key:
                    continue
                row = {"id": "CLI_" + key, "name": gsjs.or_text(r.get("client_name") or key), "client_key": key,
                       "isp_year": gsjs.or_text(r.get("isp_year")), "status": "active", "source": "isp"}
                home = isp_home_address(r.get("contact_block"))
                if home is not None:
                    row["home_address"] = home
                derived[key] = row
            for r in self.hub_rows("clients"):
                key = gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))
                if not key:
                    continue
                merged = dict(derived.get(key) or {})
                for k2, v in r.items():
                    if gsjs.or_text(v) != "":
                        merged[k2] = v
                if not merged.get("id"):
                    merged["id"] = gsjs.or_text(r.get("id") or "CLI_" + key)
                cleared = merged.get("cleared_fields")
                marked = "" if cleared is None or isinstance(cleared, (dict, list)) else gsjs.js_str(cleared)
                for col in (c.strip() for c in marked.split(",")):
                    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", col) and col in CP_SAVE_FIELDS:
                        for c in CP_FIELD_NAMES.get(col, (col,)):
                            merged[c] = ""
                derived[key] = merged
            out = list(derived.values())
            out.sort(key=by_name(lambda c: gsjs.js_str(c.get("name"))))
            return out
        return self.once("clients_derived", read)

    def client_rows(self) -> list[dict]:
        """locationsClientRows_: identity only, never a clinical field."""
        def read() -> list[dict]:
            return [{"client_key": gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name")),
                     "name": text(c.get("name")), "house": text(c.get("house")),
                     "home_address": text(c.get("home_address")), "status": text(c.get("status")),
                     "isp_year": text(c.get("isp_year"))} for c in self.clients_derived()]
        return self.once("client_rows", read)

    def non_person(self) -> tuple[list[str], list[str]]:
        def read() -> tuple[list[str], list[str]]:
            res = self.db.resolve(IST_CONFIG_TAB)
            cfg: dict[str, str] = {}
            for r in (self.db.sheetdb_rows(res.ref) if res.ref else []):
                k = gsjs.trim(gsjs.or_text(r.get("key")))
                if k:
                    cfg[k] = gsjs.or_blank(r.get("value"))
            return (ist_list(cfg.get("ist_non_person_names"), "ist_non_person_names"),
                    ist_list(cfg.get("ist_non_person_contains"), "ist_non_person_contains"))
        return self.once("non_person", read)

    def is_person(self, name: Any) -> bool:
        """locationsIsPerson_ through istNotAPerson_."""
        n = gsjs.trim(gsjs.or_text(name))
        if not n or not re.search(r"[a-z]", n, re.I):
            return False
        exact, inside = self.non_person()
        up = n.upper()
        if any(up == gsjs.trim(e).upper() for e in exact):
            return False
        return not any(gsjs.trim(w).upper() and gsjs.trim(w).upper() in up for w in inside)

    def calendar(self) -> dict[str, Any]:
        """locationsCalendar_: the hotline's Calendar Archive, or why it could not be read."""
        def read() -> dict[str, Any]:
            def rows() -> dict[str, Any]:
                sid = self.db.prop("HOTLINE_CALENDAR_ID")
                ref = self.tab_of(sid, HOTLINE_CALENDAR_TAB, "the Calendar Archive") if sid else None
                if ref is None:
                    raise RuntimeError("the hotline calendar has no tab named " + HOTLINE_CALENDAR_TAB)
                return {"values": self.db.grid(ref), "tz": "America/New_York"}
            got, why = _soft(rows)
            return {"cal": got, "why": ""} if got else {"cal": None, "why": f"the Calendar Archive could not be read ({why})"}
        return self.once("calendar", read)

    def punches(self) -> dict[str, Any]:
        """locationsPunches_: the PSI punch house's rows, or why."""
        def read() -> dict[str, Any]:
            if not self.db.house_moved(PSI_PUNCHES_FULL_TAB):
                return {"rows": None, "why": "the PSI punch house is not declared"}

            def rows() -> list[dict]:
                res = self.db.resolve(PSI_PUNCHES_FULL_TAB)
                if res.ref is None:
                    if not res.book_known:
                        raise hubdb.Unreadable("asa-hub-db holds no copy of the PSI punch house")
                    raise RuntimeError("Cannot read properties of null (reading 'getDataRange')")
                grid = self.db.grid(res.ref)
                header = [gsjs.js_str(h) for h in grid[0]]
                out = []
                for r, line in enumerate(grid[1:], start=1):
                    if all(c == "" or c is None for c in line):
                        continue
                    o: dict[str, Any] = {"_row": r}
                    for h, v in zip(header, line):
                        if h != "":
                            o[h] = v
                    out.append(o)
                return out
            got, why = _soft(rows)
            return {"rows": got, "why": ""} if got is not None else \
                {"rows": None, "why": f"the PSI punches could not be read ({why})"}
        return self.once("punches", read)

    def ist_rows(self) -> list[dict]:
        """listRows_('istRecords') from its owner, IST Records (app/ist.py): Postgres once the app is Python's."""
        import ist  # noqa: PLC0415 - IST Records imports this module
        return self.once("ist_rows", lambda: ist.records(self))

    def staff_off_tab(self) -> hubdb.Resolved:
        """The staff-off list: a tab of the Client Entities book, with the rows kept edits append before it exists."""
        sid = self.prop_book(ENTITIES_PROP, ENTITIES_FALLBACK)
        ref = self.db.tab(sid, STAFF_OFF_TAB)
        virtual = getattr(hubdb.OWN.get(), "virtual", None)
        if ref is None and virtual is not None:
            ref = virtual(sid, STAFF_OFF_TAB)
        self.db.note_book(sid)
        return hubdb.Resolved(sid, (STAFF_OFF_TAB,), ref, False, self.db.book(sid) is not None)

    def staff_off(self, code: str) -> dict[str, dict]:
        """locationsStaffOff_: the last row for a person decides; none for a tab that is not there."""
        res = self.staff_off_tab()
        out: dict[str, dict] = {}
        for r in self.db.locations_rows(res.ref):
            if house_code(r.get("house")) != code:
                continue
            k = name_key(r.get("staff_key") or r.get("name"))
            if not k:
                continue
            if gsjs.trim(gsjs.or_text(r.get("state"))).lower() == "off":
                out[k] = {"name": r.get("name") or "", "by": r.get("by") or "", "at": r.get("at") or ""}
            else:
                out.pop(k, None)
        return out

    def estate(self, resource: str) -> list[dict]:
        """estateRows_: the estate book's tab, header-keyed; no tab, no rows (its own table once the book is kept)."""
        import house_tables as HT  # noqa: PLC0415 - it imports this module

        def read() -> list[dict]:
            prop, tab = ESTATE_SOURCES[resource]
            sid = self.db.prop(prop)
            if not sid:
                raise hubdb.Unreadable(f"no {prop} is declared in the depot")
            return self.db.estate_rows(HT.tab_of(self, sid, tab, f"the estate's {tab}"))
        return self.once("estate:" + resource, read)

    def config(self) -> dict[str, str]:
        # the copy's config, each Settings › Editions save kept in app.edits laid over it
        return self.once("config", lambda: editions.laid_config(self.db, self.db.hiring_config()))

    # -- the scope's sources --
    def users(self) -> list[dict]:
        import house_tables as HT  # noqa: PLC0415 - it imports this module
        # the accounts as they stand: their own table once kept there
        return self.once("users", lambda: self.db.normalized_rows(HT.where(self, "users").ref))

    def app_rules(self) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            import house_tables as HT  # noqa: PLC0415 - it imports this module
            # App Control's rows as they stand: their own tables once kept there
            badges = HT.where(self, "app_badge_access")
            tenants = HT.where(self, "app_tenant_access")
            if badges.ref is None:
                raise hubdb.Unreadable("App Control's badge rows are not in asa-hub-db")
            return sc.app_rules(self.db.normalized_rows(badges.ref), self.db.normalized_rows(tenants.ref))
        return self.once("app_rules", read)

    def houses_of(self, keys: list[str]) -> dict[str, Any]:
        """hubViewerHousesOf_: the houses these clients live in now."""
        out: dict[str, Any] = {"codes": [], "why": []}
        rows, why = _soft(self.client_rows)
        if rows is None:
            out["why"].append(f"The client records could not be read ({why}).")
            return out
        homes, why_h = _soft(self.homes)
        if homes is None:
            out["why"].append(f"The house registry could not be read ({why_h}).")
        out["codes"] = viewer_houses_from(keys, rows, homes)
        return out

    # ---- an SSA or a FAMILY account (ViewerScope.gs): the clients whose records name it, on either side --------

    def viewer_row_of(self, uid: Any) -> dict | None:
        """hubViewerRowOf_: the account's own live users row; None when there is none. Raises when unreadable."""
        want = gsjs.str_(uid)
        return next((u for u in self.users() or []
                     if gsjs.str_(u.get("userid")) == want and not gsjs.str_(u.get("mergedinto"))), None)

    def viewer_named(self, user: dict) -> dict[str, Any]:
        """hubViewerNamed_: the display name an account may be matched by, off its own row: {known, name, self, why}."""
        try:
            row = self.viewer_row_of((user or {}).get("id"))
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: a name that cannot be read matches nothing
            return {"known": False, "name": "", "self": False, "why": sc.why_of("The accounts", exc)}
        if not row:
            return {"known": False, "name": "", "self": False,
                    "why": "This account's own row could not be found, so its name matches nothing."}
        return {"known": True, "name": gsjs.str_(row.get("displayname")),
                "self": gsjs.str_(row.get("nameby")).strip().lower() == "self", "why": ""}

    def viewer_others(self, user: dict) -> list[dict]:
        """hubViewerOthers_: the live accounts other than this one."""
        uid = gsjs.str_((user or {}).get("id"))
        return [u for u in self.users() or []
                if u and gsjs.str_(u.get("userid")) != uid and not gsjs.str_(u.get("mergedinto"))
                and gsjs.str_(u.get("active")).upper() not in ("FALSE", "0", "NO")]

    def viewer_ssa_by_name(self, user: dict, idx: dict[str, Any]) -> dict[str, Any]:
        """hubViewerSsaByName_: an SSA by its name when exactly one SSA on fully read records carries it."""
        import clients as C  # noqa: PLC0415 - it imports this module
        import ssa as SSA  # noqa: PLC0415 - it imports this module
        named = self.viewer_named(user)
        if not named["known"]:
            return {"is": "unknown", "why": named["why"]}
        if idx.get("degraded"):
            return {"is": "unknown", "why": "Not every client record could be read, so whether this account is an SSA "
                                            "cannot be told."}
        key = SSA.key_of(named["name"])
        s = (idx.get("ssas") or {}).get(key) if key else None
        if not s:
            return {"is": "family"}

        def no(why: str) -> dict[str, Any]:
            return {"is": "unknown", "why": why + ", so it is not matched by name and is shown nothing."}

        if named["self"]:
            return no("This account chose its name itself and an SSA on the records carries it")
        mails = s.get("emails") or []
        if len(mails) > 1 or len(s.get("phones") or []) > 1:
            return no("More than one SSA on the records may carry this name")
        try:
            others = self.viewer_others(user)
        except Exception as exc:  # noqa: BLE001
            return {"is": "unknown", "why": sc.why_of("The accounts", exc)}
        fold = key[4:]
        if any(name_key(u.get("displayname")) == fold or (mails and gsjs.str_(u.get("email")).lower() == mails[0])
               for u in others):
            return no("Another account carries this name or the SSA's e-mail on the records")
        return {"is": "ssa", "key": key,
                "clients": [c.get("client_key") for c in s.get("clients") or [] if C.client_live(c)]}

    def viewer_ssa_match(self, user: dict) -> dict[str, Any]:
        """hubViewerSsaMatch_ (FAIL-CLOSED): whether an account is the SSA the client records name — by the e-mail
        they give their SSA, else by its name — and then the scope of its live clients."""
        import clients as C  # noqa: PLC0415 - it imports this module
        import ssa as SSA  # noqa: PLC0415 - it imports this module
        try:
            idx = SSA.index(self)
        except Exception as exc:  # noqa: BLE001
            return {"is": "unknown", "why": sc.why_of("The SSA records", exc)}
        email = gsjs.str_((user or {}).get("email")).lower()
        keys: set[str] = set()
        clients: set[str] = set()
        stale = False
        for k, s in (idx.get("ssas") or {}).items():
            for c in s.get("clients") or []:
                if "ssa_email" not in c:
                    stale = True
                    continue
                if not email or c.get("ssa_email") != email:
                    continue
                keys.add(k)
                # a client set inactive, or archived, is no longer reached; the SSA keeps its live ones
                if C.client_live(c):
                    clients.add(gsjs.str_(c.get("client_key")))
        if stale:
            return {"is": "unknown", "why": "The SSA records are being refreshed, so nothing is shown yet."}
        if not keys:
            named = self.viewer_ssa_by_name(user, idx)
            if named["is"] != "ssa":
                return named
            keys.add(named["key"])
            clients.update(gsjs.str_(k) for k in named["clients"])
        out = sc.scope_of("ssa")
        out["ssa_keys"] = sorted(keys)
        out["client_keys"] = sorted(k for k in clients if k)
        houses = self.houses_of(out["client_keys"])
        out["house_codes"] = houses["codes"]
        out["why"] = " ".join(houses["why"] + (list(idx.get("why") or []) if idx.get("degraded") else []))
        return {"is": "ssa", "scope": out}

    def viewer_ssas_of(self, keys: list[str]) -> dict[str, Any]:
        """hubViewerSsasOf_: the SSAs whose records name these clients while they are live."""
        import clients as C  # noqa: PLC0415 - it imports this module
        import ssa as SSA  # noqa: PLC0415 - it imports this module
        out: dict[str, Any] = {"keys": [], "why": []}
        want = {gsjs.str_(k) for k in keys or [] if k}
        try:
            idx = SSA.index(self)
        except Exception as exc:  # noqa: BLE001
            out["why"].append(sc.why_of("The SSA records", exc))
            return out
        out["keys"] = sorted(k for k, s in (idx.get("ssas") or {}).items()
                             if any(C.client_live(c) and gsjs.str_(c.get("client_key")) in want
                                    for c in s.get("clients") or []))
        return out

    @staticmethod
    def viewer_family_key(name: Any) -> str:
        """hubViewerFamilyKey_: 'fam_' + the folded name, as the Families app keys a family member."""
        import clients as C  # noqa: PLC0415 - it imports this module
        n = text(C.guardian_display_name(name), 120)
        if not n or not C.guardian_is_person(n):
            return ""
        fold = name_key(n)
        return "fam_" + fold if len(fold) >= 3 else ""

    def viewer_family_of(self, v: dict[str, Any]) -> dict[str, Any]:
        """hubViewerFamilyOf_: the family record that is a guardian's own — the one its ward's record names, when the
        account carries that name."""
        import clients as C  # noqa: PLC0415 - it imports this module
        named = self.viewer_named(v["user"])
        if not named["known"]:
            return {"keys": [], "why": named["why"]}
        if named["self"]:
            return {"keys": [], "why": "This account chose its name itself, so no family record is its own."}
        mine = self.viewer_family_key(named["name"])
        if not mine:
            return {"keys": [], "why": "This account's name is not a family member's name, so no family record is "
                                       "its own."}
        try:
            row = next((c for c in C.derived(self) or [] if gsjs.str_(c.get("client_key")) == gsjs.str_(v["client_key"])),
                       None)
            raw = text((row or {}).get("guardianName") or (row or {}).get("guardian_name"), 200) if row else ""
            if row and not raw:
                m = (C.master_index(self).get("rows") or {}).get(name_key(row.get("name")))
                raw = text((m.get("fields") or {}).get("guardian_name"), 200) if m and not m.get("ambiguous") else ""
            ward = self.viewer_family_key(raw) if row else ""
        except Exception as exc:  # noqa: BLE001
            return {"keys": [], "why": sc.why_of("The ward's record", exc)}
        if ward != mine:
            return {"keys": [], "why": "The ward's record does not name this account as its guardian, so no family "
                                       "record is its own."}
        return {"keys": [mine], "why": ""}

    def viewer_guardian_wards(self, user: dict) -> dict[str, Any]:
        """An account with no client linked: the live clients whose own record gives this account's e-mail as their
        guardian's — exactly, never by name (FAIL-CLOSED)."""
        import clients as C  # noqa: PLC0415 - it imports this module
        email = gsjs.str_((user or {}).get("email")).strip().lower()
        if not email:
            return {"keys": [], "why": ""}
        try:
            rows = C.derived(self) or []
        except Exception as exc:  # noqa: BLE001
            return {"keys": [], "why": sc.why_of("The client records", exc)}
        keys = sorted({gsjs.str_(c.get("client_key")) for c in rows
                       if c.get("client_key") and gsjs.str_(c.get("guardian_email")).strip().lower() == email
                       and C.client_live(c)})
        return {"keys": keys, "why": ""}

    def viewer_live_keys(self, keys: list[str]) -> dict[str, Any]:
        """The client keys among these whose record is live (FAIL-CLOSED: none when the records cannot be read)."""
        import clients as C  # noqa: PLC0415 - it imports this module
        want = {gsjs.str_(k) for k in keys or [] if k}
        try:
            rows = C.derived(self) or []
        except Exception as exc:  # noqa: BLE001
            return {"keys": [], "why": sc.why_of("The client records", exc)}
        return {"keys": sorted({gsjs.str_(c.get("client_key")) for c in rows
                                if gsjs.str_(c.get("client_key")) in want and C.client_live(c)}), "why": ""}

    def scope_sources(self) -> sc.ScopeSources:
        return sc.ScopeSources(users=self.users, rules=self.app_rules, config=self.config, houses_of=self.houses_of,
                               ssa_match=self.viewer_ssa_match, ssas_of=self.viewer_ssas_of,
                               family_of=self.viewer_family_of, guardian_wards=self.viewer_guardian_wards,
                               family_key_of=self.viewer_family_key, named=self.viewer_named,
                               live_keys=self.viewer_live_keys)

    def viewer_days(self) -> int:
        return sc.viewer_days(self.db.prop("HUB_VIEWER_RECENT_DAYS"))

    # -- Drive --
    def need_drive(self) -> Any:
        if self.drive is None or not getattr(self.drive, "available", False):
            raise Defer("Drive is not reachable from here (no Google credentials)")
        return self.drive


def viewer_houses_from(keys: list[str], rows: list[dict], homes: list[dict] | None) -> list[str]:
    """hubViewerHousesFrom_: the sorted house codes these clients live in now."""
    want = {k for k in keys or [] if k}
    own = [c for c in rows or [] if c.get("client_key") in want and client_current(c)]
    codes: dict[str, bool] = {}
    for c in own:
        hc = house_code(c.get("house"))
        if hc:
            codes[hc] = True
    for h in homes or []:
        if h and h.get("code") and h["code"] not in codes and clients_at(h["code"], h, own):
            codes[h["code"]] = True
    return sorted(codes)


# ---- the house -------------------------------------------------------------

def house(reads: Reads, raw: Any, empty: bool = False) -> dict[str, Any]:
    """locationsHouse_: 400 for a malformed code, 404 for one neither the registry nor a client carries — or, for a
    read (`empty`), that house with nothing on file, so its screens draw empty instead of an error."""
    code = house_code(raw)
    if not code:
        return {"refused": {"status": 400, "message": "house: a house code, such as ABD1305."}}
    homes, why_h = _soft(reads.homes)
    homes_why = f"the house registry could not be read ({why_h})" if homes is None else ""
    clients, why_c = _soft(reads.client_rows)
    clients_why = f"the clients could not be read ({why_c})" if clients is None else ""
    clients = clients or []
    home = next((h for h in homes or [] if h["code"] == code), None)
    carried = any(house_code(c.get("house")) == code for c in clients)
    if not home and not carried:
        if homes is None:
            return {"refused": {"status": 503, "message": homes_why + ("; " + clients_why if clients_why else "") + "."}}
        if not empty:
            return {"refused": {"status": 404, "message": f'No house "{code}" is on the registry or on a client.'}}
    return {"code": code, "home": home, "homes": homes or [], "homes_why": homes_why, "all_clients": clients,
            "clients_why": clients_why, "clients": clients_at(code, home, clients)}


def client_list(ctx: dict) -> list[dict]:
    out = [{"client_key": c["client_key"], "name": c["name"]} for c in ctx["clients"]]
    out.sort(key=by_name(lambda c: c["name"]))
    return out


class Session:
    """One call: the reads, the viewer and the doors Locations.gs opens for them."""

    def __init__(self, reads: Reads, user: dict[str, Any] | None) -> None:
        self.reads = reads
        self.user = user

    def viewer(self) -> dict | None:
        """locationsViewer_: App Control's row for Locations; the scope, or None when it is closed."""
        gate = sc.profile_app_gate(APP_ID, self.user, self.reads.scope_sources())
        s = gate.get("scope") if gate.get("open") else None
        return s if s and s.get("kind") != "none" else None

    def read_door(self, payload: dict, empty: bool = False) -> dict[str, Any]:
        """locationsReadDoor_: the gate, then a narrowed viewer's own houses only; a read passes `empty`, so a house
        nothing is on file for answers empty (a write's door never does)."""
        s = self.viewer()
        if not s:
            return {"refused": unknown()}
        if narrowed(s) and (house_code(payload.get("house")) or "-") not in (s.get("house_codes") or []):
            return {"refused": unknown()}
        ctx = house(self.reads, payload.get("house"), empty)
        if ctx.get("refused"):
            return {"refused": ctx["refused"]}
        return {"ctx": ctx, "scope": s}

    def editions(self) -> list[str]:
        if sc.is_real_master(self.user):
            return list(EDITION.values())
        return sc.editions_for(self.user or {}, APP_ID, self.reads.config())


# ---- the parts, uncut --------------------------------------------------------

def overview_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    got = reads.calendar()
    mg = managers(got["cal"]["values"], ctx["code"], reads.today()) if got["cal"] else {"anchor": None, "current": []}
    h = ctx["home"] or {}
    kind = reads.house_type(ctx["code"])
    edit = {**(ctx["home"].get("edit") or {}), "type": kind} if ctx["home"] else None
    return {"house": {"code": ctx["code"], "home_name": h.get("home_name") or "", "address": h.get("address") or "",
                      "region": h.get("region") or "", "phone": h.get("telephone") or "",
                      "calendar_link": h.get("calendar_link") or "", "thumbnail_url": h.get("thumbnail_url") or "",
                      "type": kind or None, "on_registry": bool(ctx["home"])},
            "edit": edit,
            "registry_why": "" if ctx["home"] else (ctx["homes_why"] or "the registry has no row for " + ctx["code"]),
            "manager": mg["anchor"], "managers": mg["current"],
            "manager_why": "" if mg["anchor"] else (got["why"] or "the Calendar Archive has no ** row for " + ctx["code"]),
            "registry_manager": {"name": h.get("manager_name") or "", "phone": h.get("manager_phone") or ""},
            "clients": client_list(ctx), "degraded": not got["cal"] or bool(ctx["homes_why"])}


def staff_merge(reads: Reads, code: str, cal: dict | None, psi_rows: list[dict] | None, today_iso: str,
                hm_keys: dict | set) -> dict[str, Any]:
    """locationsStaffMerge_: everyone on record at one house, folded by name, first and latest day with sources."""
    people: dict[str, dict] = {}
    leads: set[str] = set()
    counts = {"archive": 0, "punches": 0}
    lead_since = gsjs.day_shift(today_iso, -LEAD_DAYS)

    def note(name: str, day: str, source: str) -> None:
        k = name_key(name)
        if not k:
            return
        p = people.get(k)
        if p is None:
            p = people[k] = {"name": name, "name_day": day, "first_day": day, "first_source": source, "last_day": day,
                             "last_source": source, "days": {}, "sources": {}}
        if day < p["first_day"] or (day == p["first_day"] and source == "punches"):
            p["first_day"], p["first_source"] = day, source
        if day > p["last_day"] or (day == p["last_day"] and source == "punches"):
            p["last_day"], p["last_source"] = day, source
        if day >= p["name_day"]:
            p["name"], p["name_day"] = name, day
        p["days"][day] = True
        p["sources"][source] = True
        counts[source] += 1

    if cal and cal.get("values"):
        values = cal["values"]
        head = [gsjs.trim(gsjs.or_text(x)).lower() for x in (values[0] or [])]

        def col(n: str, fb: int) -> int:
            return head.index(n) if n in head else fb

        c_loc, c_name, c_des, c_date = col("location", 0), col("employee", 1), col("designation", 2), col("date", 4)
        for line in values[1:]:
            line = line or []

            def at(j: int) -> Any:
                return line[j] if j < len(line) else None

            if code_of(at(c_loc)) != code:
                continue
            day = broadcast_day(at(c_date), cal.get("tz"))
            if not day or day > today_iso:
                continue
            name = text(at(c_name))
            if not reads.is_person(name):
                continue
            note(name, day, "archive")
            if gsjs.trim(gsjs.or_text(at(c_des))) == "***" and day >= lead_since:
                leads.add(name_key(name))
    if psi_rows:
        places = psi_places(psi_rows)
        for p in psi_rows:
            c = code_of(p.get("house")) or places.get(loc_key(p.get("location_name"))) or ""
            if c != code:
                continue
            day = broadcast_day(p.get("date_iso")) or broadcast_day(p.get("date_service"))
            if not day or day > today_iso:
                continue
            who = text(p.get("employee")) or text(gsjs.or_text(p.get("firstname")) + " " + gsjs.or_text(p.get("lastname")))
            if not reads.is_person(who):
                continue
            note(who, day, "punches")
    hm = hm_keys or {}
    staff = [{"key": k, "name": p["name"], "first_day": p["first_day"], "first_source": p["first_source"],
              "last_day": p["last_day"], "last_source": p["last_source"], "shifts": len(p["days"]),
              "sources": [s for s in ("archive", "punches") if p["sources"].get(s)], "hm": k in hm, "lead": k in leads}
             for k, p in people.items()]
    staff.sort(key=functools.cmp_to_key(lambda a, b: (1 if a["last_day"] < b["last_day"] else -1)
                                        if a["last_day"] != b["last_day"] else locale_cmp(a["name"], b["name"])))
    return {"staff": staff, "counts": counts}


def staff_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    today = reads.today()
    got, psi = reads.calendar(), reads.punches()
    mg = managers(got["cal"]["values"], ctx["code"], today) if got["cal"] else {"anchor": None, "current": []}
    hm_keys = {name_key(r["name"]) for r in mg["current"]}
    if mg["anchor"]:
        hm_keys.add(name_key(mg["anchor"]["name"]))
    merged = staff_merge(reads, ctx["code"], got["cal"], psi["rows"], today, hm_keys)
    clients = client_list(ctx)
    ist, why_i = _soft(lambda: ist_index(reads.ist_rows(), ctx["code"], clients))
    ist_why = f"the IST records could not be read ({why_i})" if ist is None else ""
    off, why_o = _soft(lambda: reads.staff_off(ctx["code"]))
    off_why = f"who was taken off this house could not be read ({why_o})" if off is None else ""
    ist, off = ist or {}, off or {}
    removed, kept = [], []
    for p in merged["staff"]:
        if p["key"] in off:
            removed.append({"key": p["key"], "name": p["name"], "by": off[p["key"]]["by"], "at": off[p["key"]]["at"]})
        else:
            kept.append(p)
    for p in kept:
        own = ist.get(p["key"]) or {}
        p["ist"] = [ist_cell(own.get(gsjs.or_text(c.get("client_key") or name_key(c.get("name")))), c) for c in clients]
    return {"house": ctx["code"], "clients": clients, "staff": kept, "ist_why": ist_why, "removed": removed,
            "removed_why": off_why,
            "sources": {"archive": {"readable": bool(got["cal"]), "why": got["why"], "rows": merged["counts"]["archive"]},
                        "punches": {"readable": psi["rows"] is not None, "why": psi["why"],
                                    "rows": merged["counts"]["punches"]}},
            "degraded": not got["cal"] or psi["rows"] is None or bool(ist_why) or bool(off_why)}


def repairs_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    index = addr_index(ctx["homes"], ctx["all_clients"])
    return {"rows": repairs_for(reads.estate("workOrders"), ctx["code"], index)}


def incidents_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    clients = client_list(ctx)
    rows = incidents_for(reads.estate("uiIncidents"), clients)
    cats = sorted({c for r in rows for c in r["categories"]})
    return {"house": ctx["code"], "clients": clients, "categories": cats, "rows": rows}


def supplies_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    index = addr_index(ctx["homes"], ctx["all_clients"])

    def assets_read() -> list[dict]:
        out = []
        for r in reads.estate("houseInventory"):
            if addr_owner(index, r.get("address"))["code"] != ctx["code"]:
                continue
            out.append({"id": cell(r.get("id")), "item": cell(r.get("item")), "address": cell(r.get("address")),
                        "cost_to_replace": cell(r.get("cost_to_replace")),
                        "current_condition": cell(r.get("current_condition")),
                        "est_expiration_year": cell(r.get("est_expiration_year")),
                        "replacement_frequency": cell(r.get("replacement_frequency"))})
        return out

    assets, why_a = _soft(assets_read)
    assets_why = f"the House Inventory List could not be read ({why_a})" if assets is None else ""
    consumables, ledger_why, ready = [], "", False
    if not reads.db.house_moved(SUPPLY_TAB):
        ledger_why = "the " + SUPPLY_TAB + " house is not declared"
    else:
        ready = True
        res = reads.db.resolve(SUPPLY_TAB)
        got, why_l = _soft(lambda: supplies(reads.db.locations_rows(res.ref), ctx["code"], SUPPLY_ORDER_DAYS))
        if got is None:
            ledger_why = f"the supplies ledger could not be read ({why_l})"
        else:
            consumables = got
    # what this side's locationSupplyEdit takes: Apps Script's answer names none, and its screen offers the old fields
    return {"house": ctx["code"], "assets": assets or [], "assets_why": assets_why, "ledger_ready": ready,
            "ledger_why": ledger_why, "consumables": consumables, "order_days": SUPPLY_ORDER_DAYS,
            "degraded": bool(assets_why) or (bool(ledger_why) and ready),
            "entry_fields": list(SUPPLY_EDIT_FIELDS), "entry_remove": True}


def notes_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    res = reads.db.resolve(NOTES_TAB)
    names = {c["client_key"]: c["name"] for c in ctx["all_clients"] if c.get("client_key")}
    notes = []
    for r in reads.db.locations_rows(res.ref):
        if house_code(r.get("house")) != ctx["code"] or gsjs.or_text(r.get("state")).lower() == "removed":
            continue
        notes.append({"id": r.get("id") or "", "house": ctx["code"], "client_key": r.get("client_key") or "",
                      "client_name": names.get(r.get("client_key") or "") or "", "priority": r.get("priority") or "normal",
                      "details": r.get("details") or "", "state": r.get("state") or "open", "by": r.get("by") or "",
                      "at": r.get("at") or "", "state_by": r.get("state_by") or "", "state_at": r.get("state_at") or ""})
    notes.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
    # an existing tab with no row is not in the copy: the copy says what it holds
    return {"house": ctx["code"], "exists": res.ref is not None, "notes": notes,
            "open_count": sum(1 for n in notes if n["state"] == "open")}


def documents_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    """locationsDocumentsBuild_: each current client's ISP, the house guidebook folder, the company policies."""
    def read() -> dict[str, Any]:
        drive = reads.need_drive()
        isps = []
        for c in ctx["clients"]:
            doc, _w = _soft(lambda c=c: drive.isp_doc_for(reads, c["name"]))
            doc = doc or {"id": "", "name": "", "url": ""}
            isps.append({"client": c["name"], "client_key": c["client_key"], "isp_doc_url": doc.get("url") or "",
                         "isp_doc_name": doc.get("name") or "", "isp_doc_id": doc.get("id") or "",
                         "isp_year": c.get("isp_year") or ""})
        isps.sort(key=by_name(lambda d: d["client"]))
        guide, why_g = _soft(lambda: drive.guidebook(reads, ctx["code"]))
        if guide is None:
            guide = {"guidebook": None, "why": f"the houses room could not be read ({why_g})", "failed": True}
        policies, why_p = _soft(reads.policies)
        policies_why = f"the company policies could not be read ({why_p})" if policies is None else ""
        return {"house": ctx["code"], "isps": isps, "guidebook": guide["guidebook"], "guidebook_why": guide["why"],
                "policies": policies or [], "policies_why": policies_why,
                "degraded": bool(guide.get("failed")) or bool(policies_why)}
    return reads.once("documents:" + ctx["code"], read)


def guidebook_part(reads: Reads, ctx: dict) -> dict[str, Any]:
    docs = documents_part(reads, ctx)
    return {"house": ctx["code"], "guidebook": docs["guidebook"], "guidebook_why": docs["guidebook_why"],
            "degraded": bool(docs.get("degraded"))}


# ---- the cuts ----------------------------------------------------------------

def overview_cut(data: dict, scope: dict) -> dict:
    if not narrowed(scope):
        return data
    out = copy(data)
    out["clients"] = mine(data.get("clients"), scope)
    return out


def staff_visible(reads: Reads, codes_in: list[str]) -> dict[str, Any]:
    """hubStaffVisibleForHouses_: folded staff names with an IST row at these houses, or a shift or punch lately."""
    codes = sorted({house_code(c) for c in codes_in if house_code(c)})
    if not codes:
        return {"keys": [], "why": ""}
    n = reads.viewer_days()
    today = reads.today()
    since = gsjs.day_shift(today, -n)
    seen: set[str] = set()
    why: list[str] = []

    def ist_names() -> None:
        for r in reads.ist_rows() or []:
            if house_code(r.get("house")) not in codes:
                continue
            nm = text(r.get("staffName"))
            k = name_key(nm) if reads.is_person(nm) else ""
            if k:
                seen.add(k)

    _ok, why_i = _soft(ist_names)
    if why_i:
        why.append(f"The IST records could not be read ({why_i}).")
    cal, psi = reads.calendar(), reads.punches()

    def said(s: str) -> str:
        s = s or "a source could not be read"
        return s[:1].upper() + s[1:] + "."

    if not cal["cal"]:
        why.append(said(cal["why"]))
    if psi["rows"] is None:
        why.append(said(psi["why"]))
    for code in codes:
        for p in staff_merge(reads, code, cal["cal"], psi["rows"], today, {})["staff"]:
            if p["last_day"] >= since:
                seen.add(p["key"])
    return {"keys": sorted(seen), "why": " ".join(why)}


def staff_cut(reads: Reads, data: dict, scope: dict, code: str) -> dict:
    """locationsStaffCut_: a narrowed viewer sees the IST cells of its own clients alone."""
    if not narrowed(scope):
        return data
    is_cut = cut_viewer(scope)
    seen = {"keys": [], "why": ""}
    if is_cut:
        got, why = _soft(lambda: staff_visible(reads, [code]))
        seen = got if got is not None else {"keys": [], "why": f"Who worked here could not be read ({why})."}
    shown, own = set(seen["keys"] or []), set(scope.get("client_keys") or [])
    out = copy(data)
    out["clients"] = mine(data.get("clients"), scope)
    out["removed"] = []
    staff = []
    for p in data.get("staff") or []:
        if is_cut and p.get("key") not in shown:
            continue
        q = copy(p)
        cells = []
        for c in p.get("ist") or []:
            if c.get("client_key") not in own:
                continue
            if is_cut:
                c = copy(c)
                c["docUrl"] = c["docFileId"] = c["docAt"] = c["docBy"] = ""
            cells.append(c)
        q["ist"] = cells
        staff.append(q)
    out["staff"] = staff
    if not is_cut:
        return out
    out["visible_why"] = seen["why"] or ""
    if seen["why"]:
        out["degraded"] = True
    return out


def incidents_cut(data: dict, scope: dict) -> dict:
    if not narrowed(scope):
        return data
    out = copy(data)
    out["clients"] = mine(data.get("clients"), scope)
    out["rows"] = mine(data.get("rows"), scope)
    out["categories"] = sorted({c for r in out["rows"] for c in r.get("categories") or []})
    return out


def documents_cut(data: dict, scope: dict) -> dict:
    if not narrowed(scope):
        return data
    out = copy(data)
    out["isps"] = mine(data.get("isps"), scope)
    if not cut_viewer(scope):
        return out
    out["policies"] = [p for p in data.get("policies") or [] if name_key(p.get("title")) in CLIENT_POLICIES]
    out["guidebook"] = None
    out["guidebook_why"] = ""
    out["guidebook_withheld"] = True
    return out


def supplies_cut(data: dict, scope: dict) -> dict:
    if not narrowed(scope):
        return data
    out = copy(data)
    out["consumables"] = [dict(copy(c), entries=[]) for c in data.get("consumables") or []]
    return out


def notes_cut(data: dict, scope: dict) -> dict:
    if not narrowed(scope):
        return data
    keys = (scope or {}).get("client_keys") or []
    out = copy(data)
    out["notes"] = [n for n in data.get("notes") or [] if not gsjs.or_text(n.get("client_key"))
                    or gsjs.or_text(n.get("client_key")) in keys]
    out["open_count"] = sum(1 for n in out["notes"] if n.get("state") == "open")
    return out


def scope_house(code: str, homes: list[dict], clients: list[dict], scope: dict) -> dict[str, Any]:
    """locationsScopeHouse_: one house as the switcher lists it to a viewer held to houses."""
    home = next((h for h in homes or [] if h.get("code") == code), None)
    at = clients_at(code, home, clients)
    shown = sorted(({"client_key": c["client_key"], "name": c["name"]} for c in mine(at, scope)),
                   key=by_name(lambda c: c["name"]))
    h = home or {}
    return {"code": code, "home_name": h.get("home_name") or "", "address": h.get("address") or "",
            "region": h.get("region") or "", "thumbnail_url": h.get("thumbnail_url") or "",
            "on_registry": bool(home), "client_count": len(at), "clients": shown}


def client_views(reads: Reads, ctx: dict, parts: dict) -> dict[str, Any]:
    """locationsClientViews_: each current client whose own scope is this house alone, cut as that client reads it."""
    missing = [n for n in VIEW_SOURCES if not parts or not parts.get(n)]
    if missing:
        raise RuntimeError("not cut: " + ", ".join(missing) + " did not answer")
    if ctx["homes_why"] or ctx["clients_why"]:
        raise RuntimeError("not cut: " + (ctx["homes_why"] or ctx["clients_why"]))
    docs = documents_part(reads, ctx)
    out: dict[str, Any] = {}
    for c in ctx["clients"]:
        key = gsjs.or_text(c.get("client_key"))
        if not key or key in out:
            continue
        if ",".join(viewer_houses_from([key], ctx["all_clients"], ctx["homes"])) != ctx["code"]:
            continue
        s = {"kind": "client", "client_keys": [key], "house_codes": [ctx["code"]], "ssa_keys": [], "family_keys": [],
             "why": ""}
        out[key] = {"scope": {"kind": "client", "writes": False, "editions": [], "cut": True,
                              "houses": [scope_house(ctx["code"], ctx["homes"], ctx["all_clients"], s)], "why": ""},
                    "overview": overview_cut(parts["overview"], s), "staff": staff_cut(reads, parts["staff"], s, ctx["code"]),
                    "incidents": incidents_cut(parts["incidents"], s), "documents": documents_cut(docs, s)}
    return out


# ---- the actions ---------------------------------------------------------------

def location_scope(sess: Session, payload: dict) -> dict[str, Any]:
    s = sess.viewer()
    if not s:
        return unknown()
    is_cut = cut_viewer(s)
    data: dict[str, Any] = {"kind": s["kind"], "writes": sc.is_real_master(sess.user),
                            "editions": [] if is_cut else sess.editions(), "cut": is_cut, "houses": None, "why": ""}
    if not narrowed(s):
        return {"status": 200, "data": data}
    why = [s["why"]] if s.get("why") else []
    homes, why_h = _soft(sess.reads.homes)
    if homes is None:
        why.append(f"The house registry could not be read ({why_h}).")
    clients, why_c = _soft(sess.reads.client_rows)
    if clients is None:
        why.append(f"The clients could not be read ({why_c}).")
    data["houses"] = [scope_house(code, homes or [], clients or [], s) for code in s.get("house_codes") or []]
    data["why"] = " ".join(why)
    return {"status": 200, "data": data}


def location_overview(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    return {"status": 200, "data": overview_cut(overview_part(sess.reads, door["ctx"]), door["scope"])}


def location_staff(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    ctx = door["ctx"]
    data = staff_cut(sess.reads, staff_part(sess.reads, ctx), door["scope"], ctx["code"])
    if not narrowed(door["scope"]):
        # the IST form's trainees: every active employee, never shown to a narrowed viewer
        got, _why = _soft(lambda: active_employees(sess.reads))
        data = {**data, "employees": got or []}
    return {"status": 200, "data": data}


def active_employees(reads: Reads) -> list[str]:
    """Every active employee's name, as the Staff app reads People."""
    import staff as SP  # noqa: PLC0415 - People as the Staff app reads them
    return sorted({gsjs.str_(p.get("name")).strip() for p in SP._people(reads)
                   if SP._status_active(p) and gsjs.str_(p.get("name")).strip()}, key=lambda n: n.lower())


def location_incident_staff(sess: Session, payload: dict) -> dict[str, Any]:
    """locationIncidentStaff: every active employee's name, for an incident's Employees involved — to the master, a
    viewer who sees every house, or one an incident edition names (Locations' or Clients'); anyone else the 404."""
    import writes as W  # noqa: PLC0415 - it imports this module
    s = sess.viewer()
    files = sc.is_real_master(sess.user) or (s is not None and not narrowed(s)) or any(
        W.edition_allows(sess, e) for e in (EDITION["incidents"], EDITION["incidentsNew"],
                                             W.CLIENT_INCIDENT_EDITION["file"]))
    if not files:
        return unknown()
    got, why = _soft(lambda: active_employees(sess.reads))
    if got is None:
        return {"status": 503, "message": f"The staff could not be read ({why})."}
    return {"status": 200, "data": {"employees": got}}


def location_repairs(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    ctx = door["ctx"]
    rows_all, why = _soft(lambda: repairs_part(sess.reads, ctx))
    if rows_all is None:
        return {"status": 503, "message": f"The repair requests could not be read just now ({why})."}
    raw = payload.get("resolved")
    with_resolved = raw is True or bool(re.fullmatch(r"(true|1|yes|on)", gsjs.or_blank(raw), re.I))
    rows = [r for r in rows_all["rows"] if with_resolved or not r["resolved"]]
    open_n = sum(1 for r in rows_all["rows"] if not r["resolved"])
    return {"status": 200, "data": {"house": ctx["code"], "resolved": with_resolved, "rows": rows,
                                    "open_count": open_n, "resolved_count": len(rows_all["rows"]) - open_n}}


def location_incidents(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    data, why = _soft(lambda: incidents_part(sess.reads, door["ctx"]))
    if data is None:
        return {"status": 503, "message": f"The incidents could not be read just now ({why})."}
    return {"status": 200, "data": incidents_cut(data, door["scope"])}


def location_documents(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    return {"status": 200, "data": documents_cut(documents_part(sess.reads, door["ctx"]), door["scope"])}


def location_supplies(sess: Session, payload: dict) -> dict[str, Any]:
    """locationSupplies; while Settings › My Work hides House Supplies, the master's alone."""
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    if E.hides_for(sess).get("location_supplies"):
        return unknown()
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    return {"status": 200, "data": supplies_cut(supplies_part(sess.reads, door["ctx"]), door["scope"])}


def location_notes(sess: Session, payload: dict) -> dict[str, Any]:
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    if cut_viewer(door["scope"]):
        return unknown()
    data, why = _soft(lambda: notes_part(sess.reads, door["ctx"]))
    if data is None:
        return {"status": 503, "message": f"The house notes could not be read just now ({why})."}
    return {"status": 200, "data": notes_cut(data, door["scope"])}


def location_pack(sess: Session, payload: dict) -> dict[str, Any]:
    """locationPack: every part of one house no slice may carry, for the relay's service identity alone."""
    if not sess.user or not sess.user.get("is_service"):
        return unknown()
    reads = sess.reads
    ctx = house(reads, payload.get("house"))
    if ctx.get("refused"):
        return ctx["refused"]
    build = {"overview": lambda: overview_part(reads, ctx), "staff": lambda: staff_part(reads, ctx),
             "notes": lambda: notes_part(reads, ctx), "supplies": lambda: supplies_part(reads, ctx),
             "guidebook": lambda: guidebook_part(reads, ctx), "repairs": lambda: repairs_part(reads, ctx),
             "incidents": lambda: incidents_part(reads, ctx), "client_views": lambda: client_views(reads, ctx, parts)}
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    for name in PACK_PARTS:
        try:
            got, why = _soft(build[name])
        except Defer as e:
            # this part is Apps Script's; the screen reads it on its own
            status[name] = {"status": 503, "message": f"This part was not gathered in this pack; it is read on its own ({e})."}
            continue
        if got is None and why:
            status[name] = {"status": 503, "message": f"This part could not be read just now ({why})."}
        else:
            parts[name] = got
            status[name] = {"status": 200}
    return {"status": 200, "data": {"house": ctx["code"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


# ---- one document's bytes: locationDocFile, and the Clients doors that open theirs the same way -----------------------

def is_file_id(v: str) -> bool:
    return bool(_RE_FILE_ID.fullmatch(v))


def shown_type(mime: Any, name: Any) -> str:
    """complianceDocsShownType_: a PDF's or a picture's own type; a blank or generic type, the name's extension."""
    m = gsjs.trim(gsjs.str_(mime).lower().split(";")[0])
    if m in ("image/jpg", "image/pjpeg"):
        m = "image/jpeg"
    if m in DOC_TYPES.values():
        return m
    if m and m != "application/octet-stream":
        return ""
    hit = re.search(r"\.([A-Za-z0-9]{1,5})\Z", gsjs.trim(gsjs.str_(name)))
    return DOC_TYPES.get(hit.group(1).lower(), "") if hit else ""


def doc_bytes(reads: Reads, file_id: str) -> dict[str, Any]:
    """locationsDocBytes_: a PDF or a picture as itself, a Google file or an Office file as PDF."""
    drv = reads.need_drive()
    try:
        f = drv.file_meta(file_id)
        if f.get("trashed"):
            return {"refused": {"status": 404, "message": "The file is in the trash."}}
        name = str(f.get("name") or "")
        mime = str(f.get("mimeType") or "")
        if mime.startswith(dr.GOOGLE_NATIVE):
            data, exported = drv.export(file_id, "application/pdf", DOC_MAX_BYTES), True
        elif mime in OFFICE_TO_GOOGLE:
            data, exported = drv.office_pdf(file_id, OFFICE_TO_GOOGLE[mime], DOC_MAX_BYTES), True
            if data is None:
                return {"refused": {"status": 415, "message": "This document could not be turned into a PDF here."}}
        else:
            shown = shown_type(mime, name)
            if not shown:
                return {"refused": {"status": 415, "message": "Only PDFs, pictures and documents are shown here."}}
            if int(f.get("size") or 0) > DOC_MAX_BYTES:
                return {"refused": {"status": 400, "message": DOC_TOO_BIG}}
            data, exported, mime = drv.media(file_id, DOC_MAX_BYTES), False, shown
    except (Defer, dr.Gone):
        raise
    except Exception as e:  # noqa: BLE001 - Drive not answering is Apps Script's to say
        raise Defer(f"Drive did not hand the file over ({type(e).__name__})") from e
    if len(data) > DOC_MAX_BYTES:
        return {"refused": {"status": 400, "message": DOC_TOO_BIG}}
    return {"name": name, "mime": "application/pdf" if exported else mime, "size": len(data), "exported": exported,
            "b64": base64.b64encode(data).decode("ascii")}


def doc_file(reads: Reads, file_id: str) -> dict[str, Any]:
    """The doors' catch around locationsDocBytes_: the server's own copy when it holds one (location_docs), else the
    bytes Drive hands over, or the refusal; a file Drive lost is a 404."""
    import location_docs as LD  # noqa: PLC0415 - it reads this module's parts
    kept = LD.served(file_id)
    if kept is not None:
        return kept
    try:
        return doc_bytes(reads, file_id)
    except dr.Gone:
        return {"refused": {"status": 404, "message": "The file is no longer in the drive."}}


def doc_known(reads: Reads, ctx: dict, file_id: str, scope: dict) -> bool:
    """locationsDocKnown_: a file the viewer's own Documents answer names, or (not for a cut viewer) an IST paper here."""
    docs = documents_cut(documents_part(reads, ctx), scope)
    if any(d.get("isp_doc_id") == file_id for d in docs.get("isps") or []):
        return True
    if docs.get("guidebook") and any(f.get("id") == file_id for f in docs["guidebook"].get("files") or []):
        return True
    if any(p.get("drive_id") == file_id for p in docs.get("policies") or []):
        return True
    if cut_viewer(scope):
        return False
    own = {name_key(c.get("name")) for c in mine(ctx["clients"], scope)} if narrowed(scope) else None
    rows, _w = _soft(reads.ist_rows)
    return any(house_code(r.get("house")) == ctx["code"] and cell(r.get("docFileId")) == file_id
               and (own is None or name_key(r.get("clientName")) in own) for r in rows or [])


def location_doc_file(sess: Session, payload: dict) -> dict[str, Any]:
    """locationDocFile: one document of the house, as bytes for the platform's own viewer."""
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return door["refused"]
    file_id = text(payload.get("id"), 120)
    if not is_file_id(file_id):
        return {"status": 400, "message": "id: a Drive file id."}
    import location_docs as LD  # noqa: PLC0415 - it reads this module's parts
    # the server's own copy says whose the file is; only one it does not hold asks Drive's Documents read
    ok = LD.known(file_id, door["ctx"]["code"], door["scope"])
    if ok is None:
        ok = doc_known(sess.reads, door["ctx"], file_id, door["scope"])
    if not ok:
        return {"status": 404, "message": "This house names no such document."}
    got = doc_file(sess.reads, file_id)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": file_id, **got}}


def location_docs_where(sess: Session, payload: dict) -> dict[str, Any]:
    """locationDocsWhere: the folder the houses' documents are copied to, and what it holds (the master's alone)."""
    import location_docs as LD  # noqa: PLC0415 - it reads this module's parts
    if not sc.is_real_master(sess.user):
        return unknown()
    return {"status": 200, "data": LD.where()}


ACTIONS: dict[str, Callable[[Session, dict], dict[str, Any]]] = {
    "locationScope": location_scope, "locationOverview": location_overview, "locationStaff": location_staff,
    "locationRepairs": location_repairs, "locationIncidents": location_incidents,
    "locationDocuments": location_documents, "locationSupplies": location_supplies, "locationNotes": location_notes,
    "locationPack": location_pack, "locationDocFile": location_doc_file, "locationDocsWhere": location_docs_where,
    "locationIncidentStaff": location_incident_staff,
}

# HUB_POLICY: the roles each read is declared for, and its typed params (Resolver.gs checks both first)
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY = {a: {"roles": POLICY_ROLES, "params": {"house": "string"}} for a in ACTIONS}
POLICY["locationScope"] = {"roles": POLICY_ROLES, "params": {}}
POLICY["locationIncidentStaff"] = {"roles": POLICY_ROLES, "params": {}}
POLICY["locationPack"] = {"roles": ("admin",), "params": {"house": "string"}}
POLICY["locationDocFile"] = {"roles": POLICY_ROLES, "params": {"house": "string", "id": "string"}}
POLICY["locationDocsWhere"] = {"roles": ("admin", "director", "manager", "staff"), "params": {}}
