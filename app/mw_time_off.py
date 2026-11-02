"""Time off for My Work (server/time_off.py translated): the records as Postgres keeps them once Time Off is Python's
(time_off_rows), else the Time Off house read off asa-hub-db, the relay's own writes laid on."""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import hubdb
import mw_relay_state
import mw_roster
import mw_shifts
import time_off_rows
from scope import Defer

OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc

TAB = "time_off"
SETTINGS_TAB = "settings"
PROP = "HUB_HOUSE_TIME_OFF_ID"
ESSENCIAL_SHEET_ID = hubdb.ESSENCIAL_ID
FACTS_TAB = hubdb.FACTS_TAB
WRITES_TABLE = "asa_time_off_writes"

HEADER = (
    "id", "createdAt", "updatedAt",
    "person", "person_key", "start_date", "end_date", "days", "houses",
    "reason_given", "time_off_reason",
    "status", "status_why",
    "filed_by", "filed_by_key", "filed_via",
    "hm_mode", "hm_asked", "hm_why", "hm_state", "hm_by", "hm_via", "hm_at", "hm_note",
    "dir_asked", "dir_state", "dir_by", "dir_via", "dir_at", "dir_note",
    "decided_at", "closed_by", "closed_at", "closed_note",
    "effects", "test_mode",
    "source", "source_key", "source_rows", "calendar_name", "flags",
)
SETTINGS_HEADER = ("key", "value", "note", "updatedAt")
REASON_COL = "time_off_reason"
ID_COL = {TAB: "id", SETTINGS_TAB: "key"}

REF_RE = re.compile(r"\bTO[0-9A-F]{10}\b")
NO_DIRECTORS_WHY = "the Time Off house's Settings tab names no director (Settings → Time Off → directors)"
NO_DIRECTORS = f"{NO_DIRECTORS_WHY} — the director half waits until one is named there"
DIRECTORS_UNREAD = ("the Time Off house's directors list could not be read (its Settings tab carries no "
                    "`directors` row)")

PENDING, SCHEDULED, DENIED, WITHDRAWN = "pending", "scheduled", "denied", "withdrawn"
CANCELLED, EXPIRED, REVIEW, HISTORY = "cancelled", "expired", "needs_review", "history"
STATUSES = (PENDING, SCHEDULED, DENIED, WITHDRAWN, CANCELLED, EXPIRED, REVIEW, HISTORY)
CLOSED = frozenset({DENIED, WITHDRAWN, CANCELLED, EXPIRED, HISTORY})

WAITING, APPROVED, NOT_APPROVED, MIGRATED = "waiting", "approved", "denied", "migrated"
DONE_LEG = frozenset({APPROVED, MIGRATED})
MODE_HM, MODE_ABOVE = "house_manager", "above"
LEG_HM, LEG_DIR = "hm", "dir"

VIA = ("platform", "form", "migration", "sms", "hotline", "phone")
FILED_VIA_DOORS = ("platform", "hotline", "phone")
DECIDE_VIA = ("platform", "email", "sms", "migration")
MIGRATED_BY = "the Master Calendar Creator form, before the platform"

# No `directors` here: the key is present only when the house's Settings tab carries the row.
SETTINGS_DEFAULTS = {"form_sync": "on", "form_cutover_at": "", "form_watermark": ""}
# the operator's rule (2026-10-28): wherever the platform names its directors, every live Platform Lead is among them —
# read off the accounts' own table into the view, folded in by directors_of, never written into the Settings cell
LEADS_KEY = "_platform_leads"
LEADS_SQL = ("SELECT coalesce(nullif(cells->>'display_name', ''), cells->>'email') FROM app.resource_rows "
             "WHERE resource = 'usersHouse' AND removed_at IS NULL AND upper(coalesce(cells->>'types', '') || ',' || "
             "coalesce(cells->>'role', '')) ~ '(^|[^A-Z])PLATFORMLEAD([^A-Z]|$)' AND upper(coalesce(cells->>'active', "
             "'')) NOT IN ('FALSE', '0', 'NO') AND coalesce(cells->>'merged_into', '') = ''")

REASON_MAX = 500
MAX_DAYS = int(os.getenv("HUB_TIME_OFF_MAX_DAYS", "120"))
UPCOMING_DAYS = 14
SOON_DAYS = 3
GONE_AFTER_S = 900.0

REFUSED_ROLES = frozenset({"client", "guardian", "onboarding", "interviewer"})
REFUSED_BADGES = frozenset({"CLIENT", "FAMILY", "SSA"})
FAMILY_BADGES = frozenset({"FAMILY", "SSA"})
WORKING_ROLES = frozenset({"staff", "manager", "admin"})

