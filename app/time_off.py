"""Time off: a request, two approvals (a house manager and a listed director), then days nobody can roster."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

import house_directory
import lanes_db as hub_db
import lanes_pg as psycopg2
import lanes_sheets
import shift_requests as sr

log = logging.getLogger("hub.time_off")

OHIO = sr.OHIO
UTC = timezone.utc

TAB = "time_off"
SETTINGS_TAB = "settings"
PROP = "HUB_HOUSE_TIME_OFF_ID"
ESSENCIAL_SHEET_ID = sr.ESSENCIAL_SHEET_ID
MASTER_SHEET_ID = os.getenv("HUB_CAL_BUILDER_SHEET_ID", "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU")
FORM_TAB = "Staff Requests"
ARCHIVE_TAB = "Requests Archive"

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
# The directors are the house's Settings cell and nothing else.
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
# The doors a person may file through.
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

TTL_S = float(os.getenv("HUB_TIME_OFF_TTL_S", "20"))
REASON_TTL_S = 300.0
REASON_MAX = 500
MAX_DAYS = int(os.getenv("HUB_TIME_OFF_MAX_DAYS", "120"))
UPCOMING_DAYS = 14
SOON_DAYS = 3
BUILDER_LOOKBACK_DAYS = 120
FORM_SYNC_EVERY_S = 300.0
LOCK_NS_ID = int(os.getenv("HUB_TIME_OFF_LOCK_NS", "8231"))
LOCK_NS_TAB = LOCK_NS_ID + 1

REFUSED_ROLES = frozenset({"client", "guardian", "onboarding", "interviewer"})
REFUSED_BADGES = frozenset({"CLIENT", "FAMILY", "SSA"})
FAMILY_BADGES = frozenset({"FAMILY", "SSA"})
WORKING_ROLES = frozenset({"staff", "manager", "admin"})

SA_RAW = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
PEOPLE_PATH = os.path.join(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"), "people.json")
LINK_PATH = "/#/app/timeoff/requests"
APP_PATH = "/app/timeoff/requests"

WRITES_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_time_off_writes ("
    "tab TEXT NOT NULL, id TEXT NOT NULL, row JSONB NOT NULL, "
    "row_number INT NOT NULL DEFAULT 0, written_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (tab, id))"
)
SAID_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_time_off_said ("
    "id TEXT PRIMARY KEY, ref TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', "
    "recipient TEXT NOT NULL DEFAULT '', said JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
)
DDL = (WRITES_DDL, SAID_DDL)


class Refused(Exception):
    def __init__(self, why: str, code: str = "refused", **extra: Any) -> None:
        super().__init__(why)
        self.why, self.code, self.extra = why, code, extra


class Unreadable(RuntimeError):
    """A read that failed: never an empty answer."""


NOT_SET_UP = "time off is not set up on this server yet"


class NotMinted(Refused):
    def __init__(self) -> None:
        super().__init__(f"{NOT_SET_UP} — nothing can be filed or decided", "not_minted")


class Unwritable(Refused):
    def __init__(self, why: str) -> None:
        super().__init__(f"the time off records could not be saved ({why}) — nothing was changed; "
                         f"try again in a minute", "unwritable")


def _connect(dsn: str):
    return hub_db.connect(dsn)


_READY: set[str] = set()
_READY_LOCK = threading.Lock()


def ensure_tables(dsn: str) -> None:
    if dsn in _READY:
        return
    with _READY_LOCK:
        if dsn in _READY:
            return
        with _connect(dsn) as conn, conn.cursor() as cur:
            for ddl in DDL:
                cur.execute(ddl)
            conn.commit()
        _READY.add(dsn)


# ── small words ─────────────────────────────────────────────────────────────

def fold(name: Any) -> str:
    return sr.fold(name)


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


def _ascii(text: Any, limit: int = 160) -> str:
    s = str(text or "")
    for bad, good in (("—", "-"), ("–", "-"), ("’", "'"), ("‘", "'"),
                      ("“", '"'), ("”", '"'), ("…", "..."), (" ", " ")):
        s = s.replace(bad, good)
    s = s.encode("ascii", "ignore").decode()
    s = " ".join(s.split())
    return s[:limit]


def house_label(code: str, view: dict[str, Any] | None = None) -> str:
    loc = ((view or {}).get("by_code") or {}).get(code) or code
    return sr.short_house(loc) or code


# ── the house: the Sheets API in production, a stand-in in tests ───────────

_HOUSE: list[Any] = [None]


def use_house(house: Any) -> None:
    """Tests only: a stand-in with .id, values, append, append_many, update, row and mirror."""
    _HOUSE[0] = house
    forget()


def _a1_row(rng: str) -> int:
    m = re.search(r"![A-Z]+(\d+)", str(rng or ""))
    return int(m.group(1)) if m else 0


class SheetsHouse:
    """The minted book, through the plain service account the mint shared it with."""

    def __init__(self, sid: str) -> None:
        self.id = sid
        self._svc: Any = None

    def _values(self) -> Any:
        if self._svc is None:
            self._svc = lanes_sheets.sheets_service(impersonate=False)
        return self._svc.spreadsheets().values()

    def values(self, tab: str) -> list[list[str]]:
        got = self._values().get(spreadsheetId=self.id, range=f"'{tab}'!A1:AZ",
                                 valueRenderOption="FORMATTED_VALUE").execute()
        return [[str(c) for c in r] for r in got.get("values") or []]

    def row(self, tab: str, n: int) -> list[str]:
        got = self._values().get(spreadsheetId=self.id, range=f"'{tab}'!A{n}:AZ{n}",
                                 valueRenderOption="FORMATTED_VALUE").execute()
        vals = got.get("values") or [[]]
        return [str(c) for c in vals[0]]

    def append_many(self, tab: str, rows: list[list[str]]) -> int:
        got = self._values().append(spreadsheetId=self.id, range=f"'{tab}'!A1",
                                    valueInputOption="RAW", insertDataOption="INSERT_ROWS",
                                    body={"values": rows}).execute()
        return _a1_row((got.get("updates") or {}).get("updatedRange"))

    def append(self, tab: str, row: list[str]) -> int:
        return self.append_many(tab, [row])

    def update(self, tab: str, n: int, row: list[str]) -> None:
        self._values().update(spreadsheetId=self.id, range=f"'{tab}'!A{n}",
                              valueInputOption="RAW", body={"values": [row]}).execute()

    mirror = None


class MemoryHouse:
    """The stand-in house: live values plus what the keeper has copied so far (`sync`)."""

    def __init__(self, sid: str = "memory-time-off") -> None:
        import redaction  # noqa: PLC0415
        self._redact = redaction.redact_row
        self.id = sid
        self.tabs: dict[str, list[list[str]]] = {TAB: [list(HEADER)],
                                                 SETTINGS_TAB: [list(SETTINGS_HEADER)]}
        self.mirrored: dict[str, list[tuple[int, dict[str, Any]]]] = {TAB: [], SETTINGS_TAB: []}
        self.fail = False
        self.writes = 0

    def _check(self) -> None:
        if self.fail:
            raise RuntimeError("the stand-in house is down")

    def values(self, tab: str) -> list[list[str]]:
        self._check()
        return [list(r) for r in self.tabs.get(tab, [])]

    def row(self, tab: str, n: int) -> list[str]:
        self._check()
        rows = self.tabs.get(tab, [])
        return list(rows[n - 1]) if 0 < n <= len(rows) else []

    def append_many(self, tab: str, rows: list[list[str]]) -> int:
        self._check()
        self.writes += 1
        first = len(self.tabs[tab]) + 1
        for r in rows:
            self.tabs[tab].append([str(c) for c in r])
        return first

    def append(self, tab: str, row: list[str]) -> int:
        return self.append_many(tab, [row])

    def update(self, tab: str, n: int, row: list[str]) -> None:
        self._check()
        self.writes += 1
        self.tabs[tab][n - 1] = [str(c) for c in row]

    def sync(self) -> None:
        for tab, rows in self.tabs.items():
            head = rows[0] if rows else []
            out = []
            for i, r in enumerate(rows[1:], start=2):
                data = {h: (r[j] if j < len(r) else "") for j, h in enumerate(head)}
                out.append((i, self._redact(data)[0]))
            self.mirrored[tab] = out

    def mirror(self, tab: str) -> list[tuple[int, dict[str, Any]]]:
        self._check()
        return list(self.mirrored.get(tab, []))


_DECLARED: dict[str, str] = {}


class NoHouse:
    """Tests only: no house declared, so nothing is read and nothing enforces."""
    id = ""
    mirror = None


def house_id(dsn: str) -> str:
    """'' when no house is declared; a mirror gap answers the last declaration read, else raises Unreadable."""
    if _HOUSE[0] is not None:
        return str(_HOUSE[0].id)
    override = os.getenv("HUB_TIME_OFF_HOUSE_ID", "").strip()
    if override:
        return override
    try:
        n = 1 if lanes_sheets.facts_held() else 0
        value = lanes_sheets.switch_prop(PROP) if n else None
    except Exception as exc:  # noqa: BLE001
        if dsn in _DECLARED:
            return _DECLARED[dsn]
        raise Unreadable(f"the Essencial's Facts could not be read ({type(exc).__name__})") from exc
    if not n:
        if dsn in _DECLARED:
            return _DECLARED[dsn]
        raise Unreadable("the Essencial's Facts are not in the mirror")
    _DECLARED[dsn] = str(value or "").strip()
    return _DECLARED[dsn]


def _house(sid: str) -> Any:
    if _HOUSE[0] is not None:
        return _HOUSE[0]
    return SheetsHouse(sid)


# ── once Time Off is Python's: the records in asa-hub-db, kept by the app ──
# (app/time_off_rows.py: read here through app.time_off_kept, written through the app's timeOffKeep door)

KEPT_DSN = "asa-hub-db"
KEPT_HOLD_S = 10.0
# the relay's door to the app: (door, payload) → its envelope, None when it did not answer
KEEPER: list[Callable[[str, dict[str, Any]], dict[str, Any] | None] | None] = [None]
# the notices lane, asked to publish what a write changed
NOTICES: list[Callable[[], None] | None] = [None]
_KEPT: dict[str, Any] = {"at": 0.0, "kept": None}
# the reasons of the last read, by ref, swapped whole on each read
_KEPT_REASONS: list[dict[str, str]] = [{}]


def kept(*, fresh: bool = False) -> bool:
    """Whether asa-hub-db holds the records now (both uploaded, not handed back). A read answers the last word heard
    when asa-hub-db is out of reach; a write (`fresh`) never does: it raises."""
    if _HOUSE[0] is not None or not KEPT_DSN:
        return False
    if not fresh and _KEPT["kept"] is not None and time.time() - float(_KEPT["at"]) < KEPT_HOLD_S:
        return bool(_KEPT["kept"])
    try:
        conn = hub_db.connect(KEPT_DSN)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM app.time_off_held")
                now = int((cur.fetchone() or (0,))[0] or 0) == 2
        finally:
            conn.close()
    except psycopg2.errors.UndefinedTable:
        now = False
    except Exception:  # noqa: BLE001
        if fresh or _KEPT["kept"] is None:
            raise
        return bool(_KEPT["kept"])
    _KEPT.update(at=time.time(), kept=now)
    return now


def _kept_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(records, settings) as the app keeps them, each reason withheld here and held aside for reason_of."""
    conn = hub_db.connect(KEPT_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT resource, cells FROM app.time_off_kept ORDER BY position, created_at, row_key")
            got = cur.fetchall()
    finally:
        conn.close()
    out: dict[str, list[dict[str, Any]]] = {"timeOff": [], "timeOffSettings": []}
    reasons: dict[str, str] = {}
    for resource, cells in got:
        cells = cells if isinstance(cells, dict) else _json(cells)
        tab = TAB if resource == "timeOff" else SETTINGS_TAB
        if not str(cells.get(ID_COL[tab]) or "").strip() or resource not in out:
            continue
        row = {**dict.fromkeys(HEADER if tab == TAB else SETTINGS_HEADER, ""),
               **{h: str(v if v is not None else "") for h, v in cells.items()}}
        if tab == TAB:
            text = row.get(REASON_COL, "")
            reasons[row["id"].strip().upper()] = text
            row[REASON_COL] = "[withheld: private]" if text.strip() else ""
        row["_row_number"] = len(out[resource]) + 2
        out[resource].append(row)
    _KEPT_REASONS[0] = reasons
    return out["timeOff"], out["timeOffSettings"]


def _keep(payload: dict[str, Any]) -> dict[str, Any]:
    """One write kept by the app; a refusal said as the house's own, anything else unwritable."""
    call = KEEPER[0]
    env = call("timeOffKeep", payload) if call is not None else None
    if not isinstance(env, dict):
        _wrote(False, "the platform's app did not answer")
        raise Unwritable("the platform's app did not answer")
    if env.get("status") == 200:
        _wrote(True)
        return env.get("data") if isinstance(env.get("data"), dict) else {}
    code = str(env.get("reason") or "")
    if code in ("duplicate", "missing", "changed"):
        raise Refused(str(env.get("message") or code), code)
    raise Unwritable(str(env.get("message") or code or env.get("status")))


def upload_kept(dsn: str) -> dict[str, Any] | None:
    """Time Off given to Python: both tabs as the house holds them live, reasons and all (every copy withholds them),
    handed to the app's upload under both tab locks, so no write lands in the house between the read and Postgres
    holding it; the app's envelope, None when it did not answer."""
    house = _require_house(dsn)
    call = KEEPER[0]
    if call is None:
        return None
    with _tab_lock(dsn, TAB), _tab_lock(dsn, SETTINGS_TAB):
        tabs = {TAB: house.values(TAB), SETTINGS_TAB: house.values(SETTINGS_TAB)}
        env = call("timeOffUpload", {"sheet_id": house.id, "tabs": tabs})
        _KEPT["kept"] = None
    forget()
    return env


# ── reading: the mirror with this relay's own writes laid on ───────────────

_VIEW_LOCK = threading.Lock()
_VIEW: dict[str, Any] = {"at": 0.0, "view": None, "gen": 0}


def forget() -> None:
    with _VIEW_LOCK:
        _VIEW["at"], _VIEW["view"] = 0.0, None
        _VIEW["gen"] = int(_VIEW.get("gen") or 0) + 1


def _mirror(dsn: str, sid: str, tab: str) -> tuple[list[tuple[int, dict[str, Any]]], str]:
    house = _HOUSE[0]
    if house is not None and callable(getattr(house, "mirror", None)):
        return house.mirror(tab), stamp()
    rows = lanes_sheets.rows(sid, tab)
    return rows, lanes_sheets.as_of(sid)


def _overlay(dsn: str) -> list[dict[str, Any]]:
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT tab, id, row, row_number, written_at FROM asa_time_off_writes")
        return [dict(r) for r in cur.fetchall()]


GONE_AFTER_S = 900.0


def _retire(dsn: str, gone: list[tuple[str, str]]) -> None:
    if not gone:
        return
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            for tab, rid in gone:
                cur.execute("DELETE FROM asa_time_off_writes WHERE tab=%s AND id=%s", (tab, rid))
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — retried on the next read
        log.warning("time off: the overlay could not be trimmed (%s)", type(exc).__name__)


def _when(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    return _at(raw)


def lay(mirrored: list[tuple[int, dict[str, Any]]], overlay: list[dict[str, Any]], tab: str,
        as_of: Any = "") -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    """Mirror rows with the overlay on top; an overlay row the mirror caught up with, or lost, is retired."""
    synced = _when(as_of)
    key = ID_COL[tab]
    by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for rn, data in mirrored:
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


def view(dsn: str, *, fresh: bool = False) -> dict[str, Any]:
    """{minted, id, rows, settings, as_of}; raises Unreadable, never answers an empty house for a failed read."""
    now = time.time()
    with _VIEW_LOCK:
        held = _VIEW.get("view")
        if held is not None and not fresh and now - float(_VIEW["at"]) < TTL_S:
            return held
        started = int(_VIEW.get("gen") or 0)
    sid = house_id(dsn)
    if not sid:
        got = {"minted": False, "id": "", "rows": [], "settings": dict(SETTINGS_DEFAULTS),
               "as_of": "", "read_at": stamp()}
    else:
        try:
            in_pg = kept()
            if in_pg:
                rows, sets = _kept_rows()
                as_of = stamp()
            else:
                rows_m, as_of = _mirror(dsn, sid, TAB)
                sets_m, _ = _mirror(dsn, sid, SETTINGS_TAB)
                overlay = _overlay(dsn)
        except Exception as exc:  # noqa: BLE001
            raise Unreadable(f"the time off records could not be read ({type(exc).__name__})") from exc
        if not in_pg:
            rows, gone = lay(rows_m, overlay, TAB, as_of)
            sets, gone2 = lay(sets_m, overlay, SETTINGS_TAB, as_of)
            _retire(dsn, gone + gone2)
        settings = dict(SETTINGS_DEFAULTS)
        for s in sets:
            k, v = str(s.get("key") or "").strip(), str(s.get("value") or "").strip()
            if k.lower() == "directors":
                # present even when blank: a blank cell names nobody, a missing row is unreadable
                settings["directors"] = v
            elif v:
                settings[k] = v
        settings[LEADS_KEY] = _platform_leads()
        got = {"minted": True, "id": sid, "rows": rows, "settings": settings,
               "settings_rows": sets, "as_of": as_of, "read_at": stamp()}
    with _VIEW_LOCK:
        if int(_VIEW.get("gen") or 0) == started:
            _VIEW["at"], _VIEW["view"] = now, got
    return got


def rows(dsn: str, *, fresh: bool = False) -> list[dict[str, Any]]:
    return view(dsn, fresh=fresh)["rows"]


def migrated(v: dict[str, Any]) -> bool:
    """The Builder reads the house once the migration has set its cutover; the form's tab until then."""
    return bool(v.get("minted")) and bool(str((v.get("settings") or {}).get("form_cutover_at") or "").strip())


def settings(dsn: str, *, fresh: bool = False) -> dict[str, str]:
    return view(dsn, fresh=fresh)["settings"]


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


def _platform_leads() -> list[str]:
    """The live Platform Leads' names; none when the accounts cannot be read — the written board still stands."""
    try:
        conn = hub_db.connect(KEPT_DSN)
        try:
            with conn.cursor() as cur:
                cur.execute(LEADS_SQL)
                return [str(n).strip() for (n,) in cur.fetchall() if str(n or "").strip()]
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 - a lead not read is a lead not added, never a board refused
        log.warning("time off: the Platform Leads could not be read (%s)", type(exc).__name__)
        return []


def board(v: dict[str, Any]) -> dict[str, Any]:
    """{readable, names, why} for the screens and the permissions: `names` is [] both for a blank cell and for a…"""
    if not v.get("minted"):
        return {"readable": False, "names": [], "why": f"{NOT_SET_UP}, so no directors list can be read"}
    try:
        names = directors_of(v.get("settings") or {})
    except Unreadable as exc:
        return {"readable": False, "names": [], "why": str(exc)}
    return {"readable": True, "names": names, "why": "" if names else NO_DIRECTORS}


def _unrecognised(b: dict[str, Any]) -> str:
    """The tail a permission refusal carries while no director can be recognised, and why."""
    if b["names"]:
        return ""
    return f" — and no director is recognised: {NO_DIRECTORS_WHY if b['readable'] else b['why']}"


def directors(dsn: str) -> list[str]:
    return directors_of(settings(dsn))


def directors_declared(dsn: str) -> list[str]:
    """The declared board ([] for a blank cell); raises Unreadable when there is no house to read it from, or its…"""
    v = view(dsn)
    if not v.get("minted"):
        raise Unreadable("no Time Off house is declared, so its directors list could not be read")
    return directors_of(v["settings"])


def _waits_words(lead: str = "") -> str:
    """The stored status line of a request both halves are still owed on."""
    return f"{lead}waiting on the house manager and a director"


def status_words(row: dict[str, Any], brd: dict[str, Any] | None) -> str:
    """The row's status line as the board stands now: a pending row says a list that could not be read, and one…"""
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


# ── writing: the relay is the house's only writer ───────────────────────────

class _Lock:
    """A session advisory lock on a connection of its own; FAIL-CLOSED: no lock, no write."""

    def __init__(self, dsn: str, ns: int, key: str) -> None:
        self.dsn, self.ns, self.key, self.conn = dsn, ns, key, None

    def __enter__(self) -> "_Lock":
        k = int(hashlib.sha1(self.key.encode()).hexdigest()[:8], 16) % (2 ** 31)
        try:
            self.conn = _connect(self.dsn)
            self.conn.autocommit = True
            with self.conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_lock(%s,%s)", (self.ns, k))
        except Exception as exc:  # noqa: BLE001
            if self.conn is not None:
                try:
                    self.conn.close()
                except Exception:  # noqa: BLE001
                    pass
            self.conn = None
            raise Unwritable(f"the write lock could not be taken ({type(exc).__name__})") from exc
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.conn = None


def id_lock(dsn: str, ref: str) -> _Lock:
    return _Lock(dsn, LOCK_NS_ID, str(ref or "").upper())


def _tab_lock(dsn: str, tab: str) -> _Lock:
    return _Lock(dsn, LOCK_NS_TAB, tab)


def _as_values(head: list[str], row: dict[str, Any]) -> list[str]:
    return [str(row.get(h, "") if row.get(h) is not None else "") for h in head]


def _head_of(values: list[list[str]], tab: str) -> list[str]:
    head = [str(h).strip() for h in (values[0] if values else [])]
    if ID_COL[tab] not in head:
        raise Unwritable(f"the {tab} tab has no {ID_COL[tab]} column")
    return head


def _overlay_put(dsn: str, tab: str, row: dict[str, Any], n: int) -> None:
    clean = {k: v for k, v in row.items() if not k.startswith("_")}
    if REASON_COL in clean:
        clean[REASON_COL] = ""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_time_off_writes (tab, id, row, row_number, written_at) "
            "VALUES (%s,%s,%s,%s,now()) ON CONFLICT (tab, id) DO UPDATE SET row=EXCLUDED.row, "
            "row_number=EXCLUDED.row_number, written_at=now()",
            (tab, str(clean.get(ID_COL[tab]) or ""), json.dumps(clean), int(n or 0)))
        conn.commit()


def _require_house(dsn: str) -> Any:
    sid = house_id(dsn)
    if not sid:
        raise NotMinted()
    return _house(sid)


def _kept_for_write() -> bool:
    """Under the tab lock: whether this write goes to the app — never guessed, an unknown answer writes nothing."""
    try:
        return kept(fresh=True)
    except Exception as exc:  # noqa: BLE001
        raise Unwritable(f"asa-hub-db could not say who holds the records ({type(exc).__name__})") from exc


def append_rows(dsn: str, tab: str, new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Append under the tab lock; a live duplicate id or source_key is refused and nothing is written."""
    if not new:
        return []
    house = _require_house(dsn)
    with _tab_lock(dsn, tab):
        if _kept_for_write():
            got = _keep({"tab": tab, "append": [{k: v for k, v in r.items() if not k.startswith("_")} for r in new]})
            numbers = list(got.get("row_numbers") or [])
            forget()
            return [{**r, "_row_number": int(numbers[i]) if i < len(numbers) else 0} for i, r in enumerate(new)]
        try:
            values = house.values(tab)
        except Exception as exc:  # noqa: BLE001
            raise Unwritable(f"its {tab} tab could not be read ({type(exc).__name__})") from exc
        head = _head_of(values, tab)
        key = ID_COL[tab]
        ki = head.index(key)
        si = head.index("source_key") if "source_key" in head else -1
        ids = {str(r[ki]).strip().upper() for r in values[1:] if len(r) > ki}
        keys = {str(r[si]).strip() for r in values[1:] if si >= 0 and len(r) > si and str(r[si]).strip()}
        for r in new:
            rid = str(r.get(key) or "").strip()
            if not rid or rid.upper() in ids:
                raise Refused(f"{rid or 'a row with no id'} is already in the house — nothing was written",
                              "duplicate")
            sk = str(r.get("source_key") or "").strip()
            if sk and sk in keys:
                raise Refused(f"the source row {sk} is already in the house — nothing was written",
                              "duplicate")
            ids.add(rid.upper())
            if sk:
                keys.add(sk)
        try:
            first = house.append_many(tab, [_as_values(head, r) for r in new])
        except Exception as exc:  # noqa: BLE001
            _wrote(False, type(exc).__name__)
            raise Unwritable(f"Google refused the append ({type(exc).__name__})") from exc
        _wrote(True)
        if not first:
            first = len(values) + 1
        out = []
        for i, r in enumerate(new):
            n = first + i
            try:
                _overlay_put(dsn, tab, r, n)
            except Exception as exc:  # noqa: BLE001 — the house holds it; the mirror carries it soon
                log.warning("time off: overlay not written for %s (%s)", r.get(key), type(exc).__name__)
            out.append({**r, "_row_number": n})
    forget()
    return out


def append_row(dsn: str, tab: str, row: dict[str, Any]) -> dict[str, Any]:
    return append_rows(dsn, tab, [row])[0]


def update_row(dsn: str, tab: str, row: dict[str, Any], expected: str) -> dict[str, Any]:
    """Compare-and-set on updatedAt; the reason cell is written back as the house holds it."""
    house = _require_house(dsn)
    key = ID_COL[tab]
    rid = str(row.get(key) or "").strip()
    with _tab_lock(dsn, tab):
        if _kept_for_write():
            got = _keep({"tab": tab, "expected": str(expected or ""),
                         "update": {k: v for k, v in row.items() if not k.startswith("_")}})
            forget()
            return {**row, "_row_number": int(got.get("row_number") or 0)}
        try:
            values = house.values(tab)
        except Exception as exc:  # noqa: BLE001
            raise Unwritable(f"its {tab} tab could not be read ({type(exc).__name__})") from exc
        head = _head_of(values, tab)
        ki = head.index(key)
        n = next((i + 1 for i, r in enumerate(values)
                  if i > 0 and len(r) > ki and str(r[ki]).strip().upper() == rid.upper()), 0)
        if not n:
            raise Refused(f"{rid} is not in the house any more — nothing was written; reload",
                          "missing")
        live = values[n - 1] + [""] * (len(head) - len(values[n - 1]))
        live_row = dict(zip(head, live))
        if "updatedAt" in head and str(live_row.get("updatedAt") or "") != str(expected or ""):
            raise Refused("the row changed in the house since it was read — nothing was written; reload",
                          "changed")
        out = dict(row)
        if REASON_COL in head:
            out[REASON_COL] = live_row.get(REASON_COL, "")
        try:
            house.update(tab, n, _as_values(head, out))
        except Exception as exc:  # noqa: BLE001
            _wrote(False, type(exc).__name__)
            raise Unwritable(f"Google refused the update ({type(exc).__name__})") from exc
        _wrote(True)
        try:
            _overlay_put(dsn, tab, out, n)
        except Exception as exc:  # noqa: BLE001 — the house holds it
            log.warning("time off: overlay not written for %s (%s)", rid, type(exc).__name__)
    forget()
    out["_row_number"] = n
    out[REASON_COL] = row.get(REASON_COL, "")
    return out


def write_setting(dsn: str, key: str, value: str, note: str = "") -> dict[str, Any]:
    v = view(dsn, fresh=True)
    held = next((s for s in v.get("settings_rows") or [] if str(s.get("key") or "") == key), None)
    row = {"key": key, "value": value, "note": note or str((held or {}).get("note") or ""),
           "updatedAt": stamp()}
    if held is None:
        return append_row(dsn, SETTINGS_TAB, row)
    return update_row(dsn, SETTINGS_TAB, row, str(held.get("updatedAt") or ""))


def new_ref(taken: Iterable[str] = ()) -> str:
    seen = {str(t).upper() for t in taken}
    while True:
        ref = "TO" + secrets.token_hex(5).upper()
        if ref not in seen:
            return ref


# ── the reason: read live, one cell, only for those who may read it ────────

_REASON: dict[str, tuple[float, str]] = {}


def reason_of(dsn: str, row: dict[str, Any]) -> tuple[str, str]:
    """(text, why) — why is '' when the read worked."""
    ref = str(row.get("id") or "")
    if str(row.get("reason_given") or "").lower() != "yes":
        return "", ""
    held = _REASON.get(ref)
    if held and time.time() - held[0] < REASON_TTL_S:
        return held[1], ""
    try:
        if kept():
            key = ref.strip().upper()
            if key not in _KEPT_REASONS[0]:
                view(dsn, fresh=True)
            return _KEPT_REASONS[0].get(key, ""), ""
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, the rest of the panel stands
        return "", f"the reason could not be read right now ({type(exc).__name__})"
    n = int(row.get("_row_number") or 0)
    try:
        house = _require_house(dsn)
        values = house.values(TAB)
        head = [str(h).strip() for h in values[0]] if values else []
        ki, ri = head.index("id"), head.index(REASON_COL)
        line = values[n - 1] if 0 < n <= len(values) else []
        if not line or len(line) <= ki or str(line[ki]).strip().upper() != ref.upper():
            line = next((r for r in values[1:] if len(r) > ki and str(r[ki]).strip().upper() == ref.upper()),
                        [])
        text = str(line[ri]) if len(line) > ri else ""
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, the rest of the panel stands
        return "", f"the reason could not be read right now ({type(exc).__name__})"
    _REASON[ref] = (time.time(), text)
    return text, ""


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


def scope_of(who: dict[str, Any], dirs: Iterable[str]) -> str:
    """refused | own | houses | all."""
    if refused_reader(who):
        return "refused"
    if every_house(who) or is_director(who, dirs):
        return "all"
    if str((who or {}).get("role") or "").strip().lower() in sr.CALENDAR_EDIT_ROLES:
        return "all"
    if (who or {}).get("manages"):
        return "houses"
    return "own"


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


def _drawn_people(est: dict[str, Any], codes: Iterable[str]) -> set[str]:
    want = set(codes)
    out: set[str] = set()
    for loc in est.get("locations") or []:
        if (house_directory.code_of(loc) or loc.upper()) not in want:
            continue
        for n in (est.get("people") or {}).get(loc, []):
            if not sr.not_a_person(n, loc):
                out.add(fold(n))
    return out


def sees_row(who: dict[str, Any], row: dict[str, Any], scope: str,
             theirs: set[str] | None = None) -> bool:
    if scope == "all":
        return True
    if scope == "refused":
        return False
    me = fold((who or {}).get("name"))
    if me and me in (fold(row.get("person")), fold(row.get("filed_by"))):
        return True
    if me and any(fold(n) == me for n in _list(row.get("hm_asked"))):
        return True
    if scope == "houses":
        managed = set((who or {}).get("manages") or [])
        if managed & set(_list(row.get("houses"))):
            return True
        return fold(row.get("person")) in (theirs or set())
    return False


# ── the houses a request touches, and who approves it ───────────────────────

def _span_days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def drawn_houses(est: dict[str, Any], person: str, start: date, end: date) -> list[str]:
    key = fold(person)
    out: set[str] = set()
    for loc in est.get("locations") or []:
        for (emp, iso), _text in (est.get("cells") or {}).get(loc, {}).items():
            d = sr.day_of(iso)
            if fold(emp) == key and d is not None and start <= d <= end:
                out.add(house_directory.code_of(loc) or loc.upper())
    return sorted(out)


def regular_houses(est: dict[str, Any], person: str) -> list[str]:
    out = []
    for loc in est.get("locations") or []:
        if sr.is_regular(est, person, loc):
            out.append(house_directory.code_of(loc) or loc.upper())
    return sorted(set(out))


def rostered_houses(est: dict[str, Any], person: str) -> set[str]:
    key = fold(person)
    return {house_directory.code_of(loc) or loc.upper() for loc in est.get("locations") or []
            if any(fold(n) == key for n in (est.get("people") or {}).get(loc, []))}


def houses_for(est: dict[str, Any], person: str, start: date, end: date,
               named: Iterable[str] = ()) -> list[str]:
    """Drawn in the window, plus a named house only where the person has a calendar row; else their regular houses."""
    own = rostered_houses(est, person)
    got = set(drawn_houses(est, person, start, end)) | {
        c for c in (str(x).strip().upper() for x in named) if c and c in own}
    if not got:
        got = set(regular_houses(est, person))
    return sorted(got)


def approvers(*, est: dict[str, Any], managers: dict[str, Any] | None, person: str,
              houses: list[str], filed_by: str, dirs: list[str]) -> dict[str, Any]:
    """{readable, hm_mode, hm_names, hm_why, dir_listed, dir_names, dir_why} — pure over what was read."""
    import shift_handoff  # noqa: PLC0415 — lazy: it imports shift_requests back
    by_code = est.get("by_code") or {}
    labels = [house_label(c, est) for c in houses]
    out: dict[str, Any] = {"readable": True, "hm_mode": "", "hm_names": [], "hm_why": "",
                           "dir_listed": list(dirs), "dir_names": [], "dir_why": ""}
    out["dir_names"] = _eligible(dirs, person, filed_by)
    out["dir_why"] = _dir_why(dirs, out["dir_names"])
    if not managers or not managers.get("readable"):
        where = ", ".join(labels) or "the person's houses"
        out.update(readable=False, hm_why=(f"who manages {where} could not be read "
                                           f"({(managers or {}).get('why') or 'no reason given'}) — "
                                           f"asked at the next pass"))
        return out
    names: list[str] = []
    whys: list[str] = []
    for code in houses:
        loc = by_code.get(code) or code
        got = shift_handoff.approval_for(location=loc, giver=person, receiver="",
                                         managers=managers, offered_by=filed_by)
        for n in got.get("names") or []:
            if not any(fold(n) == fold(x) for x in names):
                names.append(n)
        if got.get("names"):
            who = " or ".join(got["names"])
            whys.append(f"{who} {'manage' if len(got['names']) > 1 else 'manages'} "
                        f"{house_label(code, est)} (the hotline calendar's ** rows)")
    if names:
        out.update(hm_mode=MODE_HM, hm_names=names, hm_why="; ".join(whys))
    else:
        where = ", ".join(labels) or "any of the person's houses"
        # A listed director is named as a way only while the list holds one who may answer.
        also = ", or a director on the Time Off list" if out["dir_names"] else ""
        out.update(hm_mode=MODE_ABOVE,
                   hm_why=(f"no house manager other than the person or the filer is on file for "
                           f"{where}, so {sr.deciders_one()}{also} approves in their place"))
    return out


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


def next_status(row: dict[str, Any], leg: str, word: str) -> str:
    if word != "approve":
        return DENIED
    other = row.get("dir_state") if leg == LEG_HM else row.get("hm_state")
    return SCHEDULED if other in DONE_LEG else PENDING


def may_withdraw(who: dict[str, Any], row: dict[str, Any], on: date | None = None) -> bool:
    me = fold((who or {}).get("name"))
    if not me or me not in (fold(row.get("person")), fold(row.get("filed_by"))):
        return False
    st = row.get("status")
    if st in (PENDING, REVIEW):
        return True
    start = day_of(row.get("start_date"))
    return st == SCHEDULED and start is not None and (on or today()) < start


def may_cancel(who: dict[str, Any], row: dict[str, Any], dirs: list[str]) -> bool:
    if row.get("status") != SCHEDULED:
        return False
    if refused_reader(who):
        return False
    if every_house(who) or is_director(who, dirs):
        return True
    return bool(set((who or {}).get("manages") or []) & set(_list(row.get("houses"))))


def may_edit(who: dict[str, Any], row: dict[str, Any], dirs: list[str]) -> bool:
    """The approved request's Edit: its approvers (whoever may cancel it), never the person on it or whoever filed
    it — those receive it."""
    name = (who or {}).get("name")
    me = fold(name)
    if not me or any(me == fold(row.get(k)) or same_person(name, row.get(k)) for k in ("person", "filed_by")):
        return False
    return may_cancel(who, row, dirs)


def may_review(who: dict[str, Any], row: dict[str, Any], dirs: list[str]) -> bool:
    if row.get("status") != REVIEW or refused_reader(who):
        return False
    if every_house(who) or is_director(who, dirs):
        return True
    return bool(set((who or {}).get("manages") or []) & set(_list(row.get("houses"))))


# ── filing ──────────────────────────────────────────────────────────────────

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
    if not p or fold(p) in ("other", "") or sr.not_a_person(p):
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


def _spell(est: dict[str, Any], dsn: str, person: str) -> str:
    got = sr.grid_name(est, person)
    if got:
        return got
    try:
        import calendar_builder_houses  # noqa: PLC0415
        for r in calendar_builder_houses.staff_directory(dsn)["staff"]:
            if fold(r["name"]) == fold(person) or same_person(r["name"], person):
                return str(r["name"])
    except Exception:  # noqa: BLE001 — the typed spelling stands
        pass
    return str(person or "").strip()


def _spell_own(est: dict[str, Any], person: str) -> str:
    """One's own request: the calendars' spelling of this very name, else the account's own — never a look-alike
    (a middle initial dropped), which none of this person's screens reads back."""
    return sr.grid_name(est, person) or str(person or "").strip()


def off_span(start: date, end: date) -> tuple[datetime, datetime]:
    return sr.at_hour(start, 0), sr.at_hour(end + timedelta(days=1), 0)


def clashes(col_iso: str, text: str, start: date, end: date) -> bool:
    """The overlap law's own test: a cell's hours against whole days off, so an overnight on the eve counts."""
    span = sr.span_of(col_iso, text)
    return span is not None and sr.overlaps(span, off_span(start, end))


def touches(est: dict[str, Any], person: str, start: date, end: date) -> list[dict[str, Any]]:
    key = fold(person)
    out = []
    for loc in est.get("locations") or []:
        for (emp, iso), text in sorted((est.get("cells") or {}).get(loc, {}).items(), key=lambda kv: kv[0][1]):
            d = sr.day_of(iso)
            if fold(emp) != key or d is None or not start - timedelta(days=1) <= d <= end:
                continue
            if not clashes(iso, text, start, end):
                continue
            out.append({"house": house_directory.code_of(loc) or loc, "label": sr.short_house(loc),
                        "location": loc, "col_iso": iso, "value": text})
    return out


def _claims(cur, key: str, a: date, b: date) -> list[dict[str, Any]]:
    import house_cal_live  # noqa: PLC0415
    cur.execute(house_cal_live.CLAIMS_DDL)
    cur.execute("SELECT location, open_row, col_iso, value FROM asa_house_calendar_claims "
                "WHERE regexp_replace(lower(claimed_by), '[^a-z0-9]+', '', 'g') = %s "
                "AND col_iso >= %s AND col_iso <= %s",
                (key, (a - timedelta(days=1)).isoformat(), b.isoformat()))
    return [dict(r) for r in cur.fetchall()]


def claimed_only(est: dict[str, Any], person: str, claims: list[dict[str, Any]], a: date, b: date,
                 floor: date) -> list[dict[str, Any]]:
    """Shifts held through a claim alone (their own cell does not carry it) that the time off covers."""
    key = fold(person)
    out = []
    for c in claims:
        loc, iso, value = str(c["location"]), str(c["col_iso"]), str(c["value"] or "")
        d = sr.day_of(iso)
        if d is None or d < floor or not clashes(iso, value, a, b):
            continue
        own = next((t for (emp, i), t in (est.get("cells") or {}).get(loc, {}).items()
                    if i == iso and fold(emp) == key), "")
        if sr.span_of(iso, own) is not None and sr.span_of(iso, own) == sr.span_of(iso, value):
            continue
        out.append({"house": house_directory.code_of(loc) or loc, "label": sr.short_house(loc), "location": loc,
                    "col_iso": iso, "value": value, "open_row": str(c["open_row"]), "claim": True})
    return out


def _test_mode_on() -> bool:
    try:
        import effective_roster  # noqa: PLC0415
        return bool(effective_roster.test_mode().get("on"))
    except Exception:  # noqa: BLE001 — unreadable reads as on
        return True


def _read_body(body: dict[str, Any]) -> tuple[str, date | None, date | None, list[str], str]:
    person = str(body.get("person") or "").strip()
    start = day_of(body.get("start"))
    end = day_of(body.get("end")) or start
    houses = [str(h).strip().upper() for h in (body.get("houses") or []) if str(h).strip()][:12]
    reason = str(body.get("reason") or "").strip()
    return person, start, end, houses, reason


def preview(dsn: str, who: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    v = view(dsn)
    if not v["minted"]:
        raise NotMinted()
    est = sr.estate(dsn)
    person, start, end, named, reason = _read_body(body)
    mine = str((who or {}).get("name") or "")
    own = not person or fold(person) == fold(mine)
    person = person or mine
    spelled = "" if not person else _spell_own(est, person) if own else _spell(est, dsn, person)
    base = {"person": spelled or person, "start": start.isoformat() if start else "",
            "end": end.isoformat() if end else ""}
    try:
        dirs = directors_of(v["settings"])
    except Unreadable as exc:
        # FAIL-CLOSED: without the list nobody can say who approves, nor whom a director files for.
        return {**base, "ok": False, "directors_readable": False, "directors_why": str(exc),
                "refusals": [f"{exc} — nothing can be filed until it can be read; try again in a minute"]}
    refusals = validate(who=who, person=spelled or person, start=start, end=end, reason=reason,
                        existing=v["rows"], est=est, dirs=dirs)
    # A blank cell files the request: its director half waits, and the preview says so first.
    out: dict[str, Any] = {**base, "ok": not refusals, "refusals": refusals, "directors_readable": True,
                           "directors_why": "" if dirs else NO_DIRECTORS}
    if start and end and end >= start and not reach_refusal(who, spelled or person, est, dirs):
        drawn = drawn_houses(est, spelled, start, end)
        houses = houses_for(est, spelled, start, end, named)
        managers = sr.house_managers(dsn)
        asked = approvers(est=est, managers=managers, person=spelled, houses=houses,
                          filed_by=str((who or {}).get("name") or ""), dirs=dirs)
        out.update(days=(end - start).days + 1, dates=dates_words(start.isoformat(), end.isoformat()),
                   drawn_houses=drawn, houses=[{"code": c, "label": house_label(c, est)} for c in houses],
                   ignored_houses=[{"code": c, "label": house_label(c, est)} for c in named if c not in houses],
                   asked=asked, touches=touches(est, spelled, start, end))
    return out


def request(dsn: str, who: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """File one request; every refusal is raised before anything is written."""
    first = preview(dsn, who, body)
    if first.get("directors_readable") is False:
        # FAIL-CLOSED, and said as a read that failed (503), never as input that was wrong.
        raise Unreadable(str(first.get("directors_why") or DIRECTORS_UNREAD))
    if not first["ok"]:
        raise Refused("; ".join(first["refusals"]), "invalid", refusals=first["refusals"], preview=first)
    person = first["person"]
    start, end = day_of(first["start"]), day_of(first["end"])
    reason = str(body.get("reason") or "").strip()
    via = str(body.get("filed_via") or "platform").strip().lower()
    # A DOOR NOBODY KNOWS IS REFUSED, NEVER REWRITTEN.
    if via not in FILED_VIA_DOORS:
        raise Refused(f"'{via}' is not a door a request can arrive through "
                      f"({', '.join(FILED_VIA_DOORS)})", "invalid")
    with sr.person_gate(dsn, person):
        v = view(dsn, fresh=True)
        est = sr.estate(dsn, fresh=True)
        # Unreadable is raised, never filed around; a blank cell files and its director half waits.
        dirs = directors_of(v["settings"])
        again = validate(who=who, person=person, start=start, end=end, reason=reason,
                         existing=v["rows"], est=est, dirs=dirs)
        if again:
            raise Refused("; ".join(again), "invalid", refusals=again)
        asked = first["asked"]
        now = stamp()
        filer = str((who or {}).get("name") or "")
        # A CALL IS SOMEBODY ELSE TYPING IT FOR YOU.
        if via == "phone" and fold(filer) == fold(person):
            raise Refused("a request taken by telephone is filed by whoever took the call, "
                          "not by the person who is off", "invalid")
        row = {h: "" for h in HEADER}
        row.update({
            "id": new_ref(r.get("id") for r in v["rows"]), "createdAt": now, "updatedAt": now,
            "person": person, "person_key": fold(person),
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "days": str((end - start).days + 1),
            "houses": ", ".join(h["code"] for h in first["houses"]),
            "reason_given": "yes" if reason else "", REASON_COL: reason,
            "status": PENDING,
            "status_why": _waits_words(f"taken by telephone by {filer} — " if via == "phone" else ""),
            "filed_by": filer, "filed_by_key": fold(filer), "filed_via": via,
            "hm_mode": asked["hm_mode"], "hm_asked": ", ".join(asked["hm_names"]),
            "hm_why": asked["hm_why"], "hm_state": WAITING,
            "dir_asked": ", ".join(dirs), "dir_state": WAITING,
            "test_mode": "on" if _test_mode_on() else "",
            "source": "platform",
        })
        wrote = append_row(dsn, TAB, row)
    _notice(dsn, "time_off_asked", f"time_off_asked:{row['id']}", wrote, approvers_of=_asked_names(wrote))
    named = _eligible(dirs, person, filer)
    return {"ref": row["id"], "asked": {"house_manager": asked["hm_names"], "hm_mode": asked["hm_mode"],
                                        "hm_why": asked["hm_why"], "directors": named,
                                        "directors_why": "" if named else _dir_why(dirs, named)},
            "row": wrote}


def _asked_names(row: dict[str, Any]) -> list[str]:
    return _list(row.get("hm_asked")) + _list(row.get("dir_asked"))


# ── deciding ────────────────────────────────────────────────────────────────

def decide(dsn: str, who: dict[str, Any], ref: str, word: str, note: str = "",
           via: str = "platform") -> dict[str, Any]:
    word = {"yes": "approve", "no": "deny"}.get(str(word or "").strip().lower(), str(word or "").strip().lower())
    if word not in ("approve", "deny"):
        raise Refused("approve or deny", "word")
    via = via if via in DECIDE_VIA else "platform"
    note = _ascii(note, 300) if via == "sms" else str(note or "").strip()[:500]
    if word == "deny" and not note:
        if via == "sms":
            note = "no reason was given in the text"
        else:
            raise Refused("say why it is not approved — the words go to the person", "words_needed")
    with id_lock(dsn, ref):
        v = view(dsn, fresh=True)
        if not v["minted"]:
            raise NotMinted()
        row = find(v, ref)
        if not row:
            raise Refused(f"no time off request carries {str(ref).upper()}", "missing")
        if row.get("status") != PENDING:
            raise Refused(f"{row['id']} is {row.get('status')} — nothing was decided", "not_pending")
        # FAIL-CLOSED: a list that cannot be read raises Unreadable — nothing is decided on either half.
        dirs = directors_of(v["settings"])
        managers = sr.house_managers(dsn)
        if not row.get("hm_mode"):
            row = _recompute(dsn, row, managers, dirs) or row
        leg, why, code = leg_for(who, row, dirs, managers)
        if not leg:
            if blank_board(row, dirs, code):
                why, code = NO_DIRECTORS, "no_directors"
            raise Refused(why, code)
        by = str((who or {}).get("name") or "")
        now = stamp()
        new = dict(row)
        p = "hm" if leg == LEG_HM else "dir"
        new.update({f"{p}_state": APPROVED if word == "approve" else NOT_APPROVED, f"{p}_by": by,
                    f"{p}_via": via, f"{p}_at": now, f"{p}_note": note, "updatedAt": now})
        status = next_status(row, leg, word)
        new["status"] = status
        if status == DENIED:
            new.update(decided_at=now, status_why=f"not approved by {by}: {note}")
        elif status == PENDING:
            new["status_why"] = describe_wait(new)
        if status == SCHEDULED:
            new.update(decided_at=now, status_why="approved by the house manager and a director")
            with sr.person_gate(dsn, str(row.get("person") or "")):
                wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
                sr.forget_estate()
                wrote = settle_one(dsn, wrote)
        else:
            wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
    _notice(dsn, "time_off_decided", f"time_off_decided:{wrote['id']}:{leg}", wrote,
            approvers_of=_asked_names(wrote), extra={"leg": leg, "by": by, "word": word})
    if wrote.get("status") == SCHEDULED:
        _notice(dsn, "time_off_scheduled", f"time_off_scheduled:{wrote['id']}", wrote,
                approvers_of=_asked_names(wrote))
    elif wrote.get("status") == DENIED:
        _notice(dsn, "time_off_ended", f"time_off_ended:{wrote['id']}:{DENIED}", wrote,
                approvers_of=_asked_names(wrote), extra={"by": by})
    return {**wrote, "leg": leg}


def blank_board(row: dict[str, Any], dirs: list[str], code: str) -> bool:
    """A reader turned away only because the Settings cell names no director, on a request whose director half is…"""
    return not dirs and row.get("dir_state") == WAITING and code in ("not_a_director", "not_yours")


def _recompute(dsn: str, row: dict[str, Any], managers: dict[str, Any], dirs: list[str]
               ) -> dict[str, Any] | None:
    """The house-manager half only: the director half is read from the list at every decision."""
    if not managers or not managers.get("readable"):
        return None
    est = sr.estate(dsn)
    asked = approvers(est=est, managers=managers, person=str(row.get("person") or ""),
                      houses=_list(row.get("houses")), filed_by=str(row.get("filed_by") or ""), dirs=dirs)
    new = dict(row)
    new.update(hm_mode=asked["hm_mode"], hm_asked=", ".join(asked["hm_names"]), hm_why=asked["hm_why"],
               updatedAt=stamp())
    return update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))


def _close(dsn: str, who: dict[str, Any], ref: str, *, check: Callable[[dict[str, Any], list[str]], str],
           status: str, note: str, need_note: bool, why: str) -> dict[str, Any]:
    note = str(note or "").strip()[:500]
    if need_note and not note:
        raise Refused("say why — the words go to the person", "words_needed")
    with id_lock(dsn, ref):
        v = view(dsn, fresh=True)
        if not v["minted"]:
            raise NotMinted()
        row = find(v, ref)
        if not row:
            raise Refused(f"no time off request carries {str(ref).upper()}", "missing")
        # A list that cannot be read recognises no director: the withdrawal needs none, a cancel says why.
        b = board(v)
        refusal = check(row, b["names"])
        if refusal:
            raise Refused(refusal + _unrecognised(b), "not_allowed")
        by = str((who or {}).get("name") or "")
        now = stamp()
        new = dict(row)
        new.update(status=status, closed_by=by, closed_at=now, closed_note=note, updatedAt=now,
                   status_why=why.format(by=by, note=note).strip())
        wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
    _notice(dsn, "time_off_ended", f"time_off_ended:{wrote['id']}:{status}", wrote,
            approvers_of=_asked_names(wrote), extra={"by": by})
    return wrote


def withdraw(dsn: str, who: dict[str, Any], ref: str, note: str = "") -> dict[str, Any]:
    def check(row: dict[str, Any], _dirs: list[str]) -> str:
        if may_withdraw(who, row):
            return ""
        if row.get("status") == SCHEDULED:
            return "scheduled time off is withdrawn only before its first day — ask a director to cancel it"
        if row.get("status") not in (PENDING, REVIEW, SCHEDULED):
            return f"{row.get('id')} is {row.get('status')} — there is nothing to withdraw"
        return "only the person or whoever filed it withdraws a request"
    return _close(dsn, who, ref, check=check, status=WITHDRAWN, note=note, need_note=False,
                  why="withdrawn by {by}")


def cancel(dsn: str, who: dict[str, Any], ref: str, note: str) -> dict[str, Any]:
    def check(row: dict[str, Any], dirs: list[str]) -> str:
        if row.get("status") != SCHEDULED:
            return f"{row.get('id')} is {row.get('status')} — only scheduled time off is cancelled"
        return "" if may_cancel(who, row, dirs) else \
            "a listed director, an administrator or a manager of one of its houses cancels it"
    return _close(dsn, who, ref, check=check, status=CANCELLED, note=note, need_note=True,
                  why="cancelled by {by}: {note}")


def review(dsn: str, who: dict[str, Any], ref: str, action: str, *, person: str = "",
           start: str = "", end: str = "", into: str = "", note: str = "") -> dict[str, Any]:
    action = str(action or "").strip().lower()
    if action == "discard":
        return _close(dsn, who, ref, check=lambda row, dirs: "" if may_review(who, row, dirs)
                      else "house managers review their houses' rows, and the badges above every row",
                      status=WITHDRAWN, note=note, need_note=True, why="discarded by {by}: {note}")
    if action == "merge":
        into = str(into or "").strip().upper()
        if not REF_RE.fullmatch(into) or into == str(ref).upper():
            raise Refused("name the request it merges into (TO…)", "into")
        v = view(dsn)
        if not find(v, into):
            raise Refused(f"no time off request carries {into}", "into")
        return _close(dsn, who, ref, check=lambda row, dirs: "" if may_review(who, row, dirs)
                      else "house managers review their houses' rows, and the badges above every row",
                      status=WITHDRAWN, note=f"merged into {into}" + (f": {note}" if note else ""),
                      need_note=False, why="merged into " + into + " by {by}")
    if action != "confirm":
        raise Refused("confirm, merge or discard", "action")
    with id_lock(dsn, ref):
        v = view(dsn, fresh=True)
        row = find(v, ref)
        if not row:
            raise Refused(f"no time off request carries {str(ref).upper()}", "missing")
        brd = board(v)
        dirs = brd["names"]
        if not may_review(who, row, dirs):
            raise Refused("house managers review their houses' rows, and the badges above every row"
                          + _unrecognised(brd), "not_allowed")
        est = sr.estate(dsn)
        new = dict(row)
        if person.strip():
            new["person"] = _spell(est, dsn, person.strip())
            new["person_key"] = fold(new["person"])
        a = day_of(start) or day_of(row.get("start_date"))
        b = day_of(end) or day_of(row.get("end_date")) or a
        if a is None or b is None or b < a:
            raise Refused("the dates are still not a range — set a start and an end", "dates")
        if not new.get("person") or fold(new.get("person")) == "other":
            raise Refused("name the person first", "person")
        others = [r for r in v["rows"] if str(r.get("id") or "").upper() != str(row.get("id") or "").upper()]
        refusals = validate(who=who, person=new["person"], start=a, end=b, reason="", existing=others,
                            est=est, dirs=dirs)
        if refusals:
            raise Refused("; ".join(refusals), "invalid", refusals=refusals)
        by = str((who or {}).get("name") or "")
        if same_person(by, new["person"]):
            raise Refused("you cannot confirm your own time off — somebody else reviews it", "own")
        new.update(start_date=a.isoformat(), end_date=b.isoformat(), days=str((b - a).days + 1))
        now = stamp()
        if not _list(new.get("houses")):
            new["houses"] = ", ".join(houses_for(est, new["person"], a, b))
        said = as_the_form_said(row, new["person"], a, b)
        if not said:
            # whoever chose the person or the days filed it, and so decides neither half
            new.update(filed_by=by, filed_by_key=fold(by))
        if new.get("filed_via") == "migration" and said:
            new.update(status=SCHEDULED, hm_state=MIGRATED, dir_state=MIGRATED,
                       status_why=f"confirmed by {by} from the form's history")
        else:
            if not brd["readable"]:
                # FAIL-CLOSED: a request re-filed without its list would name approvers nobody read.
                raise Unreadable(f"{brd['why']} — nothing was confirmed")
            managers = sr.house_managers(dsn)
            asked = approvers(est=est, managers=managers, person=new["person"],
                              houses=_list(new.get("houses")), filed_by=str(new.get("filed_by") or ""),
                              dirs=dirs)
            new.update(status=PENDING, hm_mode=asked["hm_mode"], hm_asked=", ".join(asked["hm_names"]),
                       hm_why=asked["hm_why"], hm_state=WAITING, dir_asked=", ".join(dirs),
                       dir_state=WAITING, status_why=_waits_words(f"confirmed by {by}; "))
        new.update(updatedAt=now, closed_note=note or str(row.get("closed_note") or ""))
        if new["status"] == SCHEDULED:
            with sr.person_gate(dsn, new["person"]):
                wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
                sr.forget_estate()
                wrote = settle_one(dsn, wrote)
        else:
            wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
    return wrote


def as_the_form_said(row: dict[str, Any], person: str, a: date, b: date) -> bool:
    """A migrated row keeps its form approval only for the name the form gave and the days it gave."""
    said = str(row.get("filed_by") or "")
    if fold(said) in ("", "other") or not (fold(said) == fold(person) or same_person(said, person)):
        return False
    x, y = day_of(row.get("start_date")), day_of(row.get("end_date")) or day_of(row.get("start_date"))
    if x is None or y is None:
        return False
    lo, hi = min(x, y), max(x, y)
    return lo <= a and b <= hi


def test_rows(v: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in v["rows"] if r.get("test_mode") == "on" and r.get("status") not in CLOSED]


def discard_test_rows(dsn: str, who: dict[str, Any], note: str) -> dict[str, Any]:
    if not every_house(who):
        raise Refused("only the badges that decide every house discard the test rows", "not_allowed")
    done, failed = [], []
    for r in test_rows(view(dsn, fresh=True)):
        try:
            done.append(_close(dsn, who, r["id"], status=WITHDRAWN,
                               check=lambda row, dirs: "" if test_rows({"rows": [row]}) else
                               f"{row.get('id')} is no longer an open test-mode row",
                               note=note or "a test-mode row", need_note=False,
                               why="discarded as a test-mode row by {by}")["id"])
        except Refused as exc:
            failed.append({"ref": r["id"], "why": exc.why})
    return {"discarded": done, "failed": failed}


# ── the overlap law's source: scheduled time off as whole days ──────────────

def _interval(row: dict[str, Any]) -> dict[str, Any] | None:
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    if a is None or b is None or b < a:
        return None
    return {"location": "", "employee": str(row.get("person") or ""), "col_iso": a.isoformat(),
            "until": b.isoformat(), "value": "time off",
            "span": (sr.at_hour(a, 0), sr.at_hour(b + timedelta(days=1), 0)),
            "ref": str(row.get("id") or ""), "source": "time_off"}


def _by_person(rows_: list[dict[str, Any]], names: Iterable[str], statuses: tuple[str, ...],
               floor: date) -> dict[str, list[dict[str, Any]]]:
    want = {fold(n) for n in names if fold(n)}
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows_:
        if r.get("status") not in statuses:
            continue
        key = fold(r.get("person"))
        if want and key not in want:
            continue
        b = day_of(r.get("end_date"))
        if b is None or b < floor:
            continue
        got = _interval(r)
        if got:
            out.setdefault(key, []).append(got)
    return out


def away(dsn: str, names: Iterable[str] = ()) -> dict[str, list[dict[str, Any]]]:
    """{fold(name): [interval]} for scheduled rows; raises Unreadable; a house not minted enforces nothing."""
    v = view(dsn)
    if not v["minted"]:
        return {}
    return _by_person(v["rows"], names, (SCHEDULED,), today() - timedelta(days=1))


def asked_for(dsn: str, names: Iterable[str] = ()) -> dict[str, list[dict[str, Any]]]:
    v = view(dsn)
    if not v["minted"]:
        return {}
    return _by_person(v["rows"], names, (PENDING,), today() - timedelta(days=1))


def pending_warning(dsn: str, person: str, col_iso: str) -> str:
    """The sentence a drafted cell carries when a pending request covers its day; '' otherwise."""
    d = sr.day_of(col_iso)
    if d is None or not str(person or "").strip():
        return ""
    try:
        got = asked_for(dsn, [person]).get(fold(person)) or []
    except Exception:  # noqa: BLE001 — FAIL-OPEN: a warning that could not be read never refuses
        return ""
    for i in got:
        a, b = day_of(i["col_iso"]), day_of(i["until"])
        if a and b and a <= d <= b:
            v = view(dsn)
            row = find(v, i["ref"]) or {}
            return (f"{person} asked for time off {dates_words(i['col_iso'], i['until'])} "
                    f"({i['ref']}, {describe_wait(row)}) — the draft is allowed")
    return ""


def grid_marks(dsn: str, location: str, editor: bool) -> dict[tuple[str, str], dict[str, Any]]:
    """(employee, col_iso) → {state, ref, until}; pending only for that house's editors."""
    try:
        v = view(dsn)
    except Unreadable:
        return {}
    if not v["minted"]:
        return {}
    est = sr.estate(dsn)
    names = [n for n in (est.get("people") or {}).get(location, []) if not sr.not_a_person(n, location)]
    isos = (est.get("isos") or {}).get(location) or []
    wanted = (SCHEDULED, PENDING) if editor else (SCHEDULED,)
    by_key = _by_person(v["rows"], names, wanted, today() - timedelta(days=62))
    state_of = {str(r.get("id") or ""): str(r.get("status") or "") for r in v["rows"]}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for n in names:
        for i in by_key.get(fold(n), []):
            a, b = day_of(i["col_iso"]), day_of(i["until"])
            for iso in isos:
                d = sr.day_of(iso)
                if d and a and b and a <= d <= b:
                    st = state_of.get(i["ref"], SCHEDULED)
                    prior = out.get((n, iso))
                    if prior and prior["state"] == SCHEDULED:
                        continue
                    out[(n, iso)] = {"state": st, "ref": i["ref"], "until": i["until"]}
    return out


def lay_marks(grid: dict[str, Any], marks: dict[tuple[str, str], dict[str, Any]]) -> None:
    if not marks:
        return
    import house_cal_live  # noqa: PLC0415
    isos = house_cal_live.col_isos(grid)
    at = {iso: i for i, iso in enumerate(isos)}
    for r in grid.get("rows") or []:
        if not isinstance(r, dict):
            continue
        emp = str(r.get("employee") or "")
        for (name, iso), mark in marks.items():
            if name != emp or iso not in at:
                continue
            cells = r.setdefault("cells", [])
            i = at[iso]
            while len(cells) <= i:
                cells.append({"text": "", "color": "transparent"})
            if not isinstance(cells[i], dict):
                cells[i] = {"text": str(cells[i] or "")}
            cells[i]["time_off"] = dict(mark)


# ── what approving does, and what it did ────────────────────────────────────

def _live_applications(cur, key: str, a: date, b: date) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, location, col_iso, value FROM asa_shift_requests WHERE kind = ANY(%s) "
        "AND state = ANY(%s) AND regexp_replace(lower(person), '[^a-z0-9]+', '', 'g') = %s "
        "AND col_iso >= %s AND col_iso <= %s",
        ([sr.KIND_OPEN, sr.KIND_CALLOFF], list(sr.LIVE_STATES), key, a.isoformat(), b.isoformat()))
    return [dict(r) for r in cur.fetchall()]


def _incoming_handoffs(cur, key: str, a: date, b: date) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, location, col_iso, value, from_staff FROM asa_shift_handoffs WHERE state='pending' "
        "AND regexp_replace(lower(to_staff), '[^a-z0-9]+', '', 'g') = %s AND col_iso >= %s AND col_iso <= %s",
        (key, a.isoformat(), b.isoformat()))
    return [dict(r) for r in cur.fetchall()]


