"""Behavior Support — how each person actually uses the platform, measured.
WHY THIS IS PYTHON AND NOT APPS SCRIPT (the lane, before the feature)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

import hub_rows
import ist_config
import lanes_db as hub_db
import lanes_pg as psycopg2
import shift_slices

try:  # the platform's clock is Ohio's; the log's is UTC
    from zoneinfo import ZoneInfo
    OHIO = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - zoneinfo ships with 3.9+
    OHIO = timezone(timedelta(hours=-4))

RESOURCES = ("behaviorBoard",)

# The books this module reads, by id, from asa-hub-db.
LOGS_SHEET_ID = os.getenv("HUB_LOGS_SHEET_ID", "1qOlREzHxdPEFBu5XZf11axu_-9DVCx9G4ZGBBV3tgeg")
CORE_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
MANIFEST_DIR = Path(os.getenv("HUB_SNAPSHOT_MANIFEST", "/srv/manifests/snapshot-manifest.json")).parent
SLICE_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))

WINDOW_DAYS = int(os.getenv("HUB_BEHAVIOR_WINDOW_DAYS", "30"))
RAIL_DAYS = 14
# asa-hub-db's copies move every few minutes and the log grows slowly; recomputing the whole window on every 180s rebuild…
CACHE_S = float(os.getenv("HUB_BEHAVIOR_CACHE_S", "900"))

# THE PLATFORM'S OWN MACHINES.
MACHINE_EXACT = {"trigger", "system", "", "matrix-engine", "auto-graduate",
                 "auto-internal-docs", "auto-cjis-folder", "auto-users"}
MACHINE_PREFIX = ("asa-hub:", "auto-", "snapshot@", "svc_", "service@")
MACHINE_CONTAINS = ("@service.local",)

# Action-name prefixes → the app a person would say they were in.
PREFIX_APP = (
    ("hiring", "hiring"), ("candidate", "hiring"), ("talent", "hiring"),
    ("screen", "hiring"), ("interview", "hiring"), ("recruit", "hiring"),
    ("resume", "hiring"), ("referral", "hiring"), ("offer", "hiring"),
    ("onboard", "onboarding"), ("packet", "onboarding"), ("cjis", "onboarding"),
    ("client", "clients"), ("isp", "clients"), ("care", "clients"),
    ("guardian", "clients"),
    ("med", "medications"), ("mar", "medications"),
    ("shift", "shifts"), ("schedule", "shifts"), ("roster", "shifts"),
    ("staff", "workforce"), ("perf", "workforce"), ("attendance", "workforce"),
    ("recon", "workforce"), ("hotline", "operations"), ("callof", "operations"),
    ("estate", "operations"), ("house", "operations"), ("repair", "operations"),
    ("form", "forms"), ("digest", "forms"),
    ("doc", "documents"), ("file", "documents"), ("library", "documents"),
    ("book", "books"),
    ("chat", "chat"), ("cortex", "chat"),
    ("comms", "smart-comms"), ("smart", "smart-comms"), ("quo", "smart-comms"),
    ("mail", "mail"), ("platformmail", "mail"),
    ("user", "users"), ("auth", "users"), ("profile", "users"),
    ("people", "users"), ("member", "users"), ("invite", "users"),
    ("tenant", "settings"), ("world", "settings"), ("app", "settings"),
    ("config", "settings"), ("prefs", "settings"), ("resolver", "settings"),
    ("finance", "finance"), ("invoice", "finance"), ("truelink", "finance"),
    ("purchase", "finance"),
    ("wellbeing", "wellbeing"), ("image", "wellbeing"), ("photo", "wellbeing"),
    ("incident", "compliance"), ("compliance", "compliance"), ("audit", "compliance"),
    ("cert", "compliance"), ("requirement", "compliance"),
    ("request", "requests"), ("suggestion", "requests"),
    ("tech", "technology"), ("guardian", "guardian"),
    ("lead", "leads"), ("market", "marketing"), ("scrap", "leads"),
    ("ist", "training"), ("train", "training"), ("questionnaire", "training"),
    ("snapshot", "platform"), ("bundle", "platform"), ("selftest", "platform"),
    ("service", "platform"), ("engine", "platform"), ("flow", "platform"),
    ("runtime", "platform"), ("gather", "platform"), ("behavior", "behavior"),
)

# Nights and weekends, on Ohio's clock — the two shapes a rhythm goes wrong in.
NIGHT_FROM, NIGHT_TO = 22, 5

# THE WORKING LIFE — the two frozen books and the lines drawn on them.
PSI_TABLE = "asa_psi_time_entries"
# The call-off book, one row per absence: MyLife OS — Employee Entities' entity_call_offs, as asa-hub-db keeps it.
CALLOFF_SHEET_ID = os.getenv("HUB_EMPLOYEE_ENTITIES_SHEET_ID", "12v9fEnlJwO9GzGOGhskdRVZM5TqHHb65CJF4icHcAmE")
CALLOFF_TAB = "entity_call_offs"
WORK_WINDOW_DAYS = int(os.getenv("HUB_BEHAVIOR_WORK_WINDOW_DAYS", "30"))
# Older than this and an axis stops driving `rhythm_verdict`.
WORK_FRESH_DAYS = int(os.getenv("HUB_BEHAVIOR_WORK_FRESH_DAYS", "45"))
# The band a shift has to reach into before it is a night's work.
WORK_NIGHT_FROM, WORK_NIGHT_TO = 22, 6
WORK_NIGHT_MIN_H = 2.0
# The turnaround clinicians actually ask about — how long between clocking out and clocking back in.
QUICK_TURNAROUND_H = float(os.getenv("HUB_BEHAVIOR_TURNAROUND_H", "10"))
# PsiAnywhere splits an overnight at midnight — 1,097 entries end at 23:59:59 and 1,134 start at 00:00:00, a quarter…
STITCH_GAP_MIN = 2.0
# Hours a week.
WEEK_HOURS_STRAIN = 48.0
WEEK_HOURS_HEAVY = 60.0

# WHERE THE INCIDENT READING LIVES.
INCIDENT_MODULE_PATHS = (
    os.getenv("HUB_INCIDENT_MODULE") or "",
    "/srv/analytics/incident_exposure.py",
    # (the old platform's copy is never looked for: the old platform is shut down)
)
_INCIDENT_MODULE: ModuleType | None = None

# Severity, for fusing two axes into one reading.
_SEVERITY = {"quiet": 0, "steady": 1, "watch": 2, "heavy": 3, "strained": 4}

_CACHE: dict[str, Any] = {"at": 0.0, "board": None, "signals": None, "source_at": None}


# --------------------------------------------------------------------------- small honest helpers…

def _text(v: Any, cap: int = 300) -> str:
    return re.sub(r"\s+", " ", "" if v is None else str(v)).strip()[:cap]


def _digits10(v: Any) -> str:
    d = re.sub(r"\D+", "", _text(v, 40))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else ""


def _is_machine(actor: str) -> bool:
    a = actor.strip().lower()
    if a in MACHINE_EXACT:
        return True
    if any(a.startswith(p) for p in MACHINE_PREFIX):
        return True
    return any(c in a for c in MACHINE_CONTAINS)


def _caller(actor: str) -> str:
    """The person AT THE KEYBOARD."""
    a = _text(actor, 200).lower()
    if " (visiting" in a:
        a = a.split(" (visiting", 1)[0]
    return a.strip()


def _parse_iso(s: str) -> datetime | None:
    s = _text(s, 40)
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _app_map() -> dict[str, str]:
    """action → app, from the two manifests the relay already mounts."""
    out: dict[str, str] = {}
    try:
        res = json.loads((MANIFEST_DIR / "snapshot-manifest.json").read_text())
        apps_of = {r["resource"]: (r.get("apps") or []) for r in res.get("resources", [])}
    except Exception:
        apps_of = {}
    try:
        rel = json.loads((MANIFEST_DIR / "resolver-manifest.json").read_text())
        actions = rel.get("actions") or {}
    except Exception:
        actions = {}
    for name, pol in actions.items():
        if not isinstance(pol, dict):
            continue
        for resource in (pol.get("invalidates") or []):
            apps = apps_of.get(resource) or []
            if apps:
                out[name] = apps[0]
                break
    return out


def app_of(action: str, mapped: dict[str, str]) -> str:
    """The app a person would say they were in, or 'platform'."""
    a = _text(action, 80)
    if not a:
        return "platform"
    if a in mapped:
        return mapped[a]
    low = a.lower()
    for prefix, app in PREFIX_APP:
        if low.startswith(prefix):
            return app
    return "platform"


# --------------------------------------------------------------------------- the verdicts — sustainability, never…

def site_verdict(m: dict) -> tuple[str, str]:
    """Is this person's rhythm on the platform sustainable?"""
    actions = m["actions"]
    days = m["active_days"]
    if actions < 12 or days < 2:
        return "quiet", f"{actions} action(s) on {days} day(s) — too little to read"
    per_day = actions / max(1, days)
    night = m["night_actions"]
    weekend = m["weekend_actions"]
    run = m["longest_run_days"]
    night_share = night / actions
    weekend_share = weekend / actions
    strain = []
    if night_share >= 0.15:
        strain.append(f"{round(night_share * 100)}% of the work lands between 10pm and 5am")
    if weekend_share >= 0.30:
        strain.append(f"{round(weekend_share * 100)}% falls on weekends")
    if run >= 12:
        strain.append(f"{run} days in a row without one off the platform")
    if len(strain) >= 2:
        return "strained", "; ".join(strain)
    if per_day >= 120 or run >= 14:
        return "heavy", (f"{round(per_day)} actions on an average working day"
                         + (f", {run} days unbroken" if run >= 10 else ""))
    if strain:
        return "watch", strain[0]
    return "steady", f"{round(per_day)} actions across {days} working day(s), no night or weekend pattern"