LINK_PATH = "/#/app/timeoff/requests"
APP_PATH = "/app/timeoff/requests"

NOT_SET_UP = "time off is not set up on this server yet"
# every copy withholds the reason column; it is never read from Google here
_WITHHELD = re.compile(r"^\[withheld: [a-z]+\]")


class Unreadable(hubdb.Unreadable):
    """A read that failed: never an empty answer."""


# ── the reader behind a request ─────────────────────────────────────────────

def _db(src: Any) -> Any:
    """The asa-hub-db reader behind a session, a request's reads, or the reader itself."""
    src = getattr(src, "reads", None) or src
    return getattr(src, "db", None) or src


def _memo(src: Any, name: str, read: Any) -> Any:
    reads = getattr(src, "reads", None) or src
    once = getattr(reads, "once", None)
    return once(name, read) if callable(once) else read()


# ── small words ─────────────────────────────────────────────────────────────

def fold(name: Any) -> str:
    """The platform's own name key (`clientNameKey_`)."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def _words(name: Any) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", str(name or "").lower()) if w]


def same_person(a: Any, b: Any) -> bool:
    """Fold equality, or first and last word equal once one-letter middles are dropped."""
    fa, fb = fold(a), fold(b)
    if not fa or not fb:
        return False
    if fa == fb:
        return True
    wa = [w for w in _words(a) if len(w) > 1]
    wb = [w for w in _words(b) if len(w) > 1]
    if len(wa) < 2 or len(wb) < 2:
        return False
    return wa[0] == wb[0] and wa[-1] == wb[-1]


def named_as(name: Any, listed: Any) -> bool:
    """The listed name itself, or its words with its middle initial left out — never another middle."""
    fa, fb = fold(name), fold(listed)
    if not fa or not fb:
        return False
    if fa == fb:
        return True
    wa, wb = _words(name), _words(listed)
    long_a, long_b = [w for w in wa if len(w) > 1], [w for w in wb if len(w) > 1]
    if len(long_a) < 2 or long_a != long_b:
        return False
    ia, ib = [w for w in wa if len(w) == 1], [w for w in wb if len(w) == 1]
    return not ia or ia == ib


def _now() -> datetime:
    return datetime.now(UTC)


def stamp(at: datetime | None = None) -> str:
    return (at or _now()).astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _at(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        got = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


def _when(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    return _at(raw)


def today() -> date:
    return datetime.now(OHIO).date()


def day_of(raw: Any) -> date | None:
    try:
        return date.fromisoformat(str(raw or "").strip()[:10])
    except ValueError:
        return None


def day_words(raw: Any) -> str:
    d = day_of(raw) if not isinstance(raw, date) else raw
    return f"{d.strftime('%a')} {d.month}/{d.day}" if d else str(raw or "")


def dates_words(start: Any, end: Any) -> str:
    if str(start or "") == str(end or "") or not end:
        return day_words(start)
    return f"{day_words(start)} - {day_words(end)}"


def _list(cell: Any) -> list[str]:
    return [p.strip() for p in str(cell or "").split(",") if p.strip()]


def _json(cell: Any) -> dict[str, Any]:
    if isinstance(cell, dict):
        return cell
    try:
        got = json.loads(str(cell or "") or "{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def _label_of(home_name: Any, code: Any = "") -> str:
    """house_directory.label_of: "CAN - JH - ABD2704" → "JH", the region prefix and the code both go."""
    parts = [p.strip() for p in str(home_name or "").split(" - ") if p.strip()]
    code = str(code or "").strip()
    if parts and code and parts[-1].upper() == code.upper():
        parts = parts[:-1]
    elif len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,4}\d{3,6}", parts[-1]):
        parts = parts[:-1]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{3}", parts[0]):
        parts = parts[1:]
    return " - ".join(parts) or code


def _code_of(house: Any) -> str:
    text = str(house or "").strip()
    last = text.split(" - ")[-1].strip() if text else ""
    return last.upper()


def _short_house(location: str) -> str:
    return _label_of(location, _code_of(location)) or location


def house_label(code: str, view: dict[str, Any] | None = None) -> str:
    loc = ((view or {}).get("by_code") or {}).get(code) or code
    return _short_house(loc) or code


# ── the house: its pointer, its two tabs and the relay's writes over them ──

_DECLARED: dict[str, str] = {}


def house_id(src: Any) -> str:
    """'' when no house is declared; a failed read answers the last declaration read, else raises Unreadable."""
    override = os.getenv("HUB_TIME_OFF_HOUSE_ID", "").strip()
    if override:
        return override
    db = _db(src)
    key = str(getattr(db, "dsn", "") or "")
    try:
        ref = db.tab(ESSENCIAL_SHEET_ID, FACTS_TAB)
        props = db.switchboard("props") if ref is not None and ref.row_count else None
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001
        if key in _DECLARED:
            return _DECLARED[key]
        raise Unreadable(f"the Essencial's Facts could not be read ({type(exc).__name__})") from exc
    if props is None:
        if key in _DECLARED:
            return _DECLARED[key]
        raise Unreadable("the Essencial's Facts are not in asa-hub-db")
    _DECLARED[key] = str(props.get(PROP) or "").strip()
    return _DECLARED[key]


def _copy(db: Any, sid: str, tab: str) -> tuple[list[tuple[int, dict[str, Any]]], str]:
    """(sheet row, cells) as asa-hub-db holds the tab, with Python's kept edits laid, and when its book was synced."""
    ref = db.tab(sid, tab)
    got = db.rows(ref) if ref is not None else []
    rows = [(int(rn), d if isinstance(d, dict) else _json(d)) for rn, d in got]
    book = db.book(sid)
    synced = _when(getattr(book, "synced_at", None)) if book is not None else None
    return rows, stamp(synced) if synced else ""