def _trainings(cur, key: str, a: date, b: date) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, location, col_iso, value, person FROM asa_shift_requests WHERE kind=%s AND state=%s "
        "AND regexp_replace(lower(extra->'trainer'->>'name'), '[^a-z0-9]+', '', 'g') = %s "
        "AND col_iso >= %s AND col_iso <= %s",
        (sr.KIND_IST, sr.APPROVED, key, a.isoformat(), b.isoformat()))
    return [{"location": r["location"], "house": sr.short_house(r["location"]), "col_iso": r["col_iso"],
             "value": r["value"], "trainee": r["person"]} for r in cur.fetchall()]


def what_it_does(dsn: str, row: dict[str, Any]) -> dict[str, Any]:
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    if a is None or b is None:
        return {"shifts": [], "applications": [], "handoffs": [], "trainings": []}
    person = str(row.get("person") or "")
    key = fold(person)
    est = sr.estate(dsn)
    import shift_handoff  # noqa: PLC0415
    shift_handoff.ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        sr._ddl(cur)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        apps = _live_applications(cur, key, a, b)
        hos = _incoming_handoffs(cur, key, a, b)
        trains = _trainings(cur, key, a, b)
        claims = _claims(cur, key, a, b)
    on = today()
    return {"shifts": [t for t in touches(est, person, a, b) if (sr.day_of(t["col_iso"]) or a) >= on]
            + claimed_only(est, person, claims, a, b, on),
            "applications": [{"id": x["id"], "house": sr.short_house(x["location"]), "col_iso": x["col_iso"],
                              "value": x["value"]} for x in apps],
            "handoffs": [{"id": x["id"], "house": sr.short_house(x["location"]), "col_iso": x["col_iso"],
                          "value": x["value"], "from": x["from_staff"]} for x in hos],
            "trainings": trains}