def shift_verdict(s: dict | None) -> tuple[str, str]:
    """Is this person's roster rhythm sustainable?"""
    if not s or not s.get("shifts"):
        if s and s.get("planned"):
            return "unknown", (f"nothing worked yet in this window — {s['planned']} shift(s) "
                               "are rostered ahead, which is a plan, not a rhythm")
        return "unknown", "no shift on the roster in this window"
    shifts = s["shifts"]
    days = s["days"]
    run = s["longest_run_days"]
    nights = s["overnights"]
    per_week = shifts / max(1.0, s["span_days"] / 7.0)
    strain = []
    if run >= 7:
        strain.append(f"{run} days on in a row")
    if per_week >= 6:
        strain.append(f"{round(per_week, 1)} shifts a week")
    if nights and nights / shifts >= 0.5:
        strain.append(f"{nights} of {shifts} are overnights")
    if len(strain) >= 2:
        return "strained", "; ".join(strain)
    if strain:
        return "watch", strain[0]
    return "steady", (f"{shifts} shift(s) over {days} day(s), "
                      f"{round(per_week, 1)} a week, {nights} overnight(s)")


def work_verdict(w: dict | None) -> tuple[str, str]:
    """Is the rhythm this person ACTUALLY WORKED sustainable?"""
    if not w or not w.get("shifts"):
        return "unknown", "no punch on this person's clock in this window"
    shifts = w["shifts"]
    if shifts < 3:
        # Too little to read a RHYTHM from, and the strain tests below would each be true of a single long shift.
        return "quiet", (f"{shifts} shift(s) punched in the {WORK_WINDOW_DAYS} day(s) to "
                         f"{w['as_of']} — too little to read a rhythm from")
    per_week = w["hours_per_week"]
    strain = []
    if w["night_run_days"] >= 4:
        strain.append(f"{w['night_run_days']} nights in a row")
    elif w["nights"] and w["nights"] / shifts >= 0.5:
        strain.append(f"{w['nights']} of {shifts} shift(s) worked through the night")
    if per_week is not None and per_week >= WEEK_HOURS_STRAIN:
        strain.append(f"{per_week} hours a week")
    if w["quick_turnarounds"] >= 3:
        strain.append(f"{w['quick_turnarounds']} turnaround(s) under "
                      f"{round(QUICK_TURNAROUND_H)}h, the shortest {w['min_turnaround_h']}h")
    if w["longest_run_days"] >= 10:
        strain.append(f"{w['longest_run_days']} days worked without one off")
    if w["longest_stretch_h"] >= 24:
        strain.append(f"{w['longest_stretch_h']} hours clocked in without a break between shifts")
    if len(strain) >= 2:
        return "strained", "; ".join(strain[:3])
    if per_week is not None and per_week >= WEEK_HOURS_HEAVY:
        return "heavy", f"{per_week} hours a week across {shifts} shift(s)"
    if strain:
        return "watch", strain[0]
    rate = (f"{per_week} hours a week" if per_week is not None
            else f"{w['hours']} hours over {w['span_days']} day(s)")
    return "steady", (f"{shifts} shift(s), {rate}, {w['nights']} at night, "
                      f"longest run {w['longest_run_days']} day(s)")


def rhythm_of(axes: list[tuple[str, str, str]]) -> tuple[str, str, str]:
    """ONE READING FROM TWO MEASURED LIVES — the worse of them, and which."""
    known = [a for a in axes if a[1] in _SEVERITY]
    if not known:
        return "unknown", "", "nothing measurable about this person's rhythm in this window"
    worst = max(known, key=lambda a: _SEVERITY[a[1]])
    return worst[1], worst[0], worst[2]


def reach_verdict(home: str, extra: list[str], world: str, places: int) -> tuple[str, str]:
    """Where this person may stand."""
    where = ([home] if home else ["headquarters"]) + [t for t in extra if t and t != home]
    if len(where) > 1:
        return "multi", f"stands in {len(where)} of the {places} place(s): {', '.join(where[:4])}"
    if world:
        return "own-world", "headquarters, plus ground of their own"
    return "headquarters", f"headquarters only (the platform has {places} place(s))"


def training_verdict(t: dict | None) -> tuple[str, str]:
    """Whether this person's completed courses are still good paper."""
    if not t or not t.get("total"):
        return "unknown", "no course on file for this person"
    if t.get("expired"):
        return "lapsed", (f"{t['expired']} of {t['total']} course(s) past their date"
                          f" — {', '.join(c['course'] for c in t['courses'] if c['state'] == 'expired')[:120]}")
    if t.get("expiring"):
        return "renewing", (f"{t['expiring']} of {t['total']} course(s) due within "
                            f"{_expiring_days()} days")
    return "current", f"{t['valid']} of {t['total']} course(s) in date"


# --------------------------------------------------------------------------- the read…

def _people(cur) -> dict[str, dict]:
    """Every account, keyed by every login shape it answers to."""
    out: dict[str, dict] = {}
    for d in hub_rows.rows(CORE_SHEET_ID, "users"):
        d = d or {}
        if not isinstance(d, dict):
            continue
        if _text(d.get("merged_into")):
            continue
        uid = _text(d.get("user_id"), 40)
        if not uid:
            continue
        person = {
            "subject_key": uid,
            "name": _text(d.get("display_name"), 80),
            "role": _text(d.get("role"), 30) or "staff",
            "title": _text(d.get("title"), 80),
            "types": _text(d.get("types"), 80),
            "client_key": _text(d.get("client_key"), 60),
            "people_id": _text(d.get("people_id"), 40),
            "roster_status": _text(d.get("roster_status"), 30),
            "home_tenant": _text(d.get("home_tenant"), 60),
            "tenants": [_text(t, 60) for t in _json_list(d.get("tenants")) if _text(t, 60)],
            "active": _text(d.get("active"), 10).lower() != "false",
            "armed": bool(_text(d.get("pass_hash"), 10)),
            "keys": set(),
        }
        login = _text(d.get("email"), 120).lower()
        if login:
            person["keys"].add(login)
        for extra in _json_list(d.get("emails")):
            e = _text(extra, 120).lower()
            if "@" in e:
                person["keys"].add(e)
        ph = _digits10(d.get("phone"))
        if ph:
            person["keys"].add(ph)
        out[uid] = person
    return out