def _overlay() -> list[dict[str, Any]]:
    return [dict(r) for r in mw_relay_state.rows(WRITES_TABLE)]


def _kept(db: Any, tab: str) -> list[dict[str, Any]]:
    """The tab's rows as Postgres keeps them, shaped as lay shapes the copy's."""
    blank = dict.fromkeys(HEADER if tab == TAB else SETTINGS_HEADER, "")
    return [{**blank, **{h: str(v if v is not None else "") for h, v in cells.items()}, "_row_number": n}
            for n, cells in time_off_rows.rows_of(db, tab) if str(cells.get(ID_COL[tab]) or "").strip()]


def lay(copied: list[tuple[int, dict[str, Any]]], overlay: list[dict[str, Any]], tab: str,
        as_of: Any = "") -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    """Copy rows with the overlay on top; an overlay row the copy caught up with, or lost, is left out."""
    synced = _when(as_of)
    key = ID_COL[tab]
    by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for rn, data in copied:
        rid = str((data or {}).get(key) or "").strip()
        if not rid:
            continue
        if rid not in by_id:
            order.append(rid)
        by_id[rid] = {**{h: str(v if v is not None else "") for h, v in (data or {}).items()},
                      "_row_number": rn}
    gone: list[tuple[str, str]] = []
    for o in overlay:
        if o.get("tab") != tab:
            continue
        rid = str(o.get("id") or "")
        row = o.get("row") if isinstance(o.get("row"), dict) else _json(o.get("row"))
        held = by_id.get(rid)
        if held is not None:
            ours, theirs = _at(row.get("updatedAt")), _at(held.get("updatedAt"))
            if theirs is not None and (ours is None or theirs >= ours):
                gone.append((tab, rid))
                continue
        else:
            written = _when(o.get("written_at"))
            if synced is not None and written is not None \
                    and (synced - written).total_seconds() > GONE_AFTER_S:
                gone.append((tab, rid))
                continue
        if rid not in by_id:
            order.append(rid)
        mark = (held or {}).get(REASON_COL, "")
        by_id[rid] = {**{h: str(v if v is not None else "") for h, v in row.items()},
                      "_row_number": int(o.get("row_number") or (held or {}).get("_row_number") or 0),
                      REASON_COL: mark}
    return [by_id[r] for r in order], gone


