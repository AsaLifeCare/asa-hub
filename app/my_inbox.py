"""My Inbox (server/my_inbox.py) off asa-hub-db: the alerts that concern one person, the sheets read with Python's own
edits laid, the relay's own state through mw_relay_state and the read marks through inbox_state. One read
(myInboxView) builds the whole answer for the scope its lane decided (app/inbox_lanes.py); a client-role account is
the lane's family view (app/inbox_family.py). The bell, the punch board, the test mode switch and the relay's own marks
come handed in the payload by the lane."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

import candidates as cand_book
import clients as client_book
import gsjs
import hubdb
import locations as L
import mw_relay_state as relay_state
import mw_roster
import my_work as mw
import scope as sc
import staff as people_book
from scope import Defer

log = logging.getLogger("asa-hub-app")

try:
    import inbox_state
except Exception as _exc:  # noqa: BLE001 - without the marks every read defers (the stand-in below)
    inbox_state = None  # type: ignore[assignment]
    log.warning("my inbox: the marks module did not load, every read defers (%s)", type(_exc).__name__)

sr = mw.sr
effective_roster = mw_roster.effective_roster

APP_ID = "my-inbox"
CORE_USERS_SHEET_ID = mw.CORE_USERS_SHEET_ID
# what this service cannot read defers to the relay, never a sentence of its own
_LOUD = (Defer, hubdb.Unreadable)

UTC = timezone.utc
MODE_OWN, MODE_MASS = mw.MODE_OWN, mw.MODE_MASS

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

# an alert key: a kind, then the words that make it one alert, its state included
KEY_RE = re.compile(r"^[a-z_]+:[A-Za-z0-9:._-]{1,200}$")
# a company notice keeps the bell's own id
NOTICE_KEY_RE = re.compile(r"^srv-([1-9][0-9]{0,17})$")
PERSON_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
_PART_RE = re.compile(r"[A-Za-z0-9:._-]{1,120}")

# the apps whose doors are asked for the subject
APPS = ("my-work", "hiring", "users", "employee-tracker", "clients", "potential-clients", "ui-incidents",
        "scheduling", "support-desk",
        "vehicle-calendar", "staff-candidates")
NOTES_SHEET_ID = os.getenv("HUB_NOTES_SHEET_ID", "1BTuqU6xZHmo_jfI49rU3a6el2BB1pFMnCeS5bZBTbY4")
UPDATES_TAB = "REFERENCE-production_apps"
UPDATE_COLUMNS = ("Date", "App / area", "Status", "Activity completed", "Version / commit")
# src/registry's apps by name
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
    ("Equipment & Assets", "equipment"), ("Expenses", "expenses"), ("Families & Guardians", "family-profiles"),
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
_APP_ALIASES = (("Shift Requests", "calendarbuilder"), ("Swaps", "calendarbuilder"),
                ("Employee Tracker", "employee-tracker"), ("Hiring", "hiring"), ("Families", "family-profiles"))
UPDATE_APPS = {sr.fold(name): app_id for name, app_id in _REGISTRY_APPS + _APP_ALIASES}
# a name that is also a common heading word names its app only as the whole area
_WHOLE_AREA_ONLY = frozenset({sr.fold("Staff"), sr.fold("SSA"), sr.fold("Families")})
_UPDATE_NAME_MAX = max(map(len, UPDATE_APPS))
# Talent.gs talentLiveAllowed_
CANDIDATE_ROLES = frozenset({"admin", "director", "manager", "interviewer"})
CANDIDATE_BADGES = frozenset({"INTERVIEWER"})
# the HM badge names candidates only where App Control's Staff Candidates row opens (interviews.hm_hires)
CANDIDATE_HM_BADGE, CANDIDATE_HM_APP = "HM", "staff-candidates"

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
NOT_STAFF_ROLES = frozenset({"guardian", "client", "entity"})
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
SCHED_BOX_INBOX = "inbox"
SCHED_EVERYONE = "everyone"
SCHED_STAFF_ROLES = frozenset({"admin", "director", "manager", "staff"})
SCHED_TEST_MODE = mw.SCHED_TEST_MODE
SUPPORT_APP = "support-desk"
SUPPORT_HREF = "/app/support-desk/requests"
SUPPORT_HREF_ROOT = "/app/support-desk/"
SUPPORT_LINK_LABEL = "Open in Support Requests"
SUPPORT_BOX = "inbox"
# the master's own session also reads every alert sent to a director's seat, once per telling, without the act
DIRECTORS_SEAT = "director"
DIRECTORS_SAID = "Sent to the directors"
DIRECTORS_NOTE = ", and those sent to the directors."
ACT_KINDS = frozenset({"aware", "seen"})
ACT_ACTIONS = frozenset({"supportInboxAnswer", "schedulingAnswer"})
ACT_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
LEVELS = frozenset({"warning", "important", "info"})
AWARE_LABEL, SEEN_LABEL = "I'm aware", "Seen"
VC_BOX_INBOX = "inbox"
VC_APP = "vehicle-calendar"
VC_HREF = "/app/vehicle-calendar/"
VC_CALENDAR_HREF = "/app/vehicle-calendar/calendar"
VC_LINK_LABEL = "Open in Transportation"

# src/pages/features/hiring/flow/shared.ts STAGES
STAGES = (("new", "New"), ("phone-screen", "Phone Screen"), ("interview", "Interview"),
          ("onboarding", "Onboarding"), ("hired", "Hired"), ("ready", "Ready to start"))
STAGE_LABEL = dict(STAGES)
# Talent.gs talentStage_
STATUS_STAGE = {"new": "new", "phone screen": "phone-screen", "phone-screen": "phone-screen",
                "in person": "interview", "interview": "interview", "onboarding": "onboarding",
                "ready": "ready", "ready to start": "ready", "hired": "hired", "becoming staff": "hired",
                "becoming-staff": "hired", "minimal internal documentation ready": "hired",
                "internal-docs": "hired"}

NEVER_MISSING = frozenset({"not_known_to_clock", "clock_not_read"})
PAIR_FAULTS = frozenset({"open", "missing", "covered_by_another"})
PUNCH_WORDS = {"no_punch": "Nothing on the time clock after the shift began",
               "open": "Clocked in, never clocked out",
               "missing": "No time entry of this shift's own",
               "covered_by_another": "One time entry covers this shift and another"}

HELD_WHY = "Company notices are held while test mode is on."
KEPT_WHY_CHOSEN = "Read marks are that person's; you are only looking."
KEPT_WHY_ACTING = "Read marks are not kept in a switched session."

# the row inbox_seen keeps per kind for when it began to be watched; a folded key never carries '~'
BASELINE = "~baseline"

# hotline_desk.app_access: the gate the relay asks for each source's app
_ACCESS_LABELS = {"smartcomms": "Smart Comms", "clients": "Client Care"}
CONTAINED_ROLES = frozenset({"client", "onboarding", "interviewer"})
TENANT_BASIC_APPS = frozenset({"myasa", "users", "chat", "suggestions", "teamboard", "calendar", "playground"})
TAB_BADGES, TAB_TENANTS = "app_badge_access", "app_tenant_access"

# AlertReceive.gs: the alerts a holder of Settings › Alerts I receive turned off, kept in the Support settings house
AR_PARTS = ("no_call", "punch", "incident")
AR_KEY_PREFIX = "receive_off:"
AR_HOUSE = "support_settings"

# snapshot_service._notice_accounts: the roles a person may be chosen from
ACCOUNT_ROLES = ("staff", "manager", "admin", "director")

# Settings › Editions (app/editions.py)
EDITION_ANYONE = "myInbox.anyone"
EDITION_ANYONE_WHY = "Your own alerts, or any person's you choose, read-only."
EDITION_DIRECTORS = "myInbox.directors"


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


def candidates_admitted(role: Any, types: Any, hm_hires: bool = False) -> bool:
    """Whether the live candidates door (interviews.hiring_team) would admit this account: the HM badge only where
    App Control's Staff Candidates row opens to it (hm_hires)."""
    if _low(role) in CANDIDATE_ROLES:
        return True
    worn = sr.badges_of("", types)
    return bool(worn & CANDIDATE_BADGES) or (CANDIDATE_HM_BADGE in worn and hm_hires)


