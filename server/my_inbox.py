"""My Inbox: the alerts that concern one person, put together on the relay before anything leaves.
One door (/hub-lanes/my-inbox) builds the whole answer for one SUBJECT: the signed-in account, or, for the…"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import psycopg2
import psycopg2.extras

import hub_db
import my_work as mw
import shift_requests as sr

log = logging.getLogger("hub.my_inbox")

UTC = timezone.utc

SOURCES = (
    ("requests", "Your requests"),
    ("reimbursement", "Reimbursement requests"),
    ("punch", "Missing punches"),
    ("scheduling", "Scheduling"),
    ("support", "Support Requests"),
    ("hiring", "Hiring"),
    ("new_staff", "New staff"),
    ("new_clients", "New clients"),
    ("potential_clients", "New prospects"),
    ("notices", "Company notices"),
    ("updates", "Software updates"),
    ("med_error", "Medication error reports"),
    ("transport", "Transportation"),
)
LABELS = dict(SOURCES)

STATE_READY, STATE_UNREADABLE, STATE_NOT_ATTRIBUTABLE = mw.STATE_READY, mw.STATE_UNREADABLE, \
    mw.STATE_NOT_ATTRIBUTABLE
STATE_HELD, STATE_CLOSED, STATE_NOT_ON_PLATFORM = "held", "closed", "not_on_platform"

# Always answered, each with its one plain sentence: what the inbox cannot tell anybody yet.
NOT_ON_PLATFORM = (
    ("mentions", "@mentions",
     "Nothing on the platform reads an @ in documents or notes yet. The Mentions filter shows the chat "
     "messages written to you."),
    ("car_trips", "Car trips and mileage",
     "The mileage, fleet and expense books exist but hold no rows. Reimbursement requests do work."),
    ("doctor_appointments", "Doctor appointments with your clients",
     "The appointment book has no staff column, so no appointment can be tied to you."),
    ("hire_started", "A new hire who started work",
     "Starting work is not recorded anywhere this server reads."),
    ("hiring_referral", "Your hiring referral", "No readable source records who referred a candidate."),
    ("house_events", "House events", "The platform keeps no house events."),
    ("punch_history", "Missing punches before yesterday", "Only yesterday and today are kept."),
)

# An alert key: a kind, then the words that make it one alert — its state included, so a change is a new one.
KEY_RE = re.compile(r"^[a-z_]+:[A-Za-z0-9:._-]{1,200}$")
# A company notice keeps the bell's own id, so there is one unread state for it and no double count.
NOTICE_KEY_RE = re.compile(r"^srv-([1-9][0-9]{0,17})$")
READ_MAX = 500
# an account is chosen by its own id, nothing else
PERSON_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
_PART_RE = re.compile(r"[A-Za-z0-9:._-]{1,120}")

# The apps whose doors are asked for the subject, each on the gate's threads.
APPS = ("my-work", "hiring", "users", "employee-tracker", "clients", "potential-clients", "ui-incidents",
        "scheduling", "support-desk",
        "vehicle-calendar")
# The release notes: the notes book's tab of what went live, read from the relay's mirror.
NOTES_SHEET_ID = os.getenv("HUB_NOTES_SHEET_ID", "1BTuqU6xZHmo_jfI49rU3a6el2BB1pFMnCeS5bZBTbY4")
UPDATES_TAB = "REFERENCE-production_apps"
UPDATE_COLUMNS = ("Date", "App / area", "Status", "Activity completed", "Version / commit")
# src/registry's apps by name.
_REGISTRY_APPS = (
    ("Academy", "academy"), ("Administration", "administration"), ("App Control", "app-control"),
    ("Audit Library", "audit-library"), ("Audits & Compliance", "audits"), ("Behavior Support", "behavior"),
    ("Billing & Payers", "billing"), ("Books", "books"), ("Calendar", "calendar"),
    ("Calendar Builder", "calendarbuilder"), ("Call Offs", "call-offs"), ("Care Plans / ISP", "care-plans"),
    ("Chat", "chat"), ("Client Candidates", "client-candidates"), ("Client Care", "clients"),
    ("Client Finances", "finance"), ("Clients", "client-profiles"), ("Company Travel", "travel"),
    ("Compliance", "compliance"), ("Compliance Engine", "compliance-engine"), ("Cortex", "cortex"),
    ("Dashboard", "opsdash"), ("Decoder lab", "digestlab"), ("Directors", "directors"),
    ("Diseases Registry", "diseases"), ("Docs", "docs"), ("Dr Appointments", "dr-appointments"),
    ("Email Designs", "email-designs"), ("Emergency Contacts", "emergency-contacts"),
    ("Employee Support Hotline", "hotline"),
    ("Equipment & Assets", "equipment"), ("Expenses", "expenses"), ("Families", "family-profiles"),
    ("Family Portal", "family"),
    ("Finances", "finances"), ("Forms", "forms"), ("Guardian", "guardian"), ("Hiring Pipeline", "hiring"),
    ("House Repair", "house-repair"), ("House Work Orders", "work-orders"), ("Houses", "houses"),
    ("Hydration", "hydration"), ("ISP Library", "isp"), ("IST Records", "ist"), ("Ideal Meals", "ideal-meals"),
    ("Image Bank", "imagebank"), ("Incidents", "incidents"), ("Interviews", "interviews"),
    ("Inventory", "inventory"), ("Invoices", "invoices"), ("Kanban", "teamboard"),
    ("Leadership Dashboard", "leadership"), ("Learning", "learning"), ("Locations", "locations"),
    ("MAR — Med Administration", "mar"),
    ("Mail", "mail"), ("Marketing", "marketing"), ("Meal Tracker", "meals"), ("Meals & Nutrition", "meals"),
    ("Med Delegation", "med-delegation"), ("Med Deliveries", "med-deliveries"), ("Medications", "medications"),
    ("My Calendar", "my-calendar"), ("My Inbox", "my-inbox"), ("My Profile", "my-profile"),
    ("My Work", "my-work"), ("My asa.", "myasa"), ("Onboarding", "onboarding"), ("Overview", "overview"),
    ("Owners / Executive", "owners"), ("Payroll & Hours", "payroll"), ("People", "people"),
    ("Playground", "playground"), ("Policies", "policy-acks"), ("Potential Clients", "potential-clients"),
    ("Production Actions", "production-actions"), ("Projects", "projects"), ("Quality Indicators", "quality"),
    ("Questionnaires", "questionnaires"), ("Release Users", "release-users"), ("Reminders", "reminders"),
    ("Render Sheet", "render-sheet"), ("Schedule", "schedule"), ("Scheduling", "scheduling"),
    ("Shift Board", "shiftboard"),
    ("Shifts & Coverage", "shifts"), ("Simulator Hiring", "simulator"), ("Sleep", "sleep"),
    ("Smart Shopper", "shopper"), ("SSA", "ssa-profiles"), ("Staff", "staff-profiles"),
    ("Staff Candidates", "staff-candidates"), ("Staff Issues", "staffissues"),
    ("Staff Performance", "performance"),
    ("Suggestions", "suggestions"), ("Support Requests Queue", "support-requests"),
    ("Support Requests", "support-desk"), ("System logs", "logs"),
    ("Talent Pipeline", "talent-pipeline"), ("Task Board", "taskboard"), ("Task Board Sheet", "taskboard-sheet"),
    ("Technology", "technology"), ("Time Off", "timeoff"), ("Time Reconciliation", "time-recon"),
    ("Training Tracker", "training"), ("Transportation", "vehicle-calendar"),
    ("Transportation Users", "transportation"), ("UI Reports", "ui-incidents"),
    ("User Support", "user-support"), ("Users", "users"), ("Visits & EVV", "visits"), ("Widgets", "widgets"),
    ("Workforce Compliance", "employee-tracker"), ("Workout", "workout"),
)
# the other names src gives an app: Calendar Builder's Requests (shifts/ShiftRequestsPage) and Swaps pages, the…
_APP_ALIASES = (("Shift Requests", "calendarbuilder"), ("Swaps", "calendarbuilder"),
                ("Employee Tracker", "employee-tracker"), ("Hiring", "hiring"))
UPDATE_APPS = {sr.fold(name): app_id for name, app_id in _REGISTRY_APPS + _APP_ALIASES}
# a name that is also a common heading word names its app only as the whole area ("Locations — Staff tab" is…
_WHOLE_AREA_ONLY = frozenset({sr.fold("Staff"), sr.fold("SSA"), sr.fold("Families")})
_UPDATE_NAME_MAX = max(map(len, UPDATE_APPS))
# Talent.gs talentLiveAllowed_: the roles and badges the live candidates door admits.
CANDIDATE_ROLES = frozenset({"admin", "director", "manager", "interviewer"})
CANDIDATE_BADGES = frozenset({"INTERVIEWER", "HM"})

REQUEST_DAYS = 30
MOVE_DAYS = 14
NEW_STAFF_DAYS = 14
NEW_CLIENT_DAYS = 14
PROSPECT_DAYS = 7
MED_ERROR_DAYS = 30
ITEM_CAP = 500
NAMES_IN_BODY = 5

PTR_STATUS_HISTORY = "HUB_HOUSE_LOG_STATUS_HISTORY_ID"
HOUSE_TAB = "Data"
STAFF_STATUSES = frozenset({"active", "pending"})
# people roster rows that are never staff, whatever their start day
NOT_STAFF_ROLES = frozenset({"guardian", "client", "entity"})
# alerts that leave the list within days of being listed: their read marks are let go after PRUNE_DAYS
PRUNE_KINDS = ("punch", "move", "staff", "staffcount", "client", "prospects")
PRUNE_DAYS = 60
REIMBURSE = re.compile(r"reimburs", re.I)
REIMBURSE_SOURCES = ("support_requests", "hotline")
MED_ERROR = "medication related error"

LINK_MY_WORK = {"href": "/app/my-work/actions", "label": "Open in My Work"}
LINK_HIRING = {"href": "/app/hiring/pipeline", "label": "Open in Hiring"}
LINK_TRACKER = {"href": "/app/employee-tracker/roster", "label": "Open in the Employee Tracker"}
LINK_USERS = {"href": "/app/users/accounts", "label": "Open in Users"}
LINK_CLIENTS = {"href": "/app/clients/unique", "label": "Open in Client Care"}
LINK_PROSPECTS = {"href": "/app/potential-clients/unique", "label": "Open in Potential Clients"}
LINK_INCIDENTS = {"href": "/app/ui-incidents/log", "label": "Open in UI Reports"}
SCHED_LINK_LABEL = "Open in Scheduling"
SCHED_HREF = "/app/scheduling/calendar"
# Scheduling's own items (sched_inbox, written by apps-script/SchedulingFlows.gs): the warnings and informatives are…
SCHED_BOX_INBOX = "inbox"
SCHED_EVERYONE = "everyone"
SCHED_STAFF_ROLES = frozenset({"admin", "director", "manager", "staff"})
SCHED_TEST_MODE = mw.SCHED_TEST_MODE
# Support Requests' own items (support_inbox, written by apps-script/SupportDesk.gs): one per recipient, by id alone…
SUPPORT_APP = "support-desk"
SUPPORT_HREF = "/app/support-desk/requests"
SUPPORT_HREF_ROOT = "/app/support-desk/"
SUPPORT_LINK_LABEL = "Open in Support Requests"
SUPPORT_BOX = "inbox"
# the master's own session also reads every alert sent to a director's seat, once per telling, without the act
MIRROR_SEAT = "director"
MIRROR_SAID = "Sent to the directors"
MIRROR_NOTE = ", and those sent to the directors."
# the words an item's answer goes back through, and the levels an item may carry
ACT_KINDS = frozenset({"aware", "seen"})
ACT_ACTIONS = frozenset({"supportInboxAnswer", "schedulingAnswer"})
ACT_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
LEVELS = frozenset({"warning", "important", "info"})
AWARE_LABEL, SEEN_LABEL = "I'm aware", "Seen"
# Transportation's own items (vc_inbox, written by apps-script/VehicleCalendarFlows.gs): the requester's…
VC_BOX_INBOX = "inbox"
VC_APP = "vehicle-calendar"
VC_HREF = "/app/vehicle-calendar/"
VC_CALENDAR_HREF = "/app/vehicle-calendar/calendar"
VC_LINK_LABEL = "Open in Transportation"

# src/pages/features/hiring/flow/shared.ts STAGES
STAGES = (("new", "New"), ("phone-screen", "Phone Screen"), ("interview", "Interview"),
          ("onboarding", "Onboarding"), ("hired", "Hired"), ("ready", "Ready to start"))
STAGE_LABEL = dict(STAGES)
# Talent.gs talentStage_: the words a status row carries
STATUS_STAGE = {"new": "new", "phone screen": "phone-screen", "phone-screen": "phone-screen",
                "in person": "interview", "interview": "interview", "onboarding": "onboarding",
                "ready": "ready", "ready to start": "ready", "hired": "hired", "becoming staff": "hired",
                "becoming-staff": "hired", "minimal internal documentation ready": "hired",
                "internal-docs": "hired"}

# the punch board's verdicts: a clock that did not know or did not read the person is never a missing punch
NEVER_MISSING = frozenset({"not_known_to_clock", "clock_not_read"})
PAIR_FAULTS = frozenset({"open", "missing", "covered_by_another"})
PUNCH_WORDS = {"no_punch": "Nothing on the time clock after the shift began",
               "open": "Clocked in, never clocked out",
               "missing": "No time entry of this shift's own",
               "covered_by_another": "One time entry covers this shift and another"}

HELD_WHY = "Company notices are held while test mode is on."
KEPT_WHY_CHOSEN = "Read marks are that person's; you are only looking."
KEPT_WHY_ACTING = "Read marks are not kept in a switched session."


class Unreadable(mw.Unreadable):
    """A source that could not be read: its sentence, never an empty list."""


class NotAttributable(mw.NotAttributable):
    """Nothing ties this source's rows to the person."""


