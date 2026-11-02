"""My Work: what is asked of a person and what they have asked, narrowed on the relay before anything leaves.
One door (/hub-lanes/my-work) builds the whole answer."""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Iterator

import psycopg2
import psycopg2.extras

import hub_db
import ist_config
import redaction
import shift_handoff
import shift_requests as sr
import time_off

log = logging.getLogger("hub.my_work")

OHIO = sr.OHIO
UTC = timezone.utc
ESSENCIAL_SHEET_ID = sr.ESSENCIAL_SHEET_ID

MODE_OWN, MODE_MASS = "own", "mass"

# The depot pointers (Essencial Facts, by Subject ID) the mirror-backed sources stand on.
PTR_STATES = "HUB_HOUSE_REQUIREMENT_STATES_ID"
PTR_CATALOGUE = "HUB_HOUSE_REQUIREMENTS_ID"
PTR_APPS = "HUB_APPS_BOOK_ID"
PTR_STAFF_REQUESTS = "HUB_HOUSE_STAFF_REQUESTS_ID"
PTR_PEOPLE = "HUB_HOUSE_PEOPLE_ID"
PTR_SCHED_INBOX = "HUB_HOUSE_SCHED_INBOX_ID"
# Support Requests' items (support_inbox, written by apps-script/SupportDesk.gs): its alerts are My Inbox's, a…
PTR_SUPPORT_INBOX = "HUB_HOUSE_SUPPORT_INBOX_ID"
PTR_VC_INBOX = "HUB_HOUSE_VC_INBOX_ID"
# Employee loans' house (written by apps-script/EmployeeLoans.gs): a loan request waits on each director's seat
PTR_LOANS = "HUB_HOUSE_EMPLOYEE_LOANS_ID"
POINTERS = (PTR_STATES, PTR_CATALOGUE, PTR_APPS, PTR_STAFF_REQUESTS, PTR_PEOPLE, PTR_SCHED_INBOX, PTR_VC_INBOX,
            PTR_SUPPORT_INBOX, PTR_LOANS)
HOUSE_TAB = "Data"
TAB_POLICY_ACKS = "policyAcks"

# Requests.gs REQUESTS_PII_EXACT, plus its block on any key holding 'ssn'.
PII_EXACT = frozenset({"date_of_birth", "dob", "birth_date", "login", "password", "social_security",
                       "social_security_number"})

MASS_CAP = 600
RESOLVED_KEPT = 100
POLICY_SOON_DAYS = 30
# the reads that stop at a row count say so when they reach it
HANDOFF_LIMIT = 400
SHIFT_LIMIT = 5000
# a mirrored copy older than this many days names its day on the source line
MIRROR_OLD_DAYS = 2
NO_REF_WHY = "The source keeps no id for it."

STATE_READY, STATE_UNREADABLE, STATE_NOT_ATTRIBUTABLE = "ready", "unreadable", "not_attributable"
OPEN, RESOLVED, RECORDED = "open", "resolved", "recorded"
TONE_OVERDUE, TONE_SOON, TONE_LATER = "overdue", "soon", "later"

# Checks HR runs on a person (the catalogue's own categories): counted, never listed as asked of them.
HR_CATEGORIES = frozenset({"background", "admin"})
LISTED_STATES = ("expired", "expiring")
OWED_STATES = frozenset({"expired", "expiring", "missing"})
FLOW_OF = {"training": "Training renewal", "documents": "Document renewal", "onboarding": "Onboarding paperwork"}

# The Conditions vocabulary: a family names what the button does.
FAMILY_LABEL = {"asset": "Upload asset", "credential": "Upload asset", "decision": "Enter decision",
                "form": "Complete form", "report": "Complete form", "event": "Book training"}

ACTION_SOURCES = (
    ("requirements", "Compliance requirements"),
    ("ist", "Client training (IST)"),
    ("policies", "Policy acknowledgements"),
    ("transfers", "Shift transfers to answer"),
    ("time_off_decisions", "Time off decisions"),
    ("transfer_decisions", "Shift transfer approvals"),
    ("scheduling", "Scheduling approvals"),
    ("vehicle_calendar", "Vehicle requests"),
    ("support_desk", "Support Requests"),
    ("employee_loans", "Employee loan requests"),
)
REQUEST_SOURCES = (
    ("time_off", "Time off"),
    ("support_requests", "Support Requests Queue"),
    ("hotline", "Phone requests"),
    ("shift_requests", "Shift applications"),
    ("transfers_out", "Shift transfers offered"),
    ("call_offs", "Call-offs"),
    ("incidents", "Incident reports"),
    ("house_repairs", "House repairs"),
)
LABELS = dict(ACTION_SOURCES + REQUEST_SOURCES)

TARGET_ROSTER = {"app": "employee-tracker", "page": "roster", "href": "/app/employee-tracker/roster"}
TARGET_POLICIES = {"app": "policy-acks", "page": "documents", "href": "/app/policy-acks/documents"}
TARGET_SWAPS = {"app": "calendarbuilder", "page": "swaps", "href": "/app/calendarbuilder/swaps"}
LINK_SUPPORT = {"app": "support-requests", "page": "queue", "href": "/app/support-requests/queue",
                "label": "Open in Support Requests Queue"}
LINK_HOTLINE = {"app": "hotline", "page": "desk", "href": "/app/hotline/desk", "label": "Open in the Hotline"}
LINK_SWAPS = {**TARGET_SWAPS, "label": "Open in Swaps"}
TARGET_SCHEDULING = {"app": "scheduling", "page": "calendar", "href": "/app/scheduling/calendar"}

# Scheduling's own items (sched_inbox, written by apps-script/SchedulingFlows.gs): an approval waits in My Work on…
SCHED_BOX_WORK, SCHED_WAITING = "work", "waiting"
SCHED_WORDS = ["Approve", "Decline"]
SCHED_PHASE = {"director": "Director approval", "house_manager": "House manager approval"}
SCHED_TEST_MODE = frozenset({"yes", "on", "true"})

# Transportation's items (vc_inbox, written by apps-script/VehicleCalendarFlows.gs): a vehicle request waits in My…
TARGET_VEHICLE_CALENDAR = {"app": "vehicle-calendar", "page": "calendar", "href": "/app/vehicle-calendar/calendar"}
VC_ANSWER = "vehicleCalendarAnswer"
VC_DECIDE_HREF = "/app/my-work"
VC_FACTS_MAX, VC_LABEL_MAX, VC_VALUE_MAX = 12, 40, 240

# Support Requests' redirects (support_inbox box 'work'): one request waits on the one account it was redirected to…
TARGET_SUPPORT_DESK = {"app": "support-desk", "page": "requests", "href": "/app/support-desk/requests"}
SR_ANSWER = "supportDeskDecide"
TARGET_STAFF = {"app": "staff-profiles", "page": "profile", "href": "/app/staff-profiles/profile"}
EL_ANSWER = "employeeLoanAnswer"
SR_WORDS = ["Approve", "Deny", "Resolved", "Redirect"]
SR_PHASE = {"redirect": "Redirected"}

ALL_STAFF = "All staff"
POLICY_OWED = frozenset({"pending", "overdue"})
POLICY_DONE = frozenset({"read", "signed"})

QUEUE_OPEN = frozenset({"", "new", "pending"})
QUEUE_DONE = frozenset({"resolved", "closed", "done", "complete", "completed"})
CALL_OFF_TYPES = {"call off": "Call Off", "late show": "Late Show"}

REPAIRS_WHY = {MODE_OWN: "House repair requests keep no reporter column, so none can be shown as yours.",
               MODE_MASS: "House repair requests keep no reporter column, so none can be named to a person."}

# Settings > My Work (AlertsConfig.gs MYWORK_HIDE_KEYS), carried on the config lane: the parts the master hides from…
HIDE_PARTS = ("header", "source_notes", "missing_row", "completed", "inbox_sources")
HIDE_NOT_YET = "the display settings have not reached this server yet"


class Unreadable(RuntimeError):
    """A source that could not be read: its sentence, never an empty list."""


class NotAttributable(RuntimeError):
    """A source whose rows carry no key that ties them to a person."""

    def __init__(self, why: str, *, structural: bool = False) -> None:
        super().__init__(why)
        self.structural = structural


# ── the scope ───────────────────────────────────────────────────────────────

def hide_from_lane(lane: dict[str, Any] | None) -> dict[str, Any]:
    """{parts, readable, why} from the config lane. Anything missing or unreadable hides nothing."""
    parts = {p: False for p in HIDE_PARTS}
    if not isinstance(lane, dict):
        return {"parts": parts, "readable": False, "why": HIDE_NOT_YET}
    broken = _text(lane.get("my_work_hide_unreadable"), 200)
    if broken:
        return {"parts": parts, "readable": False, "why": f"the display settings could not be read ({broken})"}
    block = lane.get("my_work_hide")
    if not isinstance(block, dict):
        return {"parts": parts, "readable": False, "why": HIDE_NOT_YET}
    return {"parts": {p: block.get(p) is True for p in HIDE_PARTS}, "readable": True, "why": ""}


def display_for(mode: str, hide: dict[str, Any]) -> dict[str, Any]:
    """What this session is shown."""
    if mode == MODE_MASS:
        return {"hidden": {p: False for p in HIDE_PARTS}, "for_users": dict(hide["parts"]),
                "readable": bool(hide["readable"]), "why": str(hide["why"] or "")}
    return {"hidden": dict(hide["parts"])}


def scope_verdict(role: Any, flag: bool | None, acting: bool) -> str:
    """`mass` only for the master's own admin session, never while acting; every other case is `own`."""
    return MODE_MASS if (str(role or "").strip().lower() == "admin" and flag is True and not acting) \
        else MODE_OWN


# ── small words ─────────────────────────────────────────────────────────────

def fold(name: Any) -> str:
    return sr.fold(name)


def digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def last10(value: Any) -> str:
    d = digits(value)[-10:]
    return d if len(d) >= 7 else ""


def _text(value: Any, limit: int = 400) -> str:
    return " ".join(str(value if value is not None else "").split())[:limit]