def _json_list(raw: Any) -> list:
    if isinstance(raw, list):
        return raw
    s = _text(raw, 4000)
    if not s:
        return []
    try:
        v = json.loads(s)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _worlds(cur) -> dict[str, str]:
    """WHO HAS GROUND OF THEIR OWN: My World's registry, in Postgres."""
    out: dict[str, str] = {}
    try:
        got = hub_rows.worlds()
    except Exception:  # noqa: BLE001 - no world is known, as when the registry could not be read
        return out
    for d in got:
        wid = _text(d.get("world_id"), 60)
        for who in (_text(d.get("owner_user_id"), 60), _text(d.get("owner_email"), 120).lower()):
            if who and wid:
                out[who] = wid
    return out


# WHAT THE PLATFORM ALREADY KNOWS ABOUT A STAFF MEMBER BESIDE THEIR RHYTHM — the rest of what the platform holds…

# Google Sheets keeps a date as a day count from 1899-12-30.
_SHEETS_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc).date()

# THE WINDOW THE PLATFORM CALLS "EXPIRING" — the shipped floor, and the answer whenever the config house cannot be…
_EXPIRING_DAYS = int(ist_config.SHIPPED["ist_cert_expiring_days"])

def _load_ist_config(cur) -> str:
    """Refresh the relay's one copy of the `ist_config` house (ist_config's holder, which the first-shift gate…"""
    ist_config.rules(cur=cur, fresh=True)
    source = ist_config.state()["source"]
    return source if source in ("sheet", "last known") else "shipped"


def _ist_values() -> dict[str, str]:
    """The IST settings as the relay holds them, every refused cell resolved by the declaration."""
    return ist_config.current()


def _expiring_days() -> int:
    """How far ahead counts as expiring — the declared range (1..365) or the shipped value."""
    return ist_config.int_of(_ist_values(), "ist_cert_expiring_days")


def _sheet_date(v: Any) -> str:
    """A Sheets serial, or an ISO day, as YYYY-MM-DD. '' when it is neither."""
    s = _text(v, 40)
    if not s:
        return ""
    if s.isdigit() and 1 < len(s) <= 6:
        try:
            d = _SHEETS_EPOCH + timedelta(days=int(s))
        except (ValueError, OverflowError):
            return ""
        return d.isoformat() if 1940 <= d.year <= 2100 else ""
    return clean_day(s)


def clean_day(s: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return f"{y:04d}-{mo:02d}-{d:02d}" if 1940 <= y <= 2100 else ""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        mo, d, y = (int(x) for x in m.groups())
        return f"{y:04d}-{mo:02d}-{d:02d}" if 1940 <= y <= 2100 else ""
    return ""


def _hub_name_key(v: Any) -> str:
    """The platform's own name key — `clientNameKey_` in Clients.gs, which is what RequirementStates.gs already…"""
    return re.sub(r"[^a-z0-9]+", "", _text(v, 120).lower())


# ASKING THE HOUSE INSTEAD OF GUESSING BY TAB NAME.
ESSENCIAL_SHEET_ID = os.getenv(
    "HUB_ESSENCIAL_SHEET_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")


def _house_of(cur, tab: str) -> str:
    """The declared house for a tab, or '' when none is declared."""
    want = "HUB_HOUSE_" + tab.upper() + "_ID"
    try:
        got = hub_rows.rows(ESSENCIAL_SHEET_ID, "Facts", where={"Subject ID": want})
    except Exception:  # noqa: BLE001 - an unreadable depot declares no house
        return ""
    if not got:
        return ""
    # the newest fact stands: the last in the sheet's order
    d = got[-1] or {}
    return _text(d.get("Value"), 60) if isinstance(d, dict) else ""


def _rows_for(cur, tab: str) -> tuple[list[dict], str]:
    """Every row of a tab, read from the LIVE copy, plus the sheet it came from so the board can name its source."""
    house = _house_of(cur, tab)
    if house:
        try:
            rows = [d for d in hub_rows.rows(house, "Data") if isinstance(d, dict)]
        except Exception:  # noqa: BLE001 - the freshest book below answers
            rows = []
        if rows:
            return rows, house
    # No house, or a house declared but not yet copied: take the freshest book that carries the tab under its own…
    try:
        held = hub_rows.holders(tab)
        if not held:
            return [], ""
        sid = held[0]
        return [d for d in hub_rows.rows(sid, tab) if isinstance(d, dict)], sid
    except Exception:  # noqa: BLE001 - nothing read, said as no rows
        return [], ""


def _trainings(cur) -> dict[str, dict]:
    """Completed courses per person, with what is still valid and what lapsed."""
    rows, _sid = _rows_for(cur, "perf_trainings")
    today = datetime.now(timezone.utc).date()
    soon = today + timedelta(days=_expiring_days())
    best: dict[str, dict[str, str]] = {}
    for d in rows:
        who = _hub_name_key(d.get("name"))
        course = _text(d.get("cert"), 60)
        if not who or not course:
            continue
        day = _sheet_date(d.get("expires"))
        held = best.setdefault(who, {})
        if course not in held or day > held[course]:
            held[course] = day
    out: dict[str, dict] = {}
    for who, held in best.items():
        slot = {"courses": [], "valid": 0, "expiring": 0, "expired": 0, "undated": 0}
        for course, day in held.items():
            state = "undated"
            if day:
                try:
                    on = datetime.strptime(day, "%Y-%m-%d").date()
                    state = "expired" if on < today else ("expiring" if on <= soon else "valid")
                except ValueError:
                    state = "undated"
            slot["courses"].append({"course": course, "expires": day, "state": state})
            slot[state] += 1
        slot["courses"].sort(key=lambda c: (c["state"] != "expired", c["state"] != "expiring", c["course"]))
        slot["total"] = len(slot["courses"])
        out[who] = slot
    return out


def _ist_lapsed(trained_at: str, valid_days: int, today) -> bool:
    """A completed IST past `ist_valid_days` — the gate's rule, on the Ohio date; no date or 0 never lapses."""
    day = clean_day(str(trained_at or "")[:10]) if trained_at else ""
    return ist_config.lapsed(day, valid_days, today)


def _ist_kept() -> list[dict] | None:
    """IST Records' rows in asa-hub-db once the app is Python's (app.ist_records_kept), on the app's own connection;
    None while the house's sheet holds them, or when asa-hub-db does not answer."""
    try:
        with hub_db.connect() as conn, conn.cursor() as c:
            c.execute("SELECT cells FROM app.ist_records_kept ORDER BY position, created_at, row_key")
            rows = [r[0] for r in c.fetchall() if isinstance(r[0], dict)]
    except psycopg2.Error:
        return None
    return rows or None


def _ist(cur) -> dict[str, dict]:
    """The client-specific training: how much is done and how much is owed — from IST Records' own rows once they live
    in Postgres, else the house's copy."""
    rows = _ist_kept()
    if rows is None:
        rows, _sid = _rows_for(cur, "ist_records")
    valid_days = ist_config.int_of(_ist_values(), "ist_valid_days")
    today = ist_config.ohio_today()
    out: dict[str, dict] = {}
    for d in rows:
        who = _hub_name_key(d.get("staffName"))
        if not who:
            continue
        slot = out.setdefault(who, {"done": 0, "owed": 0, "clients": set()})
        state = _text(d.get("status"), 20).lower()
        at = _text(d.get("trainedAt"))
        if (state == ist_config.IST_STATUS_DONE or at) and not _ist_lapsed(at, valid_days, today):
            slot["done"] += 1
        else:
            slot["owed"] += 1
        # the CLIENT's name never travels; only how many distinct plans
        c = _text(d.get("clientName"), 80)
        if c:
            slot["clients"].add(c)
    for slot in out.values():
        slot["plans"] = len(slot.pop("clients"))
    return out


def _requirements(cur) -> dict[str, dict]:
    """The obligation matrix, folded to counts per person plus the names of what is actually wrong."""
    rows, _sid = _rows_for(cur, "requirement_states")
    out: dict[str, dict] = {}
    for d in rows:
        who = _text(d.get("person_key"), 80).lower() or _hub_name_key(d.get("person_name"))
        if not who:
            continue
        state = _text(d.get("state"), 20).lower()
        slot = out.setdefault(who, {"ok": 0, "missing": 0, "expiring": 0, "expired": 0,
                                    "na": 0, "wrong": []})
        if state in slot and isinstance(slot[state], int):
            slot[state] += 1
        if state in ("expired", "expiring") and len(slot["wrong"]) < 8:
            slot["wrong"].append({"req": _text(d.get("req_id"), 40), "state": state,
                                  "expires": clean_day(_text(d.get("expires"), 40))})
    return out


def _places(cur) -> list[str]:
    """The franchises that exist at all — 2 today."""
    try:
        got = [hub_rows.cell(d.get("tenant_id")) for d in hub_rows.rows(CORE_SHEET_ID, "tenants")]
    except Exception:  # noqa: BLE001 - no place is counted
        return []
    return [_text(t, 60) for t in got if _text(t, 60)]


# --------------------------------------------------------------------------- THE WORKING LIFE — the join first…

def _work_index(people: dict[str, dict]) -> tuple[dict[str, str], dict[str, str]]:
    """The keys the working-life books may be joined on, and NOTHING AMBIGUOUS."""
    by_name: dict[str, list[str]] = defaultdict(list)
    by_phone: dict[str, list[str]] = defaultdict(list)
    for p in people.values():
        nk = _hub_name_key(p["name"])
        if nk:
            by_name[nk].append(p["subject_key"])
        for k in p["keys"]:
            if k.isdigit() and len(k) == 10:
                by_phone[k].append(p["subject_key"])
    return ({k: v[0] for k, v in by_name.items() if len(set(v)) == 1},
            {k: v[0] for k, v in by_phone.items() if len(set(v)) == 1})


def _roster_phones(cur) -> dict[str, str]:
    """Phone → the roster's name key, so an account whose display name the roster spells differently is still…"""
    try:
        rows = shift_slices.staff_phones()
    except Exception:  # noqa: BLE001 - no phone joins anyone
        return {}
    seen: dict[str, set] = defaultdict(set)
    for staff, phone in rows:
        ph = _digits10(phone)
        nk = _hub_name_key(staff)
        if ph and nk:
            seen[ph].add(nk)
    return {ph: next(iter(nks)) for ph, nks in seen.items() if len(nks) == 1}


def _us_day(s: Any) -> str:
    """A US `MM/DD/YYYY` (with or without a time after it) as YYYY-MM-DD."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", _text(s, 40))
    if not m:
        return clean_day(_text(s, 40))
    mo, d, y = (int(x) for x in m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}" if 1940 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31 else ""


def _clock(s: Any) -> float | None:
    """`08:00:00 AM` / `22:00` → hours past midnight. None when it isn't one."""
    t = _text(s, 20).upper()
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$", t)
    if not m:
        return None
    h, mi, se, ap = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), m.group(4)
    if ap:
        h = h % 12 + (12 if ap == "PM" else 0)
    if h > 23 or mi > 59:
        return None
    return h + mi / 60 + se / 3600