def _named_error(name: Any) -> Exception:
    """An exception carrying the class name the relay reported, so its sentence reads as the relay's."""
    text = gsjs.trim(gsjs.or_blank(name))
    cls = text if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", text) else "Exception"
    return type(cls, (Exception,), {})()


# ── the read marks (app/inbox_state.py) ─────────────────────────────────────

class _NoMarks:
    """STAND-IN while app/inbox_state.py cannot load: every read defers, so the relay answers with its own marks."""

    @staticmethod
    def marks_for(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise Defer("My Inbox's marks are not on this service, so the relay answers")

    record_seen = marks_for


def _state() -> Any:
    """inbox_state (marks_for, record_seen) when it loaded, else the stand-in."""
    got = inbox_state
    ok = got is not None and callable(getattr(got, "marks_for", None)) and callable(getattr(got, "record_seen", None))
    return got if ok else _NoMarks


# ── asa-hub-db, as the relay's Store read its copy ──────────────────────────

class Store:
    """The depot's pointers, a house's rows and a book's copy word, off asa-hub-db with Python's edits laid."""

    def __init__(self, hub: mw.HubBooks) -> None:
        self.hub = hub

    def pointer(self, prop: str) -> str:
        """The house the Essencial's Facts declare for `prop` (its last row stands); raises Unreadable."""
        db = self.hub.db
        ref = db.tab(mw.ESSENCIAL_SHEET_ID, hubdb.FACTS_TAB)
        if ref is None or ref.row_count <= 0:
            raise Unreadable("the Essencial's Facts are not in asa-hub-db")
        value = str(db.switchboard("props").get(prop) or "").strip()
        if not value:
            raise Unreadable(f"no house is declared for it (the Essencial carries no {prop})")
        return value

    def tab(self, sheet_id: str, tab: str) -> tuple[list[dict], int, str]:
        return self.hub.tab(sheet_id, tab)

    def book(self, sheet_id: str) -> dict[str, Any] | None:
        return self.hub.book(sheet_id)


# ── the copies the relay built as slices, read here off asa-hub-db ──────────

def _people_rows(reads: L.Reads, _hub: mw.HubBooks) -> list[dict]:
    """The people resource: listRows_('people') merged and without the plans' clients."""
    return people_book.without_isp_clients(reads, people_book.people_merged(reads, people_book._people(reads)) or [])


def _candidate_rows(reads: L.Reads, _hub: mw.HubBooks) -> list[dict]:
    """The candidates resource: talentCandidatesRead_'s cards."""
    return list(cand_book.board(reads)["rows"])


def _client_rows(reads: L.Reads, _hub: mw.HubBooks) -> list[dict]:
    """The clients resource: clientsDerived_(null)."""
    return list(client_book.derived(reads) or [])


def _prospect_rows(_reads: L.Reads, hub: mw.HubBooks) -> list[dict]:
    """The potentialClients resource: the users book's tab as it is kept — Postgres' rows once Potential Clients is
    Python's."""
    import sheet_resources  # noqa: PLC0415 — it imports this module's neighbours
    kept = sheet_resources.kept_rows(_reads, "potentialClients")
    if kept is not None:
        return kept
    if hub.db.tab(CORE_USERS_SHEET_ID, "potentialClients") is None:
        raise hubdb.Unreadable("the potential clients tab is not in asa-hub-db")
    return hub.tab(CORE_USERS_SHEET_ID, "potentialClients")[0]


SLICES: dict[str, Callable[[L.Reads, mw.HubBooks], list[dict]]] = {
    "people": _people_rows, "candidates": _candidate_rows, "clients": _client_rows,
    "potentialClients": _prospect_rows}


# ── the context the sources share ───────────────────────────────────────────

class Ctx:
    def __init__(self, *, reads: L.Reads, hub: mw.HubBooks, owner: Any, subject: dict[str, Any],
                 me: dict[str, Any], lanes: dict[str, Any] | None, lanes_why: str, access: dict[str, dict[str, Any]],
                 requests: Callable[[], Any] | None, notices: Callable[..., dict[str, Any]] | None, held: str,
                 board: Callable[[], Any], now: datetime, readonly: bool, marks: Any,
                 updates: dict[str, Any] | None = None, alerts_off: Iterable[str] = (),
                 directors_copy: bool = False, hidden: Iterable[str] = (), readonly_why: str = "") -> None:
        self.reads, self.hub, self.owner = reads, hub, owner
        self.readonly_why = readonly_why
        # the sources Settings › My Work keeps to the master's own session: not read, not listed
        self.hidden = frozenset(hidden)
        self.subject, self.me, self.lanes, self.lanes_why = subject or {}, me or {}, lanes, lanes_why
        self.access = access or {}
        self.updates = updates
        self.alerts_off = frozenset(_low(a) for a in alerts_off or () if _low(a))
        self.requests, self.notices, self.held, self.board = requests, notices, held, board
        self.store, self.now, self.readonly = Store(hub), now, readonly
        self.directors_copy = directors_copy
        self.on = now.astimezone(mw.OHIO).date()
        self.keys = set(self.me.get("keys") or [])
        self.emails = {_low(e) for e in self.me.get("emails") or [] if _low(e)}
        self._handed_marks = marks
        self._marks: Any = None
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
        """A resource read here once per answer: a failed read is unreadable, never []."""
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
        books: set[str] = set()
        outer = hubdb.READ_BOOKS.get()
        token = hubdb.READ_BOOKS.set(books)
        try:
            rows = SLICES[name](self.reads, self.hub)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
            raise Unreadable(f"the {what} copy could not be read ({type(exc).__name__})") from None
        finally:
            hubdb.READ_BOOKS.reset(token)
            if outer is not None:
                outer |= books
        built = datetime.fromtimestamp(self.reads.db.as_of(books), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return [r for r in rows or [] if isinstance(r, dict)], built

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
                except _LOUD:
                    raise
                except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
                    log.warning("my inbox: the requests could not be read (%s)", type(exc).__name__)
                    self._req = Unreadable(f"your requests could not be read ({type(exc).__name__})")
        if isinstance(self._req, Exception):
            raise self._req
        return self._req

    def marks(self) -> dict[str, Any]:
        """The subject's read marks and every first sighting, the relay's handed rows and inbox_state's own as one."""
        if self._marks is None:
            try:
                got = _state().marks_for(self.owner, str(self.subject.get("uid") or ""), self._handed_marks)
                self._marks = ("ok", got if isinstance(got, dict) else {})
            except Exception as exc:  # noqa: BLE001 — re-raised to every reader that asks
                self._marks = ("err", exc)
        kind, got = self._marks
        if kind == "err":
            raise got
        return got

    def seen(self, kind: str, keys: list[str], *, record: bool) -> tuple[dict[str, datetime], datetime | None]:
        """({key: first seen}, when this kind began to be watched); `record` keeps the kind's baseline and each key's
        first sighting in inbox_state, the relay's own stamp where it handed one."""
        rows, baseline = _state().record_seen(self.owner, kind, list(keys), self._handed_marks, record=record)
        if record:
            self._marks = None
        first = {str(k): at for k, at in ((k, _instant(v)) for k, v in (rows or {}).items()) if at is not None}
        return first, _instant(baseline)


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
        # the status word is in the key too: a move inside one class is a new alert
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
    """The person's own shifts of yesterday and today that the relay's punch board calls missed."""
    ctx.need_keys()
    try:
        body = ctx.board()
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
    """Scheduling's warnings and informatives: those addressed to the account's own id, and those for everyone."""
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
        said = DIRECTORS_SAID if not own and _low(r.get("seat")) == DIRECTORS_SEAT else ""
        return kind == "warning", act, kind if kind in ("warning", "info") else "", said

    copy = _directors_copy(ctx, SCHED_BOX_INBOX)
    items, as_of = _house_items(ctx, mw.PTR_SCHED_INBOX, kind="scheduling", key_prefix="sched",
                                href_prefix=SCHED_HREF, app_id="scheduling", label_word="Scheduling's",
                                href=SCHED_HREF, link_label=SCHED_LINK_LABEL, accept=accept, mark=mark,
                                copy=copy)
    note = ("Alerts addressed to you, and those sent to all staff." if staff_side
            else "Alerts addressed to you.")
    if copy is not None:
        note = note[:-1] + DIRECTORS_NOTE
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


def _directors_copy(ctx: Ctx, box: str) -> Callable[[dict[str, Any]], tuple[str, str, str] | None] | None:
    """In the master's own session (or a holder of the directors' edition in theirs), the telling of an alert sent
    to a director's seat; None for any other session and in a read-only one."""
    if (ctx.subject.get("is_master") is not True and not ctx.directors_copy) or ctx.readonly:
        return None

    def key(r: dict[str, Any]) -> tuple[str, str, str] | None:
        if _low(r.get("box")) != box or _low(r.get("seat")) != DIRECTORS_SEAT:
            return None
        return _same_telling(r)
    return key


def _house_items(ctx: Ctx, ptr: str, *, kind: str, key_prefix: str, href_prefix: str, app_id: str,
                 label_word: str, href: str, link_label: str, accept: Callable[[dict[str, Any]], bool],
                 mark: Callable[[dict[str, Any]], tuple[bool, dict[str, Any] | None, str, str]],
                 copy: Callable[[dict[str, Any]], tuple[str, str, str] | None] | None = None
                 ) -> tuple[list[dict], str]:
    """(items, as_of) of one house of items written for this inbox: the rows `accept` keeps, each keyed by its id."""
    sid = ctx.store.pointer(ptr)
    rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    if not total and not mw.copied_whole(ctx.store.book(sid)):
        raise Unreadable(f"the house of {label_word} items is declared but not copied yet")
    link = {"href": href, "label": link_label} if ctx.opens(app_id) else None
    kept = [r for r in rows if accept(r)]
    if copy is not None:
        told = {_same_telling(r) for r in kept}
        for r in rows:
            k = copy(r)
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
    """Support Requests' warnings, important alerts and informatives addressed to the account's own id."""
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
        # a director's alert shown in the copy is answered at the Support Requests door, never from here
        if ctx.readonly or str(r.get("to_uid") or "").strip() != uid:
            answered = str(r.get("answered_by") or "").strip()
            said = (f"Marked by {answered}" if answered else "Marked") if str(r.get("answered_at") or "").strip() \
                else f"Waiting on {_text(r.get('to_name'), 60) or 'the person it is addressed to'}"
            return kind != "info", None, kind, said
        return kind != "info", _act(word, "supportInboxAnswer", r, AWARE_LABEL if word == "aware" else SEEN_LABEL), \
            kind, ""

    copy = _directors_copy(ctx, SUPPORT_BOX)
    if copy is not None and ctx.alerts_off:
        # an alert turned off in Settings › Alerts I receive is never copied from the directors' seats
        seat_copy = copy
        copy = lambda r: None if _low(r.get("alert")) in ctx.alerts_off else seat_copy(r)  # noqa: E731
    items, as_of = _house_items(ctx, mw.PTR_SUPPORT_INBOX, kind="support", key_prefix="sreq",
                                href_prefix=SUPPORT_HREF_ROOT, app_id=SUPPORT_APP, label_word="Support Requests'",
                                href=SUPPORT_HREF, link_label=SUPPORT_LINK_LABEL, accept=accept, mark=mark,
                                copy=copy)
    note = "Alerts addressed to you" + (DIRECTORS_NOTE if copy is not None else ".")
    return head("support", STATE_READY, as_of=as_of, count=len(items), note=note), items


def _moves(ctx: Ctx) -> tuple[list[dict] | None, str, str]:
    """(status moves of the last MOVE_DAYS, as_of, why not) — never raises but for what defers."""
    try:
        sid = ctx.store.pointer(PTR_STATUS_HISTORY)
        rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    except Unreadable as exc:
        return None, "", str(exc)
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — said on the head, the cards still answer
        return None, "", f"it could not be read ({type(exc).__name__})"
    if not total:
        return None, "", "the status history is declared but not copied yet"
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
    """Candidates in the process and their moves: names and steps only for an account the live candidates door
    admits, a count for everybody else Hiring is open to."""
    if not ctx.opens("hiring"):
        raise Closed(ctx.shut_why("hiring", "Hiring"))
    cards, as_of = ctx.slice("candidates", "candidates")
    cards = [c for c in cards if c.get("stage") in STAGE_LABEL]
    moves, _as_of, moves_why = _moves(ctx)
    gap = "" if moves is not None else f"Who moved where could not be read: {moves_why}."
    mails = ctx.emails
    link = LINK_HIRING
    if not candidates_admitted(ctx.subject.get("role"), ctx.subject.get("types"), ctx.opens(CANDIDATE_HM_APP)):
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
    """People whose start day is in the last NEW_STAFF_DAYS: counted for everybody, named for those who open Users or
    the Employee Tracker."""
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
        first, baseline = ctx.seen("client", sorted(by_key), record=not ctx.readonly)
    except _LOUD:
        raise
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
    """How many prospects arrived in the last PROSPECT_DAYS, with their names, for those who open Potential
    Clients."""
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
    """The relay's bell, judged per reader where it is kept and handed in; held while test mode is on."""
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


def read_updates(store: Store) -> dict[str, Any]:
    """The release notes, read once for the read: {rows, as_of, book, book_why}, or {why} when they could not be."""
    try:
        rows, total, as_of = store.tab(NOTES_SHEET_ID, UPDATES_TAB)
        if not total:
            return {"why": "the release notes are not in asa-hub-db"}
        if not any(set(UPDATE_COLUMNS[:3]) <= set(r) for r in rows if isinstance(r, dict)):
            return {"why": "the release notes carry no Date, App / area and Status columns"}
        book, book_why = None, ""
        try:
            book = store.book(NOTES_SHEET_ID)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — the lines still answer; the gap says the copy is unvouched
            book_why = type(exc).__name__
        return {"rows": rows, "as_of": as_of, "book": book, "book_why": book_why}
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
        log.warning("my inbox: the release notes could not be read (%s)", type(exc).__name__)
        return {"why": f"the release notes could not be read ({type(exc).__name__})"}


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
    """Every registry app an area names: each run of its words that spells a registry name, the longest where runs
    overlap."""
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
    """Every app a Live line names: what the read asks access for."""
    rows = got.get("rows") if isinstance(got, dict) else None
    if not isinstance(rows, list):
        return []
    return sorted({a for r in rows if isinstance(r, dict) and is_live(r.get("Status"))
                   for a in area_apps(update_area(r.get("App / area"))[0])})


def update_day(raw: Any) -> date | None:
    """The Ohio day a Date cell names: a written day, or a time with no zone, is that day and never a UTC instant."""
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
        return f"asa-hub-db keeps no word on the release notes, so this copy may not be the newest; {age}."
    status = _text(book.get("last_sync_status"), 40)
    if _low(status) != "ok":
        return f"The last copy of the release notes did not finish ({status or 'no word'}); {age}."
    changed, copied = _instant(book.get("modified_time")), _instant(book.get("last_sync_at"))
    if changed is not None and copied is not None and changed > copied:
        return f"The release notes changed after they were copied, so the newest lines may be missing; {age}."
    return ""


def src_updates(ctx: Ctx) -> tuple[dict, list[dict]]:
    """One alert per Live line, for everybody the read serves, except a line about an app the subject cannot open or
    one still the master's alone."""
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
            # a repeated key is numbered in the book's order over every dated line, before any is skipped or hidden
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


def src_med_error(ctx: Ctx) -> tuple[dict, list[dict]]:
    """A POINTER only: an incident report of the medication-error kind that this person filed, or whose Employees
    Involved names them alone among the roster."""
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
    """Transportation's word to the one who asked — approved, declined, cancelled: only the items addressed to the
    account's own id."""
    uid = str(ctx.me.get("uid") or ctx.subject.get("uid") or "").strip()
    if not uid:
        raise NotAttributable("this account carries no id, so no Transportation alert can be tied to it")
    sid = ctx.store.pointer(mw.PTR_VC_INBOX)
    rows, total, as_of = ctx.store.tab(sid, HOUSE_TAB)
    if not total and not mw.copied_whole(ctx.store.book(sid)):
        raise Unreadable("the house of Transportation's items is declared but not copied yet")
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


def _run(ctx: Ctx, key: str) -> tuple[dict, list[dict]]:
    try:
        return READERS[key](ctx)
    except _LOUD:
        # what this service cannot read is the relay's to answer, whole
        raise
    except Held as exc:
        return head(key, STATE_HELD, str(exc)), []
    except Closed as exc:
        return head(key, STATE_CLOSED, str(exc)), []
    except mw.NotAttributable as exc:
        return head(key, STATE_NOT_ATTRIBUTABLE, str(exc)), []
    except mw.Unreadable as exc:
        return head(key, STATE_UNREADABLE, str(exc)), []
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: one source that throws is said; the rest answer
        log.warning("my inbox: %s failed (%s: %s)", key, type(exc).__name__, str(exc)[:160])
        return head(key, STATE_UNREADABLE, f"it could not be read ({type(exc).__name__})"), []


def _unique(items: list[dict]) -> None:
    seen_ids: dict[str, int] = {}
    for it in items:
        n = seen_ids.get(it["id"], 0) + 1
        seen_ids[it["id"]] = n
        if n > 1:
            it["id"] = f"{it['id']}.{n}"


# Settings › My Work — what everyone else sees: the alert sources each part keeps to the master's own session
HIDDEN_SOURCES = {"inbox_alerts": ("new_staff", "updates")}


def hidden_sources(sess_or_reads: Any) -> frozenset[str]:
    """The sources this session does not see (editions.hides_for); none for a read with no session."""
    if not isinstance(sess_or_reads, L.Session):
        return frozenset()
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    hides = E.hides_for(sess_or_reads)
    return frozenset(src for part, srcs in HIDDEN_SOURCES.items() if hides.get(part) for src in srcs)


def board(ctx: Ctx) -> dict[str, Any]:
    """The whole answer for one subject; each source in its own FAIL-CLOSED run."""
    heads, items = [], []
    for key, _label in SOURCES:
        if key in ctx.hidden:
            continue
        h, got = _run(ctx, key)
        heads.append(h)
        items.extend(got)
    _unique(items)
    marks, marks_ok, marks_why = _marks_of(ctx, items)
    kept, unread, capped = _settled(heads, items, marks)
    me, subject = ctx.me, ctx.subject
    return {"subject": {"name": str(me.get("roster_name") or me.get("name") or subject.get("label") or ""),
                        "key_why": str(me.get("key_why") or "")},
            "heads": heads + not_on_platform(),
            "items": kept,
            "unread": unread,
            "capped": capped,
            "marks": {"readable": marks_ok, "why": marks_why, "kept": not ctx.readonly,
                      "kept_why": "" if not ctx.readonly else (ctx.readonly_why or KEPT_WHY_CHOSEN)},
            "read_at": ctx.now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


def _marks_of(ctx: Ctx, items: list[dict]) -> tuple[dict[str, dict[str, Any]], bool, str]:
    """(the subject's own marks on these items, whether they could be read, why not)."""
    ours = [it["id"] for it in items if not NOTICE_KEY_RE.fullmatch(it["id"])]
    if not ours:
        return {}, True, ""
    try:
        reads = ctx.marks().get("reads") or {}
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — every alert is said unread, and the answer says why
        log.warning("my inbox: the read marks could not be read (%s)", type(exc).__name__)
        return {}, False, f"what was read could not be read ({type(exc).__name__})"
    return {k: dict(reads[k]) for k in ours if isinstance(reads.get(k), dict)}, True, ""


def _settled(heads: list[dict], items: list[dict],
             marks: dict[str, dict[str, Any]]) -> tuple[list[dict], int, str]:
    """(the items with their marks — a cleared one left out — newest first and capped, how many are unread, the cap
    sentence)."""
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


# ── who may open which source (hotline_desk.app_access off asa-hub-db) ──────

def _words(cell: Any) -> list[str]:
    """A badge cell ("ADMIN, MANAGER") as its words, upper-cased."""
    return [b.strip().upper() for b in re.split(r"[,;|\n]+", str(cell if cell is not None else "")) if b.strip()]


def _list_cell(cell: Any) -> list[str]:
    """A list written into a cell — JSON text, a real list, or comma separated."""
    if isinstance(cell, list):
        return [str(x).strip() for x in cell if str(x).strip()]
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        if isinstance(got, list):
            return [str(x).strip() for x in got if str(x).strip()]
    except ValueError:
        pass
    return [x.strip() for x in re.split(r"[,;|\n]+", text) if x.strip()]


def _access_book(hub: mw.HubBooks) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """App Access's badge and tenant rows of the users book, the last row for an app standing."""
    if hub.db.tab(CORE_USERS_SHEET_ID, TAB_BADGES) is None:
        raise hubdb.Unreadable("App Access's badge rows are not in asa-hub-db")
    rules: dict[str, list[str]] = {}
    for r in hub.tab(CORE_USERS_SHEET_ID, TAB_BADGES)[0]:
        if r.get("app_id") is not None:
            rules[mw._jtext(r.get("app_id")) or ""] = _words(r.get("badges"))
    tenants: dict[str, list[str]] = {}
    for r in hub.tab(CORE_USERS_SHEET_ID, TAB_TENANTS)[0]:
        if r.get("app_id") is not None:
            tenants[mw._jtext(r.get("app_id")) or ""] = _list_cell(r.get("tenants"))
    return rules, tenants


def app_access(app_id: str, *, uid: str, role: str, is_master: bool, user: dict[str, Any] | None,
               rules: dict[str, list[str]], tenants: dict[str, list[str]], cut: frozenset[str],
               seen: frozenset[str]) -> dict[str, Any]:
    """{open, why}: lib/badgeAccess.ts badgeAllowsApp plus the containment, as the relay's gate decides it."""
    label = _ACCESS_LABELS.get(app_id) or app_id

    def closed(why: str) -> dict[str, Any]:
        return {"open": False, "why": why}

    session_role = str(role or "").strip().lower()
    if not uid and not session_role:
        return closed("This session carries no account.")
    if is_master is True:
        return {"open": True, "why": "the master's view is never narrowed"}
    if not str(uid or "").strip():
        return closed("This session carries no account id, so the door stays closed.")
    # Settings › My Work's app list: answered as an app with no row
    if app_id in cut and str(uid).strip() not in seen:
        return closed(f"No badge is written for {label} in App Access, so it is the master's alone.")
    if user is None:
        return closed("This account is not in the access record, so the door stays closed.")
    if str(user.get("active") or "").strip().lower() == "false":
        return closed("This account is not active.")
    if app_id in _list_cell(user.get("app_denials")):
        return closed(f"{label} was removed from this account in App Access.")
    rule = list(rules.get(app_id) or [])
    account_role = str(user.get("role") or "").strip().lower()
    for word in sorted({session_role, account_role} & CONTAINED_ROLES):
        if word.upper() not in rule:
            return closed(f"{label} is not open to {word} accounts unless App Access names that role.")
    home = str(user.get("home_tenant") or "").strip()
    places = list(tenants.get(app_id) or [])
    if home and places and app_id not in TENANT_BASIC_APPS and home not in places:
        return closed(f"{label} is not installed for this account's home tenant.")
    if not rule:
        return closed(f"No badge is written for {label} in App Access, so it is the master's alone.")
    worn = set(_words(user.get("types")))
    # the role word counts as a badge, but not one a family account wears for another column (scope.role_counts)
    for word in (session_role, account_role):
        if word and sc.role_counts(user.get("types"), word):
            worn.add(word.upper())
    if sr.badges_of("", sorted(worn)) & set(rule):
        return {"open": True, "why": "badge"}
    return closed(f"{label} is not open to this account's badges.")


def access_for(hub: mw.HubBooks, cfg: dict[str, str], subject: dict[str, Any],
               apps: Iterable[str]) -> dict[str, dict[str, Any]]:
    """{app: {open, why}} for every app a source is judged by."""
    wanted = tuple(dict.fromkeys(apps))
    uid = str(subject.get("uid") or "")
    rules, tenants = _access_book(hub)
    user = hub.users_row(CORE_USERS_SHEET_ID, uid) if uid.strip() else None
    cut = frozenset(sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY)))
    seen = frozenset(sc.list_cell(cfg.get(sc.MYWORK_APPS_SEEN_KEY)))
    out: dict[str, dict[str, Any]] = {}
    for a in wanted:
        try:
            out[a] = app_access(a, uid=uid, role=str(subject.get("role") or ""), is_master=subject.get("is_master")
                                is True, user=user, rules=rules, tenants=tenants, cut=cut, seen=seen)
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: a check that throws stays shut
            out[a] = {"open": False, "why": f"The access check failed ({type(exc).__name__})."}
    return out


# ── Settings › Alerts I receive (AlertReceive.gs arLane_), for the directors' copy ──

def alerts_off(reads: L.Reads, uid: str) -> list[str]:
    """FAIL-OPEN: the parts this account turned off, from the Support settings house; nothing when unread."""
    uid = str(uid or "").strip()
    db = reads.db
    if not uid or not db.house_moved(AR_HOUSE):
        return []
    try:
        ref = db.resolve(AR_HOUSE).ref
        rows = db.rows(ref) if ref is not None else []
    except _LOUD:
        raise
    except Exception:  # noqa: BLE001 — settings that cannot be read cut nobody
        return []
    out: list[str] = []
    for _rn, raw in rows:
        if str(raw.get("key") if raw.get("key") is not None else "").strip() != AR_KEY_PREFIX + uid:
            continue
        named = str(raw.get("value") if raw.get("value") is not None else "").strip().lower()
        parts = [p for p in AR_PARTS if p in re.split(r"[,;\s]+", named)]
        if parts:
            out = parts
    return sorted(set(out))


def _on_directors_list(reads: L.Reads, uid: str) -> bool:
    """Whether Scheduling's directors list names this account (AlertReceive.gs arHolder_)."""
    import scheduling as sched  # noqa: PLC0415 - only the directors' edition asks
    try:
        got = sched.directors(reads)
    except _LOUD:
        raise
    except Exception:  # noqa: BLE001 — a list that cannot be read names nobody
        return False
    return bool(got.get("readable")) and any(str(d.get("uid") or "") == uid for d in got.get("list") or [])


# ── the people a master (or an edition's holder) may choose ─────────────────

def accounts(hub: mw.HubBooks) -> list[dict[str, str]]:
    """Every active account a person may be chosen from (snapshot_service._notice_accounts); raises when none."""
    rows = [r for r in hub.users_rows(CORE_USERS_SHEET_ID, "", ()) if isinstance(r, dict)]
    if not rows:
        raise RuntimeError("the users copy holds no rows")
    out = []
    for r in rows:
        uid = str(r.get("user_id") or "").strip()
        role = str(r.get("role") or "").strip().lower()
        if not uid or role not in ACCOUNT_ROLES:
            continue
        if str(r.get("active") or "").strip().upper() in ("FALSE", "0", "NO"):
            continue
        out.append({"uid": uid, "role": role, "types": str(r.get("types") or ""),
                    "label": str(r.get("display_name") or "").strip() or uid,
                    "unlisted": "1" if sc.is_master_email(r.get("email")) else ""})
    return out


def people_list(accs: list[dict[str, str]]) -> list[dict[str, str]]:
    """The chooser: every active account, by its label."""
    return sorted(({"uid": a["uid"], "label": a["label"], "role": a["role"]}
                   for a in accs if not a.get("unlisted")),
                  key=lambda p: (p["label"].lower(), p["uid"]))


# ── the read ────────────────────────────────────────────────────────────────

MY_INBOX_VISIT = "My Inbox reads the signed-in account's own alerts; it is not drawn inside a visit."
MY_INBOX_OWN_ONLY = "My Inbox shows only your own alerts."
# a client-role account is forwarded by the relay to its family view; these are refused there
MY_INBOX_ROLES_REFUSED = ("onboarding", "interviewer")
MASS_WHY = "Signed in as the master account: your own alerts, or any person's you choose, read-only."
# the payload fields the relay hands its own word in
PAYLOAD_MARKS, PAYLOAD_NOTICES, PAYLOAD_NOTICES_ERROR = "inbox_marks", "notices", "notices_error"
PAYLOAD_BOARD, PAYLOAD_BOARD_ERROR, PAYLOAD_SWITCH = "punch_board", "punch_board_error", "test_mode"
# punch_board_error's word for a board the relay has not written
BOARD_MISSING = "missing"


def holder(eid: str, user: dict[str, Any] | None, config: dict[str, str]) -> bool:
    """A holder of one of this app's editions: an employee on its list while its key is on; never the master."""
    return bool(user) and not sc.is_real_master(user) and sc.edition_allows(eid, user or {}, config)


def scope_of(user: dict[str, Any], payload: dict[str, Any], config: dict[str, str] | None = None) -> dict[str, str]:
    """{mode, why[, edition]}: `mass` for the real master's own session (never when the relay asked for own), and
    widened to `mass` for a holder of the any-person edition when the config is at hand; `own` for everyone else."""
    asked = gsjs.trim(gsjs.or_blank(payload.get("mode"))).lower()
    mode = mw.scope_verdict(user.get("role"), sc.is_real_master(user), asked == MODE_OWN)
    said = payload.get("why")
    why = said if isinstance(said, str) and asked == mode else (MASS_WHY if mode == MODE_MASS else "")
    if mode == MODE_OWN and config is not None and user.get("acting") is not True \
            and holder(EDITION_ANYONE, user, config):
        return {"mode": MODE_MASS, "why": EDITION_ANYONE_WHY, "edition": EDITION_ANYONE}
    return {"mode": mode, "why": why}


def _reads_user(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any]) -> tuple[L.Reads, dict[str, Any]]:
    if isinstance(sess_or_reads, L.Session):
        return sess_or_reads.reads, dict(sess_or_reads.user or {})
    return sess_or_reads, dict(scope.get("user") or {})