def _low(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_marker(value: Any) -> bool:
    return redaction.is_marker_value(str(value or ""))


def _word(raw: Any) -> str:
    text = _text(raw, 80).replace("_", " ")
    return text[:1].upper() + text[1:] if text else ""


def today() -> date:
    return datetime.now(OHIO).date()


_MDY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b")
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")


def _instant(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    text = str(raw or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", text):
        return None
    try:
        got = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


def day_of(raw: Any) -> date | None:
    """A calendar day from an ISO day, an ISO instant (its Ohio day) or a sheet's M/D/YYYY; else None."""
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    at = _instant(raw)
    if at is not None:
        return at.astimezone(OHIO).date()
    text = str(raw or "").strip()
    try:
        m = _ISO_DAY.match(text)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = _MDY.match(text)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None
    return None


def when_of(raw: Any) -> str:
    """An instant as UTC ISO, a day as YYYY-MM-DD, '' when unreadable."""
    at = _instant(raw)
    if at is not None:
        return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = day_of(raw)
    return d.isoformat() if d else ""


def _stamp_words(raw: Any) -> str:
    at = _instant(raw)
    if at is None:
        d = day_of(raw)
        return f"{d.strftime('%b')} {d.day}, {d.year}" if d else _text(raw, 60)
    local = at.astimezone(OHIO)
    hour = local.hour % 12 or 12
    return f"{local.strftime('%b')} {local.day}, {local.year} {hour}:{local.minute:02d} " \
           f"{'AM' if local.hour < 12 else 'PM'}"


def _day_words(d: date | None) -> str:
    return f"{d.strftime('%a')} {d.month}/{d.day}" if d else ""


def tone_of(day: date | None, on: date, soon_days: int, *, today_is_overdue: bool = False) -> str:
    if day is None:
        return ""
    if day < on or (today_is_overdue and day <= on):
        return TONE_OVERDUE
    if day <= on + timedelta(days=max(0, int(soon_days))):
        return TONE_SOON
    return TONE_LATER


def pairs(*items: tuple[str, Any]) -> list[dict[str, str]]:
    """Detail pairs; a blank or withheld value is left out."""
    out = []
    for label, value in items:
        text = _text(value, 1200)
        if text and not _is_marker(text):
            out.append({"label": label, "value": text})
    return out


def clean(row: dict[str, Any] | None) -> dict[str, Any]:
    """A source row as it may be used: the redaction law applied, the support queue's PII keys dropped."""
    got, _n = redaction.redact_row(dict(row or {}))
    out = {}
    for k, v in got.items():
        norm = re.sub(r"[^a-z0-9]+", "_", str(k).lower()).strip("_")
        if norm in PII_EXACT or "ssn" in norm or redaction.is_marker_name(k):
            continue
        out[k] = v
    return out


def _json_list(cell: Any) -> list[Any]:
    if isinstance(cell, list):
        return cell
    text = str(cell or "").strip()
    if text.startswith("["):
        try:
            got = json.loads(text)
        except ValueError:
            return []
        return got if isinstance(got, list) else []
    return [p for p in re.split(r"[,;]+", text) if p.strip()]


def _sha10(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10].upper()


def copied_whole(book: dict[str, Any] | None) -> bool:
    """Whether the mirror's own word on a book says its last copy finished after the book last changed: a tab…"""
    if not isinstance(book, dict) or _low(book.get("last_sync_status")) != "ok":
        return False
    changed, copied = _instant(book.get("modified_time")), _instant(book.get("last_sync_at"))
    return changed is not None and copied is not None and changed <= copied


# ── who is asking ───────────────────────────────────────────────────────────

def _live(row: dict[str, Any]) -> bool:
    return (str(row.get("active") or "").strip().upper() not in ("FALSE", "0", "NO")
            and not str(row.get("merged_into") or "").strip())


def row_emails(row: dict[str, Any] | None) -> set[str]:
    """An account row's addresses, lower-cased; a withheld cell is never an address."""
    row = row if isinstance(row, dict) else {}
    out: set[str] = set()
    for e in [row.get("email"), *_json_list(row.get("emails"))]:
        k = _low(e)
        if "@" in k and not _is_marker(k):
            out.add(k)
    return out


def row_phones(row: dict[str, Any] | None) -> set[str]:
    """An account row's phones, each by its last ten digits."""
    row = row if isinstance(row, dict) else {}
    out: set[str] = set()
    for p in [row.get("phone"), *_json_list(row.get("phones"))]:
        d = last10(p.get("number") if isinstance(p, dict) else p)
        if d:
            out.add(d)
    return out


def _name_words(name: Any) -> list[str]:
    """A name's words, lower-cased; initials are left out."""
    return [w for w in re.findall(r"[a-z0-9]+", str(name or "").lower()) if len(w) > 1]


def _one_edit(a: str, b: str) -> bool:
    """Whether two words differ by at most one letter added, dropped or changed."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = j = diff = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        diff += 1
        if diff > 1:
            return False
        if len(a) == len(b):
            i += 1
        j += 1
    return diff + (len(b) - j) + (len(a) - i) <= 1


def same_spelling(a: Any, b: Any) -> bool:
    """Whether two spellings can be one person's name: every word of the shorter is in the longer (a word of five…"""
    x, y = _name_words(a), _name_words(b)
    if len(x) < 2 or len(y) < 2:
        return False
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    return all(w in long_ or (len(w) >= 5 and any(len(o) >= 5 and _one_edit(w, o) for o in long_))
               for w in short)


def identity_from(row: dict[str, Any] | None, uid: str, *, roster_name: str,
                  people: list[dict[str, Any]] | None = None, people_why: str = "",
                  shared: Callable[[str], bool] | None = None,
                  phones_taken: set[str] | frozenset[str] | None = frozenset(),
                  phones_taken_why: str = "",
                  emails_taken: set[str] | frozenset[str] | None = frozenset(),
                  emails_taken_why: str = "") -> dict[str, Any]:
    """The keys this account's rows may be matched on — pure over the users row and the people roster."""
    row = row if isinstance(row, dict) else {}
    display = _text(row.get("display_name"), 120)
    # Keys come only from what the account cannot set for itself: the sign-in e-mail.
    sign_in = _low(row.get("email"))
    raw_emails = {sign_in} if "@" in sign_in and not _is_marker(sign_in) else set()
    raw_phones: set[str] = set()
    # a display name the account set for itself is a key only when the roster row reached through the sign-in e-mail…
    self_named = _low(row.get("name_by") or row.get("nameby")) == "self"
    notes = []
    if emails_taken is None:
        emails: set[str] = set()
        if raw_emails:
            notes.append(f"whether another account shares your e-mail could not be read "
                         f"({emails_taken_why or 'no answer'}), so no e-mail is matched")
    else:
        emails = raw_emails - set(emails_taken)
        if raw_emails & set(emails_taken):
            notes.append("an e-mail on this account is on another account too, so it matches nothing")
    if phones_taken is None:
        phones: set[str] = set()
        notes.append(f"whether another account shares your phone could not be read "
                     f"({phones_taken_why or 'no answer'}), so no phone is matched")
    else:
        phones = raw_phones - set(phones_taken)
        if raw_phones & set(phones_taken):
            notes.append("a phone on this account is on another account too, so it matches nothing")
    keys: set[str] = set()
    key = fold(roster_name)
    if key:
        keys.add(key)
    why = ""
    if not key:
        if not row:
            why = "this account has no row in the accounts mirror, so rows filed by name cannot be claimed"
        elif not fold(display):
            why = "this account carries no name, so rows filed by name cannot be claimed"
        elif not _live(row):
            why = "this account is not active, so rows filed by name cannot be claimed"
        else:
            why = "your name is shared with another account, so rows filed by name alone cannot be claimed"
    bridged = ""
    if people is None:
        if people_why:
            notes.append(f"the people roster could not be read ({people_why}), so it adds no key")
        if self_named and key:
            # FAIL-CLOSED: a self-set name cannot be confirmed without the roster
            keys.discard(key)
            key = ""
            why = why or "your name was set on your own profile and the roster could not be read to confirm it"
    else:
        by_mail = {str(p.get("id") or id(p)): p for p in people
                   if _low(p.get("email")) and _low(p.get("email")) in emails}
        if self_named and key:
            mail_names = {fold(p.get("name")) for p in by_mail.values()}
            if len(by_mail) != 1 or key not in mail_names:
                keys.discard(key)
                notes.append("your name was set on your own profile and the roster row carrying your sign-in "
                             "e-mail does not carry it, so rows filed by name are not matched to it")
                key = ""
                why = why or ("your name was set on your own profile, so rows filed by name are matched only "
                              "through the roster row carrying your sign-in e-mail")
        named = [p for p in people if key and fold(p.get("name")) == key]
        hits = dict(by_mail)
        if len(hits) == 1:
            hit_id, hit = next(iter(hits.items()))
            how = "e-mail" if hit_id in by_mail else "phone"
            cand = fold(hit.get("name"))
            if cand and cand not in keys:
                if named:
                    notes.append(f"the people roster row carrying your {how} is not the one under your own name, "
                                 f"so it adds no key")
                elif not same_spelling(display or roster_name, hit.get("name")):
                    notes.append(f"the people roster row carrying your {how} is under a name that does not "
                                 f"match yours, so it adds no key")
                elif shared is not None and shared(cand):
                    notes.append("the people roster names you as somebody whose name another account shares, "
                                 "so it adds no key")
                else:
                    keys.add(cand)
                    bridged = _text(hit.get("name"), 120)
                    notes.append(f"your rows are also matched under “{bridged}”, the people roster's spelling "
                                 f"on the row carrying your {how}")
        if len(named) == 1:
            d = last10(named[0].get("phone"))
            if d and phones_taken is not None and d not in phones_taken:
                phones.add(d)
    if bridged and why:
        why = ""
    return {"uid": str(uid or ""), "name": display, "roster_name": roster_name if key else "",
            "keys": sorted(keys), "emails": sorted(emails), "phones": sorted(phones),
            "key_why": why, "bridged": bridged, "notes": notes}


def identity(dsn: str, core_sheet_id: str, uid: str, *, roster_name: str, db: Any = None) -> dict[str, Any]:
    """STRICT: the account's own users row; a failed read raises and nobody's rows are drawn."""
    own_db = db is None
    db = db if db is not None else PgMirror(dsn)
    try:
        row = db.users_row(core_sheet_id, uid)
        emails = sorted(row_emails(row))
        phones = sorted(row_phones(row))
        people, people_why = None, ""
        try:
            sid = db.pointers().get(PTR_PEOPLE, "")
            if not sid:
                people_why = f"the depot declares no {PTR_PEOPLE}"
            else:
                people, total, _at = db.tab(
                    sid, HOUSE_TAB,
                    f"{_low_f('email')} = ANY(%s) OR {_last10_f('phone')} = ANY(%s) OR {_fold_f('name')} = %s",
                    (emails, phones, fold(roster_name) or NO_KEY))
                if not total:
                    people, people_why = None, "the people roster is declared but not mirrored yet"
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the roster adds no key, and says so
            people, people_why = None, (str(exc) if isinstance(exc, Unreadable) else type(exc).__name__)

        def shared(key: str) -> bool:
            return db.namesakes(core_sheet_id, key, uid) > 0

        # every phone that could become a key: the account's own and the roster rows just read
        cands = set(phones) | {last10(p.get("phone")) for p in (people or [])}
        cands.discard("")
        taken: set[str] | None = set()
        taken_why = ""
        if cands:
            try:
                taken = db.phones_elsewhere(core_sheet_id, uid, sorted(cands))
            except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: no phone is a key, and the notes say so
                taken, taken_why = None, (str(exc) if isinstance(exc, Unreadable) else type(exc).__name__)
        mails_taken: set[str] | None = set()
        mails_why = ""
        if emails:
            try:
                mails_taken = db.emails_elsewhere(core_sheet_id, uid, emails)
            except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: no e-mail is a key, and the notes say so
                mails_taken, mails_why = None, (str(exc) if isinstance(exc, Unreadable) else type(exc).__name__)
        return identity_from(row, uid, roster_name=roster_name, people=people, people_why=people_why,
                             shared=shared, phones_taken=taken, phones_taken_why=taken_why,
                             emails_taken=mails_taken, emails_taken_why=mails_why)
    finally:
        if own_db:
            db.close()


# ── the reads, on one read-only connection per board ──────────────────────── The SQL narrows what is fetched and…

def _f(name: str) -> str:
    """One field of a mirrored row as text; `name` is a constant of this file, never input."""
    return f"coalesce(data->>'{name}', '')"


def _fold_f(name: str) -> str:
    return f"regexp_replace(lower({_f(name)}), '[^a-z0-9]+', '', 'g')"


def _low_f(name: str) -> str:
    return f"lower(btrim({_f(name)}))"


def _last10_f(name: str) -> str:
    return f"right(regexp_replace({_f(name)}, '[^0-9]', '', 'g'), 10)"


# A folded cell holds only [a-z0-9], so this never equals one: a blank key matches nothing.
NO_KEY = "-"
_FOLD_COL = "regexp_replace(lower(coalesce({}, '')), '[^a-z0-9]+', '', 'g')"


class PgMirror:
    """Every read My Work makes. Errors propagate to the one source that asked (FAIL-CLOSED there)."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._conn = None
        self._pointers: dict[str, str] | None = None

    def _cursor(self):
        if self._conn is None:
            conn = psycopg2.connect(self.dsn, connect_timeout=5)
            # each statement on its own: one source's failed read never poisons another's
            conn.set_session(readonly=True, autocommit=True)
            self._conn = conn
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    @contextlib.contextmanager
    def _own(self) -> Iterator[Any]:
        """A cursor where the relay's own tables are: asa-hub-db's pool once they moved, else the mirror's."""
        if not hub_db.on():
            with self._cursor() as cur:
                yield cur
            return
        with hub_db.connect(self.dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001 — already gone
                pass
            self._conn = None

    def users_row(self, core_sheet_id: str, uid: str) -> dict[str, Any] | None:
        with self._cursor() as cur:
            cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='users' "
                        "AND data->>'user_id' = %s LIMIT 1", (core_sheet_id, str(uid)))
            got = cur.fetchone()
        return got["data"] if got and isinstance(got.get("data"), dict) else None

    def namesakes(self, core_sheet_id: str, key: str, uid: str) -> int:
        """Live accounts other than `uid` whose display name folds to `key`."""
        with self._cursor() as cur:
            cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='users' "
                        f"AND {_fold_f('display_name')} = %s", (core_sheet_id, key))
            rows = [r["data"] for r in cur.fetchall() if isinstance(r.get("data"), dict)]
        return sum(1 for r in rows if _live(r) and str(r.get("user_id") or "") != str(uid))

    def phones_elsewhere(self, core_sheet_id: str, uid: str, phones: list[str]) -> set[str]:
        """Which of `phones` a live account other than `uid` also carries (exact last ten digits)."""
        with self._cursor() as cur:
            # the digit run of both cells narrows the fetch; the exact match is made below
            cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='users' "
                        "AND coalesce(data->>'user_id', '') <> %s AND regexp_replace(coalesce(data->>'phone', '') "
                        "|| coalesce(data->>'phones', ''), '[^0-9]', '', 'g') LIKE ANY(%s)",
                        (core_sheet_id, str(uid), [f"%{p}%" for p in phones] or [NO_KEY]))
            rows = [r["data"] for r in cur.fetchall() if isinstance(r.get("data"), dict)]
        wanted = set(phones)
        out: set[str] = set()
        for r in rows:
            if _live(r) and str(r.get("user_id") or "") != str(uid):
                out |= row_phones(r) & wanted
        return out

    def emails_elsewhere(self, core_sheet_id: str, uid: str, emails: list[str]) -> set[str]:
        """Which of `emails` a live account other than `uid` also carries (exact, lower-cased)."""
        # LIKE's own escape first: the pattern may widen the fetch, never narrow it
        likes = ["%" + e.replace("\\", "\\\\") + "%" for e in emails] or [NO_KEY]
        with self._cursor() as cur:
            cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='users' "
                        "AND coalesce(data->>'user_id', '') <> %s AND (lower(btrim(coalesce(data->>'email', ''))) "
                        "= ANY(%s) OR lower(coalesce(data->>'emails', '')) LIKE ANY(%s))",
                        (core_sheet_id, str(uid), list(emails) or [NO_KEY], likes))
            rows = [r["data"] for r in cur.fetchall() if isinstance(r.get("data"), dict)]
        wanted = set(emails)
        out: set[str] = set()
        for r in rows:
            if _live(r) and str(r.get("user_id") or "") != str(uid):
                out |= row_emails(r) & wanted
        return out

    def pointers(self) -> dict[str, str]:
        """pointer → the house it declares; raises Unreadable when the depot's Facts are not mirrored."""
        if self._pointers is not None:
            return self._pointers
        with self._cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='Facts'",
                        (ESSENCIAL_SHEET_ID,))
            if not int((cur.fetchone() or {}).get("n") or 0):
                raise Unreadable("the depot's Facts are not in the mirror, so no house can be found")
            cur.execute("SELECT data->>'Subject ID' AS s, data->>'Value' AS v FROM asa_drive_sheets_rows "
                        "WHERE sheet_id=%s AND tab_name='Facts' AND data->>'Subject ID' = ANY(%s) "
                        "ORDER BY ingested_at DESC", (ESSENCIAL_SHEET_ID, list(POINTERS)))
            rows = cur.fetchall()
        out: dict[str, str] = {}
        for r in rows:
            s, v = str(r.get("s") or ""), str(r.get("v") or "").strip()
            if s and s not in out:
                out[s] = v
        self._pointers = out
        return out

    def tab(self, sheet_id: str, tab: str, where: str = "", args: tuple = ()) -> tuple[list[dict], int, str]:
        """(rows matching `where`, rows in the tab at all, when the tab was last mirrored)."""
        with self._cursor() as cur:
            cur.execute("SELECT count(*) AS n, max(ingested_at) AS at FROM asa_drive_sheets_rows "
                        "WHERE sheet_id=%s AND tab_name=%s", (sheet_id, tab))
            got = cur.fetchone() or {}
            total = int(got.get("n") or 0)
            at = got.get("at")
            rows: list[dict] = []
            if total:
                cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name=%s"
                            + (f" AND ({where})" if where else "") + " ORDER BY row_number",
                            (sheet_id, tab, *args))
                rows = [r["data"] for r in cur.fetchall() if isinstance(r.get("data"), dict)]
        return rows, total, when_of(at) if at else ""

    def book(self, sheet_id: str) -> dict[str, Any] | None:
        """The mirror's own word on a book: when Drive last changed it, and how its last copy went."""
        with self._cursor() as cur:
            cur.execute("SELECT modified_time, last_sync_at, last_sync_status FROM asa_drive_sheets_meta "
                        "WHERE sheet_id=%s", (sheet_id,))
            got = cur.fetchone()
        return dict(got) if got else None

    def ist_rows(self) -> tuple[list[dict], str]:
        """The declared IST house, both tab spellings (shift_requests._ist_rows)."""
        with self._cursor() as cur:
            return sr._ist_rows(cur)

    def shift_requests(self, keys: list[str] | None, limit: int = SHIFT_LIMIT) -> list[dict]:
        """The relay's own shift requests, the newest `limit` — only these keys' rows when keys are given."""
        with self._own() as cur:
            cur.execute("SELECT to_regclass('asa_shift_requests') IS NOT NULL AS here, "
                        "to_regclass('asa_shift_pool') IS NOT NULL AS pool")
            got = cur.fetchone() or {}
            if not got.get("here"):
                return []
            pool = bool(got.get("pool"))
            where, args = "", ()
            if keys is not None:
                where, args = f" WHERE {_FOLD_COL.format('r.person')} = ANY(%s)", (list(keys) or [NO_KEY],)
            cur.execute(
                "SELECT r.id, r.kind, r.location, r.open_row, r.col_iso, r.value, r.person, r.state, r.why, "
                "r.via, r.ref, r.decided_by, r.decided_at, r.created_at, r.extra"
                + (", p.ref AS pool_ref, p.location AS pool_location" if pool else "")
                + " FROM asa_shift_requests r"
                + (" LEFT JOIN asa_shift_pool p ON p.location = r.location AND p.open_row = r.open_row "
                   "AND p.col_iso = r.col_iso" if pool else "")
                + where + " ORDER BY r.created_at DESC LIMIT %s", (*args, int(limit)))
            return [dict(r) for r in cur.fetchall()]

    def call_off_pool(self, days: list[str], keys: list[str] | None) -> list[dict]:
        """The call-off shifts the relay pooled on these days — only these callers' when keys are given."""
        with self._own() as cur:
            cur.execute("SELECT to_regclass('asa_shift_pool') IS NOT NULL AS here")
            if not (cur.fetchone() or {}).get("here"):
                return []
            where, args = "kind=%s AND col_iso = ANY(%s)", [sr.KIND_CALLOFF, list(days)]
            if keys is not None:
                where += f" AND {_FOLD_COL.format('open_row')} = ANY(%s)"
                args.append(list(keys) or [NO_KEY])
            cur.execute("SELECT location, open_row, col_iso, ref, filled_by, closed_at FROM asa_shift_pool "
                        f"WHERE {where}", tuple(args))
            return [dict(r) for r in cur.fetchall()]