def view(src: Any, *, fresh: bool = False) -> dict[str, Any]:
    """{minted, id, rows, settings, as_of}; raises Unreadable, never answers an empty house for a failed read."""
    def read() -> dict[str, Any]:
        db = _db(src)
        sid = house_id(db)
        if not sid:
            return {"minted": False, "id": "", "rows": [], "settings": dict(SETTINGS_DEFAULTS),
                    "as_of": "", "read_at": stamp()}
        try:
            kept = time_off_rows.owned(db)
            known = kept or db.book(sid) is not None
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001
            raise Unreadable(f"the time off records could not be read ({type(exc).__name__})") from exc
        if not known:
            raise Unreadable("the time off records could not be read (asa-hub-db holds no copy of the Time Off house)")
        try:
            if kept:
                rows_, sets, as_of = _kept(db, TAB), _kept(db, SETTINGS_TAB), stamp()
            else:
                rows_m, as_of = _copy(db, sid, TAB)
                sets_m, _ = _copy(db, sid, SETTINGS_TAB)
                overlay = _overlay()
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001
            raise Unreadable(f"the time off records could not be read ({type(exc).__name__})") from exc
        if not kept:
            rows_, _gone = lay(rows_m, overlay, TAB, as_of)
            sets, _gone2 = lay(sets_m, overlay, SETTINGS_TAB, as_of)
        sets_ = dict(SETTINGS_DEFAULTS)
        for s in sets:
            k, v = str(s.get("key") or "").strip(), str(s.get("value") or "").strip()
            if k.lower() == "directors":
                # present even when blank: a blank cell names nobody, a missing row is unreadable
                sets_["directors"] = v
            elif v:
                sets_[k] = v
        sets_[LEADS_KEY] = _platform_leads(db)
        return {"minted": True, "id": sid, "rows": rows_, "settings": sets_,
                "settings_rows": sets, "as_of": as_of, "read_at": stamp()}
    return read() if fresh else _memo(src, "mw_time_off.view", read)


def rows(src: Any, *, fresh: bool = False) -> list[dict[str, Any]]:
    return view(src, fresh=fresh)["rows"]


def settings(src: Any, *, fresh: bool = False) -> dict[str, str]:
    return view(src, fresh=fresh)["settings"]


def migrated(v: dict[str, Any]) -> bool:
    """The Builder reads the house once the migration has set its cutover; the form's tab until then."""
    return bool(v.get("minted")) and bool(str((v.get("settings") or {}).get("form_cutover_at") or "").strip())


def directors_of(sets: dict[str, Any]) -> list[str]:
    """The board the Settings cell names, never a name in code — and every live Platform Lead the view read beside it,
    once each."""
    if "directors" not in (sets or {}):
        raise Unreadable(DIRECTORS_UNREAD)
    names = _list(sets.get("directors"))
    for n in sets.get(LEADS_KEY) or []:
        if not any(named_as(n, d) for d in names):
            names.append(n)
    return names


def _platform_leads(db: Any) -> list[str]:
    """The live Platform Leads' names; none when the accounts cannot be read — the written board still stands."""
    try:
        return [str(n).strip() for (n,) in db.query(LEADS_SQL) if str(n or "").strip()]
    except Exception:  # noqa: BLE001 - a lead not read is a lead not added, never a board refused
        return []


def board(v: dict[str, Any]) -> dict[str, Any]:
    """{readable, names, why}: `names` is [] both for a blank cell and for a list that could not be read."""
    if not v.get("minted"):
        return {"readable": False, "names": [], "why": f"{NOT_SET_UP}, so no directors list can be read"}
    try:
        names = directors_of(v.get("settings") or {})
    except Unreadable as exc:
        return {"readable": False, "names": [], "why": str(exc)}
    return {"readable": True, "names": names, "why": "" if names else NO_DIRECTORS}


def directors(src: Any) -> list[str]:
    return directors_of(settings(src))


def directors_declared(src: Any) -> list[str]:
    """The declared board ([] for a blank cell); raises Unreadable when there is no house to read it from."""
    v = view(src)
    if not v.get("minted"):
        raise Unreadable("no Time Off house is declared, so its directors list could not be read")
    return directors_of(v["settings"])


def _waits_words(lead: str = "") -> str:
    """The stored status line of a request both halves are still owed on."""
    return f"{lead}waiting on the house manager and a director"


def status_words(row: dict[str, Any], brd: dict[str, Any] | None) -> str:
    """The row's status line as the board stands now: a pending row says a list that could not be read."""
    said = str(row.get("status_why") or "")
    if brd is None or row.get("status") != PENDING:
        return said
    lead = f"{said}; " if said else ""
    if not brd["readable"]:
        return f"{lead}{brd['why']} — nothing is decided until it can be read"
    if row.get("dir_state") != WAITING:
        return said
    if not _eligible(brd["names"], str(row.get("person") or ""), str(row.get("filed_by") or "")):
        return f"{lead}{_dir_why(brd['names'], [])}"
    return said


def _eligible(dirs: list[str], person: str, filed_by: str) -> list[str]:
    """The listed directors who may answer this request: never its person, never whoever filed it."""
    excluded = {fold(person), fold(filed_by)} - {""}
    return [d for d in dirs if fold(d) not in excluded
            and not any(same_person(d, x) for x in (person, filed_by) if x)]