class Closed(RuntimeError):
    """The source's app is not open to the person."""


class Held(RuntimeError):
    """The source is held by test mode."""


# ── small words ─────────────────────────────────────────────────────────────

def _text(value: Any, limit: int = 160) -> str:
    return mw._text(value, limit)


def _low(value: Any) -> str:
    return str(value or "").strip().lower()


def _part(raw: Any) -> str:
    """One piece of an alert key: as it is when it is already a clean word, else its stable hash."""
    text = str(raw if raw is not None else "").strip()
    if _PART_RE.fullmatch(text):
        return text
    return "h" + mw._sha10(text).lower()


def _key(kind: str, *parts: Any) -> str:
    """An alert key: its kind, then its pieces; a key the read door could not take is the hash of its pieces."""
    tail = ":".join(_part(p) for p in parts)
    key = f"{kind}:{tail}"
    return key if len(tail) <= 190 and KEY_RE.fullmatch(key) else f"{kind}:h{mw._sha10(tail).lower()}"


def _day_words(d: date | None) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}" if d else ""


def _short_day(d: date | None) -> str:
    return f"{d.strftime('%a')} {d.month}/{d.day}" if d else ""


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _names_line(names: list[str]) -> str:
    shown = [n for n in names if n][:NAMES_IN_BODY]
    rest = len([n for n in names if n]) - len(shown)
    return ", ".join(shown) + (f" and {rest} more" if rest > 0 else "")


def _instant(raw: Any) -> datetime | None:
    return mw._instant(raw)


def item(key: str, kind: str, *, title: str, body: str = "", at: Any = "", flag: bool = False,
         link: dict[str, str] | None = None, read: bool = False, act: dict[str, Any] | None = None,
         level: str = "") -> dict[str, Any]:
    """The only shape an alert leaves in. `act` and `level` are sent only when given, field by field."""
    out = {"id": key, "type": kind, "title": _text(title, 200), "body": _text(body, 300),
           "at": mw.when_of(at) if at else "", "flag": bool(flag),
           "link": {"href": str(link["href"]), "label": str(link["label"])} if link else None,
           "read": bool(read)}
    shaped = _act_of(act) if act is not None else None
    if shaped is not None:
        out["act"] = shaped
    if level in LEVELS:
        out["level"] = level
    return out


def _act_of(act: dict[str, Any]) -> dict[str, Any] | None:
    """An item's answer, whitelisted: a word, door or id this module does not know sends no act at all."""
    if not isinstance(act, dict):
        return None
    kind, action, item_id = str(act.get("kind") or ""), str(act.get("action") or ""), str(act.get("item_id") or "")
    if kind not in ACT_KINDS or action not in ACT_ACTIONS or not ACT_ID_RE.fullmatch(item_id):
        return None
    at = act.get("at")
    return {"kind": kind, "action": action, "item_id": item_id, "label": _text(act.get("label"), 40),
            "done": act.get("done") is True, "by": _text(act.get("by"), 80),
            "at": (mw.when_of(at) or _text(at, 40)) if at else ""}


def head(key: str, state: str, why: str = "", *, as_of: str = "", count: int | None = None, note: str = "",
         gap: str = "", parts: list[dict[str, Any]] | None = None, label: str = "") -> dict[str, Any]:
    out = {"key": key, "label": label or LABELS.get(key, key), "state": state, "why": why, "as_of": as_of,
           "count": count if state == STATE_READY else None, "note": note, "gap": gap}
    if parts is not None:
        out["parts"] = parts
    return out


def not_on_platform() -> list[dict[str, Any]]:
    return [head(k, STATE_NOT_ON_PLATFORM, why, label=label) for k, label, why in NOT_ON_PLATFORM]


def split_keys(keys: Any) -> tuple[list[int], list[str], int]:
    """(bell notice ids, inbox alert keys, how many could not be read) — at most READ_MAX looked at."""
    notices: list[int] = []
    alerts: list[str] = []
    ignored = 0
    for k in list(keys or [])[:READ_MAX]:
        text = k if isinstance(k, str) else ""
        m = NOTICE_KEY_RE.fullmatch(text)
        if m:
            notices.append(int(m.group(1)))
        elif KEY_RE.fullmatch(text):
            alerts.append(text)
        else:
            ignored += 1
    return sorted(set(notices)), sorted(set(alerts)), ignored


def candidates_admitted(role: Any, types: Any) -> bool:
    """Whether the live candidates door (Talent.gs talentLiveAllowed_) would admit this account."""
    if _low(role) in CANDIDATE_ROLES:
        return True
    return bool(sr.badges_of("", types) & CANDIDATE_BADGES)


# ── the store: read marks and the first-seen table (additive, created on the first own read) ─────────────

READS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_inbox_reads ("
    "user_id TEXT NOT NULL, alert_key TEXT NOT NULL, "
    "read_at TIMESTAMPTZ NOT NULL DEFAULT now(), dismissed_at TIMESTAMPTZ, "
    "PRIMARY KEY (user_id, alert_key))"
)
# platform state, not about a person: when a key was first seen by an own read
SEEN_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_inbox_seen ("
    "kind TEXT NOT NULL, key TEXT NOT NULL, first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (kind, key))"
)
DDL = (READS_DDL, SEEN_DDL)
# the row that says when a kind began to be watched; a folded key never carries '~'
BASELINE = "~baseline"
_READY: set[str] = set()


def _connect(dsn: str):
    return hub_db.connect(dsn, connect_timeout=5)


def _ensure(cur, dsn: str) -> None:
    """The tables, once per process per database; a rolled-back caller `_forget`s the mark."""
    if dsn in _READY:
        return
    for statement in DDL:
        cur.execute(statement)
    _READY.add(dsn)


def _forget(dsn: str) -> None:
    _READY.discard(dsn)