# ── the context every reader shares ─────────────────────────────────────────

class Ctx:
    """What every reader shares."""

    def __init__(self, dsn: str, *, mode: str, me: dict[str, Any], who: dict[str, Any],
                 lanes: dict[str, Any] | None, lanes_why: str, on: date, db: Any, only: str = "") -> None:
        self.dsn, self.mode, self.me, self.who, self.db, self.today = dsn, mode, me, who or {}, db, on
        self.lanes, self.lanes_why = lanes, lanes_why
        self.only = only if mode == MODE_MASS else ""
        self.keys = set(me.get("keys") or [])
        self.emails = set(me.get("emails") or [])
        self.phones = set(me.get("phones") or [])
        self._held: dict[str, Any] = {}
        self.support_keys: set[str] = set()
        self.queue_keys: set[str] = set()
        # phone requests listed under their Support twin, and the rest of the phone source's note
        self.twin_keys: list[str] = []
        self.hotline_line_note = ""

    @property
    def own(self) -> bool:
        return self.mode == MODE_OWN

    def upload_name(self) -> str:
        """The name an own upload is filed under: one that is this account's alone, or ''."""
        return self.me.get("roster_name") or self.me.get("bridged") or ""

    def _once(self, key: str, fn: Callable[[], Any]) -> Any:
        if key not in self._held:
            try:
                self._held[key] = ("ok", fn())
            except Exception as exc:  # noqa: BLE001 — re-raised to every reader that needs it
                self._held[key] = ("err", exc)
        kind, got = self._held[key]
        if kind == "err":
            raise got
        return got

    def house(self, pointer: str, what: str) -> str:
        pointers = self._once("pointers", self.db.pointers)
        sid = pointers.get(pointer, "")
        if not sid:
            raise Unreadable(f"no house is declared for {what} (the depot's newest {pointer} is blank)"
                             if pointer in pointers else
                             f"no house is declared for {what} (the depot carries no {pointer})")
        return sid

    def house_rows(self, pointer: str, tab: str, what: str, where: str = "",
                   args: tuple = ()) -> tuple[list[dict], str]:
        """(rows, as_of) from the declared house only; a house not mirrored yet is Unreadable, never []."""
        sid = self.house(pointer, what)
        rows, total, as_of = self.db.tab(sid, tab, where, args)
        if not total:
            raise Unreadable(f"the {what} house is declared but not mirrored yet")
        return rows, as_of

    def time_off_view(self) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            v = time_off.view(self.dsn)
            if not v.get("minted"):
                raise Unreadable(f"{time_off.NOT_SET_UP}, so no time off can be read")
            return v
        return self._once("time_off", read)

    def managers(self) -> dict[str, Any]:
        try:
            return self._once("managers", lambda: sr.house_managers(self.dsn))
        except Exception as exc:  # noqa: BLE001 — leg_for reads an unreadable list as such
            return {"readable": False, "why": type(exc).__name__, "by_code": {}}

    def handoffs(self, where: str = "", args: tuple = ()) -> tuple[list[dict], dict[str, str], str]:
        """(rows, training states, note): the newest HANDOFF_LIMIT transfers, and a note when that many came."""
        rows, states = shift_handoff.rows_for(self.dsn, where=where, args=args, limit=HANDOFF_LIMIT)
        note = (f"only the newest {HANDOFF_LIMIT} transfers are read, so older ones are not shown"
                if len(rows) >= HANDOFF_LIMIT else "")
        return rows, states, note

    def pending_handoffs(self) -> tuple[list[dict], dict[str, str], str]:
        return self._once("handoffs", lambda: self.handoffs("state=%s", (shift_handoff.PENDING,)))

    def copy_words(self, as_of: str) -> str:
        """A mirrored copy older than MIRROR_OLD_DAYS names its day; a recent one says nothing."""
        d = day_of(as_of)
        if d is None or (self.today - d).days <= MIRROR_OLD_DAYS:
            return ""
        return (f"the copy read here was mirrored {d.strftime('%b')} {d.day}, {d.year} — "
                f"anything filed since may not show yet")

    def own_lines(self, rows: Iterable[dict], phone_of: Callable[[dict], Any],
                  name_of: Callable[[dict], Any]) -> set[str]:
        """The account's phones that are its own within one source: every row carrying one names nobody or the…"""
        seen: dict[str, set[str]] = {}
        for r in rows:
            p = last10(phone_of(r))
            if p and p in self.phones:
                seen.setdefault(p, set()).add(fold(name_of(r)))
        return {p for p, names in seen.items() if all(not n or n in self.keys for n in names)}

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
        return [r for r in rows if isinstance(r, dict)], str(lane.get("read_at") or ""), stale

    def mine_name(self, name: Any) -> bool:
        return bool(fold(name)) and fold(name) in self.keys

    def need_keys(self, *, contact: bool = False) -> None:
        """Own mode with nothing to match on is not an empty source: it is one that cannot be attributed."""
        if not self.own:
            return
        if self.keys or (contact and (self.emails or self.phones)):
            return
        raise NotAttributable(self.me.get("key_why") or "this account has no key rows can be matched on")


# ── the rows ────────────────────────────────────────────────────────────────

def action_row(rid: str, *, person: Any, due: date | None, tone: str, due_why: str, condition: str,
               flow: str, phase: str, family: str, target: dict[str, Any] | None, action_why: str,
               details: list[dict[str, str]], everyone: bool = False) -> dict[str, Any]:
    act = None
    if target is not None:
        act = {"label": target.get("label") or FAMILY_LABEL.get(family, "Open"), "kind": target.get("kind", "link"),
               "app": target.get("app", ""), "page": target.get("page", ""), "href": target.get("href", ""),
               "certs": list(target.get("certs") or []), "upload_for": target.get("upload_for", "")}
        if act["kind"] == "decide":
            act["item_id"] = str(target.get("item_id") or "")
            act["words"] = list(target.get("words") or [])
            if target.get("action"):
                act["action"] = str(target["action"])
            act["item"] = dict(target.get("item") or {})
    return {"id": rid, "_person": _text(person, 120), "_everyone": everyone,
            "due": due.isoformat() if due else "", "due_tone": tone if due else "",
            "due_why": "" if due else (due_why or "No date on file."),
            "condition": _text(condition, 240), "flow": flow, "phase": phase, "family": family,
            "action": act, "action_why": action_why, "details": details}


def is_concluded(status_class: str, day: date | None, on: date) -> bool:
    """Concluded for Settings > My Work: resolved, or recorded about a day before `on` (the Ohio today)."""
    return status_class == RESOLVED or (status_class == RECORDED and day is not None and day < on)


def request_row(rid: str, *, person: Any, ref: str, text: str, submitted: Any, status_class: str,
                status_word: str, details: list[dict[str, str]], link: dict[str, str] | None = None,
                submitted_why: str = "", ref_why: str = "", concluded: bool | None = None) -> dict[str, Any]:
    """`concluded` is the builder's is_concluded verdict; a source with no event day leaves it to the class."""
    when = when_of(submitted)
    ref = _text(ref, 80)
    return {"id": rid, "_person": _text(person, 120), "_everyone": False,
            "_concluded": status_class == RESOLVED if concluded is None else bool(concluded), "ref": ref,
            "ref_why": "" if ref else (ref_why or NO_REF_WHY),
            "request": _text(text, 240), "submitted": when,
            "submitted_why": "" if when else (submitted_why or "The source keeps no readable date for it."),
            "status": {"class": status_class, "word": _text(status_word, 160)},
            "details": details, "link": dict(link) if link else None}


def _got(rows: list[dict], as_of: str = "", note: str = "", stale_why: str = "",
         copy_why: str = "", gap: str = "") -> dict[str, Any]:
    """A source's answer."""
    return {"rows": rows, "as_of": as_of, "note": note, "stale_why": stale_why, "copy_why": copy_why, "gap": gap}


LINE_CALLED = "made from a phone line other names also use"
LINE_RECORDED = "recorded under a phone other names share"


def _line_note(n: int, what: str, how: str = LINE_CALLED) -> str:
    """Nameless rows only a shared phone line ties to the account, counted in words — never claimed."""
    return (f"{_plural(n, what)} with no name, {how}, {'is' if n == 1 else 'are'} not claimed as yours"
            if n else "")


def _nth_ref(base: str, n: int) -> str:
    """The same request logged again keeps its ref with a count, so no two rows share one."""
    return base if n <= 1 else f"{base}-{n}"


def _join(*notes: str) -> str:
    return "; ".join(n for n in notes if n)


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# ── MY ACTIONS ──────────────────────────────────────────────────────────────

