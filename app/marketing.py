"""Marketing on Python (Marketing.gs): the competitors list and its analysis, read from Postgres (app.resource_rows,
uploaded from marketing_competitors as the app is given to Python) — the tab is never read from Google here.
marketingAnalytics is worked out on every read; the platform's own side (clients, staff, houses, counties) comes from
the client directory and the roster in asa-hub-db."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import clients as C
import gsjs
import locations as L
import resource_rows as RR

APP_ID = "marketing"
RESOURCE = "marketingCompetitors"
TAB = "marketing_competitors"
SS_TITLE = "ASA Hub — Marketing"
COPY_PROP = "MARKETING_HUB_SHEET_ID"
HEADER = ("id", "name", "aliases", "type", "tier", "site", "facebook", "linkedin", "location", "founded", "revenue",
          "staff", "served", "services", "funding", "note")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
EMPTY = {"status": 503, "message": "The Hub marketing tab is empty."}
EMPTY_ANALYTICS = {"status": 503, "message": "The Hub marketing tab is empty — open Competitors once to fill it."}

s_ = gsjs.str_


def may(user: dict | None) -> bool:
    """marketingMay_."""
    if not user or user.get("is_service"):
        return False
    return s_(user.get("role")) in ("admin", "manager", "staff")


def key_of(name: Any) -> str:
    """marketingKey_."""
    return re.sub(r"[^a-z0-9]+", " ", s_(name).lower()).strip()


def competitors(reads: L.Reads) -> list[dict[str, str]]:
    """marketingReadTab_: every row with a name, its cells as text, an unrecorded tier read as 'peer'."""
    out = []
    for r in RR.read_all(reads, RESOURCE):
        name = s_(r.get("name"))
        if not name:
            continue
        row = {h: s_(r.get(h)) for h in HEADER}
        row["name"] = name
        row["tier"] = row["tier"] or "peer"
        out.append(row)
    return out


def competitors_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """marketingCompetitors: the tracked rivals, out of Postgres."""
    if not may(sess.user):
        return dict(DENIED)
    got = competitors(sess.reads)
    if not got:
        return dict(EMPTY)
    return {"status": 200, "data": {"sheet": SS_TITLE, "drive_file_id": s_(sess.reads.db.prop(COPY_PROP)),
                                    "competitors": got}}


# ---- the analysis ---------------------------------------------------------------------------------------------------

def known(v: Any) -> str:
    """marketingKnown_: unknown is not zero."""
    s = s_(v).strip()
    return "" if not s or s in ("—", "-") or s.lower() == "n/a" else s


def money(v: Any) -> float | None:
    """marketingMoney_: a figure with its K, M or B; None when there is none, never 0."""
    s = known(v)
    if not s:
        return None
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*([MmKkBb])?", s.replace(",", ""))
    if not m:
        return None
    n = float(m.group(1))
    unit = (m.group(2) or "").lower()
    return n * {"k": 1e3, "m": 1e6, "b": 1e9}.get(unit, 1)


def integer(v: Any) -> int | None:
    """marketingInt_: the first whole number."""
    s = known(v)
    if not s:
        return None
    m = re.search(r"([0-9]+)", s.replace(",", ""))
    return int(m.group(1)) if m else None


def services_of(v: Any) -> list[str]:
    """marketingServices_."""
    return [x.strip() for x in re.split(r"\s*[|,;/]\s*", known(v)) if x.strip()]


def _num(n: float | None) -> float | int | None:
    """A number as JSON.stringify writes it: a whole one without its point."""
    if n is None:
        return None
    return int(n) if float(n).is_integer() else n


def median(values: list[float]) -> float | int | None:
    if not values:
        return None
    ordered = sorted(values)
    m = len(ordered) // 2
    return _num(ordered[m] if len(ordered) % 2 else (ordered[m - 1] + ordered[m]) / 2)


def platform_self(reads: L.Reads) -> dict[str, Any]:
    """marketingSelf_: the platform's own size, from the client directory and the roster."""
    clients = C.derived(reads) or []
    people = C._hub(reads, "people") or []
    counties: dict[str, int] = {}
    houses: set[str] = set()
    for c in clients:
        county = known(c.get("county"))
        if county:
            counties[county] = counties.get(county, 0) + 1
        addr = known(c.get("home_address"))
        if addr:
            houses.add(addr.split(",")[0].lower())
    county_list = sorted(({"county": k, "clients": v} for k, v in counties.items()), key=lambda x: -x["clients"])
    return {"name": "ASA LifeCare", "clients": len(clients), "staff": len(people), "houses": len(houses),
            "counties": county_list,
            "source": "the platform itself — the client directory, the roster and the plans"}


def analytics(sess: L.Session, payload: dict) -> dict[str, Any]:
    """marketingAnalytics (marketingAnalyticsBuild_): the rivals against each other and against the platform."""
    if not may(sess.user):
        return dict(DENIED)
    reads = sess.reads
    rivals = competitors(reads)
    if not rivals:
        return dict(EMPTY_ANALYTICS)
    me = platform_self(reads)
    tiers: dict[str, int] = {}
    unknown = {"revenue": 0, "staff": 0, "served": 0}
    revenues: list[float] = []
    serveds: list[float] = []
    staffs: list[float] = []
    service_count: dict[str, int] = {}
    cities: dict[str, int] = {}
    rows = []
    for r in rivals:
        tier = known(r.get("tier")) or "unrecorded"
        tiers[tier] = tiers.get(tier, 0) + 1
        rev, srv, stf = money(r.get("revenue")), integer(r.get("served")), integer(r.get("staff"))
        for n, k, into in ((rev, "revenue", revenues), (srv, "served", serveds), (stf, "staff", staffs)):
            if n is None:
                unknown[k] += 1
            else:
                into.append(n)
        services = services_of(r.get("services"))
        for sv in services:
            service_count[sv] = service_count.get(sv, 0) + 1
        city = known(r.get("location"))
        if city:
            cities[city] = cities.get(city, 0) + 1
        rows.append({"id": s_(r.get("id")), "name": s_(r.get("name")), "type": known(r.get("type")), "tier": tier,
                     "location": city, "founded": known(r.get("founded")), "revenue": known(r.get("revenue")),
                     "revenue_num": _num(rev), "staff": known(r.get("staff")), "staff_num": stf,
                     "served": known(r.get("served")), "served_num": srv, "services": services,
                     "site": s_(r.get("site")), "note": known(r.get("note"))})
    svc = sorted(({"service": k, "rivals": v} for k, v in service_count.items()),
                 key=lambda x: (-x["rivals"], x["service"].lower(), x["service"]))
    places = sorted(({"place": k, "rivals": v} for k, v in cities.items()), key=lambda x: -x["rivals"])
    now = datetime.now(timezone.utc)
    return {"status": 200, "data": {
        "self": me, "rivals": rows, "counted": len(rivals), "tiers": tiers, "services": svc, "places": places,
        "unknown": unknown,
        "median": {"revenue": median(revenues), "staff": median(staffs), "served": median(serveds)},
        "built_at": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z", "reused": False}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"marketingCompetitors": competitors_list,
                                                                    "marketingAnalytics": analytics}
_ROLES = ("admin", "manager", "staff")
POLICY: dict[str, dict[str, Any]] = {a: {"roles": _ROLES} for a in ACTIONS}