def _table_here(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS here", (name,))
    got = cur.fetchone()
    return bool(got["here"] if isinstance(got, dict) else (got or [False])[0])


def read_marks(dsn: str, uid: str, keys: list[str], *, ensure: bool) -> dict[str, dict[str, Any]]:
    """This account's marks on these keys. `ensure` False never writes: a table not made yet is no marks."""
    uid = str(uid or "").strip()
    if not uid or not keys:
        return {}
    try:
        with contextlib.closing(_connect(dsn)) as conn:
            if not ensure and not hub_db.on():
                conn.set_session(readonly=True, autocommit=True)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if ensure:
                    _ensure(cur, dsn)
                elif not _table_here(cur, "asa_hub_inbox_reads"):
                    return {}
                cur.execute("SELECT alert_key, read_at, dismissed_at FROM asa_hub_inbox_reads "
                            "WHERE user_id=%s AND alert_key = ANY(%s)", (uid, list(keys)))
                got = {str(r["alert_key"]): dict(r) for r in cur.fetchall()}
            if ensure:
                conn.commit()
    except Exception:
        _forget(dsn)
        raise
    return got


def mark_read(dsn: str, *, uid: str, keys: Any, dismiss: bool = False) -> int:
    """Record this account's own read (or cleared) marks; a key that is not an alert key is never written."""
    uid = str(uid or "").strip()
    clean = sorted({k for k in list(keys or [])[:READ_MAX] if isinstance(k, str) and KEY_RE.fullmatch(k)})
    if not uid or not clean:
        return 0
    try:
        with contextlib.closing(_connect(dsn)) as conn:
            with conn.cursor() as cur:
                _ensure(cur, dsn)
                cur.execute(
                    "INSERT INTO asa_hub_inbox_reads (user_id, alert_key, read_at, dismissed_at) "
                    "SELECT %s, k, now(), %s FROM unnest(%s::text[]) AS k "
                    "ON CONFLICT (user_id, alert_key) DO UPDATE SET "
                    "dismissed_at = coalesce(asa_hub_inbox_reads.dismissed_at, EXCLUDED.dismissed_at)",
                    (uid, datetime.now(UTC) if dismiss else None, clean))
            conn.commit()
            _prune(conn, uid)
    except Exception:
        _forget(dsn)
        raise
    return len(clean)


def _prune(conn, uid: str) -> None:
    """Let go of this account's marks on alerts that have long left the list (PRUNE_KINDS only: an open request…"""
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM asa_hub_inbox_reads WHERE user_id=%s "
                        "AND read_at < now() - make_interval(days => %s) "
                        "AND split_part(alert_key, ':', 1) = ANY(%s)", (uid, PRUNE_DAYS, list(PRUNE_KINDS)))
        conn.commit()
    except Exception as exc:  # noqa: BLE001 — the marks just written stand
        log.warning("my inbox: old read marks were not let go (%s)", type(exc).__name__)
        with contextlib.suppress(Exception):
            conn.rollback()


def seen(dsn: str, kind: str, keys: list[str], *, record: bool) -> tuple[dict[str, datetime], datetime | None]:
    """({key: first seen}, when this kind began to be watched)."""
    try:
        with contextlib.closing(_connect(dsn)) as conn:
            if not record and not hub_db.on():
                conn.set_session(readonly=True, autocommit=True)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if record:
                    _ensure(cur, dsn)
                    cur.execute("INSERT INTO asa_hub_inbox_seen (kind, key, first_seen) VALUES (%s, %s, now()) "
                                "ON CONFLICT DO NOTHING", (kind, BASELINE))
                    cur.execute("INSERT INTO asa_hub_inbox_seen (kind, key, first_seen) "
                                "SELECT %s, k, now() FROM unnest(%s::text[]) AS k ON CONFLICT DO NOTHING",
                                (kind, list(keys)))
                elif not _table_here(cur, "asa_hub_inbox_seen"):
                    return {}, None
                cur.execute("SELECT key, first_seen FROM asa_hub_inbox_seen WHERE kind=%s AND key = ANY(%s)",
                            (kind, [*keys, BASELINE]))
                rows = {str(r["key"]): r["first_seen"] for r in cur.fetchall()}
            if record:
                conn.commit()
    except Exception:
        _forget(dsn)
        raise
    baseline = rows.pop(BASELINE, None)
    return rows, baseline


class Store:
    """Every Postgres touch the board makes. Errors propagate to the one source that asked."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._conn = None

    def _cursor(self):
        if self._conn is None:
            conn = hub_db.intel(self.dsn, connect_timeout=5)
            conn.set_session(readonly=True, autocommit=True)
            self._conn = conn
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001 — already gone
                pass
            self._conn = None

    def pointer(self, prop: str) -> str:
        """The house the Essencial's Facts declare for `prop` (time_off.house_id's reading); raises Unreadable."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT (SELECT count(*) FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='Facts') AS n, "
                "(SELECT data->>'Value' FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='Facts' "
                "AND data->>'Source'=%s ORDER BY row_number DESC LIMIT 1) AS v",
                (mw.ESSENCIAL_SHEET_ID, mw.ESSENCIAL_SHEET_ID, f"switchboard:props.{prop}"))
            got = cur.fetchone() or {}
        if not int(got.get("n") or 0):
            raise Unreadable("the Essencial's Facts are not in the mirror")
        value = str(got.get("v") or "").strip()
        if not value:
            raise Unreadable(f"no house is declared for it (the Essencial carries no {prop})")
        return value

    def tab(self, sheet_id: str, tab: str) -> tuple[list[dict], int, str]:
        """(rows, rows in the tab, when the tab was last mirrored)."""
        with self._cursor() as cur:
            cur.execute("SELECT count(*) AS n, max(ingested_at) AS at FROM asa_drive_sheets_rows "
                        "WHERE sheet_id=%s AND tab_name=%s", (sheet_id, tab))
            got = cur.fetchone() or {}
            total = int(got.get("n") or 0)
            rows: list[dict] = []
            if total:
                cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name=%s "
                            "ORDER BY row_number", (sheet_id, tab))
                rows = [r["data"] for r in cur.fetchall() if isinstance(r.get("data"), dict)]
        return rows, total, mw.when_of(got.get("at")) if got.get("at") else ""

    def book(self, sheet_id: str) -> dict[str, Any] | None:
        """The mirror's own word on a book: when Drive last changed it, and how its last copy went."""
        with self._cursor() as cur:
            cur.execute("SELECT modified_time, last_sync_at, last_sync_status FROM asa_drive_sheets_meta "
                        "WHERE sheet_id=%s", (sheet_id,))
            got = cur.fetchone()
        return dict(got) if got else None

    def marks(self, uid: str, keys: list[str], *, ensure: bool) -> dict[str, dict[str, Any]]:
        return read_marks(self.dsn, uid, keys, ensure=ensure)

    def seen(self, kind: str, keys: list[str], *, record: bool) -> tuple[dict[str, datetime], datetime | None]:
        return seen(self.dsn, kind, keys, record=record)


# ── the context the sources share ───────────────────────────────────────────

class Ctx:
    def __init__(self, *, subject: dict[str, Any], me: dict[str, Any], lanes: dict[str, Any] | None,
                 lanes_why: str, access: dict[str, dict[str, Any]], requests: Callable[[], Any] | None,
                 notices: Callable[..., dict[str, Any]] | None, held: str, snapshot_dir: Path | str,
                 board_file: Path | str, store: Any, now: datetime, readonly: bool,
                 updates: dict[str, Any] | None = None, alerts_off: Iterable[str] = ()) -> None:
        self.subject, self.me, self.lanes, self.lanes_why = subject or {}, me or {}, lanes, lanes_why
        self.access = access or {}
        self.updates = updates
        self.alerts_off = frozenset(_low(a) for a in alerts_off or () if _low(a))
        self.requests, self.notices, self.held = requests, notices, held
        self.snapshot_dir, self.board_file = Path(snapshot_dir), Path(board_file)
        self.store, self.now, self.readonly = store, now, readonly
        self.on = now.astimezone(mw.OHIO).date()
        self.keys = set(self.me.get("keys") or [])
        self.emails = {_low(e) for e in self.me.get("emails") or [] if _low(e)}
        self._req: Any = None
        self._slices: dict[str, Any] = {}

    def opens(self, app_id: str) -> bool:
        """FAIL-CLOSED: an app whose check is missing or failed is shut."""
        got = self.access.get(app_id)
        return bool(isinstance(got, dict) and got.get("open") is True)

    def shut_why(self, app_id: str, name: str) -> str:
        got = self.access.get(app_id)
        why = str(got.get("why") or "") if isinstance(got, dict) else ""
        return why or f"{name} is not open to you."

    def need_keys(self, *, contact: bool = False) -> None:
        if self.keys or (contact and self.emails):
            return
        raise NotAttributable(self.me.get("key_why") or "this account has no key rows can be matched on")

    def slice(self, name: str, what: str) -> tuple[list[dict], str]:
        """A slice this relay built, read here once per answer: a missing or broken file is unreadable, never []."""
        if name not in self._slices:
            try:
                self._slices[name] = self._read_slice(name, what)
            except Unreadable as exc:
                self._slices[name] = exc
        got = self._slices[name]
        if isinstance(got, Exception):
            raise got
        return got

    def _read_slice(self, name: str, what: str) -> tuple[list[dict], str]:
        path = self.snapshot_dir / f"{name}.json"
        try:
            doc = json.loads(path.read_text(encoding="utf-8") or "null")
        except FileNotFoundError as exc:
            raise Unreadable(f"the {what} copy is not on this server yet") from exc
        except Exception as exc:  # noqa: BLE001
            raise Unreadable(f"the {what} copy could not be read ({type(exc).__name__})") from exc
        rows = doc.get("rows") if isinstance(doc, dict) else None
        if not isinstance(rows, list):
            raise Unreadable(f"the {what} copy carries no rows")
        return [r for r in rows if isinstance(r, dict)], mw.when_of(doc.get("built_at")) if doc.get("built_at") else ""

    def name_counts(self) -> tuple[dict[str, int] | None, str]:
        """How many people roster rows carry each folded name — (None, why) when the roster cannot be read."""
        try:
            rows, _as_of = self.slice("people", "people roster")
        except Unreadable as exc:
            return None, str(exc)
        counts: dict[str, int] = {}
        for r in rows:
            for k in {mw.fold(r.get("name")),
                      mw.fold(f"{r.get('first_name') or ''} {r.get('last_name') or ''}")} - {""}:
                counts[k] = counts.get(k, 0) + 1
        return counts, ""

    def lane(self, key: str) -> tuple[list[dict], str, str]:
        """(rows, read_at, stale sentence) of one hotline lane; a lane with no rows is Unreadable."""
        if self.lanes is None:
            raise Unreadable(self.lanes_why or "the hotline lanes could not be read")
        lane = self.lanes.get(key)
        if not isinstance(lane, dict):
            raise Unreadable(f"the {key} lane did not answer")
        rows = lane.get("rows")
        if rows is None:
            raise Unreadable(str(lane.get("error") or f"the {key} lane could not be read"))
        stale = "" if lane.get("ok") else str(lane.get("error") or "the held copy is shown")
        return [r for r in rows if isinstance(r, dict)], mw.when_of(lane.get("read_at")), stale

    def request_parts(self) -> tuple[list[dict], list[dict]]:
        """My Work's request half, own mode, read once for both sources that list from it."""
        if self._req is None:
            if self.requests is None:
                self._req = Unreadable("your requests are not read on this server")
            else:
                try:
                    heads, rows = self.requests()
                    self._req = (list(heads or []), list(rows or []))
                except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
                    log.warning("my inbox: the requests could not be read (%s)", type(exc).__name__)
                    self._req = Unreadable(f"your requests could not be read ({type(exc).__name__})")
        if isinstance(self._req, Exception):
            raise self._req
        return self._req