def _catalogue(ctx: Ctx) -> tuple[dict[str, dict] | None, str]:
    try:
        rows, _ = ctx.house_rows(PTR_CATALOGUE, HOUSE_TAB, "requirements catalogue")
    except Unreadable as exc:
        return None, str(exc)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: rows are still named, by their id
        return None, f"the requirements catalogue could not be read ({type(exc).__name__})"
    return {str(c.get("req_id") or "").strip(): c for c in rows if str(c.get("req_id") or "").strip()}, ""


def requirements(ctx: Ctx) -> dict[str, Any]:
    """A1: the compliance engine's requirement states, named by the catalogue."""
    ctx.need_keys(contact=True)
    if ctx.own:
        where = (f"{_fold_f('person_key')} = ANY(%s) OR {_fold_f('person_name')} = ANY(%s) "
                 f"OR {_low_f('login')} = ANY(%s) OR {_last10_f('login')} = ANY(%s)")
        keys = sorted(ctx.keys) or [NO_KEY]
        args: tuple = (keys, keys, sorted(ctx.emails), sorted(ctx.phones))
    else:
        where, args = f"{_low_f('state')} = ANY(%s)", (sorted(OWED_STATES),)
    raw, as_of = ctx.house_rows(PTR_STATES, HOUSE_TAB, "requirement states", where, args)

    def mine(r: dict) -> bool:
        login = r.get("login")
        if login and not _is_marker(login) and (_low(login) in ctx.emails or last10(login) in ctx.phones):
            return True
        return fold(r.get("person_key")) in ctx.keys or fold(r.get("person_name")) in ctx.keys

    rows = [clean(r) for r in raw if not ctx.own or mine(r)]
    if ctx.own and not rows:
        name = ctx.me.get("roster_name") or ctx.me.get("name") or "no name"
        raise NotAttributable(f"no requirement row carries your name ({name}) — the roster may spell it differently")
    catalogue, catalogue_why = _catalogue(ctx)
    on = ctx.today
    out: list[dict] = []
    hr_checks = 0
    missing: dict[str, list[tuple[str, dict]]] = {}
    spelled: dict[str, str] = {}
    for r in rows:
        state = _low(r.get("state"))
        if state not in OWED_STATES:
            continue
        rid = _text(r.get("req_id"), 80)
        who = _text(r.get("person_name"), 120) or _text(r.get("person_key"), 120)
        pkey = fold(r.get("person_key")) or fold(who)
        spelled.setdefault(pkey, who)
        cat = (catalogue or {}).get(rid) if catalogue is not None else None
        category = ""
        if catalogue is not None:
            if cat is None or _low(cat.get("enabled")) != "yes":
                continue
            category = _low(cat.get("category"))
            if category in HR_CATEGORIES:
                hr_checks += 1
                continue
        if state == "missing":
            missing.setdefault(pkey, []).append((rid, cat or {}))
            continue
        label = _text((cat or {}).get("label"), 120) or rid or "a requirement"
        expires = day_of(r.get("expires"))
        tone = TONE_OVERDUE if state == "expired" or (expires is not None and expires < on) else TONE_SOON
        days_left = _text(r.get("days_left"), 10)
        phase = "Expired" if state == "expired" else (
            f"Expires in {_plural(int(days_left), 'day')}" if re.fullmatch(r"-?\d+", days_left) and int(days_left) >= 0
            else "Expiring")
        target, why = _requirement_target(ctx, category, catalogue_why, [label], who)
        out.append(action_row(
            f"requirements:{pkey}:{rid}", person=who, due=expires, tone=tone,
            due_why="The requirement row carries no expiry date.",
            condition=f"{'Complete' if category == 'onboarding' else 'Renew'} {label}",
            flow=FLOW_OF.get(category, "Compliance requirement"), phase=phase,
            family="credential" if category in ("training", "documents") else ("form" if category == "onboarding"
                                                                              else "asset"),
            target=target, action_why=why,
            details=pairs(("Requirement", rid), ("Evidence", (cat or {}).get("evidence")), ("State", _word(state)),
                          ("Expires", r.get("expires")), ("Days left", days_left),
                          ("In this state since", _stamp_words(r.get("since"))),
                          ("Checked", _stamp_words(r.get("computed_at"))),
                          ("Catalogue", catalogue_why))))
    for pkey, items in missing.items():
        who = spelled.get(pkey, "")
        labels = [_text(c.get("label"), 120) or rid for rid, c in items]
        uploads = [(_text(c.get("label"), 120) or rid) for rid, c in items
                   if _low(c.get("category")) in ("training", "documents")]
        forms = [rid for rid, c in items if _low(c.get("category")) == "onboarding"]
        if uploads:
            target, why = _requirement_target(ctx, "training", catalogue_why, uploads, who)
        elif forms:
            target, why = _requirement_target(ctx, "onboarding", catalogue_why, [], who)
        else:
            target, why = _requirement_target(ctx, "", catalogue_why, [], who)
        out.append({**action_row(
            f"requirements:{pkey}:missing", person=who, due=None, tone="",
            due_why="Nothing is on file, so there is no date to run out.",
            condition=f"Nothing on file for {_plural(len(items), 'requirement')}", flow="Compliance requirements",
            phase="Not on file", family="asset", target=target, action_why=why,
            details=[{"label": lab, "value": " · ".join(x for x in (_text(c.get("evidence"), 200),
                                                                    _word(c.get("category"))) if x) or "On record as missing"}
                     for lab, (_rid, c) in zip(labels, items)]
            + pairs(("Catalogue", catalogue_why))), "folded": True})
    notes = []
    if catalogue is not None and hr_checks:
        notes.append(f"{_plural(hr_checks, 'background or admin check')} HR runs "
                     f"{'is' if hr_checks == 1 else 'are'} not listed")
    if catalogue is None:
        notes.append(f"{catalogue_why} — each requirement is named by its id")
    if ctx.own and ctx.me.get("key_why"):
        notes.append(f"{ctx.me['key_why']} — only rows carrying your sign-in were matched")
    return _got(out, as_of, _join(*notes), copy_why=ctx.copy_words(as_of))


def _requirement_target(ctx: Ctx, category: str, catalogue_why: str, certs: list[str],
                        who: str) -> tuple[dict[str, Any] | None, str]:
    if category in ("training", "documents") and certs:
        name = ctx.upload_name() if ctx.own else who
        if not name:
            # FAIL-CLOSED: no upload is offered under a name another account may carry
            return None, ("No name that is yours alone is on file to file the upload under — hand the document to HR."
                          if ctx.own else "The requirement row names nobody to file the upload under.")
        return {"label": "Upload asset", "kind": "upload", "certs": certs, "upload_for": name}, ""
    if category == "onboarding":
        return {**TARGET_ROSTER, "label": "Complete form"}, "HR files this form."
    if catalogue_why:
        return None, f"{catalogue_why[:1].upper()}{catalogue_why[1:]}, so what this asks is not known — ask HR."
    return None, "HR records this one."


def ist(ctx: Ctx) -> dict[str, Any]:
    """A2: the client trainings owed (the IST house, status owed)."""
    ctx.need_keys(contact=True)
    raw, where = ctx.db.ist_rows()
    if not raw:
        raise Unreadable(where or "the IST house holds no rows")
    lines = ctx.own_lines(raw, lambda r: r.get("staffPhone"), lambda r: r.get("staffName")) if ctx.own else set()

    def mine(r: dict) -> bool:
        return bool((_low(r.get("staffEmail")) and _low(r.get("staffEmail")) in ctx.emails)
                    or (last10(r.get("staffPhone")) and last10(r.get("staffPhone")) in lines)
                    or ctx.mine_name(r.get("staffName")))

    def on_shared_line(r: dict) -> bool:
        p = last10(r.get("staffPhone"))
        return bool(p) and p in ctx.phones and p not in lines and not fold(r.get("staffName"))

    try:
        ist_config.rules(ctx.dsn)
    except Exception:  # noqa: BLE001 — the held or shipped copy answers, and unread() says which
        pass
    window = ist_config.int_of(ist_config.current(), "ist_cert_expiring_days")
    out = []
    unclaimed = 0
    for r0 in raw:
        if _low(r0.get("status")) != ist_config.IST_STATUS_OWED:
            continue
        if ctx.own and not mine(r0):
            unclaimed += on_shared_line(r0)
            continue
        r = clean(r0)
        due = day_of(r.get("dueDate"))
        code = _text(r.get("house"), 40)
        where_ = time_off.house_label(code) if code else ""
        out.append(action_row(
            f"ist:{_text(r.get('id'), 120) or len(out)}", person=r.get("staffName"), due=due,
            tone=tone_of(due, ctx.today, window), due_why="The IST record carries no due date.",
            condition="Complete assigned client training" + (f" — {where_}" if where_ else ""),
            flow="Client training (IST)", phase="Owed", family="event",
            target={**TARGET_ROSTER, "label": "Book training"},
            action_why="Your house manager books this training and marks it done.",
            details=pairs(("Client", r.get("clientName")), ("House", where_ or code), ("Due date", r.get("dueDate")),
                          ("Record", r.get("id")), ("Note", r.get("certNote")),
                          ("Opened", _stamp_words(r.get("createdAt"))))))
    notes = []
    if ist_config.unread():
        notes.append(f"the IST settings could not be read, so the shipped {window}-day window marks what is due soon")
    if ctx.own and ctx.me.get("key_why"):
        notes.append(f"{ctx.me['key_why']} — only rows carrying your e-mail or phone were matched")
    notes.append(_line_note(unclaimed, "owed training", LINE_RECORDED))
    return _got(out, "", _join(*notes))


def _answers(done: list[tuple[str, str, date | None]], which: tuple[str, str], eff: date | None) -> bool:
    """Whether a read or signed row settles an owed one: the same policy and version; or the same policy where…"""
    policy, version = which
    for p, v, read_on in done:
        if p != policy:
            continue
        if v == version:
            return True
        if (not v or not version) and not (read_on and eff and read_on < eff):
            return True
    return False


def policies(ctx: Ctx) -> dict[str, Any]:
    """A3: acknowledgements owed — a row naming the person pending or overdue, or an all-staff one unanswered."""
    ctx.need_keys(contact=True)
    everyone = fold(ALL_STAFF)
    if ctx.own:
        where = f"{_fold_f('staff')} = ANY(%s) OR {_low_f('staff')} = ANY(%s)"
        args: tuple = (sorted(ctx.keys | {everyone}), sorted(ctx.emails))
    else:
        where, args = "", ()
    raw, as_of = ctx.house_rows(PTR_APPS, TAB_POLICY_ACKS, "policy acknowledgements", where, args)
    rows = [clean(r) for r in raw]
    me_token = "@me"
    # the Reader files a read under the account's display name; one another account shares cannot be told apart
    receipts_unmatched = ctx.own and not fold(ctx.me.get("roster_name")) and bool(fold(ctx.me.get("name")))

    def whose(r: dict) -> str:
        """Whom a row names: '' for all staff, the account itself as one token in own mode."""
        staff = r.get("staff")
        if fold(staff) == everyone:
            return ""
        if ctx.own:
            return me_token if (ctx.mine_name(staff) or _low(staff) in ctx.emails) else "-" + fold(staff)
        return fold(staff)

    answered: dict[str, list[tuple[str, str, date | None]]] = {}
    for r in rows:
        k = whose(r)
        if k and _low(r.get("status")) in POLICY_DONE:
            answered.setdefault(k, []).append((fold(r.get("policy")), _text(r.get("version"), 40),
                                               day_of(r.get("effectiveDate"))))
    # whose answer settles an all-staff row: the account's own, or the one person a mass read narrowed to
    settles = me_token if ctx.own else ctx.only
    out = []
    unsettled = 0
    seen: set[tuple[str, str, str]] = set()
    for r in rows:
        status = _low(r.get("status"))
        if status not in POLICY_OWED:
            continue
        which = (fold(r.get("policy")), _text(r.get("version"), 40))
        eff = day_of(r.get("effectiveDate"))
        k = whose(r)
        if ctx.own and k and k != me_token:
            continue
        if not k and settles and _answers(answered.get(settles, []), which, eff):
            continue
        if k and _answers(answered.get(k, []), which, eff):
            continue
        if (k,) + which in seen:
            continue
        seen.add((k,) + which)
        if not k and receipts_unmatched:
            unsettled += 1
            continue
        tone = TONE_OVERDUE if status == "overdue" else tone_of(eff, ctx.today, POLICY_SOON_DAYS)
        name = _text(r.get("policy"), 160) or "a policy"
        version = which[1]
        out.append(action_row(
            f"policies:{k or 'all'}:{_text(r.get('id'), 80) or len(out)}",
            person=r.get("staff") if k else ALL_STAFF, due=eff, tone=tone,
            due_why="The acknowledgement carries no effective date.",
            condition=f"Read and acknowledge {name}" + (f" {version}" if version else ""),
            flow="Policy acknowledgement", phase=_word(status), family="decision",
            target={**TARGET_POLICIES, "label": "Enter decision"},
            action_why="Policies is not open to you here — ask HR for the document.",
            everyone=not k and not ctx.own,
            details=pairs(("Policy", name), ("Version", version), ("Asked of", r.get("staff")),
                          ("Status", _word(status)), ("Effective", _stamp_words(r.get("effectiveDate"))))))
    gap = ""
    if unsettled:
        # FAIL-CLOSED: an all-staff policy is neither drawn as owed nor dropped as answered; the rows asked of the…
        gap = (f"{ctx.me.get('key_why') or 'your name is shared with another account'} — your reads are filed under "
               f"that name, so whether you answered {_plural(unsettled, 'all-staff policy', 'all-staff policies')} "
               f"cannot be told")
    return _got(out, as_of, copy_why=ctx.copy_words(as_of), gap=gap)