def _dir_why(dirs: list[str], named: list[str]) -> str:
    """Who answers the director half, or why nobody can: a blank list, or every name on it is in it."""
    if named:
        return "a director on the Time Off list approves: " + ", ".join(named)
    if dirs:
        return (f"every director on the Time Off list ({', '.join(dirs)}) is part of this request, and nobody "
                f"decides their own — the director half waits until another name is saved on Settings → "
                f"Time Off")
    return NO_DIRECTORS


def find(v: dict[str, Any], ref: str) -> dict[str, Any] | None:
    ref = str(ref or "").strip().upper()
    return next((r for r in v["rows"] if str(r.get("id") or "").upper() == ref), None)


def describe_wait(row: dict[str, Any]) -> str:
    st = row.get("status")
    if st == SCHEDULED:
        return "already scheduled"
    if st == REVIEW:
        return "waiting for review"
    hm, dr = row.get("hm_state"), row.get("dir_state")
    if hm == WAITING and dr == WAITING:
        return "waiting on the house manager and a director"
    if hm == WAITING:
        return "waiting on the house manager"
    if dr == WAITING:
        return "waiting on the director"
    return f"{st}"


# ── the reason: only as asa-hub-db holds it ─────────────────────────────────

def reason_of(src: Any, row: dict[str, Any]) -> tuple[str, str]:
    """(text, why) — why is '' when the text was read; a withheld cell is never fetched from Google: the relay answers."""
    if str(row.get("reason_given") or "").lower() != "yes":
        return "", ""
    text = str(row.get(REASON_COL) or "")
    if text.strip() and not _WITHHELD.match(text.strip()):
        return text, ""
    db = _db(src)
    if time_off_rows.owned(db):
        return time_off_rows.reason(db, str(row.get("id") or "")), ""
    raise Defer("a time-off reason the reader may see is withheld in asa-hub-db, so the relay answers")


# ── who is reading ──────────────────────────────────────────────────────────

def _worn(who: dict[str, Any]) -> set[str]:
    return {str(b).strip().upper() for b in (who or {}).get("badges") or []}


def refused_reader(who: dict[str, Any]) -> bool:
    role = str((who or {}).get("role") or "").strip().lower()
    if role in REFUSED_ROLES:
        return True
    # an SSA or a FAMILY is refused whatever its role says (the operator's sheet: Time Off is shut to both)
    if _worn(who) & FAMILY_BADGES:
        return True
    return role not in WORKING_ROLES and bool(_worn(who) & REFUSED_BADGES)


def is_director(who: dict[str, Any], dirs: Iterable[str]) -> bool:
    name = str((who or {}).get("name") or "")
    return bool(fold(name)) and any(named_as(name, d) for d in dirs)


def every_house(who: dict[str, Any]) -> bool:
    return bool((who or {}).get("decides_everywhere"))


def reason_visible(who: dict[str, Any], row: dict[str, Any], dirs: Iterable[str]) -> bool:
    me = fold((who or {}).get("name"))
    if me and me in (fold(row.get("person")), fold(row.get("filed_by"))):
        return True
    if every_house(who) or is_director(who, dirs):
        return True
    if me and any(fold(n) == me for n in _list(row.get("hm_asked"))):
        return True
    managed = set((who or {}).get("manages") or [])
    return bool(managed & set(_list(row.get("houses"))))


# ── the two legs ────────────────────────────────────────────────────────────

def _current_managers(row: dict[str, Any], managers: dict[str, Any] | None) -> list[str]:
    out: list[str] = []
    for code in _list(row.get("houses")):
        hm = ((managers or {}).get("by_code") or {}).get(code) or {}
        for n in hm.get("names") or ([hm.get("name")] if hm.get("name") else []):
            if n and not any(fold(n) == fold(x) for x in out):
                out.append(n)
    return out