def settle_one(dsn: str, row: dict[str, Any]) -> dict[str, Any]:
    """Stage the effects of a scheduled row (under the person's gate); repeats nothing, assigns nobody."""
    import calendar_builder_houses as cbh  # noqa: PLC0415
    import shift_handoff  # noqa: PLC0415
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    prior = _json(row.get("effects"))
    staged = list(prior.get("staged") or [])
    unplaced: list[dict[str, Any]] = []
    withdrawn = list(prior.get("withdrawn_applications") or [])
    ended = list(prior.get("ended_handoffs") or [])
    released = list(prior.get("released_claims") or [])
    problems: list[str] = []
    ref = str(row.get("id") or "")
    person = str(row.get("person") or "")
    key = fold(person)
    if a is None or b is None or b < a:
        return row
    on = today()
    floor = max(a, on)
    seen = {(s.get("location"), s.get("col_iso")) for s in staged}
    try:
        est = sr.estate(dsn, fresh=True)
    except Exception as exc:  # noqa: BLE001
        est = None
        problems.append(f"the house calendars could not be read ({type(exc).__name__})")
    for loc in (est or {}).get("locations") or []:
        emps = [n for n in (est.get("people") or {}).get(loc, []) if fold(n) == key and not sr.not_a_person(n, loc)]
        if not emps:
            continue
        emp = emps[0]
        for iso in (est.get("isos") or {}).get(loc) or []:
            d = sr.day_of(iso)
            if d is None or (loc, iso) in seen:
                continue
            eve = d == a - timedelta(days=1) and d >= on \
                and clashes(iso, (est.get("cells") or {}).get(loc, {}).get((emp, iso), ""), a, b)
            if not eve and not floor <= d <= b:
                continue
            try:
                got = cbh.time_off_release(dsn, location=loc, employee=emp, col_iso=iso,
                                           actor=f"time off {ref}",
                                           note=f"{person} is on approved time off ({ref})")
            except Exception as exc:  # noqa: BLE001 — named on the row, retried by settle
                why = getattr(exc, "why", "") or type(exc).__name__
                unplaced.append({"house": house_directory.code_of(loc), "location": loc, "col_iso": iso,
                                 "value": "", "why": str(why)})
                continue
            if got.get("unplaced"):
                unplaced.append({"house": house_directory.code_of(loc), "location": loc, "col_iso": iso,
                                 "value": got.get("value") or "", "why": got.get("why") or ""})
            elif got.get("changed"):
                staged.append({"house": house_directory.code_of(loc), "location": loc, "col_iso": iso,
                               "value": got.get("was") or "", "moved_to": got.get("moved_to") or ""})
                seen.add((loc, iso))
    trainings: list[dict[str, Any]] = []
    try:
        shift_handoff.ensure_tables(dsn)
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            sr._ddl(cur)
            cur.execute(shift_handoff.HANDOFFS_DDL)
            apps = _live_applications(cur, key, floor, b)
            hos = _incoming_handoffs(cur, key, floor, b)
            trainings = _trainings(cur, key, floor, b)
            claims = _claims(cur, key, a, b)
        if est is not None:
            import house_cal_live  # noqa: PLC0415
            for c in claimed_only(est, person, claims, a, b, on):
                try:
                    if house_cal_live.release_claim(dsn, c["location"], c["open_row"], c["col_iso"]):
                        released.append({k: c[k] for k in ("house", "location", "col_iso", "value", "open_row")})
                except Exception as exc:  # noqa: BLE001
                    problems.append(f"the {c['value']} shift they took on {c['col_iso']} was not given back "
                                    f"({type(exc).__name__})")
        for x in apps:
            try:
                sr.withdraw(dsn, request_id_=x["id"], why=f"time off scheduled ({ref})")
                withdrawn.append(x["id"])
            except Exception as exc:  # noqa: BLE001
                problems.append(f"application {x['id']} was not withdrawn ({getattr(exc, 'why', type(exc).__name__)})")
        for x in hos:
            try:
                shift_handoff.withdraw(dsn, x["id"], by=f"time off {ref}",
                                       why=f"{person} is on approved time off ({ref})")
                ended.append(x["id"])
            except Exception as exc:  # noqa: BLE001
                problems.append(f"transfer {x['id']} was not ended ({getattr(exc, 'why', type(exc).__name__)})")
    except Exception as exc:  # noqa: BLE001
        problems.append(f"the applications and transfers could not be read ({type(exc).__name__})")
    effects = {"state": "partial" if problems else "done", "staged": staged, "unplaced": unplaced,
               "withdrawn_applications": withdrawn, "ended_handoffs": ended, "released_claims": released,
               "trainings": trainings, "at": stamp(), "why": "; ".join(problems)}
    if json.dumps(effects.get("staged"), sort_keys=True) == json.dumps(prior.get("staged"), sort_keys=True) \
            and effects["unplaced"] == prior.get("unplaced") and effects["state"] == prior.get("state") \
            and withdrawn == list(prior.get("withdrawn_applications") or []) \
            and ended == list(prior.get("ended_handoffs") or []) \
            and released == list(prior.get("released_claims") or []):
        return row
    new = dict(row)
    new.update(effects=json.dumps(effects), updatedAt=stamp())
    try:
        return update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
    except Refused as exc:
        log.warning("time off: the effects of %s were not written (%s) — the next pass retries", ref, exc.why)
        return row