def _handoff_words(d: dict[str, Any]) -> str:
    day = day_of(d.get("col_iso"))
    return " ".join(x for x in (d.get("house") or "", _day_words(day), d.get("value") or "") if x)


def _seat_words(state: Any, by: Any, via: Any, at: Any, note: Any = "") -> str:
    bits = [_word(state) or "Not asked"]
    if by:
        bits.append(f"by {by}")
    if via:
        bits.append(f"({via})")
    if at:
        bits.append(f"· {_stamp_words(at)}")
    if note:
        bits.append(f"· {_text(note, 200)}")
    return " ".join(bits)


def _handoff_details(d: dict[str, Any]) -> list[dict[str, str]]:
    return pairs(("Transfer", d.get("id")), ("From", d.get("from_staff")), ("To", d.get("to_staff")),
                 ("House", d.get("house")), ("Day", _day_words(day_of(d.get("col_iso")))), ("Shift", d.get("value")),
                 ("Their answer", _seat_words(d.get("staff_state"), d.get("staff_by"), d.get("staff_via"),
                                              d.get("staff_at"))),
                 ("House manager", _seat_words(d.get("manager_state"), d.get("manager_by"), d.get("manager_via"),
                                               d.get("manager_at"))),
                 ("Director", _seat_words(d.get("director_state"), d.get("director_by"), d.get("director_via"),
                                          d.get("director_at"))),
                 ("Offered by", d.get("offered_by")), ("Offered", _stamp_words(d.get("created_at"))),
                 ("Why", d.get("why")))


def _rehearsal_note(n: int) -> str:
    return f"{_plural(n, 'rehearsal row')} {'is' if n == 1 else 'are'} not shown" if n else ""


def transfers(ctx: Ctx) -> dict[str, Any]:
    """A4: shifts somebody offered to the person, waiting on their answer."""
    ctx.need_keys()
    if ctx.own:
        rows, states, limit_note = ctx.handoffs(f"state=%s AND {_FOLD_COL.format('to_staff')} = ANY(%s)",
                                                (shift_handoff.PENDING, sorted(ctx.keys)))
    else:
        rows, states, limit_note = ctx.pending_handoffs()
    out, rehearsed = [], 0
    for row in rows:
        if row.get("state") != shift_handoff.PENDING or row.get("staff_state") != shift_handoff.PENDING:
            continue
        if ctx.own and not ctx.mine_name(row.get("to_staff")):
            continue
        if shift_handoff.is_rehearsed(row):
            rehearsed += 1
            continue
        d = shift_handoff.describe(row, ctx.who, training_state=states.get(str(row.get("training_request") or ""), ""))
        day = day_of(d.get("col_iso"))
        out.append(action_row(
            f"transfers:{d['id']}", person=d.get("to_staff"), due=day,
            tone=tone_of(day, ctx.today, time_off.SOON_DAYS, today_is_overdue=True),
            due_why="The shift's day could not be read.",
            condition=f"Answer a shift transfer from {d.get('from_staff') or 'a colleague'} — {_handoff_words(d)}",
            flow="Shift transfer", phase="Your answer" if ctx.own else "Their answer", family="decision",
            target={**TARGET_SWAPS, "label": "Enter decision"},
            action_why="Swaps is not open to you here — answer the text you were sent, or call the hotline.",
            details=_handoff_details(d)))
    return _got(out, "", _join(limit_note, _rehearsal_note(rehearsed)))


def _named(names: Iterable[Any]) -> list[str]:
    out: list[str] = []
    for n in names:
        t = _text(n, 120)
        if fold(t) and not any(fold(t) == fold(o) for o in out):
            out.append(t)
    return out


def time_off_decisions(ctx: Ctx) -> dict[str, Any]:
    """A5 (time off): the half of a request a person may decide, as time_off.leg_for decides it."""
    if ctx.own and not fold(ctx.who.get("name")):
        raise NotAttributable(ctx.me.get("key_why") or "your roster name could not be read, so no decision "
                                                       "can be tied to you")
    v = ctx.time_off_view()
    brd = time_off.board(v)
    if not brd["readable"]:
        # FAIL-CLOSED: the directors list decides who holds a half, and it did not land
        raise Unreadable(brd["why"])
    managers = ctx.managers()
    dirs = brd["names"]
    out = []
    for r in v["rows"]:
        if r.get("status") != time_off.PENDING:
            continue
        seats: list[tuple[str, str]] = []
        if ctx.own:
            leg, _why, _code = time_off.leg_for(ctx.who, r, dirs, managers)
            if leg:
                seats.append((leg, str(ctx.who.get("name") or "")))
        else:
            person, filed = str(r.get("person") or ""), str(r.get("filed_by") or "")
            eligible = time_off._eligible(dirs, person, filed)
            asked = []
            if r.get("hm_state") == time_off.WAITING:
                if str(r.get("hm_mode") or "") == time_off.MODE_ABOVE:
                    asked += eligible
                else:
                    asked += time_off._list(r.get("hm_asked")) + time_off._current_managers(r, managers)
            if r.get("dir_state") == time_off.WAITING:
                asked += eligible
            for n in _named(asked):
                leg, _why, _code = time_off.leg_for({"name": n, "badges": []}, r, dirs, managers)
                if leg and not any(s[1] == n for s in seats):
                    seats.append((leg, n))
            if not seats:
                seats.append(("", ""))
        start = time_off.day_of(r.get("start_date"))
        ref = str(r.get("id") or "")
        for leg, who in seats:
            phase = ("House manager approval" if leg == time_off.LEG_HM else "Director approval" if leg
                     else "Nobody named")
            details = pairs(("Request", ref), ("Person", r.get("person")),
                            ("Dates", time_off.dates_words(r.get("start_date"), r.get("end_date"))),
                            ("Days", r.get("days")),
                            ("Houses", ", ".join(time_off.house_label(c) for c in time_off._list(r.get("houses")))),
                            ("Where it stands", time_off.status_words(r, brd)), ("Filed by", r.get("filed_by")),
                            ("Waiting on", "" if who else "Nobody is named to decide this half yet"))
            out.append(action_row(
                f"time_off_decisions:{ref}:{fold(who) or 'nobody'}", person=who, due=start,
                tone=tone_of(start, ctx.today, time_off.SOON_DAYS, today_is_overdue=True),
                due_why="The request carries no start day.",
                condition=f"Decide {r.get('person') or 'a colleague'}'s time off — "
                          f"{time_off.dates_words(r.get('start_date'), r.get('end_date'))}",
                flow="Time off approval", phase=phase, family="decision",
                # decided in My Work's own panel, through Time Off's own door (timeOffDecide), never a visit to Time Off
                target={"kind": "decide", "app": "timeoff", "item_id": ref, "action": "timeOffDecide",
                        "words": ["Approve", "Not approved"], "label": "Enter decision",
                        "item": {"title": f"{r.get('person') or 'A colleague'}'s time off", "seat_words": phase,
                                 "facts": [d for d in details if d["label"] != "Request"]}},
                action_why="Time Off is not open to you here — answer the e-mail you were sent.",
                details=details))
    note = "" if managers.get("readable") else (
        "who manages each house could not be read — a request waiting on a house's current manager may be missing")
    return _got(out, v.get("as_of") or "", note)


def _sched_value(value: Any, limit: int) -> str:
    text = _text(value, limit)
    return "" if _is_marker(text) else text


def _sched_item(r: dict[str, Any], item_id: str, seat: str, phase: str, day: date | None) -> dict[str, Any]:
    """What the decision panel draws for one waiting item: the item's own words, never anything it does not carry."""
    house = _sched_value(r.get("house_code"), 40)
    return {"id": item_id, "flow_id": _sched_value(r.get("flow_id"), 80), "kind": _low(r.get("kind"))[:40],
            "seat": seat[:40], "seat_words": phase,
            "title": _sched_value(r.get("title"), 240), "body": _sched_value(r.get("body"), 1200),
            "house_code": house, "house_label": _sched_value(r.get("house_label"), 80) or house,
            "date": day.isoformat() if day else "", "day_words": _day_words(day),
            "shift_text": _sched_value(r.get("shift_text"), 80), "created_at": when_of(r.get("created_at")),
            "test_mode": _low(r.get("test_mode")) in SCHED_TEST_MODE}


def _seat_test_mode(r: dict[str, Any]) -> tuple[str, str]:
    return ("Test mode", "Made while test mode was on: its texts were held"
            if _low(r.get("test_mode")) in SCHED_TEST_MODE else "")


def _sched_details(ctx: Ctx, r: dict[str, Any], day: date | None, who: str) -> list[dict[str, str]]:
    return pairs(("House", r.get("house_label") or r.get("house_code")),
                 ("Day", _day_words(day) or r.get("date")), ("Shift", r.get("shift_text")),
                 ("Details", r.get("body")), ("Waiting on", "" if ctx.own else who), _seat_test_mode(r))


def _vc_facts(cell: Any) -> list[dict[str, str]]:
    """The item's own label/value pairs (vc_inbox `facts`, JSON), capped as written; a cell that is not that JSON…"""
    try:
        got = json.loads(cell) if isinstance(cell, str) else cell
    except (TypeError, ValueError):
        return []
    out: list[dict[str, str]] = []
    for p in got if isinstance(got, list) else []:
        if len(out) >= VC_FACTS_MAX:
            break
        if not isinstance(p, dict):
            continue
        label, value = _text(p.get("label"), VC_LABEL_MAX), _text(p.get("value"), VC_VALUE_MAX)
        if label and value and not _is_marker(value):
            out.append({"label": label, "value": value})
    return out


def _vc_item(r: dict[str, Any], item_id: str, seat: str, phase: str, day: date | None) -> dict[str, Any]:
    """What the decision panel draws for one waiting vehicle request: the item's own words and facts."""
    return {"id": item_id, "trip_id": _sched_value(r.get("trip_id"), 80), "kind": _low(r.get("kind"))[:40],
            "seat": seat[:40], "seat_words": phase,
            "title": _sched_value(r.get("title"), 200), "body": _sched_value(r.get("body"), 300),
            "facts": _vc_facts(r.get("facts")),
            "date": day.isoformat() if day else "", "day_words": _day_words(day),
            "when": _sched_value(r.get("when"), 80), "created_at": when_of(r.get("created_at")),
            "test_mode": _low(r.get("test_mode")) in SCHED_TEST_MODE}


def _vc_details(ctx: Ctx, r: dict[str, Any], day: date | None, who: str) -> list[dict[str, str]]:
    return _vc_facts(r.get("facts")) + pairs(("Waiting on", "" if ctx.own else who), _seat_test_mode(r))


def _sr_item(r: dict[str, Any], item_id: str, seat: str, phase: str, day: date | None) -> dict[str, Any]:
    """What the panel needs to open one redirected request: its ref (the panel reads the request itself through…"""
    return {"id": item_id, "ref": _sched_value(r.get("ref"), 40), "kind": _low(r.get("kind"))[:40],
            "seat": seat[:40], "seat_words": phase,
            "title": _sched_value(r.get("title"), 200), "body": _sched_value(r.get("body"), 300),
            "note": _sched_value(r.get("note"), 300), "date": day.isoformat() if day else "",
            "day_words": _day_words(day), "created_at": when_of(r.get("created_at")),
            "test_mode": _low(r.get("test_mode")) in SCHED_TEST_MODE}


def _sr_details(ctx: Ctx, r: dict[str, Any], day: date | None, who: str) -> list[dict[str, str]]:
    return pairs(("Request", r.get("ref")), ("Redirected", r.get("note")), ("Details", r.get("body")),
                 ("Waiting on", "" if ctx.own else who), _seat_test_mode(r))


# What tells one app's seat decisions apart: its house, its words, its door and how a row reads.
SCHED_SEATS: dict[str, Any] = {
    "pointer": PTR_SCHED_INBOX, "what": "Scheduling's items", "flow": "Scheduling", "row": "scheduling",
    "target": TARGET_SCHEDULING, "decide_href": "", "action": "", "open_label": "Open in Scheduling",
    "others_why": "Scheduling is not open to you here.", "due_why": "The item carries no shift day.",
    "condition": "A Scheduling approval", "item": _sched_item, "details": _sched_details,
    "stand_in": frozenset({"director"}), "group": "flow_id"}
VC_SEATS: dict[str, Any] = {
    "pointer": PTR_VC_INBOX, "what": "Transportation's items", "flow": "Transportation", "row": "vehicle_calendar",
    "target": TARGET_VEHICLE_CALENDAR, "decide_href": VC_DECIDE_HREF, "action": VC_ANSWER, "open_label": "",
    "others_why": "Waiting on {who}.", "due_why": "The item carries no trip day.",
    "condition": "A vehicle request", "item": _vc_item, "details": _vc_details,
    "stand_in": frozenset({"director"}), "group": "trip_id"}