def leg_for(who: dict[str, Any], row: dict[str, Any], dirs: list[str],
            managers: dict[str, Any] | None) -> tuple[str, str, str]:
    """(leg, why, code); leg is '' when this reader may decide nothing — the why says what refused."""
    name = str((who or {}).get("name") or "")
    me = fold(name)
    person = str(row.get("person") or "")
    if me and me == fold(person) or (me and same_person(name, person)):
        return "", "you cannot decide your own time off", "own"
    if me and (me == fold(row.get("filed_by")) or same_person(name, row.get("filed_by"))):
        return "", "you filed this request — the other half is somebody else's", "filed"
    # the master's own session is an eligible director; a name keeps it to one half
    director = is_director(who, dirs) or (bool(me) and (who or {}).get("is_master") is True)
    hm_named = bool(me) and (any(fold(n) == me for n in _list(row.get("hm_asked")))
                             or any(fold(n) == me for n in _current_managers(row, managers)))
    mode = str(row.get("hm_mode") or "")
    above = mode == MODE_ABOVE and (director or every_house(who))
    hm_waiting = row.get("hm_state") == WAITING
    dir_waiting = row.get("dir_state") == WAITING
    if me and (fold(row.get("hm_by")) == me or same_person(name, row.get("hm_by"))):
        return "", (f"{row.get('hm_by')} already approved as house manager — a director approves "
                    f"the other half"), "one_leg"
    if me and (fold(row.get("dir_by")) == me or same_person(name, row.get("dir_by"))):
        return "", (f"{row.get('dir_by')} already approved as director — the house manager approves "
                    f"the other half"), "one_leg"
    if hm_waiting and mode == MODE_HM and hm_named:
        return LEG_HM, "", "ok"
    if dir_waiting and director:
        return LEG_DIR, "", "ok"
    if hm_waiting and above:
        return LEG_HM, "", "ok"
    if hm_waiting and not mode:
        where = ", ".join(house_label(c) for c in _list(row.get("houses"))) or "the person's houses"
        if not (managers or {}).get("readable"):
            return "", f"who manages {where} could not be read — nothing was decided", "managers_unreadable"
    if hm_named and not hm_waiting:
        return "", f"the house manager half is already {row.get('hm_state')} ({row.get('hm_by')})", "answered"
    if director and not dir_waiting:
        return "", f"the director half is already {row.get('dir_state')} ({row.get('dir_by')})", "answered"
    if dir_waiting and not hm_named:
        return "", ("only the directors on the Time Off list approve the director half "
                    "(Settings → Time Off)"), "not_a_director"
    return "", "this request is not waiting on you", "not_yours"


def legs_of(row: dict[str, Any]) -> dict[str, Any]:
    return {"hm": {"mode": row.get("hm_mode") or "", "asked": _list(row.get("hm_asked")),
                   "why": row.get("hm_why") or "", "state": row.get("hm_state") or "",
                   "by": row.get("hm_by") or "", "via": row.get("hm_via") or "",
                   "at": row.get("hm_at") or "", "note": row.get("hm_note") or ""},
            "dir": {"asked": _list(row.get("dir_asked")), "state": row.get("dir_state") or "",
                    "by": row.get("dir_by") or "", "via": row.get("dir_via") or "",
                    "at": row.get("dir_at") or "", "note": row.get("dir_note") or ""}}


def shape(row: dict[str, Any], who: dict[str, Any] | None, dirs: list[str],
          managers: dict[str, Any] | None, est: dict[str, Any] | None = None,
          on: date | None = None, brd: dict[str, Any] | None = None) -> dict[str, Any]:
    """One row as a screen may see it: never the reason itself."""
    on = on or today()
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    me = fold((who or {}).get("name"))
    leg = ""
    on_me: bool | None = False
    if who is not None and row.get("status") == PENDING:
        got, _why, code = leg_for(who, row, dirs, managers)
        if brd is None or brd["readable"]:
            leg, on_me = got, bool(got)
        elif code not in ("own", "filed", "one_leg"):
            # FAIL-CLOSED: the list decides whether this reader has a half here, and it did not land.
            on_me = None
    effects = _json(row.get("effects"))
    return {
        "ref": row.get("id") or "", "person": row.get("person") or "",
        "start": a.isoformat() if a else "", "end": b.isoformat() if b else "",
        "days": int(row.get("days") or 0) if str(row.get("days") or "").isdigit() else (
            (b - a).days + 1 if a and b and b >= a else 0),
        "houses": [{"code": c, "label": house_label(c, est)} for c in _list(row.get("houses"))],
        "status": row.get("status") or "", "status_why": status_words(row, brd),
        "past": bool(row.get("status") == SCHEDULED and b is not None and b < on),
        "filed_by": row.get("filed_by") or "", "filed_via": row.get("filed_via") or "",
        "created_at": row.get("createdAt") or "", "updated_at": row.get("updatedAt") or "",
        **legs_of(row),
        "decided_at": row.get("decided_at") or "",
        "closed": {"by": row.get("closed_by") or "", "at": row.get("closed_at") or "",
                   "note": row.get("closed_note") or ""},
        "test_mode": row.get("test_mode") == "on", "flags": _list(row.get("flags")),
        "calendar_name": row.get("calendar_name") or "", "source": row.get("source") or "",
        "reason_given": str(row.get("reason_given") or "").lower() == "yes",
        "unplaced": len(effects.get("unplaced") or []),
        "mine": bool(me) and me in (fold(row.get("person")), fold(row.get("filed_by"))),
        "leg": leg, "waiting_on_me": on_me,
    }