def _mode_of(reads: L.Reads, user: dict[str, Any], scope: dict[str, Any]) -> tuple[str, str, str]:
    """(mode, why, edition) as this read may answer it: FAIL-CLOSED, any person only for the real master or for a
    holder of the any-person edition now."""
    if scope.get("mode") == MODE_MASS and sc.is_real_master(user):
        return MODE_MASS, str(scope.get("why") or ""), ""
    if scope.get("mode") == MODE_MASS and scope.get("edition") == EDITION_ANYONE \
            and holder(EDITION_ANYONE, user, reads.config()):
        return MODE_MASS, str(scope.get("why") or ""), EDITION_ANYONE
    return MODE_OWN, (str(scope.get("why") or "") if scope.get("mode") == MODE_OWN else ""), ""


def _unread_whose(exc: BaseException) -> mw.Refused:
    """FAIL-CLOSED: nobody's alerts are drawn for an account that could not be read."""
    cause = exc.__cause__ if isinstance(exc, mw.Refused) and exc.__cause__ is not None else exc
    log.warning("my inbox: the account could not be read (%s)", type(cause).__name__)
    return mw.Refused({"status": 502, "reason": "unreadable",
                       "message": f"Whose alerts these are could not be read ({type(cause).__name__}), so nothing is "
                                  f"shown."})