SR_SEATS: dict[str, Any] = {
    "pointer": PTR_SUPPORT_INBOX, "what": "Support Requests' items", "flow": "Support Requests", "row": "support_desk",
    "target": TARGET_SUPPORT_DESK, "decide_href": VC_DECIDE_HREF, "action": SR_ANSWER, "open_label": "",
    "others_why": "Waiting on {who}.", "due_why": "A support request carries no due day.",
    "condition": "A support request", "item": _sr_item, "details": _sr_details,
    "words": SR_WORDS, "phases": SR_PHASE, "decide_label": "Answer the request",
    "stand_in": frozenset({"redirect"}), "group": "ref"}
EL_SEATS: dict[str, Any] = {
    "pointer": PTR_LOANS, "what": "Employee loans' items", "flow": "Employee loans", "row": "employee_loans",
    "target": TARGET_STAFF, "decide_href": VC_DECIDE_HREF, "action": EL_ANSWER, "open_label": "",
    "others_why": "Waiting on {who}.", "due_why": "The item carries no disbursement date.",
    "condition": "An employee loan request", "item": _vc_item, "details": _vc_details,
    "stand_in": frozenset({"director"}), "group": "loan_id"}


def _seat_decisions(ctx: Ctx, spec: dict[str, Any]) -> dict[str, Any]:
    """The approvals an app's flows leave waiting on a seat, matched by the account id alone — the one key those…"""
    flow, what, base = spec["flow"], spec["what"], spec["target"]
    uid = str(ctx.me.get("uid") or "").strip()
    if ctx.own and not uid:
        raise NotAttributable(f"this account carries no id, so no {flow} approval can be tied to it")
    where = f"{_low_f('box')} = %s AND {_low_f('state')} = %s"
    args: tuple = (SCHED_BOX_WORK, SCHED_WAITING)
    if ctx.own:
        where += f" AND btrim({_f('to_uid')}) = %s"
        args += (uid,)
    sid = ctx.house(spec["pointer"], what)
    raw, total, as_of = ctx.db.tab(sid, HOUSE_TAB, where, args)
    if not total:
        # a house nothing has been asked in yet is empty only on the mirror's own word that it was copied whole
        if not copied_whole(ctx.db.book(sid)):
            raise Unreadable(f"the house of {what} is declared but not mirrored yet")
        return _got([], as_of)
    out = []
    rows = [r for r in (clean(r0) for r0 in raw)
            if _low(r.get("box")) == SCHED_BOX_WORK and _low(r.get("state")) == SCHED_WAITING]

    def group_of(r: dict[str, Any]) -> str:
        return _text(r.get(spec.get("group") or "id"), 80)

    # the master's own session stands in on a director's seat: one decide row per request, through the same door
    held = {group_of(r) for r in rows if uid and str(r.get("to_uid") or "").strip() == uid}
    for r in rows:
        to = str(r.get("to_uid") or "").strip()
        mine = bool(uid) and to == uid
        if ctx.own and not mine:
            continue
        item_id = _text(r.get("id"), 80)
        link = str(r.get("link") or "").strip()
        href = link if link.startswith(base["href"]) else base["href"]
        seat = _low(r.get("seat"))
        day = day_of(r.get("date"))
        who = _text(r.get("to_name"), 120)
        group = group_of(r)
        stand_in = (ctx.mode == MODE_MASS and bool(uid) and not mine and bool(item_id) and bool(group)
                    and seat in spec.get("stand_in", ()) and group not in held)
        if stand_in:
            held.add(group)
        phase = spec.get("phases", SCHED_PHASE).get(seat) or ("Your answer" if ctx.own or mine else "Their answer")
        if (mine or stand_in) and item_id:
            target: dict[str, Any] | None = {**base, "href": spec["decide_href"] or href,
                                             "label": spec.get("decide_label", "Approve or decline"), "kind": "decide",
                                             "item_id": item_id, "words": spec.get("words", SCHED_WORDS),
                                             "action": spec["action"],
                                             "item": spec["item"](r, item_id, seat, phase, day)}
        elif item_id and spec["open_label"]:
            target = {**base, "href": href, "label": spec["open_label"]}
        else:
            target = None
        out.append(action_row(
            f"{spec['row']}:{item_id or len(out)}", person=who, due=day,
            tone=tone_of(day, ctx.today, time_off.SOON_DAYS, today_is_overdue=True),
            due_why=spec["due_why"], condition=_text(r.get("title"), 240) or spec["condition"],
            flow=flow, phase=phase, family="decision", target=target,
            action_why=("The item carries no id, so it cannot be answered here." if not item_id else
                        "" if mine or stand_in else spec["others_why"].format(who=who or "another seat")),
            details=spec["details"](ctx, r, day, who)))
    return _got(out, as_of, copy_why=ctx.copy_words(as_of))


def scheduling(ctx: Ctx) -> dict[str, Any]:
    """A6: Scheduling's approvals waiting on a seat; a mass read opens Scheduling for the rest."""
    return _seat_decisions(ctx, SCHED_SEATS)


def vehicle_calendar(ctx: Ctx) -> dict[str, Any]:
    """Transportation's vehicle requests waiting on a director's seat; any other seat's only says whom it waits on."""
    return _seat_decisions(ctx, VC_SEATS)


def support_desk(ctx: Ctx) -> dict[str, Any]:
    """Support Requests redirected to an account: each waits on that account's seat alone."""
    return _seat_decisions(ctx, SR_SEATS)


def employee_loans(ctx: Ctx) -> dict[str, Any]:
    """Employee loan requests waiting on a director's seat; the first answer decides."""
    return _seat_decisions(ctx, EL_SEATS)


def transfer_decisions(ctx: Ctx) -> dict[str, Any]:
    """A5 (transfers): the house manager's or a director's consent a pending transfer waits on."""
    if ctx.own and not fold(ctx.who.get("name")) and not ctx.who.get("decides_everywhere"):
        raise NotAttributable(ctx.me.get("key_why") or "your roster name could not be read, so no approval "
                                                       "can be tied to you")
    rows, states, limit_note = ctx.pending_handoffs()
    out, rehearsed = [], 0
    for row in rows:
        if row.get("state") != shift_handoff.PENDING:
            continue
        if shift_handoff.is_rehearsed(row):
            rehearsed += 1
            continue
        d = shift_handoff.describe(row, ctx.who, training_state=states.get(str(row.get("training_request") or ""), ""))
        seats: list[tuple[str, str]] = []
        if ctx.own:
            if d.get("may_approve"):
                seats.append(("House manager approval", str(ctx.who.get("name") or "")))
            elif d.get("may_approve_director"):
                seats.append(("Director approval", str(ctx.who.get("name") or "")))
        else:
            if row.get("manager_state") == shift_handoff.PENDING:
                named = [n for n in _named(shift_handoff.manager_names(row)) if shift_handoff.waits_on(row, n)]
                seats += [("House manager approval", n) for n in named] or [("House manager approval", "")]
            if str(row.get("director_state") or shift_handoff.PENDING) == shift_handoff.PENDING \
                    and shift_handoff.director_names(row):
                seats += [("Director approval", n) for n in _named(shift_handoff.director_names(row))
                          if shift_handoff.waits_on(row, n)]
        day = day_of(d.get("col_iso"))
        for phase, who in seats:
            out.append(action_row(
                f"transfer_decisions:{d['id']}:{fold(who) or 'nobody'}:{phase[:1]}", person=who, due=day,
                tone=tone_of(day, ctx.today, time_off.SOON_DAYS, today_is_overdue=True),
                due_why="The shift's day could not be read.",
                condition=f"Approve a shift transfer: {d.get('from_staff') or '—'} to {d.get('to_staff') or '—'} — "
                          f"{_handoff_words(d)}",
                flow="Shift transfer", phase=phase, family="decision",
                target={**TARGET_SWAPS, "label": "Enter decision"},
                action_why="Swaps is not open to you here — answer the text you were sent.",
                details=_handoff_details(d) + pairs(("Waiting on", "" if who else
                                                     "Nobody is named for this consent yet"))))
    note = ""
    if ctx.own and not ctx.who.get("managers_readable", True):
        note = ("who manages each house could not be read — a transfer waiting on a house's current manager "
                "may be missing")
    return _got(out, "", _join(note, limit_note, _rehearsal_note(rehearsed)))


# ── MY REQUESTS ─────────────────────────────────────────────────────────────

TIME_OFF_CLASS = {time_off.REVIEW: (OPEN, "Needs review"), time_off.SCHEDULED: (RESOLVED, "Approved"),
                  time_off.DENIED: (RESOLVED, "Denied"), time_off.WITHDRAWN: (RESOLVED, "Withdrawn"),
                  time_off.CANCELLED: (RESOLVED, "Cancelled"), time_off.EXPIRED: (RESOLVED, "Expired"),
                  time_off.HISTORY: (RESOLVED, "On record")}
VIA_WORDS = {"platform": "On the platform", "hotline": "Through the hotline", "form": "The Google Form",
             "sms": "By text message", "migration": "Carried over from the Master Calendar Creator form"}


def filed_via_words(via: Any, filed_by: Any) -> str:
    via = _low(via)
    if via == "phone":
        return f"By telephone — taken by {filed_by}" if filed_by else "By telephone"
    return VIA_WORDS.get(via, _word(via))


def time_off_requests(ctx: Ctx) -> dict[str, Any]:
    """R1: time off — the person ON the request, never one filed for somebody else."""
    ctx.need_keys()
    v = ctx.time_off_view()
    brd = time_off.board(v)
    dirs = brd["names"]
    managers = ctx.managers()
    out = []
    for raw in v["rows"]:
        person = raw.get("person")
        if ctx.own and not ctx.mine_name(person):
            continue
        r = clean(raw)
        s = time_off.shape(raw, ctx.who, dirs, managers, None, ctx.today, brd=brd)
        status = _low(r.get("status"))
        if status == time_off.PENDING:
            cls, word = OPEN, time_off.status_words(raw, brd) or "Waiting on the house manager and a director"
        elif status in TIME_OFF_CLASS:
            cls, word = TIME_OFF_CLASS[status]
        else:
            cls, word = RECORDED, _word(status) or "Recorded"
        ref = str(r.get("id") or "")
        reason = ""
        if str(r.get("reason_given") or "").lower() == "yes":
            if ctx.own and cls == OPEN and time_off.reason_visible(ctx.who, raw, dirs):
                text, why = time_off.reason_of(ctx.dsn, raw)
                reason = text or (why[:1].upper() + why[1:] if why else "")
            else:
                reason = "Given — Time Off shows it on the request"
        closed = " · ".join(x for x in (_text(r.get("closed_by"), 80), _stamp_words(r.get("closed_at")),
                                        _text(r.get("closed_note"), 200)) if x)
        dates = time_off.dates_words(r.get("start_date"), r.get("end_date"))
        out.append(request_row(
            f"time_off:{ref}", person=person, ref=ref, text=f"Time off · {dates}", submitted=r.get("createdAt"),
            status_class=cls, status_word=word,
            concluded=is_concluded(cls, day_of(r.get("end_date")) or day_of(r.get("start_date")), ctx.today),
            details=pairs(("Dates", dates), ("Days", s.get("days") or r.get("days")),
                          ("Houses", ", ".join(h["label"] for h in s.get("houses") or [])),
                          ("Reason", reason),
                          ("Filed", filed_via_words(r.get("filed_via"), r.get("filed_by"))),
                          ("Filed by", r.get("filed_by")),
                          ("House manager", _seat_words(r.get("hm_state"), r.get("hm_by"), r.get("hm_via"),
                                                        r.get("hm_at"), r.get("hm_note"))),
                          ("Director", _seat_words(r.get("dir_state"), r.get("dir_by"), r.get("dir_via"),
                                                   r.get("dir_at"), r.get("dir_note"))),
                          ("Where it stands", s.get("status_why")), ("Closed", closed),
                          ("Flags", ", ".join(time_off._list(r.get("flags")))),
                          ("Test mode", "Filed while test mode was on" if s.get("test_mode") else "")),
            link={"app": "timeoff", "page": "requests", "href": f"/app/timeoff/requests?ref={ref}",
                  "label": "Open in Time Off"}))
    return _got(out, v.get("as_of") or "")


def _support_key(person: Any, rtype: Any, details: Any, received: Any) -> str:
    """import_staff_requests.key_of over a received day: the key the legacy import de-duplicated on."""
    d = day_of(received)
    parts = [str(person or "").strip().lower(), str(rtype or "").strip().lower(),
             str(details or "").strip().lower()[:120], d.isoformat() if d else str(received or "").strip()]
    return "|".join(parts)


VERDICT_WORDS = {"approved": "Approved", "denied": "Denied", "resolved": "Resolved"}