def settle(dsn: str) -> dict[str, Any]:
    """The minute's pass: effects owed, pending rows past their end, approvers owed a read."""
    v = view(dsn)
    if not v["minted"]:
        return {"minted": False}
    on = today()
    managers = None
    counts = {"settled": 0, "expired": 0, "recomputed": 0, "directors_asked": 0}
    est = None
    held_claims: list[dict[str, Any]] | None = None
    names = board(v)["names"]
    for r in list(v["rows"]):
        ref = str(r.get("id") or "")
        st = r.get("status")
        end = day_of(r.get("end_date"))
        try:
            if st == PENDING and end is not None and end < on:
                with id_lock(dsn, ref):
                    fresh = find(view(dsn, fresh=True), ref)
                    if fresh and fresh.get("status") == PENDING:
                        new = dict(fresh)
                        now = stamp()
                        new.update(status=EXPIRED, closed_at=now, updatedAt=now,
                                   status_why="not answered before it ended")
                        update_row(dsn, TAB, new, str(fresh.get("updatedAt") or ""))
                        counts["expired"] += 1
                        _notice(dsn, "time_off_ended", f"time_off_ended:{ref}:{EXPIRED}", new,
                                approvers_of=_asked_names(new))
            elif st == PENDING and not r.get("hm_mode"):
                managers = managers or sr.house_managers(dsn)
                if managers.get("readable"):
                    with id_lock(dsn, ref):
                        fresh = find(view(dsn, fresh=True), ref)
                        if fresh and fresh.get("status") == PENDING and not fresh.get("hm_mode"):
                            _recompute(dsn, fresh, managers, names)
                            counts["recomputed"] += 1
            elif st == PENDING and _owes_directors(r, names):
                # Filed while the list named nobody who may answer it: the row records the directors asked once it…
                with id_lock(dsn, ref):
                    fv = view(dsn, fresh=True)
                    fresh = find(fv, ref)
                    now_names = board(fv)["names"]
                    if fresh and fresh.get("status") == PENDING and _owes_directors(fresh, now_names):
                        _adopt_directors(dsn, fresh, now_names)
                        counts["directors_asked"] += 1
            elif st == SCHEDULED and end is not None and end >= on and r.get("filed_via") != "migration":
                if est is None:
                    est = sr.estate(dsn)
                if held_claims is None:
                    held_claims = _claims_from(dsn, on - timedelta(days=1))
                if settle_owed(r, est, on, _now(), tried_at=_TRIED.get(ref),
                               claims_of=lambda k, a, b: [c for c in held_claims or [] if fold(c["claimed_by"]) == k
                                                          and (a - timedelta(days=1)).isoformat() <= c["col_iso"]
                                                          <= b.isoformat()]):
                    _TRIED[ref] = _now()
                    with id_lock(dsn, ref):
                        fresh = find(view(dsn, fresh=True), ref)
                        if fresh and fresh.get("status") == SCHEDULED:
                            with sr.person_gate(dsn, str(fresh.get("person") or "")):
                                after = settle_one(dsn, fresh)
                            if after.get("updatedAt") != fresh.get("updatedAt"):
                                counts["settled"] += 1
        except Refused as exc:
            log.info("time off: %s was left for the next pass (%s)", ref, exc.why)
    return counts