# ── who files for whom (My Calendar) ────────────────────────────────────────

def scope_of(who: dict[str, Any], dirs: Iterable[str]) -> str:
    """refused | own | houses | all."""
    if refused_reader(who):
        return "refused"
    if every_house(who) or is_director(who, dirs):
        return "all"
    if str((who or {}).get("role") or "").strip().lower() in mw_shifts.sr.CALENDAR_EDIT_ROLES:
        return "all"
    if (who or {}).get("manages"):
        return "houses"
    return "own"


def _drawn_people(est: dict[str, Any], codes: Iterable[str]) -> set[str]:
    want = set(codes)
    out: set[str] = set()
    for loc in est.get("locations") or []:
        if (mw_shifts.house_directory.code_of(loc) or loc.upper()) not in want:
            continue
        for n in (est.get("people") or {}).get(loc, []):
            if not mw_shifts.sr.not_a_person(n, loc):
                out.add(fold(n))
    return out


def may_withdraw(who: dict[str, Any], row: dict[str, Any], on: date | None = None) -> bool:
    me = fold((who or {}).get("name"))
    if not me or me not in (fold(row.get("person")), fold(row.get("filed_by"))):
        return False
    st = row.get("status")
    if st in (PENDING, REVIEW):
        return True
    start = day_of(row.get("start_date"))
    return st == SCHEDULED and start is not None and (on or today()) < start


def _may_file_for(who: dict[str, Any], dirs: list[str]) -> str:
    scope = scope_of(who, dirs)
    return {"all": "anybody", "houses": "houses", "own": "self"}.get(scope, "")


def reach_refusal(who: dict[str, Any], person: str, est: dict[str, Any], dirs: list[str]) -> str:
    """The sentence when this reader may not file for (or look into) this person; '' when they may."""
    reach = _may_file_for(who, dirs)
    if not reach:
        return "this account files no time off"
    me = fold((who or {}).get("name"))
    if reach == "anybody" or fold(person) == me:
        return ""
    if reach == "self":
        return "you file time off for yourself only — your house manager can file it for somebody else"
    if fold(person) not in _drawn_people(est, (who or {}).get("manages") or []):
        return f"{person} is not drawn on a house you manage — a director or an administrator files it"
    return ""


def validate(*, who: dict[str, Any], person: str, start: date | None, end: date | None,
             reason: str, existing: list[dict[str, Any]], est: dict[str, Any],
             dirs: list[str], on: date | None = None) -> list[str]:
    on = on or today()
    out: list[str] = []
    reach = _may_file_for(who, dirs)
    if not reach:
        return ["this account files no time off"]
    if not str((who or {}).get("name") or "").strip():
        out.append("this account is not on a roster — ask your house manager to file the time off")
    p = str(person or "").strip()
    if not p or fold(p) in ("other", "") or mw_shifts.sr.not_a_person(p):
        out.append("name the person who is off — 'Other' and blank are not a person")
    me = fold((who or {}).get("name"))
    beyond = reach_refusal(who, p, est, dirs) if p else ""
    if beyond:
        out.append(beyond)
    if start is None or end is None:
        out.append("give a start date and an end date")
    else:
        if end < start:
            out.append("the end date is before the start date")
        elif (end - start).days + 1 > MAX_DAYS:
            out.append(f"one request covers at most {MAX_DAYS} days — file it in parts")
        if start < on and not every_house(who):
            out.append("time off that has already started is filed by a director or an administrator")
        if end >= start:
            for r in existing:
                if fold(r.get("person")) != fold(p) or r.get("status") not in (PENDING, SCHEDULED, REVIEW):
                    continue
                a, b = day_of(r.get("start_date")), day_of(r.get("end_date"))
                if a and b and a <= end and start <= b:
                    wait = describe_wait(r)
                    out.append(f"{'you' if fold(p) == me else p} already asked for "
                               f"{dates_words(a.isoformat(), b.isoformat())} ({r.get('id')}), {wait}")
    if len(str(reason or "")) > REASON_MAX:
        out.append(f"the reason is longer than {REASON_MAX} characters")
    return out