def support_requests(ctx: Ctx) -> dict[str, Any]:
    """R2: the Hub's support queue, matched by exact keys: the e-mail, the whole name, and a phone's last ten…"""
    ctx.need_keys(contact=True)
    if ctx.own:
        # every row on the account's phones comes back, whatever its name, so own_lines sees each line whole
        where = f"{_low_f('email')} = ANY(%s) OR {_last10_f('phone')} = ANY(%s) OR {_fold_f('personName')} = ANY(%s)"
        args: tuple = (sorted(ctx.emails), sorted(ctx.phones) or [NO_KEY], sorted(ctx.keys) or [NO_KEY])
    else:
        where, args = "", ()
    raw, as_of = ctx.house_rows(PTR_STAFF_REQUESTS, HOUSE_TAB, "support requests", where, args)
    lines = ctx.own_lines(raw, lambda r: r.get("phone"), lambda r: r.get("personName")) if ctx.own else set()

    def mine(r: dict) -> bool:
        if _low(r.get("email")) and _low(r.get("email")) in ctx.emails:
            return True
        if last10(r.get("phone")) and last10(r.get("phone")) in lines:
            return True
        return ctx.mine_name(r.get("personName"))

    out = []
    unclaimed = 0
    for r0 in raw:
        if ctx.own and not mine(r0):
            unclaimed += bool(last10(r0.get("phone")) in ctx.phones and not fold(r0.get("personName")))
            continue
        r = clean(r0)
        status = _low(r.get("status"))
        if status == "open":
            cls, word = OPEN, "Open"
        elif status == "needs_dates":
            cls, word = OPEN, "Needs dates"
        elif status == "resolved":
            cls, word = RESOLVED, VERDICT_WORDS.get(_low(r.get("verdict")), _word(r.get("verdict")) or "Resolved")
        else:
            cls, word = RECORDED, _word(status) or "Recorded"
        rid = _text(r.get("id"), 80)
        key = _support_key(r.get("personName"), r.get("type"), r.get("details"), r.get("createdAt"))
        ctx.support_keys.add(key)
        span = " – ".join(x for x in (_text(r.get("dateFrom"), 20), _text(r.get("dateTo"), 20)) if x)
        days = _text(r.get("dateDays"), 10)
        row = request_row(
            f"support_requests:{rid or len(out)}", person=r.get("personName"), ref=rid,
            ref_why="The support queue keeps no id for this row.",
            text=f"Support request · {_text(r.get('type'), 120) or 'Other'}", submitted=r.get("createdAt"),
            status_class=cls, status_word=word,
            details=pairs(("Type", r.get("type")), ("Urgency", _word(r.get("urgency"))), ("Details", r.get("details")),
                          ("Dates asked", r.get("datesText")),
                          ("Dates", span + (f" ({_plural(int(days), 'day')})" if days.isdigit() else "")),
                          ("Reading of the dates", r.get("parseNote")), ("Resolved", _stamp_words(r.get("resolvedAt"))),
                          ("Resolved by", r.get("resolvedBy")), ("Resolution", r.get("resolutionNote")),
                          ("Reminded", _plural(int(r.get("notifyCount")), "time")
                           if str(r.get("notifyCount") or "").isdigit() and int(r.get("notifyCount")) else "")),
            link=LINK_SUPPORT)
        row["_dedupe"] = key
        out.append(row)
    return _got(out, as_of, _line_note(unclaimed, "request"), copy_why=ctx.copy_words(as_of))


def hotline(ctx: Ctx) -> dict[str, Any]:
    """R3: requests filed from calls into the Employee Support Queue; one also in R2 is listed there."""
    ctx.need_keys(contact=True)
    rows, as_of, stale = ctx.lane("supportQueue")
    lines = ctx.own_lines(rows, lambda r: r.get("requestor_phone"), lambda r: r.get("requestor")) if ctx.own else set()
    kept, unclaimed = [], 0
    for raw in rows:
        if ctx.own and not (ctx.mine_name(raw.get("requestor"))
                            or (last10(raw.get("requestor_phone")) and last10(raw.get("requestor_phone")) in lines)):
            unclaimed += bool(last10(raw.get("requestor_phone")) in ctx.phones and not fold(raw.get("requestor")))
            continue
        r = clean({k: v for k, v in raw.items() if k != "requestor_phone"})
        kept.append((r, _support_key(r.get("requestor"), r.get("type_of_request"), r.get("description_of_request"),
                                     r.get("date_received"))))
    logged = Counter(key for _r, key in kept)
    nth: Counter = Counter()
    out, twins = [], 0
    for r, key in kept:
        nth[key] += 1
        ctx.queue_keys.add(key)
        if key in ctx.support_keys:
            twins += 1
            ctx.twin_keys.append(key)
            continue
        status = _text(r.get("status"), 40)
        low = status.lower()
        if low in QUEUE_OPEN:
            cls, word = OPEN, _word(status) or "New"
        elif low in QUEUE_DONE:
            cls, word = RESOLVED, _word(status)
        else:
            cls, word = RECORDED, _word(status)
        ref = _nth_ref("HQ" + _sha10(key), nth[key])
        out.append(request_row(
            f"hotline:{ref}", person=r.get("requestor"), ref=ref,
            text=f"Phone request · {_text(r.get('type_of_request'), 120) or 'Other'}", submitted=r.get("date_received"),
            status_class=cls, status_word=word,
            details=pairs(("Type", r.get("type_of_request")), ("Urgency", r.get("urgency")),
                          ("Description", r.get("description_of_request")),
                          ("Date received", _stamp_words(r.get("date_received"))), ("Notes", r.get("notes")),
                          ("Processed", r.get("processed")),
                          ("Logged", f"{logged[key]} times in the queue with the same words on the same day"
                           if logged[key] > 1 else "")),
            link=LINK_HOTLINE))
    ctx.hotline_line_note = _line_note(unclaimed, "phone request")
    return _got(out, as_of, _join(_twin_note(twins), ctx.hotline_line_note), stale)


def _twin_note(twins: int) -> str:
    return (f"{_plural(twins, 'phone request')} {'is' if twins == 1 else 'are'} also in the Support Requests Queue "
            f"and listed there") if twins else ""


SHIFT_CLASS = {sr.APPLIED: (OPEN, "Applied"), sr.NEEDS_TRAINING: (OPEN, "Needs training approval"),
               sr.APPROVED: (RESOLVED, "Approved"), sr.NOT_CHOSEN: (RESOLVED, "Not chosen"),
               sr.WITHDRAWN: (RESOLVED, "Withdrawn"), sr.REFUSED: (RESOLVED, "Refused")}
SHIFT_KIND = {sr.KIND_OPEN: "Open shift", sr.KIND_CALLOFF: "Called-off shift", sr.KIND_IST: "Training approval"}


def _app_link(path: str) -> str:
    """A relay deep link (`/#/app/...`) as the router's own address."""
    return path[2:] if path.startswith("/#/") else path


def shift_applications(ctx: Ctx) -> dict[str, Any]:
    """R4: shift applications and training approvals; a call-off's caller never travels."""
    ctx.need_keys()
    got = ctx.db.shift_requests(sorted(ctx.keys) if ctx.own else None, SHIFT_LIMIT)
    limit_note = (f"only the newest {SHIFT_LIMIT} shift applications are read, so older ones are not shown"
                  if len(got) >= SHIFT_LIMIT else "")
    out, rehearsed = [], 0
    for r in got:
        if ctx.own and not ctx.mine_name(r.get("person")):
            continue
        if sr.is_rehearsed(r):
            rehearsed += 1
            continue
        kind = str(r.get("kind") or "")
        cls, word = SHIFT_CLASS.get(str(r.get("state") or ""), (RECORDED, _word(r.get("state")) or "Recorded"))
        location = str(r.get("location") or "")
        house = sr.short_house(location) if location else ""
        day = day_of(r.get("col_iso"))
        pool_ref = ""
        if r.get("pool_location"):
            pool_ref = str(r.get("pool_ref") or "") or sr.ref_of(location, str(r.get("open_row") or ""),
                                                                 str(r.get("col_iso") or ""))
        what = SHIFT_KIND.get(kind, _word(kind) or "Shift request")
        rid = str(r.get("id") or "")
        link = ({"app": "calendarbuilder", "page": "house-cal", "href": _app_link(sr.deep_link(pool_ref, location)),
                 "label": "Open in House Calendars"} if pool_ref else None)
        out.append(request_row(
            f"shift_requests:{rid}", person=r.get("person"), ref=rid,
            text=" · ".join(x for x in (what, house, " ".join(y for y in (_day_words(day), _text(r.get("value"), 40))
                                                              if y)) if x),
            submitted=r.get("created_at"), status_class=cls, status_word=word,
            concluded=is_concluded(cls, day, ctx.today),
            details=pairs(("Kind", what), ("House", house), ("Day", _day_words(day)), ("Shift", r.get("value")),
                          ("Filed", _word(r.get("via"))), ("Why", r.get("why")), ("Decided by", r.get("decided_by")),
                          ("Decided", _stamp_words(r.get("decided_at"))), ("Shift handle", pool_ref)),
            link=link))
    return _got(out, "", _join(limit_note, _rehearsal_note(rehearsed)))


def transfers_out(ctx: Ctx) -> dict[str, Any]:
    """R5: transfers of the person's own shifts (from_staff)."""
    ctx.need_keys()
    if ctx.own:
        rows, states, limit_note = ctx.handoffs(f"{_FOLD_COL.format('from_staff')} = ANY(%s)", (sorted(ctx.keys),))
    else:
        rows, states, limit_note = ctx.handoffs()
    out, rehearsed = [], 0
    for raw in rows:
        if ctx.own and not ctx.mine_name(raw.get("from_staff")):
            continue
        if shift_handoff.is_rehearsed(raw):
            rehearsed += 1
            continue
        d = shift_handoff.describe(raw, ctx.who, training_state=states.get(str(raw.get("training_request") or ""), ""))
        state = str(d.get("state") or "")
        if state == shift_handoff.PENDING:
            if d.get("staff_state") == shift_handoff.PENDING:
                word = f"Waiting on {d.get('to_staff') or 'the colleague'}"
            elif d.get("manager_state") == shift_handoff.PENDING:
                word = "Waiting on the house manager"
            elif d.get("director_state") == shift_handoff.PENDING:
                word = "Waiting on a director"
            else:
                word = "Waiting"
            cls = OPEN
        elif state == shift_handoff.DONE:
            cls, word = RESOLVED, "Transferred"
        elif state == shift_handoff.DEAD:
            cls, word = RESOLVED, "Closed"
        else:
            cls, word = RECORDED, _word(state) or "Recorded"
        out.append(request_row(
            f"transfers_out:{d['id']}", person=d.get("from_staff"), ref=d["id"],
            text=f"Shift transfer to {d.get('to_staff') or '—'} · {_handoff_words(d)}",
            submitted=d.get("created_at"), status_class=cls, status_word=word, details=_handoff_details(d),
            concluded=is_concluded(cls, day_of(d.get("col_iso")), ctx.today), link=LINK_SWAPS))
    return _got(out, "", _join(limit_note, _rehearsal_note(rehearsed)))


def call_offs(ctx: Ctx) -> dict[str, Any]:
    """R6: call-offs and late calls the person phoned in; attendance records about them are not requests."""
    ctx.need_keys()
    rows, as_of, stale = ctx.lane("callOffs")
    kept = []
    for raw in rows:
        kind = CALL_OFF_TYPES.get(_low(raw.get("type")))
        if not kind:
            continue
        if ctx.own and not ctx.mine_name(raw.get("employee_name")):
            continue
        kept.append((clean(raw), kind))
    days = sorted({d.isoformat() for r, k in kept if k == "Call Off" for d in [day_of(r.get("date"))] if d})
    pool: list[dict] | None = []
    pool_why = ""
    if days:
        try:
            pool = ctx.db.call_off_pool(days, sorted(ctx.keys) if ctx.own else None)
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said on each call-off, never guessed covered
            pool, pool_why = None, f"whether it was covered could not be read ({type(exc).__name__})"
    by_cell = {(fold(p.get("open_row")), str(p.get("col_iso") or "")[:10]): p for p in (pool or [])}
    out = []
    for r, kind in kept:
        day = day_of(r.get("date"))
        detail_extra: list[tuple[str, Any]] = []
        if kind == "Late Show":
            cls, word = RECORDED, "Late call logged"
        elif day is None:
            cls, word = RECORDED, "Filed"
            detail_extra.append(("Status", "The shift's day could not be read, so whether it was covered is not known"))
        elif pool is None:
            cls, word = RECORDED, "Filed"
            detail_extra.append(("Status", pool_why[:1].upper() + pool_why[1:]))
        else:
            hit = by_cell.get((fold(r.get("employee_name")), day.isoformat()))
            if hit and str(hit.get("filled_by") or "").strip():
                cls, word = RESOLVED, "Covered"
                if not ctx.own:
                    detail_extra.append(("Covered by", hit.get("filled_by")))
            elif hit and hit.get("closed_at"):
                cls, word = RESOLVED, "Closed"
            elif day < ctx.today:
                cls, word = RESOLVED, "Past"
            elif hit:
                cls, word = OPEN, "Being covered"
            else:
                # never pooled: nothing says anyone is covering it
                cls, word = RECORDED, "Filed"
                detail_extra.append(("Status", "It is not in the open-shift pool yet, so whether it is being covered "
                                               "is not known"))
        rid = _text(r.get("id"), 60)
        out.append(request_row(
            f"call_offs:{rid or len(out)}", person=r.get("employee_name"), ref=rid,
            ref_why="The call-off book keeps no id for this row.",
            text=" · ".join(x for x in (kind, _day_words(day) or _text(r.get("date"), 20)) if x),
            submitted=r.get("timestamp") or r.get("createdAt"), status_class=cls, status_word=word,
            concluded=is_concluded(cls, day, ctx.today),
            details=pairs(("Type", kind), ("Shift day", r.get("date")), ("How late", r.get("how_late")),
                          ("Notes", r.get("notes")), ("Taken by", r.get("your_name")),
                          ("Name taken from", r.get("name_from")), ("Recorded", r.get("timestamp")), *detail_extra)))
    return _got(out, as_of, "", stale)