# ── the sources ─────────────────────────────────────────────────────────────

def _is_reimbursement(row: dict[str, Any]) -> bool:
    return row.get("source") in REIMBURSE_SOURCES and bool(REIMBURSE.search(str(row.get("request") or "")))


def _is_med_error_report(row: dict[str, Any]) -> bool:
    """An incident report of the medication-error kind: listed by its pointer alone, never as a request too."""
    return row.get("source") == "incidents" and MED_ERROR in _low(row.get("request"))


def _parts_head(key: str, heads: list[dict]) -> tuple[str, str, str, list[dict]]:
    """(state, why, gap, parts) of a source that lists from several of My Work's."""
    parts = [{"key": str(h.get("key") or ""), "label": str(h.get("label") or ""), "state": str(h.get("state") or ""),
              "why": str(h.get("why") or "")} for h in heads]
    ready = [h for h in heads if h.get("state") == STATE_READY]
    failed = [h for h in heads if h.get("state") != STATE_READY and not h.get("structural")]
    if not ready:
        whys = "; ".join(f"{h.get('label')}: {h.get('why')}" for h in failed) or "nothing could be read"
        if failed and all(h.get("state") == STATE_NOT_ATTRIBUTABLE for h in failed):
            return STATE_NOT_ATTRIBUTABLE, str(failed[0].get("why") or whys), "", parts
        return STATE_UNREADABLE, whys, "", parts
    gap = "; ".join(f"{h.get('label')}: {h.get('why')}" for h in failed)
    return STATE_READY, "", gap, parts


def _request_items(ctx: Ctx, rows: list[dict], kind: str) -> list[dict]:
    cutoff = ctx.on - timedelta(days=REQUEST_DAYS)
    link = LINK_MY_WORK if ctx.opens("my-work") else None
    out = []
    for r in rows:
        status = r.get("status") if isinstance(r.get("status"), dict) else {}
        cls = str(status.get("class") or mw.RECORDED)
        d = mw.day_of(r.get("submitted"))
        if cls != mw.OPEN and (d is None or d < cutoff):
            continue
        # the status word is in the key too: a move inside one class ('Open' to 'Needs dates') is a new alert
        word = str(status.get("word") or "")
        out.append(item(_key("req", r.get("id"), cls, mw.fold(word)), kind,
                        title=str(r.get("request") or "A request"), body=word, at=r.get("submitted"), link=link))
    return out


def src_requests(ctx: Ctx) -> tuple[dict, list[dict]]:
    heads, rows = ctx.request_parts()
    state, why, gap, parts = _parts_head("requests", heads)
    notes = [str(h.get("why") or "") for h in heads if h.get("structural")]
    notes.append(f"Open requests, and those filed in the last {REQUEST_DAYS} days.")
    if state != STATE_READY:
        return head("requests", state, why, parts=parts), []
    if any(_is_med_error_report(r) for r in rows):
        notes.append("A medication error report you filed is listed under Medication error reports.")
    items = _request_items(ctx, [r for r in rows if not _is_reimbursement(r) and not _is_med_error_report(r)],
                           "requests")
    return head("requests", STATE_READY, as_of="", count=len(items), note=" ".join(n for n in notes if n),
                gap=gap, parts=parts), items


def src_reimbursement(ctx: Ctx) -> tuple[dict, list[dict]]:
    heads, rows = ctx.request_parts()
    mine = [h for h in heads if h.get("key") in REIMBURSE_SOURCES]
    state, why, gap, parts = _parts_head("reimbursement", mine)
    if state != STATE_READY:
        return head("reimbursement", state, why, parts=parts), []
    items = _request_items(ctx, [r for r in rows if _is_reimbursement(r)], "reimbursement")
    return head("reimbursement", STATE_READY, count=len(items),
                note="Reimbursement asked through a support or phone request.", gap=gap, parts=parts), items


def src_punch(ctx: Ctx) -> tuple[dict, list[dict]]:
    """The person's own shifts of yesterday and today that the punch board calls missed; an unread clock is…"""
    ctx.need_keys()
    try:
        body = json.loads(ctx.board_file.read_text(encoding="utf-8") or "null")
    except FileNotFoundError as exc:
        raise Unreadable("the attendance lane has not written a punch board on this server yet") from exc
    except Exception as exc:  # noqa: BLE001
        raise Unreadable(f"the punch board could not be read ({type(exc).__name__})") from exc
    if not isinstance(body, dict):
        raise Unreadable("the punch board is not a record")
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    read_at = _instant(status.get("read_at"))
    if read_at is None:
        raise Unreadable("the time clock has not been read yet, so a missed punch cannot be known")
    days = [str(d) for d in status.get("days") or []]
    if ctx.on.isoformat() not in days:
        raise Unreadable("the punch board on this server is not today's, so a missed punch cannot be known")
    gap = ""
    if str(status.get("clock_state") or "") != "read":
        local = read_at.astimezone(mw.OHIO)
        hour = local.hour % 12 or 12
        why = _text(status.get("clock_why"), 160) or str(status.get("clock_state") or "not read")
        gap = (f"The time clock has not been read since {_short_day(local.date())} {hour}:{local.minute:02d} "
               f"{'AM' if local.hour < 12 else 'PM'} ({why}), so a punch missed after that is not known.")
    items = []
    for r in body.get("rows") or []:
        if not isinstance(r, dict) or r.get("row_kind") != "shift":
            continue
        if mw.fold(r.get("person_key")) not in ctx.keys:
            continue
        verdict, pair = str(r.get("verdict") or ""), str(r.get("pair") or "")
        if verdict in NEVER_MISSING:
            continue
        if verdict == "no_punch":
            what = "no_punch"
        elif r.get("pair_fault") is True and pair in PAIR_FAULTS:
            what = pair
        else:
            continue
        d = mw.day_of(r.get("day")) or mw.day_of(r.get("shift_at"))
        house = _text(r.get("house_name"), 80) or _text(r.get("house"), 40)
        shift = _text(r.get("shift_code"), 20) or _text(r.get("time"), 10)
        items.append(item(_key("punch", r.get("id"), what), "punch",
                          title="Missing punch" + (f" — {house}" if house else ""),
                          body=" · ".join(x for x in (_short_day(d), shift, PUNCH_WORDS[what]) if x),
                          at=r.get("shift_at") or (d.isoformat() if d else ""), flag=True))
    return head("punch", STATE_READY, as_of=mw.when_of(read_at), count=len(items),
                note="Only yesterday and today are kept.", gap=gap), items


def src_scheduling(ctx: Ctx) -> tuple[dict, list[dict]]:
    """Scheduling's warnings and informatives: those addressed to the account's own id, and those for everyone…"""
    uid = str(ctx.me.get("uid") or ctx.subject.get("uid") or "").strip()
    staff_side = _low(ctx.subject.get("role")) in SCHED_STAFF_ROLES
    if not uid and not staff_side:
        raise NotAttributable("this account carries no id, so no Scheduling alert can be tied to it")

    def accept(r: dict[str, Any]) -> bool:
        if _low(r.get("box")) != SCHED_BOX_INBOX:
            return False
        to = str(r.get("to_uid") or "").strip()
        everyone = _low(r.get("seat")) == SCHED_EVERYONE and not to
        return bool((uid and to == uid) or (everyone and staff_side))

    def mark(r: dict[str, Any]) -> tuple[bool, dict[str, Any] | None, str, str]:
        kind = _low(r.get("kind"))
        own = bool(uid) and str(r.get("to_uid") or "").strip() == uid
        # a warning addressed to the subject is answered in Scheduling, by the subject alone
        act = (_act("aware", "schedulingAnswer", r, AWARE_LABEL)
               if kind == "warning" and own and not ctx.readonly else None)
        said = MIRROR_SAID if not own and _low(r.get("seat")) == MIRROR_SEAT else ""
        return kind == "warning", act, kind if kind in ("warning", "info") else "", said

    mirror = _directors_mirror(ctx, SCHED_BOX_INBOX)
    items, as_of = _house_items(ctx, mw.PTR_SCHED_INBOX, kind="scheduling", key_prefix="sched",
                                href_prefix=SCHED_HREF, app_id="scheduling", label_word="Scheduling's",
                                href=SCHED_HREF, link_label=SCHED_LINK_LABEL, accept=accept, mark=mark,
                                mirror=mirror)
    note = ("Alerts addressed to you, and those sent to all staff." if staff_side
            else "Alerts addressed to you.")
    if mirror is not None:
        note = note[:-1] + MIRROR_NOTE
    return head("scheduling", STATE_READY, as_of=as_of, count=len(items), note=note), items


def _act(kind: str, action: str, r: dict[str, Any], label: str) -> dict[str, Any]:
    """The answer a house row asks of its recipient, done once anybody answered it there."""
    answered = str(r.get("answered_at") or "").strip()
    return {"kind": kind, "action": action, "item_id": str(r.get("id") or "").strip(), "label": label,
            "done": bool(answered), "by": str(r.get("answered_by") or ""), "at": answered}


def _same_telling(r: dict[str, Any]) -> tuple[str, str, str]:
    """One telling of a request: its id, the kind and the title, whoever it was addressed to."""
    return (str(r.get("flow_id") or r.get("ref") or "").strip(), _low(r.get("kind")),
            str(r.get("title") or "").strip())


def _directors_mirror(ctx: Ctx, box: str) -> Callable[[dict[str, Any]], tuple[str, str, str] | None] | None:
    """In the master's own session, the telling of an alert sent to a director's seat; None for any other session…"""
    if ctx.subject.get("is_master") is not True or ctx.readonly:
        return None

    def key(r: dict[str, Any]) -> tuple[str, str, str] | None:
        if _low(r.get("box")) != box or _low(r.get("seat")) != MIRROR_SEAT:
            return None
        return _same_telling(r)
    return key