def _staff_directory(src: Any, est: dict[str, Any]) -> list[dict[str, Any]]:
    """calendar_builder_houses.staff_directory: everybody a house manager may place, the calendars' and the accounts'."""
    sr = mw_shifts.sr
    by_key: dict[str, dict[str, Any]] = {}
    for loc in est.get("locations") or []:
        short = sr.short_house(loc)
        for n in (est.get("people") or {}).get(loc, []):
            if mw_roster.house_cal_live.not_a_person(n, loc) or n.startswith(sr.CALL_OFF_ROW):
                continue
            entry = by_key.setdefault(fold(n), {"name": n, "houses": []})
            if short not in entry["houses"]:
                entry["houses"].append(short)
    try:
        accounts = mw_relay_state.rows("asa_users", columns=("display_name", "entity_name", "role", "active",
                                                             "merged_into"))
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - the calendars still answer
        accounts = []
    for a in accounts:
        if a.get("active") is False or a.get("role") != "staff":
            continue
        if a.get("merged_into") is not None and str(a.get("merged_into")) != "":
            continue
        entity = a.get("entity_name")
        name = str((entity if entity not in (None, "") else a.get("display_name")) or "").strip()
        if name and fold(name):
            by_key.setdefault(fold(name), {"name": name, "houses": []})
    return sorted(by_key.values(), key=lambda r: r["name"].lower())


def _spell(est: dict[str, Any], src: Any, person: str) -> str:
    """The spelling a request is filed under: the calendars', else the staff directory's, else as typed."""
    got = mw_shifts.sr.grid_name(est, person)
    if got:
        return got
    try:
        for r in _staff_directory(src, est):
            if fold(r["name"]) == fold(person) or same_person(r["name"], person):
                return str(r["name"])
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - the typed spelling stands
        pass
    return str(person or "").strip()


def _spell_own(est: dict[str, Any], person: str) -> str:
    """One's own request: the calendars' spelling of this very name, else the account's own — never a look-alike
    (a middle initial dropped), which none of this person's screens reads back."""
    return mw_shifts.sr.grid_name(est, person) or str(person or "").strip()


def off_span(start: date, end: date) -> tuple[datetime, datetime]:
    return mw_shifts.sr.at_hour(start, 0), mw_shifts.sr.at_hour(end + timedelta(days=1), 0)


def clashes(col_iso: str, text: str, start: date, end: date) -> bool:
    """The overlap law's own test: a cell's hours against whole days off, so an overnight on the eve counts."""
    span = mw_shifts.sr.span_of(col_iso, text)
    return span is not None and mw_shifts.sr.overlaps(span, off_span(start, end))


def _entry(r: dict[str, Any], est: dict[str, Any] | None) -> dict[str, Any]:
    return {"ref": r.get("id") or "", "person": r.get("person") or "", "start": r.get("start_date") or "",
            "end": r.get("end_date") or "",
            "houses": [{"code": c, "label": house_label(c, est)} for c in _list(r.get("houses"))]}


def hero(rows_: list[dict[str, Any]], shaped: list[dict[str, Any]], *, scope: str,
         on: date | None = None) -> dict[str, Any]:
    on = on or today()
    first = on.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    last = nxt - timedelta(days=1)
    sched = [r for r in rows_ if r.get("status") == SCHEDULED]
    off_now, upcoming, month_people, month_days = [], [], set(), 0
    for r in sched:
        a, b = day_of(r.get("start_date")), day_of(r.get("end_date"))
        if not a or not b:
            continue
        if a <= on <= b:
            off_now.append(r)
        if on < a <= on + timedelta(days=UPCOMING_DAYS):
            upcoming.append(r)
        lo, hi = max(a, first), min(b, last)
        if lo <= hi:
            month_people.add(fold(r.get("person")))
            month_days += (hi - lo).days + 1
    waiting = [s for s in shaped if s["status"] == PENDING]
    on_me = [s for s in waiting if s["waiting_on_me"]]
    soon = [s for s in on_me if s["start"] and (day_of(s["start"]) or on) <= on + timedelta(days=SOON_DAYS)]
    # one row whose answer is unknown makes the count unknown: None, never a zero it cannot vouch for
    unknown = any(s["waiting_on_me"] is None for s in waiting)
    counts = {"scheduled": sum(1 for s in shaped if s["status"] == SCHEDULED and not s["past"]),
              "waiting": len(waiting), "review": sum(1 for s in shaped if s["status"] == REVIEW)}
    return {"off_now": [_entry(r, None) for r in sorted(off_now, key=lambda r: r.get("end_date") or "")],
            "upcoming": [_entry(r, None) for r in sorted(upcoming, key=lambda r: r.get("start_date") or "")],
            "waiting": {"count": len(waiting), "on_me": None if unknown else len(on_me),
                        "soon_on_me": None if unknown else len(soon)},
            "month": {"people": len(month_people), "days": month_days, "label": on.strftime("%B")},
            "bar": counts if scope in ("all", "houses") else None}