INCIDENT_LABELS = (("incident_category", "Category"), ("incident_location", "Location"),
                   ("incident_date", "Incident date"), ("incident_time", "Incident time"),
                   ("incident_reported_date", "Reported date"), ("incident_reported_time", "Reported time"),
                   ("client_name", "Client"), ("employees_involved", "Employees involved"),
                   ("summary_of_incident", "Summary"), ("immediate_action_taken", "Immediate action"),
                   ("cause_and_contributing_factors", "Causes and contributing factors"),
                   ("prevention_plan", "Prevention plan"), ("your_name", "Filed by"), ("timestamp", "Filed"))


def incidents(ctx: Ctx) -> dict[str, Any]:
    """R7: incident reports the person filed; the book keeps no status, so none is guessed."""
    ctx.need_keys(contact=True)
    rows, as_of, stale = ctx.lane("uiIncidents")
    out = []
    nth: Counter = Counter()
    for raw in rows:
        if ctx.own and not (ctx.mine_name(raw.get("your_name")) or _low(raw.get("your_name")) in ctx.emails):
            continue
        r = clean(raw)
        base = "IN" + _sha10(f"{r.get('timestamp') or ''}|{r.get('your_name') or ''}|{r.get('client_name') or ''}|"
                             f"{r.get('incident_category') or ''}")
        nth[base] += 1
        ref = _nth_ref(base, nth[base])
        known = {k for k, _ in INCIDENT_LABELS} | {"id"}
        extra = [(_word(k), v) for k, v in r.items() if k not in known]
        cat = _text(r.get("incident_category"), 80)
        out.append(request_row(
            f"incidents:{ref}", person=r.get("your_name"), ref=ref,
            text="Incident report" + (f" · {cat}" if cat else ""), submitted=r.get("timestamp"),
            status_class=RECORDED, status_word="Filed",
            concluded=is_concluded(RECORDED, day_of(r.get("timestamp")) or day_of(r.get("incident_reported_date")),
                                   ctx.today),
            details=pairs(*[(label, r.get(k)) for k, label in INCIDENT_LABELS], *extra)))
    return _got(out, as_of, "", stale)


def house_repairs(ctx: Ctx) -> dict[str, Any]:
    """R8: the repairs form keeps no reporter; nothing in it can be claimed."""
    raise NotAttributable(REPAIRS_WHY[ctx.mode], structural=True)


READERS: dict[str, Callable[[Ctx], dict[str, Any]]] = {
    "requirements": requirements, "ist": ist, "policies": policies, "transfers": transfers,
    "time_off_decisions": time_off_decisions, "transfer_decisions": transfer_decisions, "scheduling": scheduling,
    "vehicle_calendar": vehicle_calendar, "support_desk": support_desk, "employee_loans": employee_loans,
    "time_off":time_off_requests, "support_requests": support_requests, "hotline": hotline,
    "shift_requests": shift_applications, "transfers_out": transfers_out, "call_offs": call_offs,
    "incidents": incidents, "house_repairs": house_repairs,
}


# ── the board ───────────────────────────────────────────────────────────────

def _head(key: str, state: str, why: str = "", *, as_of: str = "", count: int | None = None, note: str = "",
          stale_why: str = "", copy_why: str = "", structural: bool = False, gap: str = "") -> dict[str, Any]:
    return {"key": key, "label": LABELS[key], "state": state, "why": why, "as_of": as_of, "count": count,
            "hidden": 0, "capped": False, "stale_why": stale_why, "copy_why": copy_why, "note": note,
            "structural": structural, "gap": gap}


def _unique_ids(rows: list[dict]) -> None:
    """A row id is the screen's key for it: a repeat inside one source gets a count, never a twin."""
    seen: Counter = Counter()
    for r in rows:
        seen[r["id"]] += 1
        if seen[r["id"]] > 1:
            r["id"] = f"{r['id']}~{seen[r['id']]}"


def _run(ctx: Ctx, key: str) -> tuple[dict[str, Any], list[dict]]:
    try:
        got = READERS[key](ctx)
    except NotAttributable as exc:
        return _head(key, STATE_NOT_ATTRIBUTABLE, str(exc), structural=exc.structural), []
    except Unreadable as exc:
        return _head(key, STATE_UNREADABLE, str(exc)), []
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: one source that throws is said; the rest answer
        log.warning("my work: %s failed (%s: %s)", key, type(exc).__name__, str(exc)[:160])
        return _head(key, STATE_UNREADABLE, f"it could not be read ({type(exc).__name__})"), []
    rows = list(got.get("rows") or [])
    for r in rows:
        r["source"] = key
    _unique_ids(rows)
    return (_head(key, STATE_READY, as_of=str(got.get("as_of") or ""), count=len(rows),
                  note=str(got.get("note") or ""), stale_why=str(got.get("stale_why") or ""),
                  copy_why=str(got.get("copy_why") or ""), gap=str(got.get("gap") or "")), rows)


TONE_ORDER = {TONE_OVERDUE: 0, TONE_SOON: 1, TONE_LATER: 2, "": 3}
CLASS_ORDER = {OPEN: 0, RECORDED: 1, RESOLVED: 2}


def _action_sort(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda a: (TONE_ORDER.get(a["due_tone"], 3), a["due"] or "9999-12-31",
                                       a["condition"]))


def _request_sort(rows: list[dict]) -> list[dict]:
    rows = sorted(rows, key=lambda r: r["submitted"] or "", reverse=True)
    return sorted(rows, key=lambda r: CLASS_ORDER.get(r["status"]["class"], 1))


def _keep_newest_resolved(heads: list[dict], rows: list[dict]) -> list[dict]:
    """Every open and recorded row, and the newest RESOLVED_KEPT resolved ones per source."""
    by_source: dict[str, list[dict]] = {}
    for r in rows:
        if r["status"]["class"] == RESOLVED:
            by_source.setdefault(r["source"], []).append(r)
    dropped: set[int] = set()
    for key, resolved in by_source.items():
        resolved.sort(key=lambda r: r["submitted"] or "", reverse=True)
        cut = resolved[RESOLVED_KEPT:]
        dropped |= {id(r) for r in cut}
        for h in heads:
            if h["key"] == key and cut:
                h["hidden"] = len(cut)
                h["note"] = _join(h["note"], f"{_plural(len(cut), 'older resolved request')} "
                                             f"{'is' if len(cut) == 1 else 'are'} not shown")
    return [r for r in rows if id(r) not in dropped]


def _people(actions: list[dict], requests: list[dict]) -> list[dict[str, Any]]:
    spell: dict[str, Counter] = {}
    tally: dict[str, list[int]] = {}
    for part, rows in ((0, actions), (1, requests)):
        for r in rows:
            k = fold(r.get("_person"))
            if not k or r.get("_everyone"):
                continue
            spell.setdefault(k, Counter())[r["_person"]] += 1
            t = tally.setdefault(k, [0, 0])
            if part == 0 or r["status"]["class"] == OPEN:
                t[part] += 1
    out = [{"key": k, "name": spell[k].most_common(1)[0][0], "open_actions": t[0], "open_requests": t[1]}
           for k, t in tally.items()]
    return sorted(out, key=lambda p: p["name"].lower())


def _finish(rows: list[dict], mass: bool) -> list[dict]:
    """Private fields off; the person named only on a mass read."""
    out = []
    for r in rows:
        person = r.pop("_person", "")
        everyone = r.pop("_everyone", False)
        r.pop("_dedupe", None)
        r.pop("_concluded", None)
        if mass:
            r["person"] = {"key": "" if everyone else fold(person), "name": person}
        out.append(r)
    return out


def _cap(heads: list[dict], rows: list[dict]) -> tuple[list[dict], str]:
    if len(rows) <= MASS_CAP:
        return rows, ""
    kept = rows[:MASS_CAP]
    kept_ids = {id(r) for r in kept}
    capped = {r["source"] for r in rows if id(r) not in kept_ids}
    for h in heads:
        if h["key"] in capped:
            h["capped"] = True
    return kept, f"Showing {MASS_CAP} of {len(rows)} — pick a person to see all of theirs."


def _drop_hidden(heads: list[dict], rows: list[dict], gone: Callable[[dict], bool]) -> list[dict]:
    """Rows the master hides never leave the server; a ready source counts what is left."""
    kept = [r for r in rows if not gone(r)]
    if len(kept) != len(rows):
        for h in heads:
            if h["state"] == STATE_READY:
                h["count"] = sum(1 for r in kept if r["source"] == h["key"])
    return kept


def requests_for(dsn: str, *, me: dict[str, Any], who: dict[str, Any], lanes: dict[str, Any] | None,
                 lanes_why: str = "", on: date | None = None, db: Any = None) -> tuple[list[dict], list[dict]]:
    """The request half of the board in own mode alone — (heads, rows) — for a screen that lists a person's own…"""
    own_db = db is None
    db = db if db is not None else PgMirror(dsn)
    try:
        ctx = Ctx(dsn, mode=MODE_OWN, me=me, who=who, lanes=lanes, lanes_why=lanes_why, on=on or today(), db=db)
        heads, rows = [], []
        for key, _label in REQUEST_SOURCES:
            head, got = _run(ctx, key)
            heads.append(head)
            rows.extend(got)
    finally:
        if own_db:
            db.close()
    for r in rows:
        if r.get("_dedupe") and r["_dedupe"] in ctx.queue_keys:
            r["details"].append({"label": "Also in", "value": "the Employee Support Queue"})
    return heads, _finish(_request_sort(rows), False)


def board(dsn: str, *, mode: str, me: dict[str, Any], who: dict[str, Any], lanes: dict[str, Any] | None,
          lanes_why: str = "", person: str = "", scope_why: str = "", on: date | None = None,
          db: Any = None, hide: dict[str, bool] | None = None) -> dict[str, Any]:
    """The whole answer; each source in its own FAIL-CLOSED run, narrowed before it is returned."""
    mass = mode == MODE_MASS
    hide = hide or {}
    only = fold(person) if mass else ""
    own_db = db is None
    db = db if db is not None else PgMirror(dsn)
    try:
        ctx = Ctx(dsn, mode=mode, me=me, who=who, lanes=lanes, lanes_why=lanes_why, on=on or today(), db=db,
                  only=only)
        a_heads, a_rows = [], []
        for key, _label in ACTION_SOURCES:
            head, rows = _run(ctx, key)
            a_heads.append(head)
            a_rows.extend(rows)
        r_heads, r_rows = [], []
        for key, _label in REQUEST_SOURCES:
            head, rows = _run(ctx, key)
            r_heads.append(head)
            r_rows.extend(rows)
    finally:
        if own_db:
            db.close()
    if hide.get("completed") is True:
        r_rows = _drop_hidden(r_heads, r_rows, lambda r: r.get("_concluded") is True)
        # a phone request is said to be listed under its Support twin only while that twin is still listed
        listed = {r.get("_dedupe") for r in r_rows if r["source"] == "support_requests"}
        for h in r_heads:
            if h["key"] == "hotline" and h["state"] == STATE_READY:
                h["note"] = _join(_twin_note(sum(1 for k in ctx.twin_keys if k in listed)), ctx.hotline_line_note)
    if hide.get("missing_row") is True:
        a_rows = _drop_hidden(a_heads, a_rows, lambda r: r.get("folded") is True)
    for r in r_rows:
        if r.get("_dedupe") and r["_dedupe"] in ctx.queue_keys:
            r["details"].append({"label": "Also in", "value": "the Employee Support Queue"})
    people = _people(a_rows, r_rows) if mass else None
    if mass and only:
        name = next((p["name"] for p in people or [] if p["key"] == only), person)
        for r in a_rows:
            if r.get("_everyone"):
                r["_person"], r["_everyone"] = name, False
        a_rows = [r for r in a_rows if fold(r.get("_person")) == only]
        r_rows = [r for r in r_rows if fold(r.get("_person")) == only]
        for heads, rows in ((a_heads, a_rows), (r_heads, r_rows)):
            for h in heads:
                if h["state"] == STATE_READY:
                    h["count"] = sum(1 for r in rows if r["source"] == h["key"])
    a_rows = _action_sort(a_rows)
    # counted before the trim below: the figure is every resolved request on record, not the ones kept
    resolved = sum(1 for r in r_rows if r["status"]["class"] == RESOLVED)
    r_rows = _request_sort(_keep_newest_resolved(r_heads, r_rows))
    totals = {"actions": len(a_rows), "overdue": sum(1 for r in a_rows if r["due_tone"] == TONE_OVERDUE),
              "open_requests": sum(1 for r in r_rows if r["status"]["class"] == OPEN),
              "resolved": resolved}
    a_note = r_note = ""
    if mass and not only:
        a_rows, a_note = _cap(a_heads, a_rows)
        r_rows, r_note = _cap(r_heads, r_rows)
    scope: dict[str, Any] = {"mode": mode, "why": scope_why, "person": only}
    if mass:
        scope["people"] = people
    return {"scope": scope,
            "me": {"name": me.get("roster_name") or me.get("name") or "", "key_why": me.get("key_why") or "",
                   "notes": list(me.get("notes") or [])},
            "actions": {"sources": a_heads, "rows": _finish(a_rows, mass), "note": a_note},
            "requests": {"sources": r_heads, "rows": _finish(r_rows, mass), "note": r_note},
            "totals": totals,
            "read_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