def _house_items(ctx: Ctx, ptr: str, *, kind: str, key_prefix: str, href_prefix: str, app_id: str,
                 label_word: str, href: str, link_label: str, accept: Callable[[dict[str, Any]], bool],
                 mark: Callable[[dict[str, Any]], tuple[bool, dict[str, Any] | None, str, str]],
                 mirror: Callable[[dict[str, Any]], tuple[str, str, str] | None] | None = None
                 ) -> tuple[list[dict], str]:
    """(items, as_of) of one house of items written for this inbox: the rows `accept` keeps, each keyed…"""
    sid = ctx.store.pointer(ptr)
    rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    if not total and not mw.copied_whole(ctx.store.book(sid)):
        raise Unreadable(f"the house of {label_word} items is declared but not mirrored yet")
    link = {"href": href, "label": link_label} if ctx.opens(app_id) else None
    kept = [r for r in rows if accept(r)]
    if mirror is not None:
        told = {_same_telling(r) for r in kept}
        for r in rows:
            k = mirror(r)
            if k is None or k in told or accept(r):
                continue
            told.add(k)
            kept.append(r)
    items = []
    for r in kept:
        flag, act, level, said = mark(r)
        rid = str(r.get("id") or "").strip()
        own = str(r.get("link") or "").strip()
        said = _text(said, 80)
        # room is kept for the marks, so the item's own cut never takes them
        body = _text(r.get("body"), 280 - (len(said) + 3 if said else 0))
        body = " · ".join(x for x in (body, said, "Test mode" if _low(r.get("test_mode")) in SCHED_TEST_MODE else "")
                          if x)
        items.append(item(_key(key_prefix, rid or f"{r.get('created_at')}|{r.get('title')}"), kind,
                          title=_text(r.get("title"), 200) or LABELS.get(kind, kind), body=body,
                          at=r.get("created_at"), flag=flag,
                          link={**link, "href": own if own.startswith(href_prefix) else href} if link else None,
                          act=act, level=level))
    return items, as_of


def src_support(ctx: Ctx) -> tuple[dict, list[dict]]:
    """Support Requests' warnings, important alerts and informatives addressed to the account's own id — there is…"""
    uid = str(ctx.me.get("uid") or ctx.subject.get("uid") or "").strip()
    if not uid:
        raise NotAttributable("this account carries no id, so no Support Requests alert can be tied to it")

    def accept(r: dict[str, Any]) -> bool:
        return _low(r.get("box")) == SUPPORT_BOX and str(r.get("to_uid") or "").strip() == uid

    def mark(r: dict[str, Any]) -> tuple[bool, dict[str, Any] | None, str, str]:
        kind = _low(r.get("kind"))
        word = "aware" if kind in ("warning", "important") else "seen" if kind == "info" else ""
        if not word:
            return True, None, "", ""
        # a director's alert shown to the master is answered at the Support Requests door, never from here
        if ctx.readonly or str(r.get("to_uid") or "").strip() != uid:
            answered = str(r.get("answered_by") or "").strip()
            said = (f"Marked by {answered}" if answered else "Marked") if str(r.get("answered_at") or "").strip() \
                else f"Waiting on {_text(r.get('to_name'), 60) or 'the person it is addressed to'}"
            return kind != "info", None, kind, said
        return kind != "info", _act(word, "supportInboxAnswer", r, AWARE_LABEL if word == "aware" else SEEN_LABEL), \
            kind, ""

    mirror = _directors_mirror(ctx, SUPPORT_BOX)
    if mirror is not None and ctx.alerts_off:
        # an alert the master turned off in Settings is never copied from the directors' seats
        seat_copy = mirror
        mirror = lambda r: None if _low(r.get("alert")) in ctx.alerts_off else seat_copy(r)  # noqa: E731
    items, as_of = _house_items(ctx, mw.PTR_SUPPORT_INBOX, kind="support", key_prefix="sreq",
                                href_prefix=SUPPORT_HREF_ROOT, app_id=SUPPORT_APP, label_word="Support Requests'",
                                href=SUPPORT_HREF, link_label=SUPPORT_LINK_LABEL, accept=accept, mark=mark,
                                mirror=mirror)
    note = "Alerts addressed to you" + (MIRROR_NOTE if mirror is not None else ".")
    return head("support", STATE_READY, as_of=as_of, count=len(items), note=note), items


def _moves(ctx: Ctx) -> tuple[list[dict] | None, str, str]:
    """(status moves of the last MOVE_DAYS, as_of, why not) — never raises."""
    try:
        sid = ctx.store.pointer(PTR_STATUS_HISTORY)
        rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    except Unreadable as exc:
        return None, "", str(exc)
    except Exception as exc:  # noqa: BLE001 — said on the head, the cards still answer
        return None, "", f"it could not be read ({type(exc).__name__})"
    if not total:
        return None, "", "the status history is declared but not mirrored yet"
    since = ctx.now - timedelta(days=MOVE_DAYS)
    out = []
    for r in rows:
        at = _instant(r.get("timestamp"))
        if at is not None and at >= since:
            out.append({**r, "_at": at})
    return out, as_of, ""


def _stage_of(status: Any) -> tuple[str, str]:
    """(stage id, words) of a status word; a word that is no stage is said as it is."""
    stage = STATUS_STAGE.get(_low(status), "")
    return stage, STAGE_LABEL.get(stage) or _text(status, 60)


def _next_step(card: dict[str, Any]) -> str:
    """The first open item of the card's own stage (shared.ts openConditions over stageItems)."""
    for c in card.get("checklist") or []:
        if isinstance(c, dict) and c.get("stage") == card.get("stage") and c.get("status") in ("pending", "missing"):
            return _text(c.get("label"), 80)
    return ""


def _days_at(card: dict[str, Any], on: date) -> int | None:
    raw = card.get("daysAtStage")
    if isinstance(raw, int) and raw >= 0:
        return raw
    d = mw.day_of(card.get("stageSince"))
    return (on - d).days if d is not None and d <= on else None


def src_hiring(ctx: Ctx) -> tuple[dict, list[dict]]:
    """Candidates in the process and their moves: names and steps only for an account the live candidates door…"""
    if not ctx.opens("hiring"):
        raise Closed(ctx.shut_why("hiring", "Hiring"))
    cards, as_of = ctx.slice("candidates", "candidates")
    cards = [c for c in cards if c.get("stage") in STAGE_LABEL]
    moves, _as_of, moves_why = _moves(ctx)
    gap = "" if moves is not None else f"Who moved where could not be read: {moves_why}."
    mails = ctx.emails
    link = LINK_HIRING
    if not candidates_admitted(ctx.subject.get("role"), ctx.subject.get("types")):
        if not cards and not moves:
            return head("hiring", STATE_READY, as_of=as_of, count=0, gap=gap,
                        note="Candidate names are shown to interviewers, managers and directors."), []
        by_stage = {sid: sum(1 for c in cards if c.get("stage") == sid) for sid, _ in STAGES}
        words = " · ".join(f"{STAGE_LABEL[s]} {n}" for s, n in by_stage.items() if n)
        moved = f"{_plural(len(moves), 'move')} in the last {MOVE_DAYS} days" if moves is not None else ""
        latest = max([mw.when_of(c.get("stageSince")) for c in cards] + [mw.when_of(m["_at"]) for m in moves or []]
                     + [""])
        sig = mw._sha10(json.dumps([by_stage, len(moves or [])], sort_keys=True)).lower()
        one = item(f"hiring_count:{sig}", "hiring", title=f"{_plural(len(cards), 'candidate')} in the hiring process",
                   body=" · ".join(x for x in (words, moved) if x), at=latest, link=link)
        return head("hiring", STATE_READY, as_of=as_of, count=1, gap=gap,
                    note="Candidate names are shown to interviewers, managers and directors."), [one]
    items = []
    added: dict[str, bool] = {}
    for c in cards:
        cid = str(c.get("id") or "")
        mine = _low(c.get("addedBy")) in mails if "@" in _low(c.get("addedBy")) else False
        added[cid] = mine
        days = _days_at(c, ctx.on)
        step = _next_step(c)
        body = " · ".join(x for x in ((f"Next: {step}" if step else "Nothing open at this stage"),
                                      (f"{_plural(days, 'day')} at this stage" if days is not None else "")) if x)
        items.append(item(_key("cand", cid, c.get("stage")), "hiring",
                          title=f"{_text(c.get('name'), 80) or 'A candidate'} — {STAGE_LABEL[c['stage']]}",
                          body=body, at=c.get("stageSince") or c.get("appliedAt"), flag=mine, link=link))
    for m in moves or []:
        cid = str(m.get("candidate_id") or "")
        _to, to_words = _stage_of(m.get("to_status"))
        _from, from_words = _stage_of(m.get("from_status"))
        by_me = "@" in _low(m.get("actor")) and _low(m.get("actor")) in mails
        body = " · ".join(x for x in ((f"From {from_words}" if from_words else ""), ("You moved it" if by_me else ""))
                          if x)
        items.append(item(_key("move", cid, mw.when_of(m["_at"])), "hiring",
                          title=f"{_text(m.get('candidate_name'), 80) or 'A candidate'} moved to {to_words or '—'}",
                          body=body, at=m["_at"], flag=by_me or added.get(cid, False), link=link))
    return head("hiring", STATE_READY, as_of=as_of, count=len(items), gap=gap), items


def src_new_staff(ctx: Ctx) -> tuple[dict, list[dict]]:
    """People whose start day is in the last NEW_STAFF_DAYS: counted for everybody, named for those who open…"""
    rows, as_of = ctx.slice("people", "people roster")
    first = ctx.on - timedelta(days=NEW_STAFF_DAYS - 1)
    recent = []
    for r in rows:
        # the roster also carries guardians and clients: a start day never makes one of them staff
        if _low(r.get("role")) in NOT_STAFF_ROLES or str(r.get("guardian_for") or "").strip():
            continue
        status = _low(r.get("status"))
        d = mw.day_of(r.get("start_date"))
        if status in STAFF_STATUSES and d is not None and first <= d <= ctx.on:
            recent.append((d, r, status))
    recent.sort(key=lambda t: t[0], reverse=True)
    tracker, users = ctx.opens("employee-tracker"), ctx.opens("users")
    note = f"Start days in the last {NEW_STAFF_DAYS} days."
    if not (tracker or users):
        if not recent:
            return head("new_staff", STATE_READY, as_of=as_of, count=0, note=note), []
        days = sorted(d for d, _r, _s in recent)
        span = _short_day(days[0]) if days[0] == days[-1] else f"{_short_day(days[0])} – {_short_day(days[-1])}"
        one = item(f"staffcount:{days[-1].isoformat()}:{len(recent)}", "new_staff",
                   title=f"{_plural(len(recent), 'new staff member', 'new staff members')} in the last "
                         f"{NEW_STAFF_DAYS} days",
                   body=f"Start days {span}" if days[0] != days[-1] else f"Start day {span}", at=days[-1].isoformat())
        return head("new_staff", STATE_READY, as_of=as_of, count=1, note=note + " Names are shown to those who "
                    "open Users or the Employee Tracker."), [one]
    link = LINK_TRACKER if tracker else LINK_USERS
    items = []
    for d, r, status in recent:
        name = _text(r.get("name"), 80) or _text(" ".join(str(r.get(k) or "") for k in ("first_name", "last_name")), 80)
        items.append(item(_key("staff", r.get("id") or name), "new_staff", title=f"New staff: {name or 'unnamed'}",
                          body=f"Started {_short_day(d)}" + (" · pending" if status == "pending" else ""),
                          at=d.isoformat(), link=link))
    return head("new_staff", STATE_READY, as_of=as_of, count=len(items), note=note), items