def _owes_directors(row: dict[str, Any], names: list[str]) -> bool:
    """A waiting director half that asked nobody who may answer it, while the list now names somebody who may: a…"""
    if row.get("dir_state") != WAITING:
        return False
    person, filed_by = str(row.get("person") or ""), str(row.get("filed_by") or "")
    return (not _eligible(_list(row.get("dir_asked")), person, filed_by)
            and bool(_eligible(list(names or []), person, filed_by)))


def _adopt_directors(dsn: str, row: dict[str, Any], names: list[str]) -> dict[str, Any]:
    """Write the list a pending row's director half is now asked of, and tell those directors on the bell as the…"""
    new = dict(row)
    new.update(dir_asked=", ".join(names), updatedAt=stamp())
    wrote = update_row(dsn, TAB, new, str(row.get("updatedAt") or ""))
    named = _eligible(names, str(row.get("person") or ""), str(row.get("filed_by") or ""))
    if named:
        _notice(dsn, "time_off_asked", f"time_off_asked:{row.get('id')}:directors", wrote, approvers_of=named)
    return wrote


RETRY_S = 600.0
_TRIED: dict[str, datetime] = {}


def _claims_from(dsn: str, floor: date) -> list[dict[str, Any]]:
    import house_cal_live  # noqa: PLC0415
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute("SELECT location, open_row, col_iso, value, claimed_by FROM asa_house_calendar_claims "
                    "WHERE col_iso >= %s", (floor.isoformat(),))
        return [dict(r) for r in cur.fetchall()]


def settle_owed(row: dict[str, Any], est: dict[str, Any], on: date, now: datetime, *,
                claims_of: Callable[[str, date, date], list[dict[str, Any]]],
                tried_at: datetime | None = None) -> bool:
    """A cell the effects never saw, a claim still held, or a partial or unplaced result due for its retry."""
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    if a is None or b is None:
        return False
    eff = _json(row.get("effects"))
    if not eff.get("state"):
        return True
    person = str(row.get("person") or "")
    seen = {(s.get("location"), s.get("col_iso")) for s in (eff.get("staged") or []) + (eff.get("unplaced") or [])}
    if any((t["location"], t["col_iso"]) not in seen and (sr.day_of(t["col_iso"]) or on) >= on
           for t in touches(est, person, a, b)):
        return True
    if claimed_only(est, person, claims_of(fold(person), a, b), a, b, on):
        return True
    last = max([t for t in (_at(eff.get("at")), tried_at) if t is not None], default=None)
    due = last is None or (now - last).total_seconds() >= RETRY_S
    return due and (eff.get("state") != "done" or bool(eff.get("unplaced")))


# ── the Builder's slice and the Requests tab ────────────────────────────────

def for_builder(dsn: str) -> tuple[list[dict[str, Any]], str | None]:
    """calendarRequests from the house: pending and scheduled inside the lookback; the old fields kept."""
    v = view(dsn)
    on = today()
    floor = on - timedelta(days=BUILDER_LOOKBACK_DAYS)
    out = []
    for r in v["rows"]:
        if r.get("status") not in (PENDING, SCHEDULED):
            continue
        a, b = day_of(r.get("start_date")), day_of(r.get("end_date"))
        if a is None or b is None or b < floor:
            continue
        out.append({"timestamp": str(r.get("createdAt") or ""), "name": str(r.get("person") or ""),
                    "startDate": a.isoformat(), "endDate": b.isoformat(),
                    "calendarName": str(r.get("calendar_name") or ""), "pending": b >= on,
                    "state": str(r.get("status") or ""), "ref": str(r.get("id") or "")})
    out.sort(key=lambda r: r["startDate"])
    return out, verified_stamp(dsn, v.get("id") or "", v.get("as_of") or None)