def _night_hours(start: float, end: float) -> float:
    """How much of a shift falls inside the night band, in hours."""
    total = 0.0
    for k in (-1, 0, 1, 2):
        a = max(start, k * 24 + WORK_NIGHT_FROM)
        b = min(end, k * 24 + 24 + WORK_NIGHT_TO)
        if b > a:
            total += b - a
    return total


def _worked(cur, by_name: dict[str, str]) -> tuple[dict[str, dict], str, int]:
    """THE TIME CLOCK — what these people actually worked, per account."""
    try:
        cur.execute(
            f"SELECT employee, date_service, start_time, end_time, status "  # noqa: S608
            f"FROM public.{PSI_TABLE} WHERE coalesce(employee,'') <> ''")
        rows = cur.fetchall()
    except psycopg2.Error:
        return {}, "", -1

    # one punch → (night-of key, start, end) in hours from its own midnight
    spans: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    last_day = ""
    for r in rows:
        key = by_name.get(_hub_name_key(r["employee"]))
        day = _us_day(r["date_service"])
        if not day:
            continue
        if day > last_day:
            last_day = day
        if not key:
            continue
        s, e = _clock(r["start_time"]), _clock(r["end_time"])
        if s is None or e is None:
            continue
        if e <= s:
            e += 24  # the punch crosses midnight in one row
        spans[key].append((day, s, e))
    if not last_day:
        return {}, "", -1
    age = (datetime.now(OHIO).date() - datetime.strptime(last_day, "%Y-%m-%d").date()).days
    since = (datetime.strptime(last_day, "%Y-%m-%d").date()
             - timedelta(days=WORK_WINDOW_DAYS)).isoformat()

    out: dict[str, dict] = {}
    for key, punches in spans.items():
        # absolute hours from one origin, so the stitch and the turnaround can be arithmetic instead of calendar work
        base = min(p[0] for p in punches)
        origin = datetime.strptime(base, "%Y-%m-%d").date()
        marks: list[tuple[float, float]] = []
        for day, s, e in punches:
            if day < since:
                continue
            off = (datetime.strptime(day, "%Y-%m-%d").date() - origin).days * 24
            marks.append((off + s, off + e))
        if not marks:
            continue
        marks.sort()
        # THE STITCH — and it repairs exactly ONE thing on purpose.
        shifts: list[tuple[float, float]] = []
        for s, e in marks:
            if shifts:
                prev_s, prev_e = shifts[-1]
                seam = (abs((prev_e % 24) - 24) <= STITCH_GAP_MIN / 60
                        or (prev_e % 24) <= STITCH_GAP_MIN / 60)
                if s < prev_e or (seam and s - prev_e <= STITCH_GAP_MIN / 60):
                    shifts[-1] = (prev_s, max(prev_e, e))
                    continue
            shifts.append((s, e))

        hours = sum(e - s for s, e in shifts)
        night_days: set[str] = set()
        nights = 0
        for s, e in shifts:
            midnight = (s // 24) * 24  # the shift's own day, so the band lines up
            if _night_hours(s - midnight, e - midnight) >= WORK_NIGHT_MIN_H:
                nights += 1
                # the night a shift BELONGS to: one that starts at 00:30 is the previous evening's night, not its…
                night_days.add((origin + timedelta(days=int((s - 6) // 24))).isoformat())
        days = sorted({(origin + timedelta(days=int(s // 24))).isoformat() for s, _e in shifts})
        gaps = [shifts[i][0] - shifts[i - 1][1] for i in range(1, len(shifts))]
        # a fortnight off is a holiday, not a rest between shifts
        rest = [g for g in gaps if 0 <= g < 24 * 3]
        # THE LONGEST UNBROKEN STRETCH — shifts that touch with no gap at all, chained.
        run_start = shifts[0][0]
        best_stretch = shifts[0][1] - shifts[0][0]
        for i in range(1, len(shifts)):
            if gaps[i - 1] > 0:
                run_start = shifts[i][0]
            best_stretch = max(best_stretch, shifts[i][1] - run_start)
        span = max(1.0, (shifts[-1][1] - shifts[0][0]) / 24)
        first_day = (origin + timedelta(days=int(shifts[0][0] // 24))).isoformat()
        last_seen = (origin + timedelta(days=int(shifts[-1][0] // 24))).isoformat()
        out[key] = {
            "shifts": len(shifts),
            "hours": round(hours, 1),
            "days": len(days),
            "nights": nights,
            "night_run_days": _longest_run(sorted(night_days)),
            "longest_run_days": _longest_run(days),
            # A WEEKLY RATE NEEDS A WEEK.
            "hours_per_week": round(hours / (span / 7.0), 1) if span >= 7 else None,
            "longest_shift_h": round(max(e - s for s, e in shifts), 1),
            "longest_stretch_h": round(best_stretch, 1),
            "quick_turnarounds": sum(1 for g in rest if g < QUICK_TURNAROUND_H),
            "back_to_back": sum(1 for g in rest if g <= 0.25),
            "min_turnaround_h": round(min(rest), 1) if rest else None,
            "first": first_day,
            "last": last_seen,
            "span_days": round(span, 1),
            "as_of": last_day,
            "age_days": age,
            "fresh": age <= WORK_FRESH_DAYS,
        }
    return out, last_day, age


def _absences(cur, by_name: dict[str, str]) -> tuple[dict[str, dict], str, int]:
    """CALL-OFFS AS A COUNT AND A TYPE — never a reason."""
    try:
        rows = [d for d in hub_rows.rows(CALLOFF_SHEET_ID, CALLOFF_TAB, fields=["employee_name", "date", "type"])
                if isinstance(d, dict) and str(d.get("employee_name") or "").strip()]
    except Exception:  # noqa: BLE001 - the book unread is no absence
        return {}, "", -1
    parsed: list[tuple[str, str, str]] = []
    last_day = ""
    for r in rows:
        day = _us_day(r["date"])
        if not day or day > datetime.now(OHIO).date().isoformat():
            continue  # a typo'd year ('0024') is not evidence
        if day > last_day:
            last_day = day
        key = by_name.get(_hub_name_key(r["employee_name"]))
        if key:
            parsed.append((key, day, _text(r["type"], 30) or "Call Off"))
    if not last_day:
        return {}, "", -1
    age = (datetime.now(OHIO).date() - datetime.strptime(last_day, "%Y-%m-%d").date()).days
    since = (datetime.strptime(last_day, "%Y-%m-%d").date()
             - timedelta(days=WORK_WINDOW_DAYS)).isoformat()
    out: dict[str, dict] = {}
    for key, day, kind in parsed:
        if day < since:
            continue
        slot = out.setdefault(key, {"count": 0, "types": Counter(), "first": day, "last": day,
                                    "as_of": last_day, "age_days": age,
                                    "window_days": WORK_WINDOW_DAYS})
        slot["count"] += 1
        slot["types"][kind] += 1
        slot["first"] = min(slot["first"], day)
        slot["last"] = max(slot["last"], day)
    for slot in out.values():
        slot["types"] = [{"type": k, "n": n} for k, n in slot["types"].most_common()]
    return out, last_day, age


def _incident_module() -> ModuleType | None:
    """`incident_exposure.py`, loaded by path and kept for the life of the process, or None when it is not…"""
    global _INCIDENT_MODULE
    if _INCIDENT_MODULE is not None:
        return _INCIDENT_MODULE
    for path in INCIDENT_MODULE_PATHS:
        if not path or not os.path.exists(path):
            continue
        spec = importlib.util.spec_from_file_location("hub_incident_exposure", path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "exposure"):
            continue  # a file of that name that is not this reading
        _INCIDENT_MODULE = mod
        return mod
    return None


def _incidents(cur) -> dict:
    """The incident reading, or the reason there is not one."""
    mod = _incident_module()
    if mod is None:
        return {"looked": False, "emitted": False, "people": {},
                "refusal": "the incident reading is not reachable from this "
                           "process — it needs incident_exposure.py mounted "
                           "read-only beside the other analytics readings, and "
                           "until it is, this axis reports that it could not "
                           "look rather than reporting no incidents",
                "unavailable": "module"}
    try:
        out = mod.exposure(cur)
    except Exception as exc:  # noqa: BLE001 — a broken read must not take the board down
        return {"looked": False, "emitted": False, "people": {},
                "refusal": f"the incident reading could not be computed "
                           f"({type(exc).__name__}) — reported rather than "
                           f"swallowed, because a lane that fails quietly "
                           f"looks exactly like a lane that found nothing",
                "unavailable": "error"}
    out["looked"] = True
    out["unavailable"] = ""
    return out


_ROSTER_OFF = ("r/o", "c/o", "ro", "r\\o", "r/0", "off", "ncns")


def _roster_day(rows: list[dict]) -> dict:
    """ONE PERSON, ONE DAY → what the roster actually says happened."""
    off = False
    spans: list[tuple[float, float, bool, str]] = []
    pointers: list[str] = []
    for row in rows:
        status = _text(row.get("status"), 40).lower()
        house = _text(row.get("house") or row.get("houseCode"), 40)
        if status in _ROSTER_OFF:
            off = True
            continue
        start, end = _clock(row.get("start")), _clock(row.get("end"))
        if start is None or end is None:
            pointers.append(house)
            continue
        if end <= start:
            end += 24  # the cell crosses midnight
        spans.append((start, end, "overnight" in status, house))
    shifts: list[dict] = []
    for start, end, night, house in sorted(spans):
        held = shifts[-1] if shifts else None
        if held and start < held["end"]:  # the same shift, typed in two grids
            held["end"] = max(held["end"], end)
            held["night"] = held["night"] or night
        else:
            held = {"end": end, "night": night, "houses": set()}
            shifts.append(held)
        if house:
            held["houses"].add(house)
    if shifts:
        houses = {h for s in shifts for h in s["houses"]}
        return {"shifts": len(shifts), "overnights": sum(1 for s in shifts if s["night"]),
                "hours_unknown": 0, "off_requested": int(off), "houses": houses}
    if pointers:
        return {"shifts": 1, "overnights": 0, "hours_unknown": 1,
                "off_requested": int(off), "houses": {h for h in pointers if h}}
    return {"shifts": 0, "overnights": 0, "hours_unknown": 0,
            "off_requested": int(off), "houses": set()}


def _shifts_by_name() -> dict[str, dict]:
    """The roster, from the slice this relay already builds."""
    path = SLICE_DIR / "shifts.json"
    if not path.exists():
        return {}
    try:
        rows = (json.loads(path.read_text()) or {}).get("rows") or []
    except Exception:
        return {}
    today = datetime.now(OHIO).date().isoformat()
    # ONE HUMAN, ONE ROSTER.
    grouped: dict[str, dict[str, list[dict]]] = {}
    spellings: dict[str, Counter] = {}
    for row in rows:
        name = _text(row.get("staff"), 80)
        if not name:
            continue
        key = _hub_name_key(name) or name.lower()
        spellings.setdefault(key, Counter())[name] += 1
        grouped.setdefault(key, {}).setdefault(_text(row.get("date"), 10), []).append(row)
    by: dict[str, dict] = {}
    for key, per_day in grouped.items():
        slot = by.setdefault(key, {
            "shifts": 0, "overnights": 0, "houses": set(), "days": set(),
            "planned": 0, "planned_overnights": 0, "off_requested": 0,
            "hours_unknown": 0, "night_days": set()})
        for day, day_rows in per_day.items():
            d = _roster_day(day_rows)
            slot["off_requested"] += d["off_requested"]
            if not d["shifts"]:
                continue
            if day and day > today:
                slot["planned"] += d["shifts"]
                slot["planned_overnights"] += d["overnights"]
                continue
            slot["shifts"] += d["shifts"]
            slot["overnights"] += d["overnights"]
            slot["hours_unknown"] += d["hours_unknown"]
            slot["houses"] |= d["houses"]
            if day:
                slot["days"].add(day)
                if d["overnights"]:
                    slot["night_days"].add(day)
    out: dict[str, dict] = {}
    for key, slot in by.items():
        days = sorted(slot["days"])
        out[key] = {
            "name": spellings[key].most_common(1)[0][0],
            "shifts": slot["shifts"],
            "days": len(days),
            "overnights": slot["overnights"],
            "houses": sorted(slot["houses"])[:8],
            "houses_n": len(slot["houses"]),
            "planned": slot["planned"],
            "planned_overnights": slot["planned_overnights"],
            "off_requested": slot["off_requested"],
            "hours_unknown": slot["hours_unknown"],
            "night_run_days": _longest_run(sorted(slot["night_days"])),
            "first": days[0] if days else "",
            "last": days[-1] if days else "",
            "span_days": _span_days(days),
            "longest_run_days": _longest_run(days),
        }
    return out


def _span_days(days: list[str]) -> float:
    if len(days) < 2:
        return float(len(days) or 1)
    a, b = _parse_iso(days[0] + "T00:00:00Z"), _parse_iso(days[-1] + "T00:00:00Z")
    return max(1.0, ((b - a).days + 1) if a and b else float(len(days)))


def _longest_run(days: list[str]) -> int:
    """The longest unbroken run of calendar days — the shape that tires people out, and the one a weekly total…"""
    if not days:
        return 0
    seen = sorted({d for d in days if d})
    best = run = 1
    prev = _parse_iso(seen[0] + "T00:00:00Z")
    for d in seen[1:]:
        cur = _parse_iso(d + "T00:00:00Z")
        if prev and cur and (cur - prev).days == 1:
            run += 1
        else:
            run = 1
        best = max(best, run)
        prev = cur
    return best


def _measure(dsn: str) -> tuple[list[dict], list[dict], str]:
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    since_s = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    mapped = _app_map()
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        people = _people(cur)
        worlds = _worlds(cur)
        places = _places(cur)
        # THE LANE'S CONFIGURATION FIRST — the expiring window every count below is measured against.
        ist_config_source = _load_ist_config(cur)
        trainings = _trainings(cur)
        ist = _ist(cur)
        reqs = _requirements(cur)
        # THE WORKING LIFE.
        by_name_key, by_phone_key = _work_index(people)
        worked, worked_at, worked_age = _worked(cur, by_name_key)
        absences, calloff_at, calloff_age = _absences(cur, by_name_key)
        # THE INCIDENTS, MEASURED AGAINST THE SHIFTS THEY HAPPENED ACROSS — or refused outright.
        incidents = _incidents(cur)
        roster_phone = _roster_phones(cur)
        by_key: dict[str, dict] = {}
        for p in people.values():
            for k in p["keys"]:
                by_key.setdefault(k, p)
        # THE LOG, once: the logs book's history and the Hub's own lines.
        rows = [{"actor": r.get("actor"), "action": r.get("action"), "at": r.get("timestamp"),
                 "area": r.get("area"), "ok": r.get("ok")}
                for r in hub_rows.log_lines(since_s, ["actor", "action", "timestamp", "area", "ok"])]
        newest = max((t for t in (_parse_iso(r["at"] or "") for r in rows) if t), default=None)
        source_at = newest.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if newest else ""

    agg: dict[str, dict] = {}
    machine_rows = 0
    unmatched: Counter = Counter()
    now = datetime.now(timezone.utc)
    rail_from = (now - timedelta(days=RAIL_DAYS)).date()
    for r in rows:
        actor = _caller(r["actor"] or "")
        if not actor:
            continue
        if _is_machine(actor):
            machine_rows += 1
            continue
        person = by_key.get(actor)
        if not person:
            unmatched[actor] += 1
            continue
        at = _parse_iso(r["at"] or "")
        if not at:
            continue
        local = at.astimezone(OHIO)
        m = agg.setdefault(person["subject_key"], {
            "person": person, "actions": 0, "apps": Counter(), "days": set(),
            "hours": [0] * 24, "night_actions": 0, "weekend_actions": 0,
            "distinct_actions": set(), "first": at, "last": at,
            "rail": Counter(), "failures": 0,
        })
        m["actions"] += 1
        m["apps"][app_of(r["action"] or "", mapped)] += 1
        m["distinct_actions"].add(_text(r["action"], 60))
        m["days"].add(local.date().isoformat())
        m["hours"][local.hour] += 1
        if local.hour >= NIGHT_FROM or local.hour < NIGHT_TO:
            m["night_actions"] += 1
        if local.weekday() >= 5:
            m["weekend_actions"] += 1
        if local.date() >= rail_from:
            m["rail"][local.date().isoformat()] += 1
        if _text(r["ok"], 10).lower() in ("false", "0", "no"):
            m["failures"] += 1
        if at < m["first"]:
            m["first"] = at
        if at > m["last"]:
            m["last"] = at

    shifts = _shifts_by_name()
    board: list[dict] = []
    signals: list[dict] = []
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    window = f"{WINDOW_DAYS}d"

    for person in people.values():
        m = agg.get(person["subject_key"])
        # THE JOIN, in the platform's own name key rather than a raw lowercase name — "Chyna white" and "Chyna…
        nkey = _hub_name_key(person["name"])
        s = shifts.get(nkey)
        if not s:
            for k in person["keys"]:
                # the phone has to be unique on BOTH sides — unique among the accounts (8 numbers are not) and…
                if not k.isdigit() or by_phone_key.get(k) != person["subject_key"]:
                    continue
                alt = roster_phone.get(k)
                if alt and shifts.get(alt):
                    s = shifts[alt]
                    break
        w = worked.get(person["subject_key"])
        absence = absences.get(person["subject_key"])
        # THE INCIDENT AXIS, JOINED ON THE SAME NAME KEY AS EVERYTHING ELSE — and None, never 0, whenever the…
        incident = (incidents.get("people") or {}).get(_hub_name_key(person["name"]))
        world = worlds.get(person["subject_key"], "")
        if not world:
            for k in person["keys"]:
                if worlds.get(k):
                    world = worlds[k]
                    break
        franchises = ([person["home_tenant"]] if person["home_tenant"] else []) + person["tenants"]
        if m:
            days = sorted(m["days"])
            metrics = {
                "actions": m["actions"],
                "active_days": len(days),
                "distinct_actions": len(m["distinct_actions"]),
                "night_actions": m["night_actions"],
                "weekend_actions": m["weekend_actions"],
                "failures": m["failures"],
                "longest_run_days": _longest_run(days),
                "first_seen": m["first"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                "last_seen": m["last"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                "hours": m["hours"],
                "rail": [{"day": (rail_from + timedelta(days=i)).isoformat(),
                          "n": m["rail"].get((rail_from + timedelta(days=i)).isoformat(), 0)}
                         for i in range(RAIL_DAYS + 1)],
            }
            top_apps = [{"app": a, "n": n} for a, n in m["apps"].most_common(8)]
            sample = "full" if m["actions"] >= 40 else "thin"
        else:
            metrics = {"actions": 0, "active_days": 0, "distinct_actions": 0,
                       "night_actions": 0, "weekend_actions": 0, "failures": 0,
                       "longest_run_days": 0, "first_seen": "", "last_seen": "",
                       "hours": [0] * 24, "rail": []}
            top_apps = []
            sample = "none"

        sv, sw = site_verdict(metrics) if sample != "none" else (
            "unknown", "this account has done nothing the platform recorded in this window")
        hv, hw = shift_verdict(s)
        wv, ww = work_verdict(w)
        # ONE READING FROM THE TWO AXES THAT MEASURE A RHYTHM.
        work_drives = bool(w and w.get("fresh"))
        axes = [("work", wv, ww)] if work_drives else []
        axes.append(("site", sv, sw))
        rhythm_v, rhythm_from, rhythm_why = rhythm_of(axes)
        if w and not work_drives:
            rhythm_why += (f" · their time clock is not counted here: its newest "
                           f"punch is {w['age_days']} days old")
        rv, rw = reach_verdict(person["home_tenant"], person["tenants"], world, len(places) or 1)
        apps_c = m["apps"] if m else Counter()
        # HABITS, counted from what the person DID — not from a tab a machine fills.
        forms_n = apps_c.get("forms", 0)
        img = apps_c.get("wellbeing", 0)

        # WHAT THEY WERE TRAINED TO DO, beside what they did this month.
        training = trainings.get(nkey)
        ist_row = ist.get(nkey)
        req_row = reqs.get(nkey)
        tv, tw = training_verdict(training)

        row = {
            "id": "BHV_" + person["subject_key"],
            "subject_kind": "client" if person["role"] == "client" else "person",
            "subject_key": person["subject_key"],
            "subject_name": person["name"],
            "role": person["role"],
            "title": person["title"],
            "types": person["types"],
            "active": person["active"],
            "armed": person["armed"],
            "roster_status": person["roster_status"],
            "window_days": WINDOW_DAYS,
            "computed_at": stamp,
            "sample": sample,
            "metrics": metrics,
            "top_apps": top_apps,
            "franchises": franchises,
            "world": world,
            "forms_actions": forms_n,
            "images_touched": img,
            "shifts": s or None,
            # THE WORKING LIFE, each source carrying its own age so a manager is never shown a three-month-old…
            "worked": w,
            "worked_as_of": worked_at, "worked_age_days": worked_age,
            "worked_fresh": work_drives,
            "absences": absence,
            "absences_as_of": calloff_at, "absences_age_days": calloff_age,
            "absences_known": calloff_age >= 0 and calloff_age <= WORK_WINDOW_DAYS,
            # THE INCIDENTS.
            "incidents": incident,
            "incidents_known": bool(incidents.get("emitted")),
            "incidents_why": incidents.get("refusal", "").split(" · ")[0][:240],
            "incidents_window": (incidents.get("windows") or {}).get("overlap") or None,
            "work_verdict": wv, "work_why": ww,
            "rhythm_verdict": rhythm_v, "rhythm_from": rhythm_from,
            "rhythm_why": rhythm_why,
            "site_verdict": sv, "site_why": sw,
            "shift_verdict": hv, "shift_why": hw,
            "reach_verdict": rv, "reach_why": rw,
            "training": training,
            "ist": ist_row,
            "requirements": req_row,
            "training_verdict": tv, "training_why": tw,
            "signals_hash": "",
        }
        row["signals_hash"] = hashlib.sha1(json.dumps({
            "a": metrics["actions"], "d": metrics["active_days"],
            "apps": top_apps, "f": franchises, "w": world, "i": img,
            "s": (s or {}).get("shifts"), "v": [sv, hv, rv, tv, wv, rhythm_v],
            # the punched rhythm joins the hash, so a week of nights or a run of quick turnarounds earns a fresh…
            "wk": [(w or {}).get("shifts"), (w or {}).get("hours"), (w or {}).get("nights"),
                   (w or {}).get("quick_turnarounds"), (w or {}).get("as_of")],
            "ab": [(absence or {}).get("count"), (absence or {}).get("as_of")],
            # the incident axis joins the hash only when it was actually emitted, so a shut gate never churns the…
            "in": [(incident or {}).get("incidents"), (incident or {}).get("shifts"),
                   (incident or {}).get("window")] if incident else None,
            # the courses join the hash, so a certificate that lapses or is renewed is enough on its own to earn a…
            "t": [(c["course"], c["state"]) for c in (training or {}).get("courses", [])],
            "ist": [(ist_row or {}).get("done"), (ist_row or {}).get("owed")],
            "rq": [(req_row or {}).get("expired"), (req_row or {}).get("missing")],
        }, sort_keys=True).encode()).hexdigest()[:16]
        board.append(row)

        # THE GENERIC ROWS — the same arithmetic, in the shape anything else may also enter: who · what · how much ·…
        def sig(name: str, value: Any, unit: str, detail: str = "") -> dict:
            key = f"{person['subject_key']}|{name}|{window}"
            return {
                "id": "SIG_" + hashlib.sha1(key.encode()).hexdigest()[:16],
                "subject_kind": row["subject_kind"],
                "subject_key": person["subject_key"],
                "subject_name": person["name"],
                "signal": name, "value": value, "unit": unit, "detail": detail,
                "at": stamp, "window": window, "source": "relay:behavior", "tenant": "",
                "payload": "",
            }

 # THE WHOLE PICTURE, AS ONE ROW.
        snapshot = {k: row[k] for k in (
            "subject_kind", "subject_key", "subject_name", "role", "title", "types",
            "active", "armed", "roster_status", "window_days", "computed_at", "sample",
            "metrics", "top_apps", "franchises", "world", "forms_actions",
            "images_touched", "shifts", "worked", "worked_as_of", "worked_age_days",
            "worked_fresh", "absences", "absences_as_of", "absences_age_days",
            "absences_known", "incidents", "incidents_known", "incidents_why",
            "incidents_window", "work_verdict", "work_why",
            "rhythm_verdict", "rhythm_from", "rhythm_why", "site_verdict", "site_why",
            "shift_verdict", "shift_why", "reach_verdict", "reach_why",
            "training", "ist", "requirements", "training_verdict", "training_why",
            "signals_hash")}
        blob = json.dumps(snapshot, separators=(",", ":"))
        if len(blob) > 7800:  # never a truncated JSON: drop the finest detail first
            trimmed = dict(snapshot)
            trimmed["metrics"] = {k: v for k, v in snapshot["metrics"].items() if k != "hours"}
            blob = json.dumps(trimmed, separators=(",", ":"))
        if len(blob) > 7800:  # then the obligation detail, whose counts survive
            trimmed["requirements"] = {k: v for k, v in (trimmed.get("requirements") or {}).items()
                                       if k != "wrong"} or None
            blob = json.dumps(trimmed, separators=(",", ":"))[:7800]
        signals.append(sig("profile.snapshot", sample, "snapshot",
                           f"{rhythm_v} · {row['site_verdict']} · {row['work_verdict']} "
                           f"· {row['shift_verdict']}"))
        signals[-1]["payload"] = blob

        if sample != "none":
            signals.append(sig("site.actions", metrics["actions"], "actions"))
            signals.append(sig("site.active_days", metrics["active_days"], "days"))
            signals.append(sig("site.night_actions", metrics["night_actions"], "actions"))
            signals.append(sig("site.weekend_actions", metrics["weekend_actions"], "actions"))
            signals.append(sig("site.longest_run", metrics["longest_run_days"], "days"))
            signals.append(sig("site.verdict", sv, "verdict", sw))
            for a in top_apps[:5]:
                signals.append(sig(f"app.{a['app']}", a["n"], "actions"))
        if s:
            signals.append(sig("shift.count", s["shifts"], "shifts"))
            signals.append(sig("shift.days", s["days"], "days"))
            signals.append(sig("shift.overnights", s["overnights"], "shifts"))
            signals.append(sig("shift.longest_run", s["longest_run_days"], "days"))
            signals.append(sig("shift.verdict", hv, "verdict", hw))
            if s["planned"]:
                signals.append(sig("shift.planned", s["planned"], "shifts",
                                   "rostered ahead — a plan, not a rhythm"))
        # THE PUNCHED RHYTHM.
        if w:
            age = f"as of {w['as_of']} ({w['age_days']}d old)"
            signals.append(sig("work.shifts", w["shifts"], "shifts", age))
            signals.append(sig("work.hours", w["hours"], "hours", age))
            if w["hours_per_week"] is not None:
                signals.append(sig("work.hours_per_week", w["hours_per_week"], "hours", age))
            if w["longest_stretch_h"] >= 24:
                signals.append(sig("work.longest_stretch", w["longest_stretch_h"], "hours",
                                   f"clocked in without a break between shifts · {age}"))
            signals.append(sig("work.nights", w["nights"], "shifts", age))
            signals.append(sig("work.night_run", w["night_run_days"], "nights", age))
            signals.append(sig("work.longest_run", w["longest_run_days"], "days", age))
            if w["quick_turnarounds"]:
                signals.append(sig("work.quick_turnarounds", w["quick_turnarounds"], "gaps",
                                   f"shortest {w['min_turnaround_h']}h · {age}"))
            signals.append(sig("work.verdict", wv, "verdict", f"{ww} · {age}"))
        # CALL-OFFS: the count and the type, never the reason.
        if absence:
            signals.append(sig("absence.count", absence["count"], "absences",
                               ", ".join(f"{t['type']} x{t['n']}" for t in absence["types"])
                               + f" · as of {absence['as_of']} ({absence['age_days']}d old)"))
        elif row["absences_known"]:
            signals.append(sig("absence.count", 0, "absences",
                               f"none on file in the {WORK_WINDOW_DAYS} day(s) to "
                               f"{calloff_at}"))
        # INCIDENTS: a rate, or NOTHING.
        if incident:
            signals.append(sig(
                "incident.per_100_shifts", incident["per_100_shifts"], "per 100 shifts",
                f"{incident['incidents']} incident(s) across {incident['shifts']} "
                f"shift(s), {incident['window']['first']} to "
                f"{incident['window']['last']} · "
                + ", ".join(f"{t['type']} x{t['n']}" for t in incident["types"])[:200]
                + " · a reading of wellbeing, never an order and never a gate"))
        signals.append(sig("rhythm.verdict", rhythm_v, "verdict",
                           (f"from the {rhythm_from} axis · " if rhythm_from else "") + rhythm_why))
        if img:
            signals.append(sig("habit.images", img, "actions"))
        if forms_n:
            signals.append(sig("habit.forms", forms_n, "actions"))
        if world or franchises:
            signals.append(sig("reach.verdict", rv, "verdict", rw))
        if training:
            # the LIST is the point of this lane: one row naming every course this person completed, so the house…
            signals.append(sig("training.completed", training["total"], "courses",
                               ", ".join(c["course"] for c in training["courses"])[:280]))
            signals.append(sig("training.verdict", tv, "verdict", tw))
            for state in ("valid", "expiring", "expired"):
                if training[state]:
                    signals.append(sig(f"training.{state}", training[state], "courses",
                                       ", ".join(c["course"] for c in training["courses"]
                                                 if c["state"] == state)[:280]))
        if ist_row:
            signals.append(sig("ist.done", ist_row["done"], "records",
                               f"{ist_row['plans']} client plan(s)"))
            if ist_row["owed"]:
                signals.append(sig("ist.owed", ist_row["owed"], "records"))
        if req_row:
            for state in ("ok", "missing", "expiring", "expired"):
                if req_row[state]:
                    signals.append(sig(f"req.{state}", req_row[state], "requirements"))

    board.sort(key=lambda r: (-r["metrics"]["actions"], r["subject_name"].lower()))
    # the platform's own machines, said out loud rather than dropped in silence
    board_meta = {
        "id": "BHV_platform", "subject_kind": "platform", "subject_key": "platform",
        "subject_name": "The platform's own machines", "role": "machine",
        "window_days": WINDOW_DAYS, "computed_at": stamp, "sample": "full",
        "metrics": {"actions": machine_rows, "active_days": 0, "distinct_actions": 0,
                    "night_actions": 0, "weekend_actions": 0, "failures": 0,
                    "longest_run_days": 0, "first_seen": "", "last_seen": "",
                    "hours": [0] * 24, "rail": []},
        "top_apps": [], "franchises": [], "forms_actions": 0, "images_touched": 0,
        "shifts": None, "site_verdict": "machine",
        "site_why": f"{machine_rows} row(s) written by the platform's own sweeps, judged as nobody's work",
        "shift_verdict": "unknown", "shift_why": "", "reach_verdict": "single", "reach_why": "",
        "work_verdict": "unknown", "work_why": "", "worked": None,
        "rhythm_verdict": "unknown", "rhythm_from": "", "rhythm_why": "",
        "absences": None,
        # HOW OLD THE WORKING LIFE IS, said once for the whole board.
        "worked_as_of": worked_at, "worked_age_days": worked_age,
        "worked_fresh": 0 <= worked_age <= WORK_FRESH_DAYS,
        "worked_people": len(worked),
        "absences_as_of": calloff_at, "absences_age_days": calloff_age,
        "absences_known": 0 <= calloff_age <= WORK_WINDOW_DAYS,
        "absences_people": len(absences),
        # THE INCIDENT ACCOUNTING, SAID ONCE FOR THE WHOLE BOARD AND WITH NO NAME IN IT.
        "incidents": None,
        "incidents_known": bool(incidents.get("emitted")),
        "incidents_looked": bool(incidents.get("looked")),
        "incidents_unavailable": incidents.get("unavailable", ""),
        "incidents_why": incidents.get("refusal", ""),
        "incidents_windows": incidents.get("windows") or None,
        "incidents_coverage": incidents.get("coverage") or None,
        "incidents_gate": incidents.get("gate") or None,
        "incidents_types": incidents.get("types") or [],
        "incidents_people": len(incidents.get("people") or {}),
        # WHICH CONFIGURATION THIS PASS OBEYED, and the one number it decides.
        "ist_config_source": ist_config_source,
        "ist_expiring_days": _expiring_days(),
        "signals_hash": "", "unattributed_actors": len(unmatched),
        "unattributed_rows": sum(unmatched.values()),
    }
    board.append(board_meta)
    return board, signals, source_at


def _cached(dsn: str) -> tuple[list[dict], list[dict], str]:
    if _CACHE["board"] is not None and (time.time() - _CACHE["at"]) < CACHE_S:
        return _CACHE["board"], _CACHE["signals"], _CACHE["source_at"]
    board, signals, source_at = _measure(dsn)
    _CACHE.update({"at": time.time(), "board": board, "signals": signals, "source_at": source_at})
    return board, signals, source_at


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """build_one's dispatch shape, same as hr_slices.build."""
    if resource not in RESOURCES:
        raise KeyError(resource)
    board, _signals, source_at = _cached(dsn)
    return board, source_at or None


def signals_payload(dsn: str) -> dict:
    """What the relay hands to Apps Script for the `behavior_signals` house."""
    board, signals, source_at = _cached(dsn)
    people = [r for r in board if r["subject_kind"] != "platform"]
    return {
        "rows": signals,
        "source_at": source_at,
        "window": f"{WINDOW_DAYS}d",
        "source": "relay:behavior",
        "people": len(people),
        "read": sum(1 for r in people if r["sample"] != "none"),
    }


if __name__ == "__main__":  # a read-only probe: counts, never a person's name
    import sys
    dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    b, s, at = _measure(dsn)
    people = [r for r in b if r["subject_kind"] != "platform"]
    read = [r for r in people if r["sample"] != "none"]
    print(json.dumps({
        "source_at": at,
        "accounts": len(people),
        "with_evidence": len(read),
        "signals": len(s),
        "site_verdicts": dict(Counter(r["site_verdict"] for r in people)),
        "shift_verdicts": dict(Counter(r["shift_verdict"] for r in people)),
        "work_verdicts": dict(Counter(r["work_verdict"] for r in people)),
        "rhythm_verdicts": dict(Counter(r["rhythm_verdict"] for r in people)),
        "rhythm_from": dict(Counter(r["rhythm_from"] for r in people)),
        # what the new axis actually changed, counted rather than claimed
        "work_changed_verdict": sum(1 for r in people
                                    if r["rhythm_verdict"] != r["site_verdict"]),
        "quiet_rescued": sum(1 for r in people if r["site_verdict"] in ("quiet", "unknown")
                             and r["rhythm_verdict"] not in ("quiet", "unknown")),
        "with_worked": sum(1 for r in people if r["worked"]),
        "worked_as_of": next((r.get("worked_as_of") for r in b
                              if r["subject_kind"] == "platform"), ""),
        "worked_age_days": next((r.get("worked_age_days") for r in b
                                 if r["subject_kind"] == "platform"), None),
        "with_absences": sum(1 for r in people if r["absences"]),
        "absences_as_of": next((r.get("absences_as_of") for r in b
                                if r["subject_kind"] == "platform"), ""),
        # THE INCIDENT AXIS, PROBED AS WHAT IT IS.
        "incidents_looked": next((r.get("incidents_looked") for r in b
                                  if r["subject_kind"] == "platform"), None),
        "incidents_known": next((r.get("incidents_known") for r in b
                                 if r["subject_kind"] == "platform"), None),
        "incidents_gate": next((r.get("incidents_gate") for r in b
                                if r["subject_kind"] == "platform"), None),
        "incidents_windows": next((r.get("incidents_windows") for r in b
                                   if r["subject_kind"] == "platform"), None),
        "incidents_coverage": next((r.get("incidents_coverage") for r in b
                                    if r["subject_kind"] == "platform"), None),
        "incidents_why": next((r.get("incidents_why") for r in b
                               if r["subject_kind"] == "platform"), ""),
        "with_incidents": sum(1 for r in people if r["incidents"]),
        "incident_signals": sum(1 for x in s if x["signal"].startswith("incident.")),
        "with_shifts": sum(1 for r in people if r["shifts"]),
        "with_planned_only": sum(1 for r in people
                                 if r["shifts"] and not r["shifts"]["shifts"]
                                 and r["shifts"]["planned"]),
        "with_images": sum(1 for r in people if r["images_touched"]),
        "multi_place": sum(1 for r in people if len(r["franchises"]) > 1),
        "apps_seen": sorted({a["app"] for r in read for a in r["top_apps"]}),
        # which configuration this probe's numbers were computed against
        "ist_config_source": next((r.get("ist_config_source") for r in b
                                   if r["subject_kind"] == "platform"), ""),
        "ist_expiring_days": next((r.get("ist_expiring_days") for r in b
                                   if r["subject_kind"] == "platform"), None),
        "machine_rows": next((r["metrics"]["actions"] for r in b if r["subject_kind"] == "platform"), 0),
        "unattributed": next((r.get("unattributed_rows") for r in b if r["subject_kind"] == "platform"), 0),
    }, indent=1))