def src_new_clients(ctx: Ctx) -> tuple[dict, list[dict]]:
    """Clients first seen since My Inbox began watching, for those who open Client Care: name and house only."""
    if not ctx.opens("clients"):
        raise Closed(ctx.shut_why("clients", "Client Care"))
    rows, as_of = ctx.slice("clients", "clients")
    by_key: dict[str, dict] = {}
    for r in rows:
        k = _text(r.get("client_key"), 120)
        if k and k not in by_key:
            by_key[k] = r
    if not by_key:
        # never a baseline from an empty copy: every client after it would be said new
        raise Unreadable("the clients copy on this server holds no client")
    try:
        first, baseline = ctx.store.seen("client", sorted(by_key), record=not ctx.readonly)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: never "no new clients" on a failed read
        raise Unreadable(f"when each client was first seen could not be read ({type(exc).__name__})") from exc
    if baseline is None:
        return head("new_clients", STATE_READY, as_of=as_of, count=0,
                    gap="My Inbox has not begun watching for new clients yet: it begins the first time its own "
                        "account opens it."), []
    since = ctx.now - timedelta(days=NEW_CLIENT_DAYS)
    items = []
    for k, at in sorted(first.items(), key=lambda kv: kv[1], reverse=True):
        if at is None or at <= baseline or at < since or k not in by_key:
            continue
        r = by_key[k]
        items.append(item(_key("client", k), "new_clients", title=f"New client: {_text(r.get('name'), 80) or k}",
                          body=_text(r.get("house"), 80), at=at, link=LINK_CLIENTS))
    b_day = baseline.astimezone(mw.OHIO).date() if isinstance(baseline, datetime) else None
    return head("new_clients", STATE_READY, as_of=as_of, count=len(items),
                note=f"Counted from the day My Inbox began watching ({_day_words(b_day)})."), items


def src_potential_clients(ctx: Ctx) -> tuple[dict, list[dict]]:
    """How many prospects arrived in the last PROSPECT_DAYS, with their names, for those who open Potential…"""
    if not ctx.opens("potential-clients"):
        raise Closed(ctx.shut_why("potential-clients", "Potential Clients"))
    rows, as_of = ctx.slice("potentialClients", "potential clients")
    first = ctx.on - timedelta(days=PROSPECT_DAYS - 1)
    recent = []
    for r in rows:
        d = mw.day_of(r.get("scraped_at"))
        if d is not None and first <= d <= ctx.on:
            recent.append((d, _text(r.get("client_name"), 60)))
    note = f"Arrived in the last {PROSPECT_DAYS} days."
    if not recent:
        return head("potential_clients", STATE_READY, as_of=as_of, count=0, note=note), []
    recent.sort(key=lambda t: t[0], reverse=True)
    names = _names_line([n for _d, n in recent])
    one = item(f"prospects:{recent[0][0].isoformat()}:{len(recent)}", "potential_clients",
               title=f"{_plural(len(recent), 'new prospect')} in the last {PROSPECT_DAYS} days",
               body=names, at=recent[0][0].isoformat(), link=LINK_PROSPECTS)
    return head("potential_clients", STATE_READY, as_of=as_of, count=1, note=note), [one]


def src_notices(ctx: Ctx) -> tuple[dict, list[dict]]:
    """The bell's own notices, judged per reader where they are kept; held while test mode is on."""
    if ctx.held:
        raise Held(HELD_WHY)
    if ctx.notices is None:
        raise Unreadable("the notices lane is not on this server")
    try:
        got = ctx.notices()
    except Exception as exc:  # noqa: BLE001
        raise Unreadable(f"the notices could not be read ({type(exc).__name__})") from exc
    if not isinstance(got, dict):
        raise Unreadable("the notices lane gave no answer")
    if got.get("held"):
        raise Held(HELD_WHY)
    items = []
    for n in got.get("notices") or []:
        try:
            nid = int(n.get("id"))
        except (TypeError, ValueError):
            continue
        shift = _text(n.get("shift"), 40)
        href = str(n.get("href") or "")
        items.append(item(f"srv-{nid}", "notices", title=str(n.get("title") or "Company notice"),
                          body=str(n.get("body") or "").replace("{shift}", shift or "the shift"),
                          at=n.get("published_at") or n.get("at"), flag=n.get("priority") == "high",
                          link={"href": href, "label": "Open"} if href.startswith("/app/") else None,
                          read=bool(n.get("read"))))
    return head("notices", STATE_READY, count=len(items),
                note="Only the newest notices were judged." if got.get("truncated") else ""), items


# ── software updates: the release notes' Live lines ─────────────────────────

_NEW_APP = re.compile(r"\bnew[\s-]*app\b", re.I)
_MASTER_ONLY = re.compile(r"\bmaster(?:['’]?s)?[\s-]*(?:only|alone)\b", re.I)
_BRACKETED = re.compile(r"[(\[{]([^)\]}]*)[)\]}]")
_SEP_RUN = re.compile(r"\s*([-–—:|])(?:\s*[-–—:|])+\s*")
_EDGE_SEPS = re.compile(r"^[\s,;:|–—-]+|[\s,;:|–—-]+$")
_WORD = re.compile(r"[a-z0-9]+")
_ISO_DAY_AT = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_ZONED = re.compile(r"(?:z|[+-]\d{2}:?\d{2})$", re.I)
UPDATE_BODY_MAX = 300


def read_updates(dsn: str, *, store: Any = None) -> dict[str, Any]:
    """The release notes' copy, read once for the door: {rows, as_of, book, book_why}, or {why} when it could not…"""
    own = store is None
    store = store if store is not None else Store(dsn)
    try:
        rows, total, as_of = store.tab(NOTES_SHEET_ID, UPDATES_TAB)
        if not total:
            return {"why": "the release notes are not in the mirror"}
        if not any(set(UPDATE_COLUMNS[:3]) <= set(r) for r in rows if isinstance(r, dict)):
            return {"why": "the release notes carry no Date, App / area and Status columns"}
        book, book_why = None, ""
        try:
            book = store.book(NOTES_SHEET_ID)
        except Exception as exc:  # noqa: BLE001 — the lines still answer; the gap says the copy is unvouched
            book_why = type(exc).__name__
        return {"rows": rows, "as_of": as_of, "book": book, "book_why": book_why}
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
        log.warning("my inbox: the release notes could not be read (%s)", type(exc).__name__)
        return {"why": f"the release notes could not be read ({type(exc).__name__})"}
    finally:
        if own:
            store.close()


def is_live(status: Any) -> bool:
    return _low(status).startswith("live")


def update_area(raw: Any) -> tuple[str, bool]:
    """(the area's name, whether the line calls it a new app)."""
    text = _text(raw, 120)
    name = _BRACKETED.sub(lambda m: " " if _NEW_APP.search(m.group(1)) or _MASTER_ONLY.search(m.group(1))
                          else m.group(0), text)
    name = _EDGE_SEPS.sub("", _SEP_RUN.sub(r" \1 ", _MASTER_ONLY.sub(" ", _NEW_APP.sub(" ", name))))
    return " ".join(name.split()), bool(_NEW_APP.search(text))


def area_apps(area: str) -> list[str]:
    """Every registry app an area names: each run of its words that spells a registry name, the longest where…"""
    words = _WORD.findall(str(area or "").lower())
    runs: dict[tuple[int, int], str] = {}
    for i in range(len(words)):
        joined = ""
        for j in range(i, len(words)):
            joined += words[j]
            if len(joined) > _UPDATE_NAME_MAX:
                break
            if joined in UPDATE_APPS and (joined not in _WHOLE_AREA_ONLY or (i == 0 and j + 1 == len(words))):
                runs[(i, j + 1)] = UPDATE_APPS[joined]
    return sorted({app for (i, j), app in runs.items()
                   if not any(a <= i and j <= b and b - a > j - i for a, b in runs)})


def masters_alone(row: dict[str, Any]) -> bool:
    """A line still the master's alone, said in its Status or in its App / area."""
    return any(_MASTER_ONLY.search(str(row.get(col) or "")) for col in ("Status", "App / area"))


def updates_apps(got: Any) -> list[str]:
    """Every app a Live line names: what the door asks access for."""
    rows = got.get("rows") if isinstance(got, dict) else None
    if not isinstance(rows, list):
        return []
    return sorted({a for r in rows if isinstance(r, dict) and is_live(r.get("Status"))
                   for a in area_apps(update_area(r.get("App / area"))[0])})


def update_day(raw: Any) -> date | None:
    """The Ohio day a Date cell names: a written day, or a time with no zone, is that day and never a UTC…"""
    text = str(raw if raw is not None else "").strip()
    m = _ISO_DAY_AT.match(text)
    if m and not _ZONED.search(text):
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return mw.day_of(text)