def _who_me(reads: L.Reads, hub: mw.HubBooks, subject: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """(who, me): the reader as shift_requests.viewer builds one, and the subject's own keys read STRICTLY."""
    uid = subject["uid"]
    try:
        row = hub.users_row(CORE_USERS_SHEET_ID, uid) if uid else None
        key = mw.fold((row or {}).get("display_name"))
        namesakes = hub.users_named(CORE_USERS_SHEET_ID, key) if key else []
        name = mw.roster_name_from(row, namesakes, uid)
        if subject["types"] is None:
            subject["types"] = str((row or {}).get("types") or "")
        who = sr.viewer(reads, name=name, role=subject["role"], types=subject["types"],
                        is_master=subject["is_master"])
        me = mw.identity(hub, CORE_USERS_SHEET_ID, uid, roster_name=name)
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _unread_whose(exc) from exc
    return who, me


def _handed_call(payload: dict[str, Any], key: str, err_key: str, missing: Callable[[], Exception] | None
                 ) -> Callable[[], Any] | None:
    """What the relay handed for `key` as a call: its answer, the error it reported, or what a missing one is."""
    if key in payload:
        got = payload.get(key)
        return lambda: got
    err = gsjs.trim(gsjs.or_blank(payload.get(err_key)))
    if err:
        def failed() -> Any:
            raise (missing() if missing is not None and err == BOARD_MISSING else _named_error(err))
        return failed
    if missing is None:
        return None

    def absent() -> Any:
        raise missing()
    return absent


def _held(reads: L.Reads, payload: dict[str, Any]) -> str:
    """Test mode as the relay words it for the bell: the relay's own switch when handed, else read here."""
    given = payload.get(PAYLOAD_SWITCH)
    with effective_roster.use_switch(given if isinstance(given, dict) else None):
        switch = effective_roster.test_mode(reads)
    return ("test mode" + ("" if switch.get("readable") else " (unreadable, so treated as on)")
            if switch.get("on") else "")


def build(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any], marks: Any = None,
          handed: dict[str, Any] | None = None, now: datetime | None = None) -> dict[str, Any]:
    """The lane's data for one session (server/my_inbox.py's board, its display and its scope); `scope` carries the
    person, `marks` the relay's inbox_marks, `handed` the rest of its payload. A chosen person's inbox is read-only.
    A refusal the lane answers raises Refused, and what this service cannot read defers."""
    reads, user = _reads_user(sess_or_reads, scope)
    if gsjs.trim(gsjs.or_blank(user.get("role"))).lower() == "client":
        raise Defer("a client-role account is the relay's family view")
    handed = handed if isinstance(handed, dict) else {}
    now = now or datetime.now(UTC)
    mode, scope_why, edition = _mode_of(reads, user, scope)
    mass = mode == MODE_MASS
    person = gsjs.trim(gsjs.or_blank(scope.get("person"))) if mass else ""
    # a switched session reads the account's own alerts and keeps no mark, as the relay's builder answered it
    switched = user.get("acting") is True
    readonly = bool(person) or switched
    hub = mw.HubBooks(reads)
    cfg = reads.config()
    accs: list[dict[str, str]] | None = None
    people_why = ""
    if mass:
        try:
            accs = accounts(hub)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 - the chooser says so; the session's own alerts still answer
            people_why = f"The accounts could not be read ({type(exc).__name__})."
    if person:
        if accs is None:
            raise mw.Refused({"status": 502, "reason": "unreadable", "message": f"{people_why} Nobody can be chosen."})
        acc = next((a for a in accs if a.get("uid") == person and not (edition and a.get("unlisted"))), None)
        if acc is None:
            raise mw.Refused({"status": 403, "reason": "scope", "message": "That person is not an active account."})
        # judged as that account — its own role and badges, never the session's
        subject = {"uid": acc["uid"], "role": acc["role"], "types": acc.get("types") or "", "is_master": False,
                   "label": acc.get("label") or ""}
    else:
        subject = {"uid": gsjs.trim(gsjs.or_blank(user.get("id"))),
                   "role": gsjs.trim(gsjs.or_blank(user.get("role"))).lower(), "types": None,
                   "is_master": sc.is_real_master(user), "label": ""}
    who, me = _who_me(reads, hub, subject)
    try:
        lanes, lanes_why = mw.lanes_for(hub, mw.MY_WORK_LANES), ""
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 - each source that reads a lane says so; the others answer
        lanes, lanes_why = None, f"the hotline lanes could not be read ({type(exc).__name__})"
    store = Store(hub)
    # the release notes first: access is asked only for the apps their Live lines name
    updates = read_updates(store)
    access = access_for(hub, cfg, subject, (*APPS, *updates_apps(updates)))
    held = _held(reads, handed)
    directors_copy = (not person and not readonly and subject["is_master"] is not True
                      and holder(EDITION_DIRECTORS, user, cfg))
    off: list[str] = []
    if not readonly and (subject["is_master"] is True
                         or (directors_copy and _on_directors_list(reads, subject["uid"]))):
        off = alerts_off(reads, subject["uid"])
    on = now.astimezone(mw.OHIO).date()
    ctx = Ctx(reads=reads, hub=hub, owner=sess_or_reads, subject=subject, me=me, lanes=lanes, lanes_why=lanes_why,
              access=access,
              requests=lambda: mw.requests_for(reads, me=me, who=who, lanes=lanes, lanes_why=lanes_why, on=on, db=hub),
              notices=_handed_call(handed, PAYLOAD_NOTICES, PAYLOAD_NOTICES_ERROR, None), held=held,
              board=_handed_call(handed, PAYLOAD_BOARD, PAYLOAD_BOARD_ERROR, FileNotFoundError),
              now=now, readonly=readonly, marks=marks, updates=updates, alerts_off=off,
              directors_copy=directors_copy, hidden=hidden_sources(sess_or_reads),
              readonly_why=KEPT_WHY_CHOSEN if person else KEPT_WHY_ACTING if switched else "")
    # the marks first: marks not handed, or a store that cannot answer, defer before any source is read
    try:
        ctx.marks()
    except _LOUD:
        raise
    except Exception:  # noqa: BLE001 — said on the answer's marks, every alert unread
        pass
    try:
        data = board(ctx)
    except _LOUD:
        raise
    except mw.Refused:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("my inbox: the board failed (%s)", type(exc).__name__)
        raise mw.Refused({"status": 503, "reason": "unreadable",
                          "message": f"My Inbox could not be put together ({type(exc).__name__})."}) from exc
    # Settings › My Work's Sources switch, judged as My Work judges it; an edition never shows the master's settings
    apply_display(data, mw.display_for(MODE_MASS if mass and not edition else MODE_OWN,
                                       mw.hide_from_lane(mw.hide_lane(reads))))
    data["scope"] = {"mode": mode, "why": scope_why, "person": person, "readonly": readonly}
    if mass:
        data["scope"]["people"] = people_list(accs) if accs is not None else None
        data["scope"]["people_why"] = people_why
    if edition:
        data["scope"]["edition"] = edition
    return data