def verified_stamp(dsn: str, sid: str, fallback: str | None) -> str | None:
    if not sid or _HOUSE[0] is not None:
        return fallback or stamp()
    try:
        return _now().strftime("%Y-%m-%dT%H:%M:%SZ") if lanes_sheets.verified(sid) else fallback
    except Exception:  # noqa: BLE001
        return fallback


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


def requests_tab(dsn: str, who: dict[str, Any], view_: dict[str, Any]) -> dict[str, Any]:
    """Calendar Builder → Requests → Time off: the house's rows, cut as the app cuts them."""
    try:
        v = view(dsn)
    except Unreadable as exc:
        return {"readable": False, "rows": [], "why": str(exc)}
    if not v["minted"]:
        return {"readable": False, "rows": [], "why": NOT_SET_UP}
    # A list that cannot be read recognises no director: the rows are cut by badge and house alone.
    brd = board(v)
    dirs = brd["names"]
    scope = scope_of(who, dirs)
    theirs = _drawn_people(view_, who.get("manages") or []) if scope == "houses" else set()
    managers = sr.house_managers(dsn)
    on = today()
    out = []
    for r in v["rows"]:
        if r.get("status") in (HISTORY,) or not sees_row(who, r, scope, theirs):
            continue
        b = day_of(r.get("end_date"))
        if b is not None and b < on - timedelta(days=BUILDER_LOOKBACK_DAYS):
            continue
        s = shape(r, who, dirs, managers, view_, on, brd=brd)
        s.update(id=s["ref"], kind=sr.KIND_TIME_OFF, link=f"{APP_PATH}?ref={s['ref']}",
                 state="upcoming" if (b is not None and b >= on and r.get("status") in (PENDING, SCHEDULED))
                 else "past", decided_by=", ".join(x for x in (r.get("hm_by"), r.get("dir_by")) if x),
                 decided_why=s["status_why"], asked=str(r.get("createdAt") or ""),
                 visible=True)
        out.append(s)
    out.sort(key=lambda t: (t["state"] != "upcoming", t["start"]))
    # The rows read; the list that decides them is said beside them, blank or not landed.
    return {"readable": True, "why": "", "rows": out,
            "directors_readable": brd["readable"], "directors_why": brd["why"]}


# ── the app's feed ───────────────────────────────────────────────────────────

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
    # One row whose answer is unknown makes the count unknown: None, never a zero it cannot vouch for.
    unknown = any(s["waiting_on_me"] is None for s in waiting)
    counts = {"scheduled": sum(1 for s in shaped if s["status"] == SCHEDULED and not s["past"]),
              "waiting": len(waiting), "review": sum(1 for s in shaped if s["status"] == REVIEW)}
    return {"off_now": [_entry(r, None) for r in sorted(off_now, key=lambda r: r.get("end_date") or "")],
            "upcoming": [_entry(r, None) for r in sorted(upcoming, key=lambda r: r.get("start_date") or "")],
            "waiting": {"count": len(waiting), "on_me": None if unknown else len(on_me),
                        "soon_on_me": None if unknown else len(soon)},
            "month": {"people": len(month_people), "days": month_days, "label": on.strftime("%B")},
            "bar": counts if scope in ("all", "houses") else None}


def feed(dsn: str, who: dict[str, Any], *, house: str = "") -> dict[str, Any]:
    """Everything the app draws, cut per reader here; an unread house is said, never zero."""
    out: dict[str, Any] = {"readable": False, "why": "", "house": {"minted": False, "as_of": ""},
                           "hero": None, "rows": [], "me": {}, "directors": [], "houses": [],
                           "people": [], "test_mode": _test_mode_on()}
    v = view(dsn)
    brd = board(v)
    dirs = brd["names"]
    scope = scope_of(who, dirs)
    est = sr.estate(dsn)
    managers = sr.house_managers(dsn)
    me = str((who or {}).get("name") or "")
    reach = _may_file_for(who, dirs)
    out["me"] = {"name": me, "scope": scope, "manages": list((who or {}).get("manages") or []),
                 "may_file_for": reach, "is_director": is_director(who, dirs),
                 "every_house": every_house(who), "managers_readable": bool(managers.get("readable"))}
    out["directors"] = dirs
    out["directors_readable"] = brd["readable"]
    out["directors_why"] = brd["why"]
    out["houses"] = sorted(({"code": c, "label": sr.short_house(loc), "location": loc}
                            for c, loc in (est.get("by_code") or {}).items()), key=lambda h: h["label"])
    out["prefill_house"] = str(house or "").strip().upper()
    if reach == "anybody":
        try:
            import calendar_builder_houses  # noqa: PLC0415
            out["people"] = [{"name": r["name"], "houses": r.get("houses") or []}
                             for r in calendar_builder_houses.staff_directory(dsn)["staff"]]
        except Exception:  # noqa: BLE001 — FAIL-OPEN: the calendars' own names still answer
            out["people"] = []
    elif reach == "houses":
        mine = set((who or {}).get("manages") or [])
        names: dict[str, dict[str, Any]] = {}
        for loc in est.get("locations") or []:
            if (house_directory.code_of(loc) or loc.upper()) not in mine:
                continue
            for n in (est.get("people") or {}).get(loc, []):
                if not sr.not_a_person(n, loc):
                    names.setdefault(fold(n), {"name": n, "houses": []})["houses"].append(sr.short_house(loc))
        out["people"] = sorted(names.values(), key=lambda p: p["name"].lower())
    out["house"] = {"minted": bool(v["minted"]), "as_of": v.get("as_of") or ""}
    if not v["minted"]:
        out["why"] = "Time off is not set up on this server yet."
        return out
    out["readable"] = True
    theirs = _drawn_people(est, (who or {}).get("manages") or []) if scope == "houses" else set()
    seen = [r for r in v["rows"] if sees_row(who, r, scope, theirs)]
    on = today()
    shaped = [shape(r, who, dirs, managers, est, on, brd=brd) for r in seen]
    shaped.sort(key=lambda s: (s["created_at"] or ""), reverse=True)
    out["rows"] = shaped
    out["hero"] = hero(seen, shaped, scope=scope, on=on)
    labels = {c: house_label(c, est) for c in (est.get("by_code") or {})}
    for key in ("off_now", "upcoming"):
        for e in out["hero"][key]:
            for h in e["houses"]:
                h["label"] = labels.get(h["code"], h["code"])
    out["me"]["waiting_on_me"] = out["hero"]["waiting"]["on_me"]
    if scope in ("houses", "all"):
        out["orphan_ro"] = orphan_ro(est, v["rows"], None if scope == "all" else set((who or {}).get("manages") or []),
                                     on)
    return out


def orphan_ro(est: dict[str, Any], rows_: list[dict[str, Any]], codes: set[str] | None,
              on: date) -> list[dict[str, Any]]:
    """R/O typed on a calendar with no pending or scheduled request behind it, today onward."""
    covered: dict[str, list[tuple[date, date]]] = {}
    for r in rows_:
        a, b = day_of(r.get("start_date")), day_of(r.get("end_date"))
        if r.get("status") in (PENDING, SCHEDULED, REVIEW) and a and b:
            covered.setdefault(fold(r.get("person")), []).append((a, b))
    out = []
    for loc in est.get("locations") or []:
        code = house_directory.code_of(loc) or loc.upper()
        if codes is not None and code not in codes:
            continue
        for (emp, iso), text in (est.get("cells") or {}).get(loc, {}).items():
            d = sr.day_of(iso)
            if d is None or d < on or str(text).strip().upper() not in ("R/O", "RO", "R\\O", "R/0"):
                continue
            if sr.not_a_person(emp, loc) or any(x <= d <= y for x, y in covered.get(fold(emp), [])):
                continue
            out.append({"person": emp, "house": code, "label": sr.short_house(loc), "col_iso": iso})
    out.sort(key=lambda o: (o["col_iso"], o["person"]))
    return out[:200]


def detail(dsn: str, who: dict[str, Any], ref: str) -> dict[str, Any]:
    v = view(dsn)
    if not v["minted"]:
        raise NotMinted()
    row = find(v, ref)
    brd = board(v)
    dirs = brd["names"]
    scope = scope_of(who, dirs)
    est = sr.estate(dsn)
    theirs = _drawn_people(est, (who or {}).get("manages") or []) if scope == "houses" else set()
    if not row or not sees_row(who, row, scope, theirs):
        raise Refused("no time off request of yours carries that reference", "missing")
    managers = sr.house_managers(dsn)
    s = shape(row, who, dirs, managers, est, brd=brd)
    leg, why_not, code = leg_for(who, row, dirs, managers) if row.get("status") == PENDING else ("", "", "")
    if row.get("status") == PENDING and not brd["readable"]:
        # decide() raises while the list cannot be read, so the screen offers neither half and says why.
        leg, why_not = "", f"{brd['why']} — nothing is decided on this request until it can be read"
    elif row.get("status") == PENDING and not leg and blank_board(row, dirs, code):
        why_not = NO_DIRECTORS
    s["may"] = {"approve": bool(leg), "deny": bool(leg), "withdraw": may_withdraw(who, row),
                "cancel": may_cancel(who, row, dirs), "review": may_review(who, row, dirs),
                # the panel's Edit (the whole record): an approved request's approvers; a waiting one's, whoever
                # decides a half of it; one in review, whoever reviews it — never the person on it
                "edit": may_edit(who, row, dirs) or bool(leg) or may_review(who, row, dirs)}
    s["why_not"] = why_not
    s["leg"] = leg
    s["directors"] = dirs
    s["directors_readable"] = brd["readable"]
    s["directors_why"] = brd["why"]
    s["effects"] = _json(row.get("effects"))
    visible = reason_visible(who, row, dirs)
    s["reason_visible"] = visible
    s["reason"], s["reason_why"] = reason_of(dsn, row) if visible else ("", "")
    s["timeline"] = timeline(dsn, row)
    approver = bool(leg) or every_house(who) or is_director(who, dirs) or scope == "houses"
    if row.get("status") in (PENDING, REVIEW, SCHEDULED):
        try:
            s["does"] = what_it_does(dsn, row)
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never drawn as "nothing"
            s["does"] = None
            s["does_why"] = f"what approving does could not be read ({type(exc).__name__})"
    if approver:
        s["others_off"] = others_off([r for r in v["rows"] if sees_row(who, r, scope, theirs)], row, est)
    return s


def others_off(rows_: list[dict[str, Any]], row: dict[str, Any], est: dict[str, Any] | None) -> list[dict[str, Any]]:
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    houses = set(_list(row.get("houses")))
    out = []
    for r in rows_:
        if r is row or r.get("id") == row.get("id") or r.get("status") not in (SCHEDULED, PENDING):
            continue
        x, y = day_of(r.get("start_date")), day_of(r.get("end_date"))
        if not (a and b and x and y) or not (x <= b and a <= y) or not (houses & set(_list(r.get("houses")))):
            continue
        out.append({**_entry(r, est), "status": r.get("status")})
    return out