def _age_words(now: datetime, at: datetime) -> str:
    mins = max(0, int((now - at).total_seconds() // 60))
    if mins < 60:
        return _plural(mins, "minute")
    return _plural(mins // 60, "hour") if mins < 48 * 60 else _plural(mins // 1440, "day")


def _updates_gap(got: dict[str, Any], now: datetime) -> str:
    """Why the copy may not be the newest, with its age."""
    at = _instant(got.get("as_of"))
    age = f"the copy is {_age_words(now, at)} old" if at else "the copy's age is not known"
    book = got.get("book")
    if got.get("book_why"):
        return f"Whether the release notes' copy is the newest could not be told ({got['book_why']}); {age}."
    if not isinstance(book, dict):
        return f"The mirror keeps no word on the release notes, so this copy may not be the newest; {age}."
    status = _text(book.get("last_sync_status"), 40)
    if _low(status) != "ok":
        return f"The last copy of the release notes did not finish ({status or 'no word'}); {age}."
    changed, copied = _instant(book.get("modified_time")), _instant(book.get("last_sync_at"))
    if changed is not None and copied is not None and changed > copied:
        return f"The release notes changed after they were copied, so the newest lines may be missing; {age}."
    return ""


def src_updates(ctx: Ctx) -> tuple[dict, list[dict]]:
    """One alert per Live line, for everybody the door serves, except a line about an app the subject cannot open…"""
    got = ctx.updates
    if got is None:
        raise Unreadable("the release notes are not read on this server")
    if not isinstance(got, dict) or not isinstance(got.get("rows"), list):
        raise Unreadable(str(got.get("why") if isinstance(got, dict) else "") or "the release notes could not be read")
    master = ctx.subject.get("is_master") is True
    seen: dict[str, int] = {}
    undated = 0
    items = []
    for r in got["rows"]:
        if not isinstance(r, dict):
            continue
        area, new = update_area(r.get("App / area"))
        d = update_day(r.get("Date"))
        version = _text(r.get("Version / commit"), 80)
        aid = ""
        if d is not None:
            # a repeated key is numbered in the book's order over every dated line, before any is skipped or hidden…
            aid = _key("upd", d.isoformat(), mw.fold(area), mw.fold(version))
            n = seen[aid] = seen.get(aid, 0) + 1
            aid = aid if n == 1 else f"{aid}.{n}"
        if not is_live(r.get("Status")):
            continue
        apps = area_apps(area)
        # a new app that names no app the map knows cannot be judged released, so it is the master's alone
        if (masters_alone(r) or (new and not apps)) and not master:
            continue
        if not all(ctx.opens(a) for a in apps):
            continue
        if d is None:
            undated += 1
            continue
        room = UPDATE_BODY_MAX - (len(version) + 3 if version else 0)
        what = _text(r.get("Activity completed"), 4000)
        if len(what) > room:
            what = what[:room - 1].rstrip() + "…"
        name = area or "The platform"
        items.append(item(aid, "updates", title=f"{name} is new" if new else f"{name} updated",
                          body=" · ".join(x for x in (what, version) if x), at=d.isoformat()))
    # the newest line of a day is listed first
    items.reverse()
    gaps = [_updates_gap(got, ctx.now)]
    if undated:
        gaps.append(f"Not listed: {_plural(undated, 'live line')} with no day that can be read.")
    return head("updates", STATE_READY, as_of=str(got.get("as_of") or ""), count=len(items),
                note="What went live on the platform, from the release notes. A change to an app that is not open "
                     "to you, or not released yet, is not listed.",
                gap=" ".join(g for g in gaps if g)), items


_SPLIT = re.compile(r"\s*(?:[,;/&+\n]|\band\b)\s*", re.I)


def named_keys(text: Any, keys: set[str]) -> set[str]:
    """The person's keys a free-text list of employees names: each a whole name of two words or more, folded."""
    return {mw.fold(part) for part in _SPLIT.split(str(text or ""))
            if len(mw._name_words(part)) >= 2 and mw.fold(part) in keys}


def names_you(text: Any, keys: set[str]) -> bool:
    return bool(named_keys(text, keys))


def src_med_error(ctx: Ctx) -> tuple[dict, list[dict]]:
    """A POINTER only: an incident report of the medication-error kind that this person filed, or whose Employees…"""
    ctx.need_keys(contact=True)
    rows, read_at, stale = ctx.lane("uiIncidents")
    cutoff = ctx.on - timedelta(days=MED_ERROR_DAYS)
    link = LINK_INCIDENTS if ctx.opens("ui-incidents") else None
    counts, counts_why = ctx.name_counts()
    items = []
    for r in rows:
        if MED_ERROR not in _low(r.get("incident_category")):
            continue
        filer = r.get("your_name")
        mine = (bool(mw.fold(filer)) and mw.fold(filer) in ctx.keys) or (_low(filer) in ctx.emails)
        if not mine:
            named = named_keys(r.get("employees_involved"), ctx.keys)
            # one candidate only: a name two roster rows carry, or a roster that cannot be read, names nobody
            if not named or counts is None or all(counts.get(k, 0) > 1 for k in named):
                continue
        happened, filed = mw.day_of(r.get("incident_date")), mw.day_of(r.get("timestamp"))
        # listed while it happened or was filed in the window; a day after today is a slip and never counts
        days = [x for x in (happened, filed) if x is not None and x <= ctx.on]
        if not days or max(days) < cutoff:
            continue
        d = happened if happened is not None and happened <= ctx.on else max(days)
        ref = mw._sha10(f"{r.get('timestamp') or ''}|{r.get('your_name') or ''}|{r.get('incident_date') or ''}|"
                        f"{r.get('incident_category') or ''}").lower()
        items.append(item(f"mar:{ref}", "med_error", title=f"A medication error report names you — {_day_words(d)}",
                          at=r.get("timestamp") or d.isoformat(), flag=True, link=link))
    gaps = []
    if stale:
        gaps.append(f"The copy shown is not the newest ({stale}).")
    if counts is None:
        gaps.append(f"Reports that name you among the employees involved are not listed: the people roster could "
                    f"not be read to tell you from a namesake ({counts_why}).")
    return head("med_error", STATE_READY, as_of=read_at, count=len(items),
                note=f"Reports filed or about a day in the last {MED_ERROR_DAYS} days. A name somebody else on the "
                     f"people roster also carries is not matched. Only the day is shown here.",
                gap=" ".join(gaps)), items


def src_transport(ctx: Ctx) -> tuple[dict, list[dict]]:
    """Transportation's word to the one who asked — approved, declined, cancelled: only the items addressed to…"""
    uid = str(ctx.me.get("uid") or ctx.subject.get("uid") or "").strip()
    if not uid:
        raise NotAttributable("this account carries no id, so no Transportation alert can be tied to it")
    sid = ctx.store.pointer(mw.PTR_VC_INBOX)
    rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    if not total and not mw.copied_whole(ctx.store.book(sid)):
        raise Unreadable("the house of Transportation's items is declared but not mirrored yet")
    link = {"label": VC_LINK_LABEL} if ctx.opens(VC_APP) else None
    items = []
    for r in rows:
        if _low(r.get("box")) != VC_BOX_INBOX or str(r.get("to_uid") or "").strip() != uid:
            continue
        rid = str(r.get("id") or "").strip()
        href = str(r.get("link") or "").strip()
        # room is kept for the test-mode mark, so the item's own cut never takes it
        body = _text(r.get("body"), 280)
        if _low(r.get("test_mode")) in SCHED_TEST_MODE:
            body = " · ".join(x for x in (body, "Test mode") if x)
        items.append(item(_key("vcal", rid or f"{r.get('created_at')}|{r.get('title')}"), "transport",
                          title=_text(r.get("title"), 200) or "Transportation", body=body, at=r.get("created_at"),
                          flag=False,
                          link={**link, "href": href if href.startswith(VC_HREF) else VC_CALENDAR_HREF}
                          if link else None))
    return head("transport", STATE_READY, as_of=as_of, count=len(items), note="Alerts addressed to you."), items


READERS: dict[str, Callable[[Ctx], tuple[dict, list[dict]]]] = {
    "requests": src_requests, "reimbursement": src_reimbursement, "punch": src_punch, "scheduling": src_scheduling,
    "support": src_support, "transport": src_transport,
    "hiring": src_hiring,
    "new_staff": src_new_staff, "new_clients": src_new_clients, "potential_clients": src_potential_clients,
    "notices": src_notices, "updates": src_updates, "med_error": src_med_error,
}


def _run(ctx: Ctx, key: str,
         reader: Callable[[Ctx], tuple[dict, list[dict]]] | None = None) -> tuple[dict, list[dict]]:
    try:
        return (reader or READERS[key])(ctx)
    except Held as exc:
        return head(key, STATE_HELD, str(exc)), []
    except Closed as exc:
        return head(key, STATE_CLOSED, str(exc)), []
    except mw.NotAttributable as exc:
        return head(key, STATE_NOT_ATTRIBUTABLE, str(exc)), []
    except mw.Unreadable as exc:
        return head(key, STATE_UNREADABLE, str(exc)), []
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: one source that throws is said; the rest answer
        log.warning("my inbox: %s failed (%s)", key, type(exc).__name__)
        return head(key, STATE_UNREADABLE, f"it could not be read ({type(exc).__name__})"), []


def _unique(items: list[dict]) -> None:
    seen_ids: dict[str, int] = {}
    for it in items:
        n = seen_ids.get(it["id"], 0) + 1
        seen_ids[it["id"]] = n
        if n > 1:
            it["id"] = f"{it['id']}.{n}"


def board(dsn: str, *, subject: dict[str, Any], me: dict[str, Any], access: dict[str, dict[str, Any]],
          requests: Callable[[], Any] | None, lanes: dict[str, Any] | None, lanes_why: str = "",
          notices: Callable[[], dict[str, Any]] | None = None, held: str = "",
          snapshot_dir: Path | str = "/srv/snapshot", board_file: Path | str = "",
          readonly: bool = False, readonly_why: str = "", store: Any = None,
          now: datetime | None = None, updates: dict[str, Any] | None = None,
          alerts_off: Iterable[str] = ()) -> dict[str, Any]:
    """The whole answer for one subject; each source in its own FAIL-CLOSED run."""
    now = now or datetime.now(UTC)
    own_store = store is None
    store = store if store is not None else Store(dsn)
    try:
        ctx = Ctx(subject=subject, me=me, lanes=lanes, lanes_why=lanes_why, access=access, requests=requests,
                  notices=notices, held=held, snapshot_dir=snapshot_dir, board_file=board_file, store=store, now=now,
                  readonly=readonly, updates=updates, alerts_off=alerts_off)
        heads, items = [], []
        for key, _label in SOURCES:
            h, got = _run(ctx, key)
            heads.append(h)
            items.extend(got)
        _unique(items)
        marks, marks_ok, marks_why = _marks_of(store, subject, items, readonly)
    finally:
        if own_store:
            store.close()
    kept, unread, capped = _settled(heads, items, marks)
    return {"subject": {"name": str(me.get("roster_name") or me.get("name") or subject.get("label") or ""),
                        "key_why": str(me.get("key_why") or "")},
            "heads": heads + not_on_platform(),
            "items": kept,
            "unread": unread,
            "capped": capped,
            "marks": {"readable": marks_ok, "why": marks_why, "kept": not readonly,
                      "kept_why": "" if not readonly else (readonly_why or KEPT_WHY_CHOSEN)},
            "read_at": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


def _marks_of(store: Any, subject: dict[str, Any], items: list[dict],
              readonly: bool) -> tuple[dict[str, dict[str, Any]], bool, str]:
    """(the subject's own marks on these items, whether they could be read, why not)."""
    ours = [it["id"] for it in items if not NOTICE_KEY_RE.fullmatch(it["id"])]
    if not ours:
        return {}, True, ""
    try:
        return store.marks(str(subject.get("uid") or ""), ours, ensure=not readonly), True, ""
    except Exception as exc:  # noqa: BLE001 — every alert is said unread, and the answer says why
        log.warning("my inbox: the read marks could not be read (%s)", type(exc).__name__)
        return {}, False, f"what was read could not be read ({type(exc).__name__})"


def _settled(heads: list[dict], items: list[dict],
             marks: dict[str, dict[str, Any]]) -> tuple[list[dict], int, str]:
    """(the items with their marks — a cleared one left out — newest first and capped, how many are unread, the…"""
    kept = []
    for it in items:
        mark = marks.get(it["id"])
        if mark is not None:
            if mark.get("dismissed_at"):
                continue
            it["read"] = bool(mark.get("read_at"))
        kept.append(it)
    kept.sort(key=lambda it: it["at"] or "", reverse=True)
    capped = len(kept) > ITEM_CAP
    kept = kept[:ITEM_CAP]
    for h in heads:
        if h["state"] == STATE_READY:
            h["count"] = sum(1 for it in kept if it["type"] == h["key"])
    return (kept, sum(1 for it in kept if not it["read"]),
            f"Showing the newest {ITEM_CAP} alerts." if capped else "")


# ── a client-role account: New staff, Company notices and the chat, nothing else ──────────────────────────────

# New staff is the backend's (apps-script/MyFamily.gs); the company notices are this relay's own, cut to the houses…
FAMILY_SOURCES = (("new_staff", "New staff"), ("notices", "Company notices"))
# a new staff member opens on the basic profile Staff shows a client, only while Staff is open to the account
FAMILY_STAFF_APP = "staff-profiles"
FAMILY_STAFF_HREF = "/app/staff-profiles/profile"
FAMILY_APPS = (FAMILY_STAFF_APP,)
FAMILY_KEY_RE = re.compile(r"^fam:[a-z]{1,12}:[A-Za-z0-9._-]{1,120}$")
FAMILY_STAFF_KEY_RE = re.compile(r"[a-z0-9]{3,80}")
HOUSE_CODE_RE = re.compile(r"[A-Z]{2,4}\d{3,6}")
FAMILY_HOUSES_MAX = 12
FAMILY_STATES = {"ok": STATE_READY, "empty": STATE_READY, "not_applicable": STATE_CLOSED,
                 "unreadable": STATE_UNREADABLE}
FAMILY_VIEWERS = frozenset({"client", "guardian"})
FAMILY_UNLINKED = "This account is not linked to a client yet, so nothing on a client's record is listed."
FAMILY_STAFF_NOTE = "The staff who serve the house, whose first day there is in the last two weeks."
FAMILY_NOTICES_NOTE = "Who takes a shift at the house, from the company's notices."
FAMILY_NO_HOUSES = "the backend named no house for this account, so no notice can be tied to one"


def family_houses(family: dict[str, Any]) -> tuple[list[str], str]:
    """(the houses the backend names for the account, at most FAMILY_HOUSES_MAX codes; why none, or why they may…"""
    raw = family.get("house_codes")
    if not isinstance(raw, list):
        return [], FAMILY_NO_HOUSES
    codes = sorted({c for c in (str(x).strip().upper() for x in raw if isinstance(x, str))
                    if HOUSE_CODE_RE.fullmatch(c)})
    why = _text(family.get("houses_why"), 300)
    if not codes:
        return [], why or FAMILY_NO_HOUSES
    return codes[:FAMILY_HOUSES_MAX], why


def family_staff_head(family: dict[str, Any] | None, why: str = "") -> dict[str, Any]:
    """New staff as the backend said it, in this module's words: a head it did not send is unreadable, and an…"""
    if family is None:
        return head("new_staff", STATE_UNREADABLE, why or "the backend did not answer")
    if family.get("linked") is not True:
        return head("new_staff", STATE_NOT_ATTRIBUTABLE, _text(family.get("why"), 300) or FAMILY_UNLINKED)
    h = next((x for x in family.get("heads") or [] if isinstance(x, dict) and x.get("key") == "new_staff"), None)
    state = FAMILY_STATES.get(str(h.get("state") or ""), STATE_UNREADABLE) if h else STATE_UNREADABLE
    if state != STATE_READY:
        said = (_text(h.get("why"), 300) or "it could not be read") if h else "the backend did not answer for it"
        return head("new_staff", state, said)
    return head("new_staff", STATE_READY, count=0, note=FAMILY_STAFF_NOTE, gap=_text(h.get("gap"), 300),
                as_of=mw.when_of(family.get("read_at")) if family.get("read_at") else "")


def family_items(family: dict[str, Any] | None, ctx: Ctx) -> list[dict[str, Any]]:
    """The backend's new staff, field by field: a `fam:staff:` key, a readable day and its title; the link is…"""
    if family is None or family.get("linked") is not True:
        return []
    staff_open = ctx.opens(FAMILY_STAFF_APP)
    out = []
    for raw in family.get("items") or []:
        if not isinstance(raw, dict) or raw.get("type") != "new_staff":
            continue
        key = str(raw.get("id") or "")
        if not key.startswith("fam:staff:") or not FAMILY_KEY_RE.fullmatch(key) or mw.day_of(raw.get("at")) is None:
            continue
        staff = str(raw.get("staff") or "")
        link = ({"href": f"{FAMILY_STAFF_HREF}?staff={staff}", "label": "Open in Staff"}
                if staff_open and FAMILY_STAFF_KEY_RE.fullmatch(staff) else None)
        out.append(item(key, "new_staff", title=_text(raw.get("title"), 200) or "New staff", at=raw.get("at"),
                        link=link))
    return out


def family_notices(ctx: Ctx, family: dict[str, Any] | None, why: str = "") -> tuple[dict, list[dict]]:
    """The company notices at the account's own houses (`ctx.notices(houses)`); held while test mode is on."""
    if family is None:
        raise Unreadable(why or "the backend did not answer, so no house is known")
    if family.get("linked") is not True:
        raise NotAttributable(_text(family.get("why"), 300) or FAMILY_UNLINKED)
    houses, houses_why = family_houses(family)
    if not houses:
        raise Unreadable(houses_why)
    if ctx.held:
        raise Held(HELD_WHY)
    if ctx.notices is None:
        raise Unreadable("the notices lane is not on this server")
    try:
        got = ctx.notices(houses)
    except Exception as exc:  # noqa: BLE001
        raise Unreadable(f"the notices could not be read ({type(exc).__name__})") from exc
    if not isinstance(got, dict):
        raise Unreadable("the notices lane gave no answer")
    if got.get("held"):
        raise Held(HELD_WHY)
    items = []
    for n in got.get("notices") or []:
        try:
            nid = int(n.get("id"))
        except (TypeError, ValueError, AttributeError):
            continue
        items.append(item(f"srv-{nid}", "notices", title=str(n.get("title") or "Company notice"),
                          body=str(n.get("body") or ""), at=n.get("published_at") or n.get("at"),
                          read=bool(n.get("read"))))
    gap = " ".join(g for g in (houses_why, "Only the newest notices were judged." if got.get("truncated") else "")
                   if g)
    return head("notices", STATE_READY, count=len(items), note=FAMILY_NOTICES_NOTE, gap=gap), items


def family_board(dsn: str, *, subject: dict[str, Any], family: dict[str, Any] | None,
                 access: dict[str, dict[str, Any]], family_why: str = "",
                 notices: Callable[[list[str]], dict[str, Any]] | None = None, held: str = "",
                 readonly: bool = False, readonly_why: str = "", store: Any = None,
                 now: datetime | None = None) -> dict[str, Any]:
    """A client-role account's whole answer, in board()'s shape: New staff (`family`, the myFamily read's data…"""
    now = now or datetime.now(UTC)
    if family is not None and not isinstance(family, dict):
        family = {}
    own_store = store is None
    store = store if store is not None else Store(dsn)
    try:
        ctx = Ctx(subject=subject, me={}, lanes=None, lanes_why="", access=access, requests=None, notices=notices,
                  held=held, snapshot_dir="", board_file="", store=store, now=now, readonly=readonly)
        heads = [family_staff_head(family, family_why)]
        items = family_items(family, ctx)
        h, got = _run(ctx, "notices", lambda c: family_notices(c, family, family_why))
        heads.append(h)
        items.extend(got)
        _unique(items)
        marks, marks_ok, marks_why = _marks_of(store, subject, items, readonly)
    finally:
        if own_store:
            store.close()
    kept, unread, capped = _settled(heads, items, marks)
    known = family or {}
    viewer = str(known.get("viewer") or "")
    ward = known.get("ward") if isinstance(known.get("ward"), dict) else {}
    # None: the backend did not answer, so whether the account is linked is not known
    linked = (known.get("linked") is True) if family is not None else None
    unlinked = (_text(known.get("why"), 300) or FAMILY_UNLINKED) if linked is False else ""
    return {"family": True,
            "viewer": viewer if viewer in FAMILY_VIEWERS else "client",
            "ward": {"name": _text(ward.get("name"), 120)},
            "linked": linked,
            "why": unlinked,
            "subject": {"name": _text(ward.get("name"), 120), "key_why": unlinked},
            "heads": heads,
            "items": kept,
            "unread": unread,
            "capped": capped,
            "marks": {"readable": marks_ok, "why": marks_why, "kept": not readonly,
                      "kept_why": "" if not readonly else (readonly_why or KEPT_WHY_ACTING)},
            "read_at": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


def landed(h: dict[str, Any]) -> bool:
    """Ready with nothing unsettled, or shut to the subject: nothing it holds is missing from the list."""
    return (h.get("state") == STATE_READY and not h.get("gap")) or h.get("state") == STATE_CLOSED


def apply_display(data: dict[str, Any], display: dict[str, Any]) -> dict[str, Any]:
    """The answer as this session is shown it (`display` is my_work.display_for's)."""
    hidden = (display.get("hidden") or {}).get("inbox_sources") is True
    shown: dict[str, Any] = {"hidden": {"inbox_sources": hidden}}
    if "for_users" in display:
        shown.update(for_users={"inbox_sources": (display["for_users"] or {}).get("inbox_sources") is True},
                     readable=bool(display.get("readable")), why=str(display.get("why") or ""))
    data["display"] = shown
    if hidden:
        sources = [h for h in data.get("heads") or [] if h.get("state") != STATE_NOT_ON_PLATFORM]
        data["whole"] = bool(sources) and all(landed(h) for h in sources)
        data["heads"] = []
    return data