def _door(sess: L.Session, payload: dict) -> tuple[dict[str, Any], str] | dict[str, Any]:
    """(scope, person) for a session this read serves, or the refusal; what the relay keeps for itself defers."""
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("My Inbox is drawn for a person, never the service")
    if gsjs.trim(gsjs.or_blank(payload.get("member"))) or user.get("visiting_member"):
        return {"status": 403, "reason": "visit", "message": MY_INBOX_VISIT}
    role = gsjs.trim(gsjs.or_blank(user.get("role"))).lower()
    if role in MY_INBOX_ROLES_REFUSED or role == "client":
        raise Defer("the relay refuses this role or forwards it to its family view")
    gate = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    if gate.get("open") is not True:
        raise Defer("App Control does not open My Inbox to this account here")
    scope = scope_of(user, payload, sess.reads.config())
    person = gsjs.trim(gsjs.or_blank(payload.get("person")))
    if person and scope["mode"] != MODE_MASS:
        return {"status": 403, "reason": "scope", "message": MY_INBOX_OWN_ONLY}
    if person and not PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    return scope, person


def my_inbox_view(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myInboxView: GET /hub-lanes/my-inbox off asa-hub-db; the lane decides the scope, widened here only for a
    holder of the any-person edition."""
    got = _door(sess, payload)
    if isinstance(got, dict):
        return got
    scope, person = got
    try:
        return {"status": 200, "data": build(sess, {**scope, "person": person}, payload.get(PAYLOAD_MARKS), payload)}
    except mw.Refused as exc:
        return dict(exc.env)


# the relay's own state the payload hands in (relay_state) is bound for the whole read
ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"myInboxView": relay_state.bound(my_inbox_view)}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "myInboxView": {"roles": POLICY_ROLES,
                    "params": {"person": "string", "mode": "string", "why": "string", "member": "string",
                               "inbox_marks": "object", "notices": "object", "notices_error": "string",
                               "punch_board": "object", "punch_board_error": "string", "test_mode": "object"}}}