def timeline(dsn: str, row: dict[str, Any]) -> list[dict[str, Any]]:
    ref = str(row.get("id") or "")
    out = [{"at": row.get("createdAt") or "", "what": "asked",
            "text": f"asked by {row.get('filed_by') or row.get('person')} via {row.get('filed_via') or 'platform'}"}]
    try:
        ensure_tables(dsn)
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT kind, recipient, said, updated_at FROM asa_time_off_said WHERE ref=%s "
                        "ORDER BY updated_at", (ref,))
            said = [dict(r) for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 — FAIL-OPEN: the row's own facts still read
        said = []
    for s in said:
        entry = s.get("said") if isinstance(s.get("said"), dict) else {}
        out.append({"at": entry.get("at") or "", "what": "message",
                    "text": f"{s['kind'].replace('timeoff_', '').replace('_', ' ')} → {s['recipient']}: "
                            f"{entry.get('state') or 'offered'}" + (f" ({entry.get('why')})" if entry.get("why") else "")})
    for p, label in (("hm", "house manager"), ("dir", "director")):
        if row.get(f"{p}_state") in (APPROVED, NOT_APPROVED):
            out.append({"at": row.get(f"{p}_at") or "", "what": p,
                        "text": f"{'approved' if row.get(f'{p}_state') == APPROVED else 'not approved'} as "
                                f"{label} by {row.get(f'{p}_by')} via {row.get(f'{p}_via') or 'platform'}"})
        elif row.get(f"{p}_state") == MIGRATED:
            out.append({"at": row.get("decided_at") or "", "what": p, "text": f"{label}: {MIGRATED_BY}"})
    if row.get("status") == SCHEDULED:
        out.append({"at": row.get("decided_at") or "", "what": "scheduled", "text": "scheduled"})
    eff = _json(row.get("effects"))
    if eff:
        given_back = len(eff.get("released_claims") or [])
        out.append({"at": eff.get("at") or "", "what": "effects",
                    "text": f"{len(eff.get('staged') or [])} cell(s) staged as drafts, "
                            f"{len(eff.get('unplaced') or [])} with no free OPEN row"
                            + (f", {given_back} shift(s) they had taken open again" if given_back else "")})
    if row.get("closed_at"):
        out.append({"at": row.get("closed_at") or "", "what": row.get("status") or "closed",
                    "text": row.get("status_why") or row.get("status") or ""})
    out.sort(key=lambda e: e["at"] or "")
    return out


# ── the settings ─────────────────────────────────────────────────────────────

def people_rows() -> list[dict[str, Any]]:
    try:
        with open(PEOPLE_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise Unreadable(f"the People file could not be read ({type(exc).__name__})") from exc
    got = data.get("rows") if isinstance(data, dict) else data
    return [r for r in (got or []) if isinstance(r, dict)]


def resolve_name(name: str, people: list[dict[str, Any]], accounts: list[dict[str, Any]]) -> dict[str, Any]:
    hits = [p for p in people if same_person(p.get("name"), name)]
    accs = [a for a in accounts if same_person(a.get("name"), name)]
    p = hits[0] if len(hits) == 1 else None
    return {"name": name, "people_matches": len(hits), "account_matches": len(accs),
            "people_name": str((p or {}).get("name") or ""),
            "phone": bool(str((p or {}).get("phone") or "").strip()),
            "email": bool(str((p or {}).get("email") or "").strip()),
            "account_role": str((accs[0] if len(accs) == 1 else {}).get("role") or ""),
            "ok": len(hits) == 1 or (not hits and len(accs) == 1)}


def _accounts(dsn: str) -> list[dict[str, Any]]:
    with hub_db.intel(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT coalesce(nullif(entity_name,''), display_name) AS name, role FROM asa_users "
                    "WHERE active IS NOT FALSE AND (merged_into IS NULL OR merged_into::text = '')")
        return [dict(r) for r in cur.fetchall()]


_WRITABLE: dict[str, Any] = {"ok": None, "why": ""}


def _wrote(ok: bool, why: str = "") -> None:
    _WRITABLE.update(ok=ok, why=why)


def settings_state(dsn: str, *, probe: bool = False) -> dict[str, Any]:
    """`probe` (the relay's start only) writes the header back; a read reports the last write's outcome."""
    v = view(dsn, fresh=True)
    brd = board(v)
    dirs = brd["names"]
    try:
        people, accounts = people_rows(), _accounts(dsn)
        resolved = [resolve_name(d, people, accounts) for d in dirs]
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said per name, never "all fine"
        resolved = [{"name": d, "ok": False, "why": f"could not be checked ({type(exc).__name__})"} for d in dirs]
    if probe and v["minted"] and kept():
        # the house is no longer written: the app keeps the records
        _wrote(KEEPER[0] is not None, "" if KEEPER[0] is not None else "the platform's app is not reachable")
    elif probe and v["minted"]:
        try:
            house = _house(v["id"])
            head = house.values(SETTINGS_TAB)[:1]
            house.update(SETTINGS_TAB, 1, list(head[0] if head else SETTINGS_HEADER))
            _wrote(True)
        except Exception as exc:  # noqa: BLE001
            _wrote(False, type(exc).__name__)
    writable, why = _WRITABLE["ok"], _WRITABLE["why"]
    s = v["settings"]
    # `directors` is the cell's board.
    return {"minted": v["minted"], "directors": dirs, "directors_readable": brd["readable"],
            "directors_declared": bool(brd["readable"] and dirs), "directors_why": brd["why"],
            "resolved": resolved,
            "form_sync": s.get("form_sync") or "on", "form_cutover_at": s.get("form_cutover_at") or "",
            "form_watermark": s.get("form_watermark") or "", "test_rows": len(test_rows(v)),
            "test_mode": _test_mode_on(),
            "house": {"id": v["id"], "mirrored_at": v.get("as_of") or "", "writable": writable,
                      "writable_why": why, "rows": len(v["rows"])}}


def save_settings(dsn: str, who: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    if not every_house(who):
        raise Refused("the Time Off settings are for the badges that decide every house", "not_allowed")
    v = view(dsn, fresh=True)
    if not v["minted"]:
        raise NotMinted()
    if "directors" in body:
        names = [" ".join(str(n).split()) for n in (body.get("directors") or []) if str(n).strip()]
        names = list(dict.fromkeys(names))
        if not names:
            raise Refused("the list cannot be empty — a request would have no director to ask", "empty")
        try:
            people, accounts = people_rows(), _accounts(dsn)
        except Exception as exc:  # noqa: BLE001
            raise Refused(f"the names could not be checked ({type(exc).__name__}) — nothing was saved",
                          "unreadable") from exc
        bad = [r["name"] for r in (resolve_name(n, people, accounts) for n in names) if not r["ok"]]
        if bad:
            raise Refused(f"{', '.join(bad)} match nobody, or more than one person — nothing was saved",
                          "unresolved", names=bad)
        write_setting(dsn, "directors", ", ".join(names), "the director half of every time off request")
    if "form_sync" in body:
        word = "on" if str(body.get("form_sync")).strip().lower() in ("on", "true", "1", "yes") else "off"
        write_setting(dsn, "form_sync", word, "new Google Form rows are added while on")
    return settings_state(dsn)


# ── messages: planned here, said by the one send door ───────────────────────

K_ASK_MANAGER = "timeoff_ask_manager"
K_ASK_ABOVE = "timeoff_ask_above"
K_ASK_DIRECTOR = "timeoff_ask_director"
K_SCHEDULED = "timeoff_scheduled"
K_SCHEDULED_MANAGER = "timeoff_scheduled_manager"
K_DENIED = "timeoff_denied"
K_CANCELLED = "timeoff_cancelled"
K_CANCELLED_MANAGER = "timeoff_cancelled_manager"
K_EXPIRED = "timeoff_expired"
KINDS = (K_ASK_MANAGER, K_ASK_ABOVE, K_ASK_DIRECTOR, K_SCHEDULED, K_SCHEDULED_MANAGER, K_DENIED,
         K_CANCELLED, K_CANCELLED_MANAGER, K_EXPIRED)
TELL_DAYS = 3


def _affected_managers(row: dict[str, Any], managers: dict[str, Any] | None) -> list[str]:
    eff = _json(row.get("effects"))
    codes = {str(s.get("house") or "") for s in (eff.get("staged") or []) + (eff.get("unplaced") or [])
             + (eff.get("released_claims") or [])}
    out: list[str] = []
    for code in sorted(c for c in codes if c):
        hm = ((managers or {}).get("by_code") or {}).get(code) or {}
        for n in (hm.get("names") or [hm.get("name")])[:1]:
            if n and fold(n) != fold(row.get("person")) and not any(fold(n) == fold(x) for x in out):
                out.append(n)
    return out


def wanted(row: dict[str, Any], dirs: list[str], managers: dict[str, Any] | None,
           now: datetime | None = None) -> list[tuple[str, str]]:
    """(kind, recipient) owed by this row now — pure."""
    now = now or _now()
    if row.get("filed_via") == "migration" or str(row.get("source") or "").startswith("legacy"):
        return []
    st = row.get("status")
    out: list[tuple[str, str]] = []
    skip = {fold(row.get("person")), fold(row.get("filed_by"))} - {""}

    def free(n: str) -> bool:
        return fold(n) not in skip and not any(same_person(n, x) for x in (row.get("person"), row.get("filed_by")) if x)

    if st == PENDING:
        deciders = {fold(row.get("hm_by")), fold(row.get("dir_by"))} - {""}
        asked = [n for n in dirs if free(n) and fold(n) not in deciders]
        above = row.get("hm_state") == WAITING and row.get("hm_mode") == MODE_ABOVE
        if row.get("hm_state") == WAITING and row.get("hm_mode") == MODE_HM:
            out += [(K_ASK_MANAGER, n) for n in _list(row.get("hm_asked")) if free(n)]
        if above:
            out += [(K_ASK_ABOVE, n) for n in asked]
        elif row.get("dir_state") == WAITING:
            out += [(K_ASK_DIRECTOR, n) for n in asked]
        return out
    at = _at(row.get("updatedAt"))
    if at is None or (now - at) > timedelta(days=TELL_DAYS):
        return []
    person = str(row.get("person") or "")
    if st == SCHEDULED:
        out.append((K_SCHEDULED, person))
        out += [(K_SCHEDULED_MANAGER, n) for n in _affected_managers(row, managers)]
    elif st == DENIED:
        out.append((K_DENIED, person))
    elif st == CANCELLED:
        out.append((K_CANCELLED, person))
        out += [(K_CANCELLED_MANAGER, n) for n in _affected_managers(row, managers)]
    elif st == WITHDRAWN and _json(row.get("effects")).get("staged"):
        out += [(K_CANCELLED_MANAGER, n) for n in _affected_managers(row, managers)]
    elif st == EXPIRED:
        out.append((K_EXPIRED, person))
    return out


def said_id(ref: str, kind: str, recipient: str) -> str:
    return f"{ref}:{kind}:{fold(recipient)}"


def people_spelling(name: str, people: list[dict[str, Any]]) -> str:
    exact = [p for p in people if fold(p.get("name")) == fold(name)]
    if exact:
        return str(exact[0].get("name") or name)
    close = [p for p in people if same_person(p.get("name"), name)]
    return str(close[0].get("name") or name) if len(close) == 1 else name


def drafts_words(row: dict[str, Any]) -> str:
    eff = _json(row.get("effects"))
    staged = [s for s in eff.get("staged") or [] if s.get("moved_to")]
    days_off = [s for s in eff.get("staged") or [] if not s.get("moved_to")]
    unplaced = eff.get("unplaced") or []
    parts = []
    if staged:
        parts.append(f"{len(staged)} shift(s) are open drafts: " + "; ".join(
            f"{day_words(s.get('col_iso'))} {s.get('value')} at {sr.short_house(s.get('location') or '')}"
            for s in staged[:4]) + ("..." if len(staged) > 4 else "") + ".")
    if days_off:
        parts.append(f"{len(days_off)} day(s) are drafted R/O.")
    back = eff.get("released_claims") or []
    if back:
        parts.append(f"{len(back)} shift(s) they had taken are open again: " + "; ".join(
            f"{day_words(s.get('col_iso'))} {s.get('value')} at {sr.short_house(s.get('location') or '')}"
            for s in back[:4]) + ("..." if len(back) > 4 else "") + ".")
    if unplaced:
        parts.append(f"{len(unplaced)} could not be moved (no free OPEN row) and still show their name.")
    return _ascii(" ".join(parts), 300) or "Nothing on the calendars needed moving."


def door_row(row: dict[str, Any], kind: str, recipient: str, people: list[dict[str, Any]],
             est: dict[str, Any] | None = None) -> dict[str, Any]:
    ref = str(row.get("id") or "")
    houses = _list(row.get("houses"))
    label = ", ".join(house_label(c, est) for c in houses) or "your house"
    by = row.get("hm_by") if row.get("hm_state") == NOT_APPROVED else row.get("dir_by")
    words = row.get("hm_note") if row.get("hm_state") == NOT_APPROVED else row.get("dir_note")
    if row.get("status") in (CANCELLED, WITHDRAWN):
        by, words = row.get("closed_by"), row.get("closed_note")
    who = people_spelling(recipient, people)
    approval = row.get("hm_why") if kind in (K_ASK_MANAGER, K_ASK_ABOVE) else \
        ("a director approves as well as the house manager" if kind == K_ASK_DIRECTOR else "")
    n = int(row.get("days")) if str(row.get("days") or "").isdigit() else 0
    return {"id": said_id(ref, kind, recipient), "kind": kind, "person": who, "person_key": fold(who),
            "to_name": who, "requester": str(row.get("person") or ""),
            "dates": dates_words(row.get("start_date"), row.get("end_date")),
            "days": f"{n} day{'' if n == 1 else 's'}" if n else "", "house_name": label, "houses": houses,
            "ref": ref, "link_path": f"{LINK_PATH}?ref={ref}", "approval_why": _ascii(approval, 200),
            "by": str(by or ""), "words": _ascii(words, 160), "drafts": drafts_words(row),
            "reason_line": "A reason was given - read it on the Hub." if str(row.get("reason_given") or "") == "yes"
            else "No reason was given.", "day": str(row.get("start_date") or "")}


def owed(dsn: str, *, now: datetime | None = None, limit: int = 40) -> list[dict[str, Any]]:
    import psi_reminders  # noqa: PLC0415
    import shift_handoff  # noqa: PLC0415
    now = now or _now()
    if psi_reminders.quiet(now):
        return []
    v = view(dsn)
    if not v["minted"]:
        return []
    brd = board(v)
    dirs = brd["names"]
    managers = sr.house_managers(dsn)
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, said FROM asa_time_off_said")
        said = {r["id"]: r["said"] for r in cur.fetchall()}
    try:
        people = people_rows()
    except Unreadable:
        people = []
    est = None
    out: list[dict[str, Any]] = []
    rehearsing = _test_mode_on()
    for r in v["rows"]:
        if r.get("test_mode") == "on" and not rehearsing:
            continue
        if r.get("status") == PENDING and not brd["readable"]:
            # FAIL-CLOSED: nobody is asked to approve what decide() would refuse; nothing is marked said, so each…
            continue
        for kind, who in wanted(r, dirs, managers, now):
            sid = said_id(str(r.get("id") or ""), kind, who)
            if not shift_handoff._owed_again(said.get(sid), now):
                continue
            if est is None:
                try:
                    est = sr.estate(dsn)
                except Exception:  # noqa: BLE001 — the codes travel instead of the names
                    est = {}
            out.append(door_row(r, kind, who, people, est))
            if len(out) >= limit:
                return out
    return out


def mark_said(dsn: str, ids: list[str], results: dict[str, Any],
              rows: list[dict[str, Any]] | None = None) -> int:
    """Only a real outcome closes an ask; "not now" stays owed."""
    import shift_handoff  # noqa: PLC0415
    dial, test_mode = str(results.get("dial") or ""), str(results.get("test_mode") or "")
    shift_handoff.note_dial(dial, test_mode)
    by_id = {str(r.get("id")): r for r in (results.get("results") or []) if isinstance(r, dict)}
    names = {str(r.get("id")): str(r.get("to_name") or "") for r in rows or []}
    done = 0
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        for key in ids:
            got = by_id.get(str(key))
            ref, _, rest = str(key).partition(":")
            kind, _, who = rest.partition(":")
            if not got or kind not in KINDS:
                continue
            state = str(got.get("state") or "failed")
            if state in shift_handoff.NOT_NOW:
                continue
            entry = {"state": state, "why": str(got.get("why") or "")[:300], "at": stamp(),
                     "dial": dial, "test_mode": test_mode}
            if got.get("phone_key"):
                entry["phone_key"] = str(got["phone_key"])
            if got.get("email"):
                entry["email"] = str(got["email"])
            cur.execute(
                "INSERT INTO asa_time_off_said (id, ref, kind, recipient, said, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,now()) ON CONFLICT (id) DO UPDATE SET said=EXCLUDED.said, "
                "updated_at=now()", (str(key), ref, kind, names.get(str(key)) or who, json.dumps(entry)))
            done += cur.rowcount
        conn.commit()
    return done


# ── answers by text ──────────────────────────────────────────────────────────

def match_reply(dsn: str, *, ref: str, name: str, who: dict[str, Any] | Callable[[], dict[str, Any]] | None
                ) -> dict[str, Any]:
    """{row, leg, why, code}: the leg this sender may fill, or '' with the sentence — never a guess."""
    v = view(dsn)
    row = find(v, ref)
    if not row:
        return {"row": None, "leg": "", "why": f"no time off request carries {ref}", "code": "missing"}
    if row.get("status") != PENDING:
        return {"row": row, "leg": "", "why": f"{ref} is already {row.get('status')}", "code": "not_pending"}
    # Unreadable is raised: the ear holds the text and asks again, never reads it as "not yours".
    dirs = directors_of(v["settings"])
    reader = (who() if callable(who) else who) or {"name": name}
    reader = {**reader, "name": name}
    leg, why, code = leg_for(reader, row, dirs, sr.house_managers(dsn))
    if not leg and blank_board(row, dirs, code):
        why, code = NO_DIRECTORS, "no_directors"
    return {"row": row, "leg": leg, "why": why, "code": code}


def note_from_text(text: str, ref: str) -> str:
    upper = str(text or "")
    i = upper.upper().find(str(ref).upper())
    rest = upper[i + len(ref):] if i >= 0 else ""
    return _ascii(rest.strip(" .,:;-"), 300)


def answered_words(row: dict[str, Any], leg: str, word: str) -> str:
    ref = str(row.get("id") or "")
    half = "house manager" if leg == LEG_HM else "director"
    if word != "approve":
        return f"your NO for {ref} is recorded: the time off is not approved"
    if row.get("status") == SCHEDULED:
        return f"your YES for {ref} is recorded: both halves are approved and the time off is scheduled"
    other = "a director" if leg == LEG_HM else "the house manager"
    return f"your YES for {ref} is recorded: the {half} half is approved - {other} still has to approve"


# ── web notices: the platform channel ────────────────────────────────────────

def house_labels(dsn: str) -> dict[str, str]:
    try:
        est = sr.estate(dsn)
    except Exception:  # noqa: BLE001 — FAIL-OPEN: the codes stand in for the names
        return {}
    return {c: house_label(c, est) for c in (est.get("by_code") or {})}


def _notice(dsn: str, kind: str, key: str, row: dict[str, Any], *, approvers_of: list[str],
            extra: dict[str, Any] | None = None) -> None:
    try:
        # the notices lane derives this one from the row (web_notices.events_from_time_off): it is asked to look now
        wake = NOTICES[0]
        if wake is not None:
            wake()
    except Exception as exc:  # noqa: BLE001 — a notice never breaks the act it reports
        log.warning("time off: notice %s not published (%s)", key, type(exc).__name__)


# ── until the Google Form is closed ─────────────────────────────────────────

_FORM_AT = [0.0]


def _form_ts(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=OHIO)
        except ValueError:
            continue
    return _at(text)


def _field(data: dict[str, Any], name: str) -> str:
    want = " ".join(name.lower().split())
    for k, val in (data or {}).items():
        if " ".join(str(k).lower().split()) == want:
            return str(val or "").strip()
    return ""


def form_problems(row: dict[str, Any], existing: list[dict[str, Any]], on: date) -> list[str]:
    """What the platform's own form would have refused; such a form row waits for review instead."""
    a, b = day_of(row.get("start_date")), day_of(row.get("end_date"))
    if a is None or b is None:
        return ["the dates are not a range"]
    out = []
    if (b - a).days + 1 > MAX_DAYS:
        out.append(f"it covers more than {MAX_DAYS} days")
    if a < on:
        out.append("it had already started when it was filed")
    key = fold(row.get("person"))
    for r in existing:
        if fold(r.get("person")) != key or r.get("status") not in (PENDING, SCHEDULED, REVIEW):
            continue
        x, y = day_of(r.get("start_date")), day_of(r.get("end_date"))
        if x and y and x <= b and a <= y:
            out.append(f"it overlaps {r.get('id')} ({dates_words(x.isoformat(), y.isoformat())}, {describe_wait(r)})")
    return out


def form_sync(dsn: str, *, force: bool = False) -> dict[str, Any]:
    """New form rows after the cutover become pending requests; only while form_sync is on."""
    if not force and time.time() - _FORM_AT[0] < FORM_SYNC_EVERY_S:
        return {"skipped": "not due"}
    _FORM_AT[0] = time.time()
    v = view(dsn)
    if not v["minted"]:
        return {"skipped": "not minted"}
    s = v["settings"]
    if (s.get("form_sync") or "on") != "on" or not s.get("form_cutover_at"):
        return {"skipped": "off"}
    try:
        dirs = directors_of(s)
    except Unreadable as exc:
        # FAIL-CLOSED: form rows wait behind the watermark until the list can be read.
        return {"skipped": "directors unreadable", "why": str(exc)}
    floor = max(filter(None, [_at(s.get("form_cutover_at")), _at(s.get("form_watermark"))]),
                default=None)
    form = lanes_sheets.rows(MASTER_SHEET_ID, FORM_TAB)
    est = sr.estate(dsn)
    keys = {str(r.get("source_key") or "") for r in v["rows"]}
    grid = sorted({n for loc in est.get("locations") or [] for n in (est.get("people") or {}).get(loc, [])
                   if not sr.not_a_person(n, loc)})
    fresh = []
    newest = floor
    for rn, data in form:
        ts = _form_ts(_field(data, "Timestamp"))
        if ts is None or (floor is not None and ts <= floor):
            continue
        newest = ts if newest is None or ts > newest else newest
        fresh.append((rn, data))
    if not fresh:
        return {"added": 0}
    planned = plan_migration({"staff_requests": fresh, "requests_archive": []}, keys, grid_names=grid,
                             accounts=[], today=today(),
                             houses_of=lambda p, a, b: houses_for(est, p, a, b), live=True)
    managers = sr.house_managers(dsn)
    added = 0
    held = list(v["rows"])
    for row in planned["rows"]:
        problems = form_problems(row, held, today()) if row["status"] == PENDING else []
        if problems:
            row.update(status=REVIEW, hm_state="", dir_state="",
                       status_why="a form row that needs a look: " + "; ".join(problems),
                       flags=", ".join(_list(row.get("flags")) + ["needs_a_look"]))
        if row["status"] == PENDING:
            asked = approvers(est=est, managers=managers, person=row["person"], houses=_list(row["houses"]),
                              filed_by=row["person"], dirs=dirs)
            row.update(hm_mode=asked["hm_mode"], hm_asked=", ".join(asked["hm_names"]), hm_why=asked["hm_why"],
                       dir_asked=", ".join(dirs), status_why=_waits_words("filed on the Google Form; "))
        row["id"] = new_ref(r.get("id") for r in held)
        try:
            append_row(dsn, TAB, row)
            held.append(row)
            added += 1
            if row["status"] == PENDING:
                _notice(dsn, "time_off_asked", f"time_off_asked:{row['id']}", row, approvers_of=_asked_names(row))
        except Refused as exc:
            log.info("time off: a form row was not added (%s)", exc.why)
    if newest is not None:
        write_setting(dsn, "form_watermark", stamp(newest), "the newest form row added")
    return {"added": added}


# ── the migration plan: pure, shared by the tool and the tests ──────────────

_MONTHS = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
_ORD = r"(?:st|nd|rd|th)?"
_SEP = r"\s*(?:-|–|—|to|thru|through|until|till)\s*"
_NUM = r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?"
_DASH = r"(\d{1,2})-(\d{1,2})-(\d{2,4})"
_NAMED = _MONTH + r"\s+(\d{1,2})" + _ORD + r"(?:,?\s*(\d{4}))?"
_PATTERNS = (
    ("num_range", re.compile(_NUM + _SEP + _NUM, re.I)),
    ("dash_range", re.compile(_DASH + _SEP + _DASH, re.I)),
    ("named_range", re.compile(_NAMED + _SEP + _NAMED, re.I)),
    ("named_days", re.compile(_NAMED + _SEP + r"(\d{1,2})" + _ORD + r"(?![/\d])", re.I)),
    ("num_days", re.compile(_NUM + _SEP + r"(\d{1,2})(?![/\d])", re.I)),
    ("num", re.compile(_NUM, re.I)),
    ("dash", re.compile(_DASH, re.I)),
    ("named", re.compile(_NAMED, re.I)),
)


def _year_near(month: int, day: int, anchor: date, given: str | None) -> date | None:
    if given:
        y = int(given)
        y = y + 2000 if y < 100 else y
        try:
            return date(y, month, day)
        except ValueError:
            return None
    for y in (anchor.year, anchor.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            continue
        if d >= anchor - timedelta(days=31):
            return d
    return None


def parse_ranges(text: str, anchor: date) -> list[tuple[date, date]]:
    """Every date range a free-text request names; the year from the anchor, nearest forward."""
    s = str(text or "")
    out: list[tuple[date, date]] = []
    taken = [False] * len(s)

    def free(m: re.Match[str]) -> bool:
        return not any(taken[m.start():m.end()])

    def mark(m: re.Match[str]) -> None:
        for i in range(m.start(), m.end()):
            taken[i] = True

    def mon(word: str) -> int:
        return _MONTHS.get(word.lower()[:3], 0)

    found: list[tuple[int, date, date]] = []
    for kind, pat in _PATTERNS:
        for m in pat.finditer(s):
            if not free(m):
                continue
            g = m.groups()
            a = b = None
            try:
                if kind == "num_range":
                    a = _year_near(int(g[0]), int(g[1]), anchor, g[2])
                    b = _year_near(int(g[3]), int(g[4]), a or anchor, g[5])
                elif kind == "dash_range":
                    a = _year_near(int(g[0]), int(g[1]), anchor, g[2])
                    b = _year_near(int(g[3]), int(g[4]), anchor, g[5])
                elif kind == "named_range":
                    a = _year_near(mon(g[0]), int(g[1]), anchor, g[2])
                    b = _year_near(mon(g[3]), int(g[4]), a or anchor, g[5])
                elif kind == "named_days":
                    a = _year_near(mon(g[0]), int(g[1]), anchor, g[2])
                    b = _year_near(mon(g[0]), int(g[3]), a or anchor, g[2])
                elif kind == "num_days":
                    a = _year_near(int(g[0]), int(g[1]), anchor, g[2])
                    b = _year_near(int(g[0]), int(g[3]), a or anchor, g[2])
                elif kind in ("num", "dash"):
                    a = b = _year_near(int(g[0]), int(g[1]), anchor, g[2])
                elif kind == "named":
                    a = b = _year_near(mon(g[0]), int(g[1]), anchor, g[2])
            except (ValueError, TypeError):
                a = b = None
            if a is None or b is None:
                continue
            if b < a and (a - b).days < 300:
                continue
            if b < a:
                b = _year_near(b.month, b.day, a, None) or b
            mark(m)
            found.append((m.start(), a, b))
    found.sort(key=lambda t: t[0])
    for _i, a, b in found:
        if (a, b) not in out and (b - a).days <= 366:
            out.append((a, b))
    return out


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:20]


def resolve_person(name: str, grid_names: list[str], accounts: list[str]) -> str:
    key = fold(name)
    if not key or key == "other":
        return ""
    for pool in (grid_names, accounts):
        exact = [n for n in pool if fold(n) == key]
        if exact:
            return exact[0]
        close = sorted({n for n in pool if same_person(n, name)})
        if len(close) == 1:
            return close[0]
    return ""


def _blank_row() -> dict[str, str]:
    return {h: "" for h in HEADER}


def plan_migration(sources: dict[str, list[tuple[int, dict[str, Any]]]], existing_keys: Iterable[str], *,
                   grid_names: list[str], accounts: list[str], today: date,
                   houses_of: Callable[[str, date, date], list[str]] | None = None,
                   live: bool = False, until: datetime | None = None) -> dict[str, Any]:
    """Rows to append, by class; nothing already in the house (by source_key) is planned again."""
    from calendar_builder_slices import _req_date  # noqa: PLC0415 — the form's own date reader
    have = {str(k) for k in existing_keys if str(k)}
    planned: dict[str, dict[str, str]] = {}
    counts = {"scheduled": 0, "pending": 0, "history": 0, "needs_review": 0, "duplicate": 0,
              "already": 0, "archive_ranges": 0, "archive_unparsed": 0, "after_cutover": 0}
    now = stamp()
    for rn, data in sources.get("staff_requests") or []:
        raw_name = _field(data, "Your Name")
        ts_raw = _field(data, "Timestamp")
        stamped = _form_ts(ts_raw)
        if until is not None and stamped is not None and stamped > until:
            counts["after_cutover"] += 1
            continue
        raw_start, raw_end = _field(data, "Time off (start date)"), _field(data, "Time off (end date)")
        start = _req_date(raw_start)
        end = _req_date(raw_end) or start
        ts = _form_ts(ts_raw)
        person = resolve_person(raw_name, grid_names, accounts)
        flags: list[str] = []
        if not raw_name.strip() or fold(raw_name) == "other":
            flags.append("name_other")
        elif not person:
            flags.append("no_calendar_row")
        if start is None:
            flags.append("dates_unparsed")
        elif end is not None and end < start:
            flags.append("reversed_dates")
        clean = not ({"name_other", "reversed_dates", "dates_unparsed"} & set(flags))
        if clean:
            # the form's own words, so a re-run keys a row the same whoever the grid names that day
            key = "form:" + _sha(f"{fold(raw_name)}|{start}|{end}")
        else:
            key = "form:" + _sha(f"{ts_raw}|{fold(raw_name)}|{raw_start}|{raw_end}")
        if key in have:
            counts["already"] += 1
            continue
        if key in planned:
            row = planned[key]
            row["source_rows"] = ", ".join(_list(row["source_rows"]) + [str(rn)])
            row["flags"] = ", ".join(dict.fromkeys(_list(row["flags"]) + ["duplicate"]))
            counts["duplicate"] += 1
            continue
        latest = max(d for d in (start, end) if d) if (start or end) else None
        upcoming = latest is not None and latest >= today
        row = _blank_row()
        row.update(person=person or raw_name.strip(), person_key=fold(person or raw_name),
                   start_date=start.isoformat() if start else "", end_date=(end or start).isoformat() if (end or start) else "",
                   filed_by=raw_name.strip(), filed_by_key=fold(raw_name),
                   source="form:staff_requests", source_key=key, source_rows=str(rn),
                   calendar_name=_field(data, "Calendar Name"), flags=", ".join(flags),
                   createdAt=stamp(ts) if ts else now, updatedAt=now)
        if start and end and end >= start:
            row["days"] = str((end - start).days + 1)
            if houses_of is not None and person:
                row["houses"] = ", ".join(houses_of(person, start, end))
        if live:
            row["filed_via"] = "form"
            if upcoming and clean and person:
                row.update(status=PENDING, status_why="filed on the Google Form; waiting on the house manager and a director",
                           hm_state=WAITING, dir_state=WAITING)
                counts["pending"] += 1
            else:
                row.update(status=REVIEW, status_why="a form row that needs a person: " + ", ".join(flags or ["past dates"]))
                counts["needs_review"] += 1
        else:
            row["filed_via"] = "migration"
            if upcoming and clean and person:
                row.update(status=SCHEDULED, hm_state=MIGRATED, dir_state=MIGRATED, hm_by=MIGRATED_BY,
                           dir_by=MIGRATED_BY, hm_via="migration", dir_via="migration",
                           decided_at=stamp(ts) if ts else now,
                           status_why="scheduled by the Master Calendar Creator form, before the platform")
                counts["scheduled"] += 1
            elif upcoming:
                row.update(status=REVIEW, status_why="migrated from the form and needs a person: " + ", ".join(flags))
                counts["needs_review"] += 1
            else:
                row.update(status=HISTORY, status_why="the form's history, before the platform")
                counts["history"] += 1
        planned[key] = row
    for rn, data in sources.get("requests_archive") or []:
        kind = _field(data, "Request Type").lower()
        if kind not in ("vacation", "vacation request"):
            continue
        raw_name = _field(data, "Your Name")
        ts_raw = _field(data, "Timestamp")
        details = next((str(v or "") for k, v in (data or {}).items()
                        if str(k).lower().startswith("please provide the details")), "")
        ts = _form_ts(ts_raw)
        anchor = ts.date() if ts else today
        person = resolve_person(raw_name, grid_names, accounts)
        ranges = parse_ranges(details, anchor)
        base = _blank_row()
        base.update(person=person or raw_name.strip(), person_key=fold(person or raw_name),
                    filed_by=raw_name.strip(), filed_by_key=fold(raw_name), filed_via="migration",
                    source="legacy:requests_archive", source_rows=str(rn), status=HISTORY,
                    status_why="the old request form's history, before the platform",
                    reason_given="yes" if details.strip() else "", **{REASON_COL: details.strip()[:REASON_MAX]},
                    createdAt=stamp(ts) if ts else now, updatedAt=now,
                    hm_state=MIGRATED, dir_state=MIGRATED, hm_by=MIGRATED_BY, dir_by=MIGRATED_BY)
        if not person:
            base["flags"] = "no_calendar_row"
        if not ranges:
            key = "legacy:" + _sha(f"{ts_raw}|{fold(raw_name)}|{details}")
            if key in have:
                counts["already"] += 1
                continue
            if key in planned:
                continue
            row = dict(base)
            row.update(source_key=key, flags=", ".join(_list(base["flags"]) + ["dates_unparsed"]))
            planned[key] = row
            counts["archive_unparsed"] += 1
            continue
        for i, (a, b) in enumerate(ranges):
            key = "legacy:" + _sha(f"{ts_raw}|{fold(raw_name)}|{i}|{a}|{b}")
            if key in have:
                counts["already"] += 1
                continue
            if key in planned:
                continue
            row = dict(base)
            row.update(source_key=key, start_date=a.isoformat(), end_date=b.isoformat(),
                       days=str((b - a).days + 1))
            planned[key] = row
            counts["archive_ranges"] += 1
    return {"rows": list(planned.values()), "counts": counts}
