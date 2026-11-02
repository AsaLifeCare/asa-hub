"""My Profile (server/my_profile.py) off asa-hub-db: one person's details and compliance requirements, the sheets read
with Python's own edits laid. One read (myProfileView) builds the answer for the scope the relay decided."""
from __future__ import annotations

import json
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import clients as client_book
import gsjs
import hubdb
import locations as L
import mw_relay_state as relay_state
import mw_shifts
import my_work as mw
import scope as sc
from scope import Defer

log = logging.getLogger("asa-hub-app")

# the relay module my_profile stood on, under the name it called it by
ist_config = mw_shifts.ist

APP_ID = "my-profile"
CORE_USERS_SHEET_ID = mw.CORE_USERS_SHEET_ID
# what this service cannot read defers to the relay, never a sentence of its own
_LOUD = (Defer, hubdb.Unreadable)

MODE_OWN, MODE_MASS = mw.MODE_OWN, mw.MODE_MASS
STATE_READY, STATE_UNREADABLE, STATE_NOT_ATTRIBUTABLE = mw.STATE_READY, mw.STATE_UNREADABLE, mw.STATE_NOT_ATTRIBUTABLE
STATE_NOT_APPLICABLE = "not_applicable"
UTC = timezone.utc

# a roster row is asked for by its own id as the roster writes it, nothing else
PERSON_RE = re.compile(r"[\w .:@'’-]{1,120}")
# a client is asked for by its client key ("jane_doe"), nothing else
CLIENT_RE = re.compile(r"[\w .:@'’-]{1,120}")
KIND_STAFF, KIND_CLIENT = "staff", "client"
# who reads a client-role profile: the client, or a guardian signed in for them
VIEWER_CLIENT, VIEWER_GUARDIAN = "client", "guardian"

CLIENTS_UNREAD = "the clients list"
# how old an accounts copy may be and still vouch for a widening (the relay's MIRROR_TRUST_MAX_S)
FRESH_S = 7200.0
# a pass over a book that ended with its copy whole: the keeper's, or one read straight from Google
CLEAN_PASS = frozenset({"ok", "direct", "direct_formatted"})
LINK_GAP = "Whether this account is still tied to its client could not be confirmed, so this is not shown."
REQS_NOT_CLIENT = "Requirements apply to staff, not to clients."
# App Control's row My Profile splits My Requirements off (src/lib/featureAccess.ts APP_FEATURES): a badge it does not
# name is answered My Details alone, the requirements withheld in their own words. An empty row is the master's alone.
REQS_FEATURE = "my-profile.requirements"
REQS_SHUT = "My Requirements is not open to this account in App Control."
DOCS_NOT_CLIENT = "Submitted documents apply to staff, not to clients."
CLIENT_MISSING_WHY = {
    "client_id": "No client number is on file.",
    "house": "No house is on file.",
    "start_date": "No start date is on file.",
    "phone": "No phone is on file for the client.",
    "email": "No e-mail is on file for the client.",
    "address": "No home address is on file.",
    "guardian": "No guardian is named on file.",
    "guardian_phone": "No guardian phone is on file.",
    "guardian_email": "No guardian e-mail is on file.",
}
GUARDIAN_SELF_NOTE = "The client record names the client as their own guardian."

CURRENT, SOON, ATTENTION, UNKNOWN = "current", "soon", "attention", "unknown"
STATUS_WORDS = {CURRENT: "Current", SOON: "Due soon", ATTENTION: "Needs attention"}
STATE_CLASS = {"ok": CURRENT, "expiring": SOON, "expired": ATTENTION, "missing": ATTENTION}
NOT_APPLICABLE = frozenset({"na", "n/a"})
CLASS_ORDER = {ATTENTION: 0, SOON: 1, CURRENT: 2, UNKNOWN: 3}
UPLOADABLE = frozenset({"training", "documents"})
# what the person files themselves from My Requirements: the dated categories, and the onboarding forms they hold. An
# onboarding form is filed under its label alone — the certificate door takes a requirement id only for UPLOADABLE
SELF_FILED = UPLOADABLE | {"onboarding"}
CATEGORY_WORDS = {"training": "Training", "documents": "Documents", "onboarding": "Onboarding paperwork",
                  "background": "Background check", "admin": "Admin"}

MISSING_WHY = {
    "employee_id": "No employee ID is on file.",
    "role": "No role or title is on file.",
    "start_date": "No start date is on file.",
    "phone": "No phone is on file.",
    "email": "No e-mail is on file.",
    "address": "No address is on file — the staff roster keeps a city and state only, and both are blank.",
}
# the lane's own words, the same whichever engine answers
WITHHELD_WHY = "Withheld from the copy the relay reads."
ADDRESS_NOTE = "City and state only — the staff roster keeps no street address."
TITLE_NOTE = "As written on the account's own profile, not taken from the staff roster."

UPLOAD_FORM = "HR files this form."
UPLOAD_HR = "HR records this one."
UPLOAD_NO_NAME = "No name that is yours alone is on the staff roster to file the upload under — hand the document to HR."
# ComplianceDocs.gs CERT_CONFIRM_WORDS: the master's confirmation of a read date into the record
CONFIRM_NOT_MASTER = "Only the master confirms a date into the record."
CONFIRM_MED = "Med Delivery dates are written by the MAIS registry check, not here."
CONFIRM_MAIS = "MAIS has no date column in the record."
CONFIRM_UNDATED = "This requirement keeps no date in the record."
MED_IDS = frozenset({"med1", "med2", "med3"})
MED_SOURCE_RE = re.compile(r"^med\s*\d", re.I)
EXPIRY_SOURCE_RE = re.compile(r"\bexp", re.I)
ROLE_EXPIRES = "expires"
ROLE_ISSUED = "issued"
UNREAD = "could not be read"
# a refused row is somebody's record: its status and its ties are never described to the caller
NOT_YOURS = "a staff roster row under your name is not taken as yours — HR can settle which record is yours"
OWN_ROWS_ONLY = "your requirement rows are matched only through your own staff roster row, so none is shown"
OWN_ROWS_SHARED = ("another row of the staff roster carries your name, so requirement rows filed under it cannot be "
                   "told apart — HR can settle which row is yours")
STAFF_UNREAD = "the statuses that count as on staff"

# how a record behind My Info answered: read, unread (the read failed), untold (rows could not be told apart), none
S_READ, S_UNREAD, S_UNTOLD, S_NONE = "read", "unread", "untold", "none"
ROSTER_UNREAD = "the staff roster"

# ContactGuard.gs cgBlockStatuses_: the roster statuses that count as on staff, configured or shipped
STAFF_CONFIG_TAB, STAFF_CONFIG_KEY = "hiring_alerts_config", "staff_guard_block_statuses"
ON_STAFF_SHIPPED = frozenset({"active", "admin"})


class NoSuchPerson(LookupError):
    """The master asked for a roster row, or a client, that its source was read and does not hold."""


def _text(value: Any, limit: int = 400) -> str:
    return mw._text(value, limit)


def _low(value: Any) -> str:
    return mw._low(value)


def _sentence(text: str) -> str:
    t = str(text or "").strip()
    return (t[:1].upper() + t[1:]) if t else ""


def _why(exc: BaseException, what: str) -> str:
    """A failed read in words: an Unreadable's own sentence, else the kind of failure."""
    if isinstance(exc, mw.Unreadable):
        return str(exc)
    return f"{what} {UNREAD} ({type(exc).__name__})"


def _roster_id(value: Any) -> str:
    """A roster id as the accounts tab links it (ComplianceDocs.gs complianceDocsRosterId_)."""
    return re.sub(r"^people:", "", str(value or "").strip()).strip()


def _mail(value: Any) -> str:
    """An address that may be matched on: lower-cased, never a withheld cell."""
    m = _low(value)
    return m if "@" in m and not mw._is_marker(m) else ""


def _row_mails(row: dict[str, Any] | None) -> set[str]:
    """A roster row's addresses (ComplianceDocs.gs complianceDocsRosterMails_)."""
    row = row or {}
    got = {_mail(e) for e in [row.get("email"), *mw._json_list(row.get("emails"))]}
    got.discard("")
    return got


# ── the reads ────────────────────────────────────────────────────────────────

class Books(mw.HubBooks):
    """My Work's reads, and the two this door adds: the accounts tied to a roster row, and the accounts copy's age."""

    def accounts_for(self, core_sheet_id: str, roster_id: str, emails: list[str]) -> list[dict[str, Any]]:
        """Live accounts linked to `roster_id` or signing in with one of `emails`."""
        rows = self.users_rows(core_sheet_id,
                               f"regexp_replace(btrim({mw._f('people_id')}), '^people:', '') = %s "
                               f"OR lower(btrim({mw._f('email')})) = ANY(%s)",
                               (roster_id or mw.NO_KEY, list(emails) or [mw.NO_KEY]))
        return tied_accounts([r for r in rows if isinstance(r, dict)], roster_id, emails)

    def users_copy(self, core_sheet_id: str) -> tuple[float | None, bool]:
        """(seconds since the accounts tab was last copied, or None; whether the last pass over its book was clean). The
        accounts kept in their own table are the record itself: no copy to age."""
        if self._kept_name(core_sheet_id, "users") is not None:
            return 0.0, True
        ref = self._ref(core_sheet_id, "users")
        if ref is None:
            raise Defer("the accounts book is not in asa-hub-db")
        _total, newest = self._count(ref)
        book = self.db.book(core_sheet_id)
        age = None
        if isinstance(newest, datetime):
            newest = newest if newest.tzinfo else newest.replace(tzinfo=UTC)
            age = (datetime.now(UTC) - newest).total_seconds()
        return age, book is not None and _low(book.status) in CLEAN_PASS


def tied_accounts(rows: list[dict[str, Any]], roster_id: str, emails: list[str]) -> list[dict[str, Any]]:
    """The live accounts among `rows` linked to the roster row or signing in with one of its e-mails."""
    wanted = set(emails)
    return [r for r in rows if mw._live(r) and ((roster_id and _roster_id(r.get("people_id")) == roster_id)
                                                or _low(r.get("email")) in wanted)]


def _house(db: Any, pointer: str, what: str) -> str:
    pointers = db.pointers()
    sid = pointers.get(pointer, "")
    if not sid:
        raise mw.Unreadable(f"no house is declared for {what} (the depot's newest {pointer} is blank)"
                            if pointer in pointers else
                            f"no house is declared for {what} (the depot carries no {pointer})")
    return sid


def _house_rows(db: Any, pointer: str, what: str, where: str = "", args: tuple = ()) -> tuple[list[dict], str]:
    """(raw rows, as_of) from the declared house; a house not copied yet is Unreadable, never []."""
    rows, total, as_of = db.tab(_house(db, pointer, what), mw.HOUSE_TAB, where, args)
    if not total:
        raise mw.Unreadable(f"the {what} house is declared but not copied yet")
    return rows, as_of


def _roster(db: Any, where: str = "", args: tuple = ()) -> tuple[list[dict], str]:
    rows, as_of = _house_rows(db, mw.PTR_PEOPLE, "staff roster", where, args)
    return [mw.clean(r) for r in rows], as_of


def staff_statuses(db: Any, core_sheet_id: str) -> frozenset[str]:
    """The roster statuses that count as on staff: the configured list, else the shipped one when none is set."""
    rows, _total, _at = db.tab(core_sheet_id, STAFF_CONFIG_TAB, f"btrim({mw._f('key')}) = %s", (STAFF_CONFIG_KEY,))
    raw = next((str(r.get("value") or "") for r in rows if str(r.get("key") or "").strip() == STAFF_CONFIG_KEY), "")
    got = frozenset(v.strip().lower() for v in re.split(r"[,;\n]+", raw) if v.strip())
    return got or ON_STAFF_SHIPPED


def _distinct(rows: list[dict]) -> list[dict]:
    """Roster rows once each, by id (a row with no id is its own)."""
    out: dict[str, dict] = {}
    for r in rows:
        out.setdefault(_text(r.get("id"), 120) or f"#{id(r)}", r)
    return list(out.values())


def people_list(db: Any) -> list[dict[str, str]]:
    """Every named roster row the master may choose, by its id."""
    rows, _as_of = _roster(db)
    out = [{"key": _text(r.get("id"), 120), "name": _text(r.get("name"), 120), "status": mw._word(r.get("status")),
            "kind": KIND_STAFF} for r in _distinct(rows)]
    out = [p for p in out if p["key"] and p["name"] and PERSON_RE.fullmatch(p["key"])]
    return sorted(out, key=lambda p: (p["name"].lower(), p["key"]))


# ── whose profile this is ────────────────────────────────────────────────────

def _subject(**over: Any) -> dict[str, Any]:
    base = {"own": True, "name": "", "ledger_key": "", "ledger_why": "", "upload_why": "", "roster_id": "",
            "roster": None, "roster_state": S_NONE, "roster_unread": ROSTER_UNREAD, "roster_gap": "",
            "roster_why": "", "roster_as_of": "", "roster_shared": False, "account": None, "account_state": S_NONE,
            "account_unread": "", "account_gap": "", "account_why": "", "account_note": "", "keys": set(),
            "emails": set(), "phones": set(), "key_why": "", "notes": []}
    base.update(over)
    return base


def _roster_unsettled(s: dict[str, Any], state: str, why: str, gap: str, *, unread: str = ROSTER_UNREAD) -> dict:
    """No roster row is this account's: every field only the roster holds says why, and nothing is filed."""
    if state == S_UNREAD:
        ledger_why = f"{unread} {UNREAD}, so no submitted document can be matched to you"
        upload_why = _sentence(f"{unread} {UNREAD}, so which record is yours is not settled — try again in a minute.")
    else:
        ledger_why = "no staff roster row is settled as yours, so no submitted document can be matched to you"
        upload_why = UPLOAD_NO_NAME
    s.update(roster_state=state, roster_why=why, roster_gap=gap, roster_unread=unread, ledger_key="",
             ledger_why=ledger_why, upload_why=upload_why)
    return s


def own_subject(db: Any, core_sheet_id: str, me: dict[str, Any], uid: str) -> dict[str, Any]:
    """The signed-in account: its own accounts row, and the ONE roster row my_work.identity's name keys reach."""
    keys, emails = set(me.get("keys") or []), set(me.get("emails") or [])
    primary = mw.fold(me.get("roster_name"))
    s = _subject(keys=keys, emails=emails, phones=set(me.get("phones") or []),
                 key_why=str(me.get("key_why") or ""), notes=list(me.get("notes") or []),
                 name=str(me.get("roster_name") or me.get("name") or ""))
    try:
        s["account"] = db.users_row(core_sheet_id, uid)
        if s["account"] is None:
            s["account_note"] = "this account has no row in the accounts book"
        else:
            s["account_state"] = S_READ
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the fields it would fill say so
        s.update(account_state=S_UNREAD, account_unread="your account row", account_why=_why(exc, "your account row"))
    none_gap = "No staff roster row is tied to you, so this is not known."
    if not keys:
        return _roster_unsettled(s, S_NONE, (s["key_why"] or "no name that is yours alone names a roster row")
                                 + ", so no roster row is taken as yours", none_gap)
    try:
        rows, as_of = _roster(db, f"{mw._fold_f('name')} = ANY(%s)", (sorted(keys),))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: no roster field is guessed
        return _roster_unsettled(s, S_UNREAD, _why(exc, "the staff roster"), "")
    s["roster_as_of"] = as_of
    rows = _distinct([r for r in rows if mw.fold(r.get("name")) in keys])
    if not rows:
        return _roster_unsettled(s, S_NONE, "no row of the staff roster is under your name", none_gap)
    try:
        on_staff: frozenset[str] | None = staff_statuses(db, core_sheet_id)
        staff_why = ""
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: a row that needs a staff status is not taken
        on_staff, staff_why = None, _why(exc, STAFF_UNREAD)
    taken: list[tuple[dict, bool]] = []
    unknown = False
    for r in rows:
        has_mail = bool(_row_mails(r) & emails)
        bridged = mw.fold(r.get("name")) != primary
        # reached through the spelling the sign-in e-mail bridged: an on-staff row carrying that e-mail only
        if bridged and not has_mail:
            continue
        if bridged or not has_mail:
            if on_staff is None:
                unknown = True
                continue
            if _low(r.get("status")) not in on_staff:
                continue
        taken.append((r, has_mail))
    mine: list[tuple[dict, bool]] = []
    for r, has_mail in taken:
        try:
            others = [a for a in db.accounts_for(core_sheet_id, _text(r.get("id"), 120), sorted(_row_mails(r)))
                      if str(a.get("user_id") or "") != str(uid)]
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: a row that may be another account's is not yours
            tie = "whether another account is tied to your staff roster row"
            cause = str(exc) if isinstance(exc, mw.Unreadable) else type(exc).__name__
            return _roster_unsettled(s, S_UNREAD, f"{tie} {UNREAD} ({cause})", "", unread=tie)
        if others:
            continue
        mine.append((r, has_mail))
    if unknown and not any(m for _r, m in mine):
        # only a row carrying the sign-in e-mail outranks one whose staff status could not be judged
        return _roster_unsettled(s, S_UNREAD, f"{staff_why}, so whether the staff roster row under your name is "
                                              f"yours cannot be settled", "", unread=STAFF_UNREAD)
    if len(mine) > 1:
        with_mail = [m for m in mine if m[1]]
        mine = with_mail if len(with_mail) == 1 else mine
    if len(mine) > 1:
        # FAIL-CLOSED: two rows either of which could be yours are neither
        return _roster_unsettled(s, S_UNTOLD, "more than one row of the staff roster is under your name, so which "
                                              "one is yours cannot be told",
                                 "Which staff roster row is yours cannot be told, so this is not shown.")
    if not mine:
        # the refused row may be a namesake's: nothing of its status or its ties is said
        return _roster_unsettled(s, S_UNTOLD, NOT_YOURS,
                                 "The staff roster row under your name is not taken as yours, so this is not shown.")
    row = mine[0][0]
    key = mw.fold(row.get("name"))
    s.update(roster=row, roster_state=S_READ, roster_id=_text(row.get("id"), 120),
             name=_text(row.get("name"), 120) or s["name"])
    if any(r is not row and mw.fold(r.get("name")) == key for r in rows):
        # the certificate door refuses a name two roster rows carry: nothing filed under it can be told apart
        s.update(roster_shared=True, upload_why=UPLOAD_NO_NAME,
                 ledger_why="another row of the staff roster carries your name, so documents filed under it "
                            "cannot be told apart")
    else:
        s["ledger_key"] = key
    return s


def chosen_subject(db: Any, core_sheet_id: str, person: str) -> dict[str, Any]:
    """The roster row the master chose, and the one live account tied to it (linked to it, or by its e-mail)."""
    s = _subject(own=False, roster_id=person)
    try:
        rows, as_of = _roster(db, f"btrim({mw._f('id')}) = %s", (person,))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the person is not guessed from anything else
        why = _why(exc, "the staff roster")
        # no account is looked up for a row that could not be read: its fields are the roster's unread too
        s.update(roster_state=S_UNREAD, roster_why=why, account_state=S_UNREAD, account_unread=ROSTER_UNREAD,
                 key_why=f"{why}, so whose requirements these are is not known",
                 ledger_why=f"{ROSTER_UNREAD} {UNREAD}, so no submitted document can be matched to this person")
        return s
    hits = _distinct([r for r in rows if _text(r.get("id"), 120) == person])
    if not hits:
        raise NoSuchPerson("No row of the staff roster carries that person.")
    row = hits[0]
    s.update(roster=row, roster_state=S_READ, roster_as_of=as_of, name=_text(row.get("name"), 120))
    key = mw.fold(row.get("name"))
    s["emails"] |= _row_mails(row)
    if key:
        try:
            twins, _at = _roster(db, f"{mw._fold_f('name')} = %s", (key,))
            twins = _distinct([t for t in twins if mw.fold(t.get("name")) == key])
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: a name that may be shared matches nothing
            s["notes"].append(f"whether another roster row carries this name {UNREAD} "
                              f"({_why(exc, 'the staff roster')}), so rows filed by name are not matched")
        else:
            if len(twins) > 1:
                s["notes"].append("another row of the staff roster carries this name, so rows filed by name "
                                  "are not matched")
            else:
                s["keys"].add(key)
                s["ledger_key"] = key
    if not s["keys"]:
        s["key_why"] = "this roster row's name cannot be matched on"
    if not s["ledger_key"]:
        s["ledger_why"] = ("no roster name that is this profile's alone is on file, so no submitted document "
                           "can be matched to it")
    try:
        accounts = db.accounts_for(core_sheet_id, person, sorted(s["emails"]))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — the roster still answers the fields it holds
        s.update(account_state=S_UNREAD, account_unread="the accounts tied to this roster row",
                 account_why=_why(exc, "the accounts tied to this roster row"))
        return s
    by_uid = {str(a.get("user_id") or ""): a for a in accounts if str(a.get("user_id") or "")}
    if len(by_uid) == 1:
        s.update(account=next(iter(by_uid.values())), account_state=S_READ)
        if _mail(s["account"].get("email")):
            s["emails"].add(_mail(s["account"].get("email")))
    elif by_uid:
        s.update(account_state=S_UNTOLD,
                 account_note="more than one account is tied to this roster row, so no account's own fields are shown",
                 account_gap="More than one account is tied to this roster row, so this is not shown.")
    else:
        s["account_note"] = "no account is tied to this roster row, so every field is the roster's"
    return s


# ── MY DETAILS ───────────────────────────────────────────────────────────────

def _cell(row: dict[str, Any] | None, *names: str) -> tuple[str, bool]:
    """(the first readable value among `names`, whether a withheld one was met)."""
    withheld = False
    for n in names:
        v = _text((row or {}).get(n), 300)
        if not v:
            continue
        if mw._is_marker(v):
            withheld = True
            continue
        return v, withheld
    return "", withheld


def _sources(s: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The two records behind My Info, each with how it answered and what a blank field then says."""
    roster = {"kind": "roster", "row": s["roster"] if s["roster_state"] == S_READ else None,
              "state": s["roster_state"], "unread": s["roster_unread"], "gap": s["roster_gap"]}
    account = {"kind": "account", "row": s["account"] if s["account_state"] == S_READ else None,
               "state": s["account_state"], "unread": s["account_unread"], "gap": s["account_gap"]}
    return roster, account


def _blank_why(key: str, srcs: list[dict[str, Any]], withheld: bool) -> str:
    """Why a field is blank: a withheld cell, a record that could not be read, one untold, one untied, else none."""
    if withheld:
        return WITHHELD_WHY
    unread = list(dict.fromkeys(x["unread"] for x in srcs if x["state"] == S_UNREAD and x["unread"]))
    if unread:
        return _sentence(f"{' and '.join(unread)} {UNREAD}, so this is not known.")
    untold = [x for x in srcs if x["state"] == S_UNTOLD and x["gap"]]
    if untold:
        return untold[0]["gap"]
    untied = [x for x in srcs if x["kind"] == "roster" and x["state"] == S_NONE and x["gap"]]
    if untied:
        return untied[0]["gap"]
    return MISSING_WHY[key]


def _field(key: str, label: str, picks: list[tuple[dict[str, Any], tuple[str, ...]]]) -> dict[str, str]:
    withheld = False
    for src, names in picks:
        value, w = _cell(src["row"], *names)
        withheld = withheld or w
        if value:
            if key == "start_date":
                d = mw.day_of(value)
                value = d.isoformat() if d else value
            note = TITLE_NOTE if key == "role" and src["kind"] == "account" else ""
            return {"key": key, "label": label, "value": value, "why": "", "note": note}
    return {"key": key, "label": label, "value": "", "why": _blank_why(key, [p[0] for p in picks], withheld),
            "note": ""}


# the badges a Role names over the roster's word: the house manager's and every one above it (scope.BADGE_ORDER)
LEAD_BADGES = sc.BADGE_ORDER[:sc.BADGE_ORDER.index("HM") + 1]


def _role(roster: dict[str, Any], account: dict[str, Any]) -> dict[str, str]:
    """Role: the highest badge the account wears when it leads (a director over an administrator), as the person's
    own corners draw it; under the house manager's, the roster's role or the account's title."""
    row = account["row"] or {}
    top = sc.highest_badge(row.get("types"), _low(row.get("email")) == sc.MASTER_ACCOUNT) if account["row"] else ""
    if top in LEAD_BADGES:
        return {"key": "role", "label": "Role", "value": sc.badge_reads(top), "why": "", "note": ""}
    return _field("role", "Role", [(roster, ("role",)), (account, ("title",))])


def details(s: dict[str, Any]) -> dict[str, Any]:
    """My Info: each field from the first record that holds it — the roster for what HR keeps, the account else."""
    roster, account = _sources(s)
    fields = [
        _field("employee_id", "Employee ID", [(roster, ("employee_id",)), (account, ("employee_id",))]),
        _role(roster, account),
        _field("start_date", "Start date", [(roster, ("start_date",)), (account, ("start_date",))]),
        _field("phone", "Phone", [(account, ("phone",)), (roster, ("phone",))]),
        _field("email", "Email", [(account, ("email",)), (roster, ("email",))]),
    ]
    city, w1 = _cell(roster["row"], "city")
    state, w2 = _cell(roster["row"], "state")
    place = ", ".join(x for x in (city, state) if x)
    if place:
        fields.append({"key": "address", "label": "Address", "value": place, "why": "", "note": ADDRESS_NOTE})
    else:
        fields.append({"key": "address", "label": "Address", "value": "",
                       "why": _blank_why("address", [roster], w1 or w2), "note": ""})
    notes = [n for n in (s["roster_why"], s["account_why"], s["account_note"]) if n]
    # FAIL-CLOSED: with the roster unread and no account row answering, nothing on the card was read
    unread = roster["state"] == S_UNREAD and account["state"] in (S_UNREAD, S_NONE)
    why = ""
    if unread:
        why = "the staff roster did not answer" if roster["unread"] == ROSTER_UNREAD else f"{roster['unread']} {UNREAD}"
        if account["state"] == S_NONE:
            why += f", and {s['account_note'] or 'no account row answers for it'}"
        elif account["unread"] == ROSTER_UNREAD:
            why += ", so no account tied to this row was looked up"
        else:
            why += f", and {account['unread']} did not answer"
    return {"state": STATE_UNREADABLE if unread else STATE_READY, "why": why,
            "fields": fields, "notes": notes, "as_of": s["roster_as_of"]}


# ── MY REQUIREMENTS ──────────────────────────────────────────────────────────

def _catalogue(db: Any) -> tuple[dict[str, dict] | None, str]:
    try:
        rows, _ = _house_rows(db, mw.PTR_CATALOGUE, "requirements catalogue")
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: rows are still listed, named by their id
        return None, _why(exc, "the requirements catalogue")
    return {str(c.get("req_id") or "").strip(): c for c in rows if str(c.get("req_id") or "").strip()}, ""


def status_of(state: str, expires: date | None, on: date, window: int) -> tuple[str, str]:
    """(class, word): a date already past needs attention and one inside the platform's window is due soon."""
    if state in STATE_CLASS:
        if expires is not None and expires < on:
            return ATTENTION, STATUS_WORDS[ATTENTION]
        cls = STATE_CLASS[state]
        if cls == CURRENT and expires is not None and expires <= on + timedelta(days=max(0, window)):
            cls = SOON
        return cls, STATUS_WORDS[cls]
    return UNKNOWN, mw._word(state) or "Not stated"


def upload_verdict(category: str, catalogue_why: str, ledger_key: str = "", no_key_why: str = "") -> dict[str, Any]:
    """Whether this row takes a new version here: only for what the person files themselves, under a name of theirs;
    by_label: filed under the requirement's label, never its id (an onboarding form)."""
    if category in SELF_FILED:
        if not ledger_key:
            # FAIL-CLOSED: the certificate door would refuse it, so nothing is offered that cannot land
            return {"allowed": False, "why": no_key_why or UPLOAD_NO_NAME}
        return {"allowed": True, "why": "", "by_label": category not in UPLOADABLE}
    if catalogue_why:
        return {"allowed": False, "why": f"{_sentence(catalogue_why)}, so what this asks is not known — ask HR."}
    return {"allowed": False, "why": UPLOAD_HR}


def date_role(cat: dict[str, Any] | None) -> str:
    """What the record's date for a requirement is (ComplianceDocs.gs complianceDocsDateRole_): expiry or issue."""
    source = _text((cat or {}).get("date_source"), 120)
    if not source:
        return ""
    return ROLE_EXPIRES if _text((cat or {}).get("credential"), 120) or EXPIRY_SOURCE_RE.search(source) else ROLE_ISSUED


def confirm_verdict(mass: bool, rid: str, cat: dict[str, Any] | None, upload: dict[str, Any],
                    catalogue_why: str) -> dict[str, Any]:
    """Whether the master may confirm a read date for this row into the record (ComplianceDocs.gs certUploadConfirm)."""
    if not mass:
        return {"allowed": False, "why": CONFIRM_NOT_MASTER}
    if cat is None:
        why = f"{_sentence(catalogue_why)}, so what this asks is not known — ask HR." if catalogue_why else CONFIRM_UNDATED
        return {"allowed": False, "why": why}
    if _low(cat.get("category")) not in UPLOADABLE:
        # an onboarding form is filed by the person, but its date is HR's to record
        return {"allowed": False, "why": UPLOAD_FORM if _low(cat.get("category")) == "onboarding" else upload["why"]}
    source = _text(cat.get("date_source"), 120)
    if rid in MED_IDS or MED_SOURCE_RE.match(source):
        return {"allowed": False, "why": CONFIRM_MED}
    if rid == "mais":
        return {"allowed": False, "why": CONFIRM_MAIS}
    if not source:
        return {"allowed": False, "why": CONFIRM_UNDATED}
    return {"allowed": True, "why": ""}


def own_rows_key(s: dict[str, Any]) -> str:
    """The one name an own profile's requirement rows are matched by: the roster row own_subject settled."""
    state = s["roster_state"]
    if state == S_UNREAD:
        raise mw.Unreadable(f"{s['roster_why'] or ROSTER_UNREAD + ' ' + UNREAD} — {OWN_ROWS_ONLY}")
    if state != S_READ or s["roster"] is None:
        raise mw.NotAttributable(f"{s['roster_why'] or 'no staff roster row is settled as yours'} — {OWN_ROWS_ONLY}")
    if s["roster_shared"]:
        raise mw.NotAttributable(OWN_ROWS_SHARED)
    key = mw.fold(s["roster"].get("name"))
    if not key:
        raise mw.NotAttributable(f"your staff roster row carries no name — {OWN_ROWS_ONLY}")
    return key


def requirements(db: Any, s: dict[str, Any], *, on: date, window: int, mass: bool = False) -> dict[str, Any]:
    """Every requirement the compliance engine holds for this person, current ones included."""
    if s["own"]:
        key = own_rows_key(s)
        where = f"{mw._fold_f('person_key')} = %s OR {mw._fold_f('person_name')} = %s"
        raw, as_of = _house_rows(db, mw.PTR_STATES, "requirement states", where, (key, key))

        def mine(r: dict) -> bool:
            # the engine's own reading (RequirementStates.gs): the fold of person_key, else of person_name
            return (mw.fold(r.get("person_key")) or mw.fold(r.get("person_name"))) == key
    else:
        keys, emails, phones = s["keys"], s["emails"], s["phones"]
        if not keys and not emails and not phones:
            raise mw.NotAttributable(s["key_why"] or "nothing names this person that requirement rows are filed under")
        where = (f"{mw._fold_f('person_key')} = ANY(%s) OR {mw._fold_f('person_name')} = ANY(%s) "
                 f"OR {mw._low_f('login')} = ANY(%s) OR {mw._last10_f('login')} = ANY(%s)")
        k = sorted(keys) or [mw.NO_KEY]
        raw, as_of = _house_rows(db, mw.PTR_STATES, "requirement states", where,
                                 (k, k, sorted(emails) or [mw.NO_KEY], sorted(phones) or [mw.NO_KEY]))

        def mine(r: dict) -> bool:
            login = r.get("login")
            if login and not mw._is_marker(login) and (_low(login) in emails or mw.last10(login) in phones):
                return True
            return mw.fold(r.get("person_key")) in keys or mw.fold(r.get("person_name")) in keys

    rows = [mw.clean(r) for r in raw if mine(r)]
    if not rows:
        whose, them = ("your", "you") if s["own"] else ("this person’s", "them")
        raise mw.NotAttributable(f"no requirement row carries {whose} name ({s['name'] or 'no name'}) — the engine "
                                 f"may not have run for {them} yet, or the roster spells it differently")
    # one row per requirement: the newest the engine computed
    newest: dict[str, dict] = {}
    for r in rows:
        rid = _text(r.get("req_id"), 80)
        held = newest.get(rid)
        if held is None or str(r.get("computed_at") or "") > str(held.get("computed_at") or ""):
            newest[rid] = r
    catalogue, catalogue_why = _catalogue(db)
    out: list[dict[str, Any]] = []
    not_applicable = switched_off = 0
    for rid, r in newest.items():
        state = _low(r.get("state"))
        cat = catalogue.get(rid) if catalogue is not None else None
        category = ""
        if catalogue is not None:
            if cat is None or _low(cat.get("enabled")) != "yes":
                switched_off += 1
                continue
            # the checks HR runs (background, admin) are listed like the rest; only HR records them
            category = _low(cat.get("category"))
        if state in NOT_APPLICABLE:
            not_applicable += 1
            continue
        label = _text((cat or {}).get("label"), 120) or rid or "a requirement"
        expires = mw.day_of(r.get("expires"))
        cls, word = status_of(state, expires, on, window)
        if expires is not None:
            due_why = ""
        elif state == "missing":
            due_why = "Nothing is on file, so there is no date to run out."
        else:
            due_why = "The requirement row carries no expiry date."
        category_word = CATEGORY_WORDS.get(category, mw._word(category)) if category else ""
        category_why = "" if category_word else (
            f"{_sentence(catalogue_why)}." if catalogue_why else "The catalogue gives it no category.")
        upload = upload_verdict(category, catalogue_why, s["ledger_key"], s["upload_why"])
        role = date_role(cat)
        out.append({
            "id": rid or f"row{len(out)}", "req_id": rid, "requirement": label, "cert": label,
            "category": category_word, "category_why": category_why,
            "status": {"class": cls, "word": word}, "state": mw._word(state),
            "due": expires.isoformat() if expires else "",
            "due_tone": mw.tone_of(expires, on, window) if expires else "",
            "due_why": due_why,
            "upload": upload,
            # the roster spelling the master's upload is filed under
            "file_as": s["name"] if upload["allowed"] and (not s["own"] or mass) else "",
            # the record keeps an expiry for it, so a date read off the paper can stand in for the due date
            "dated": role == ROLE_EXPIRES,
            # what the record's date is: an expiry, the document's own date (never a due date), or none
            "date_role": role,
            "confirm": confirm_verdict(mass, rid, cat, upload, catalogue_why),
            "details": mw.pairs(("Requirement", rid), ("Evidence", (cat or {}).get("evidence")),
                                ("State", mw._word(state)), ("Expires", r.get("expires")),
                                ("Days left", r.get("days_left")),
                                ("In this state since", mw._stamp_words(r.get("since"))),
                                ("Checked", mw._stamp_words(r.get("computed_at")))),
        })
    out.sort(key=lambda x: (CLASS_ORDER.get(x["status"]["class"], 3), x["due"] or "9999-12-31",
                            x["requirement"].lower()))
    notes = []
    if not_applicable:
        notes.append(f"{mw._plural(not_applicable, 'requirement')} the engine marks as not applying "
                     f"{'is' if not_applicable == 1 else 'are'} not listed")
    if switched_off:
        notes.append(f"{mw._plural(switched_off, 'requirement')} the catalogue has switched off or no longer holds "
                     f"{'is' if switched_off == 1 else 'are'} not listed")
    if catalogue is None:
        notes.append(f"{catalogue_why} — each requirement is named by its id")
    totals = {c: sum(1 for x in out if x["status"]["class"] == c) for c in (CURRENT, SOON, ATTENTION, UNKNOWN)}
    return {"rows": out, "as_of": as_of, "note": mw._join(*notes), "copy_why": _copy_words(as_of, on),
            "totals": totals}


# the lane's own words, the same whichever engine answers
def _copy_words(as_of: str, on: date, what: str = "the copy read here was mirrored", since: str = "filed") -> str:
    d = mw.day_of(as_of)
    if d is None or (on - d).days <= mw.COPY_OLD_DAYS:
        return ""
    return f"{what} {d.strftime('%b')} {d.day}, {d.year} — anything {since} since may not show yet"


def requirements_withheld(why: str) -> dict[str, Any]:
    """The requirements where they do not apply or are not open: plainly none, in their own words, nothing read."""
    return {"rows": [], "as_of": "", "note": "", "copy_why": "", "gap": "",
            "totals": {CURRENT: 0, SOON: 0, ATTENTION: 0, UNKNOWN: 0}, "state": STATE_NOT_APPLICABLE, "why": why}


def requirements_open(user: dict[str, Any] | None, reads: L.Reads) -> bool:
    """App Control's My Requirements row (REQS_FEATURE), FAIL-CLOSED: the master always, before any row is read; else a
    badge the row names. A viewer the row could match only on the client records (SSA or FAMILY worn) is not opened by it, and
    My Details still answers."""
    if sc.is_real_master(user):
        return True
    try:
        return sc.profile_app_gate(REQS_FEATURE, user, reads.scope_sources()).get("open") is True
    except Defer:
        return False


def requirements_part(db: Any, s: dict[str, Any], *, on: date, window: int, mass: bool = False) -> dict[str, Any]:
    """The requirements with their state and sentence — unreadable or untied said, never an empty list."""
    empty = {"rows": [], "as_of": "", "note": "", "copy_why": "", "gap": "",
             "totals": {CURRENT: 0, SOON: 0, ATTENTION: 0, UNKNOWN: 0}, "on": on.isoformat(), "window": window}
    try:
        got = requirements(db, s, on=on, window=window, mass=mass)
    except mw.NotAttributable as exc:
        return {**empty, "state": STATE_NOT_ATTRIBUTABLE, "why": str(exc)}
    except mw.Unreadable as exc:
        return {**empty, "state": STATE_UNREADABLE, "why": str(exc)}
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
        log.warning("my profile: the requirements failed (%s)", type(exc).__name__)
        return {**empty, "state": STATE_UNREADABLE, "why": f"they {UNREAD} ({type(exc).__name__})"}
    # a chosen row whose name another row shares lists what its e-mail ties, and is not read as whole
    gap = s["notes"][0] if not s["own"] and s["notes"] else ""
    return {**empty, **got, "state": STATE_READY, "why": "", "gap": gap}


# ── CLIENTS ──────────────────────────────────────────────────────────────────

def _wire(v: Any) -> Any:
    """A value as the clients list carries it: JSON's own types, a whole number written without its fraction."""
    if isinstance(v, bool) or v is None or isinstance(v, (str, int)):
        return v
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return int(v) if v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {str(k): _wire(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_wire(x) for x in v]
    if isinstance(v, gsjs.SheetDate):
        return gsjs.iso(v.at)
    return str(v)


def read_clients(reads: L.Reads) -> tuple[list[dict[str, Any]], str, str]:
    """(rows, as_of, build_error) of clientsDerived_ off asa-hub-db, as the relay's clients slice carries it."""
    books: set[str] = set()
    outer = hubdb.READ_BOOKS.get()
    token = hubdb.READ_BOOKS.set(books)
    try:
        got = client_book.derived(reads)
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never an empty list
        raise mw.Unreadable(f"{CLIENTS_UNREAD} {UNREAD} ({type(exc).__name__})") from None
    finally:
        hubdb.READ_BOOKS.reset(token)
        if outer is not None:
            outer |= books
    rows = [_wire(r) for r in (got or []) if isinstance(r, dict)]
    if not rows:
        raise mw.Unreadable(f"{CLIENTS_UNREAD} holds no client, so it is taken as not built rather than as nobody")
    built = datetime.fromtimestamp(reads.db.as_of(books), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return rows, built, ""


def _client_key(row: dict[str, Any] | None) -> str:
    key = _text((row or {}).get("client_key"), 120)
    return "" if mw._is_marker(key) else key


def _choosable(row: dict[str, Any]) -> bool:
    key, name = _client_key(row), _text(row.get("name"), 120)
    return bool(key and name and not mw._is_marker(name) and CLIENT_RE.fullmatch(key))


def clients_list(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Every named client the master may choose, by its client key, once each."""
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        if _choosable(r):
            key = _client_key(r)
            out.setdefault(key, {"key": key, "name": _text(r.get("name"), 120), "status": mw._word(r.get("status")),
                                 "kind": KIND_CLIENT})
    return sorted(out.values(), key=lambda p: (p["name"].lower(), p["key"]))


def clients_left_out(rows: list[dict[str, Any]]) -> str:
    """The client records the chooser cannot list, in words; '' when every record can be chosen."""
    n = sum(1 for r in rows if not _choosable(r))
    if not n:
        return ""
    return (f"{mw._plural(n, 'client record')} {'carries' if n == 1 else 'carry'} no usable client key or name, "
            f"so {'it' if n == 1 else 'they'} cannot be chosen")


def _flag(value: Any) -> bool:
    """A sheet flag as the backend reads it: set unless blank or plainly false."""
    return str(value if value is not None else "").strip().upper() not in ("", "FALSE", "0", "NO")


def client_key_of(row: dict[str, Any] | None) -> str:
    """The client an account is tied to: the client key on a live client-role accounts row, never a service one."""
    row = row if isinstance(row, dict) else {}
    if not row or _flag(row.get("is_service")) or not mw._live(row) or _low(row.get("role")) != "client":
        return ""
    return _client_key(row)


def _client_subject(**over: Any) -> dict[str, Any]:
    base = {"own": True, "name": "", "client_key": "", "row": None, "state": S_NONE, "unread": "", "gap": "",
            "why": "", "as_of": "", "build_error": "", "field_why": "", "card_why": "", "viewer": VIEWER_CLIENT,
            "account": None}
    base.update(over)
    return base


def viewer_of(account: dict[str, Any] | None) -> str:
    """'guardian' when a client-role account wears SSA or FAMILY (clientUserCreate writes FAMILY on the account of the
    person the client record names as guardian, the FIX BADGES sheet's FAMILY column); an older cell says GUARDIAN."""
    raw = (account or {}).get("types")
    words = mw._json_list(raw) if isinstance(raw, list) or str(raw or "").strip().startswith("[") \
        else re.split(r"[,;|\n]+", str(raw or ""))
    return VIEWER_GUARDIAN if any(sc.BADGE_RENAMED.get(b, b) in sc.FAMILY_TICKS
                                  for b in (str(w).strip().upper() for w in words)) else VIEWER_CLIENT


def _plain(value: Any, limit: int = 120) -> str:
    """A cell as it is written, never a withheld marker."""
    return "" if mw._is_marker(value) else _text(value, limit)


def guardian_account(account: dict[str, Any]) -> dict[str, str]:
    """A guardian's own account, from its own accounts row: the name, the sign-in and the phone it holds."""
    return {"name": _plain(account.get("display_name")), "email": _plain(account.get("email")),
            "phone": _plain(account.get("phone"), 40)}


def _settle_client(s: dict[str, Any], clients: Callable[[], tuple[list[dict], str, str]]) -> dict[str, Any]:
    """The one client record carrying the subject's client key."""
    key = s["client_key"]
    try:
        rows, as_of, build_error = clients()
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: no field is guessed
        s.update(state=S_UNREAD, unread=CLIENTS_UNREAD, why=_why(exc, CLIENTS_UNREAD))
        return s
    s.update(as_of=as_of, build_error=build_error)
    hits = [r for r in rows if _client_key(r) == key]
    if not hits:
        if not s["own"]:
            raise NoSuchPerson("No client record carries that client.")
        s.update(state=S_NONE, why="no client record carries the client tied to your account",
                 gap="No client record is tied to you, so this is not known.")
        return s
    if len(hits) > 1:
        # FAIL-CLOSED: two records either of which could be this client's are neither
        s.update(state=S_UNTOLD, why="more than one client record carries this client, so which one is theirs "
                                     "cannot be told",
                 gap="Which client record is this client's cannot be told, so this is not shown.")
        return s
    row = mw.clean(hits[0])
    s.update(row=row, state=S_READ, name=_text(row.get("name"), 120) or s["name"])
    return s


def _link_unconfirmed(s: dict[str, Any], cause: str) -> dict[str, Any]:
    """FAIL-CLOSED: a link the accounts copy cannot vouch for draws no client record, and says why."""
    s.update(state=S_UNREAD, unread="whether this account is still tied to its client",
             why=f"{cause}, so whether this account is still tied to its client cannot be confirmed and no client "
                 f"record is drawn",
             field_why=LINK_GAP, card_why="whether this account is still tied to its client could not be confirmed")
    return s


def _hours(seconds: float) -> str:
    return mw._plural(max(1, int(round(seconds / 3600))), "hour")


def own_client_subject(db: Any, core_sheet_id: str, uid: str, clients: Callable[[], tuple[list[dict], str, str]],
                       fresh_s: float = FRESH_S) -> dict[str, Any]:
    """A client-role account: the client its own accounts row is tied to, and nothing the screen sends."""
    s = _client_subject(own=True)
    try:
        account = db.users_row(core_sheet_id, uid)
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nobody's client record is drawn
        s.update(state=S_UNREAD, unread="your account row", why=_why(exc, "your account row"))
        return s
    if account is None:
        s.update(why="this account has no row in the accounts book, so no client record is taken as yours",
                 gap="No client record is tied to you, so this is not known.")
        return s
    s["name"] = _text(account.get("display_name"), 120)
    s["viewer"] = viewer_of(account)
    if s["viewer"] == VIEWER_GUARDIAN:
        s["account"] = guardian_account(account)
    key = client_key_of(account)
    if not key:
        why = ("no client is tied to this account, so no client record is taken as yours"
               if _low(account.get("role")) == "client" and mw._live(account) else
               "this account is not a live client account on record, so no client record is taken as yours")
        s.update(why=why, gap="No client record is tied to you, so this is not known.")
        return s
    try:
        age, sync_ok = db.users_copy(core_sheet_id)
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: a link that may be stale is not taken
        return _link_unconfirmed(s, f"how fresh the accounts copy is {UNREAD} ({type(exc).__name__})")
    if age is None:
        return _link_unconfirmed(s, "the accounts copy read here carries no copy time")
    if not sync_ok:
        return _link_unconfirmed(s, "the last copy pass over the accounts book did not finish cleanly")
    if age > fresh_s:
        return _link_unconfirmed(s, f"the accounts copy read here is more than {_hours(fresh_s)} old")
    s["client_key"] = key
    return _settle_client(s, clients)


def chosen_client_subject(key: str, clients: Callable[[], tuple[list[dict], str, str]]) -> dict[str, Any]:
    """The client the master chose, by its client key."""
    return _settle_client(_client_subject(own=False, client_key=key), clients)


def _client_field(key: str, label: str, value: str, withheld: bool, s: dict[str, Any], note: str = "") -> dict:
    if value:
        return {"key": key, "label": label, "value": value, "why": "", "note": note}
    if withheld:
        why = WITHHELD_WHY
    elif s["state"] == S_UNREAD:
        why = s["field_why"] or _sentence(f"{s['unread']} {UNREAD}, so this is not known.")
    elif s["state"] != S_READ:
        why = s["gap"] or "No client record is tied to this profile, so this is not known."
    else:
        why = CLIENT_MISSING_WHY[key]
    return {"key": key, "label": label, "value": "", "why": why, "note": ""}


def client_details(s: dict[str, Any], on: date) -> dict[str, Any]:
    """A client's card: each field from the client record, labelled for a client."""
    row = s["row"] if s["state"] == S_READ else None

    def cell(*names: str) -> tuple[str, bool]:
        return _cell(row, *names)

    number, w_num = cell("client_number")
    if not number:
        # the plan's clientNumber echoes the client key unless a number was written over it
        alt, w_alt = cell("clientNumber")
        number, w_num = ("" if alt == s["client_key"] else alt), (w_num or w_alt)
    start, w_start = cell("start_date")
    if start:
        d = mw.day_of(start)
        start = d.isoformat() if d else start
    guardian, w_guard = cell("guardianName", "guardian_name")
    guardian_note = ""
    if guardian.lower() == "self":
        guardian, guardian_note = "Self", GUARDIAN_SELF_NOTE
    elif guardian:
        relation, _w = cell("guardian_relationship")
        guardian_note = f"Relationship: {relation}" if relation else ""
    fields = [
        _client_field("client_id", "Client ID", number, w_num, s),
        _client_field("house", "House", *cell("house", "houseName"), s),
        _client_field("start_date", "Start date", start, w_start, s),
        _client_field("phone", "Phone", *cell("client_phone"), s),
        _client_field("email", "Email", *cell("client_email"), s),
        _client_field("address", "Address", *cell("home_address"), s),
        _client_field("guardian", "Guardian", guardian, w_guard, s, guardian_note),
        _client_field("guardian_phone", "Guardian phone", *cell("guardian_phone"), s),
        _client_field("guardian_email", "Guardian email", *cell("guardian_email"), s),
    ]
    old = ""
    if row is not None and s["build_error"]:
        # the older copy stays in place when a rebuild fails: it is never shown as current
        d = mw.day_of(s["as_of"])
        built = f"the copy built {d.strftime('%b')} {d.day}, {d.year}" if d else "an older copy"
        old = f"{s['build_error']}, so this is {built} — anything changed since may not show yet"
    elif row is not None:
        old = _copy_words(s["as_of"], on, "the clients list read here was built", "changed")
    notes = [n for n in (s["why"], old) if n]
    unread = s["state"] == S_UNREAD
    return {"state": STATE_UNREADABLE if unread else STATE_READY,
            "why": (s["card_why"] or f"{s['unread']} did not answer") if unread else "",
            "fields": fields, "notes": notes, "as_of": s["as_of"]}


def client_answer(s: dict[str, Any], scope: dict[str, Any], on: date) -> dict[str, Any]:
    """A client's profile: the card, and plainly no requirements and no documents — those are staff things."""
    person: dict[str, Any] = {"name": s["name"], "key": "", "key_why": DOCS_NOT_CLIENT, "roster_id": "",
                              "kind": KIND_CLIENT, "own": s["own"], "notes": []}
    if s["own"]:
        person["viewer"] = s["viewer"]
        if s["viewer"] == VIEWER_GUARDIAN:
            ward = s["name"] if s["state"] == S_READ else ""
            person["name"] = ward
            person["account"] = {**(s["account"] or guardian_account({})), "guardian_of": ward}
    return {"scope": scope,
            "person": person,
            "details": client_details(s, on),
            "requirements": requirements_withheld(REQS_NOT_CLIENT),
            "documents": {"state": STATE_NOT_APPLICABLE, "why": DOCS_NOT_CLIENT},
            "read_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


# ── the answer ──────────────────────────────────────────────────────────────

def _window() -> tuple[int, str]:
    window = ist_config.int_of(ist_config.current(), "ist_cert_expiring_days")
    note = (f"the IST settings {UNREAD}, so the shipped {window}-day window marks what is due soon"
            if ist_config.unread() else "")
    return window, note


def profile(reads: L.Reads, core_sheet_id: str, *, mode: str, me: dict[str, Any], uid: str, person: str = "",
            client: str = "", role: str = "", scope_why: str = "", on: date | None = None, db: Any = None,
            clients: Callable[[], tuple[list[dict], str, str]] | None = None,
            fresh_s: float = FRESH_S, reqs_open: bool = True) -> dict[str, Any]:
    """The whole answer for one person — the caller's own, or the roster row or client the master chose; the
    requirements withheld, never read, where App Control does not open them (reqs_open, the caller's to decide)."""
    mass = mode == MODE_MASS
    chosen = person if mass else ""
    chosen_client = client if mass and not chosen else ""
    as_client = not mass and _low(role) == "client"
    on = on or mw.today()
    reader = clients or (lambda: read_clients(reads))
    held: dict[str, Any] = {}

    def clients_once() -> tuple[list[dict], str, str]:
        # one read of the clients list per answer, shared by the chooser and the subject
        if "got" not in held:
            try:
                held["got"] = (reader(), None)
            except Exception as exc:  # noqa: BLE001 — raised again to each asker, who says so
                held["got"] = (None, exc)
        got, exc = held["got"]
        if exc is not None:
            raise exc
        return got

    db = db if db is not None else Books(reads)
    people, people_why, client_rows, clients_why, clients_note = None, "", None, "", ""
    if mass:
        try:
            people = people_list(db)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — the chooser says so; the profile still answers
            people_why = _why(exc, "the staff roster")
        try:
            raw_clients = clients_once()[0]
            client_rows = clients_list(raw_clients)
            clients_note = clients_left_out(raw_clients)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — the chooser says so; the profile still answers
            clients_why = _why(exc, CLIENTS_UNREAD)
        if not client_rows and clients_note:
            # a list whose every record was left out is no list: the sentence says why nobody can be chosen
            clients_why, clients_note = clients_note, ""
    scope: dict[str, Any] = {"mode": mode, "why": scope_why, "person": chosen}
    if mass:
        scope["client"] = chosen_client
        scope["people"] = (people or []) + (client_rows or [])
        scope["people_why"] = people_why
        scope["clients_why"] = clients_why
        scope["clients_note"] = clients_note
    if as_client or chosen_client:
        c = (own_client_subject(db, core_sheet_id, uid, clients_once, fresh_s) if as_client
             else chosen_client_subject(chosen_client, clients_once))
        return client_answer(c, scope, on)
    s = chosen_subject(db, core_sheet_id, chosen) if chosen else own_subject(db, core_sheet_id, me, uid)
    reqs = requirements_withheld(REQS_SHUT)
    if reqs_open:
        try:
            ist_config.rules(reads)
        except _LOUD:
            raise
        except Exception:  # noqa: BLE001 — the held or shipped copy answers, and _window says which
            pass
        window, window_note = _window()
        reqs = requirements_part(db, s, on=on, window=window, mass=mass)
        if window_note and reqs["state"] == STATE_READY:
            reqs["note"] = mw._join(reqs["note"], window_note)
    info = details(s)
    key = s["ledger_key"]
    return {"scope": scope,
            "person": {"name": s["name"], "key": key,
                       "key_why": "" if key else (s["ledger_why"] or "no roster name that is this profile's alone "
                                                  "is on file, so no submitted document can be matched to it"),
                       "roster_id": s["roster_id"], "kind": KIND_STAFF, "own": s["own"],
                       "notes": list(s["notes"]) if s["own"] else []},
            "details": info,
            "requirements": reqs,
            "read_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


# ── who is reading (the relay's _roster_name_of) ────────────────────────────

def roster_name(db: Books, uid: str) -> str:
    """STRICT: the account's roster name off its own users row, '' when a live namesake shares it."""
    if not uid:
        return ""
    try:
        row = db.users_row(CORE_USERS_SHEET_ID, uid)
        key = mw.fold((row or {}).get("display_name"))
        namesakes = db.users_named(CORE_USERS_SHEET_ID, key) if key else []
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — an unreadable name is not "not on a roster"
        raise mw.Refused({"status": 502, "message": f"your roster name could not be read ({type(exc).__name__})",
                          "reason": "unreadable"}) from exc
    return mw.roster_name_from(row, namesakes, uid)


# ── the read ────────────────────────────────────────────────────────────────

MY_PROFILE_VISIT = "My Profile reads the signed-in account's own record; it is not drawn inside a visit."
MY_PROFILE_OWN_ONLY = "My Profile shows only your own profile."
# a client-role account (a client or a guardian) is served its own client's record; these are refused by the relay
MY_PROFILE_ROLES_REFUSED = ("onboarding", "interviewer")
MASS_WHY = "Signed in as the master account: your own profile, or any person's you choose."


def scope_of(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, str]:
    """{mode, why}: `mass` only for the real master's own session, and only when the relay did not ask for own."""
    asked = gsjs.trim(gsjs.or_blank(payload.get("mode"))).lower()
    mode = mw.scope_verdict(user.get("role"), sc.is_real_master(user), asked == MODE_OWN)
    said = payload.get("why")
    why = said if isinstance(said, str) and asked == mode else (MASS_WHY if mode == MODE_MASS else "")
    return {"mode": mode, "why": why}


def build(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any], person: str = "",
          client: str = "") -> dict[str, Any]:
    """The lane's data for one session; a refusal the lane answers raises Refused, what cannot be read here defers."""
    if isinstance(sess_or_reads, L.Session):
        reads, user = sess_or_reads.reads, dict(sess_or_reads.user or {})
    else:
        reads, user = sess_or_reads, dict(scope.get("user") or {})
    # FAIL-CLOSED: any person's profile only for the real master, whatever the caller said
    mode = MODE_MASS if scope.get("mode") == MODE_MASS and sc.is_real_master(user) else MODE_OWN
    scope_why = str(scope.get("why") or "") if mode == scope.get("mode") else ""
    person = person if mode == MODE_MASS else ""
    client = client if mode == MODE_MASS else ""
    role = gsjs.trim(gsjs.or_blank(user.get("role"))).lower()
    uid = gsjs.trim(gsjs.or_blank(user.get("id")))
    db = Books(reads)
    if role == "client" and mode != MODE_MASS:
        # the client is found from the account's own row; no roster identity is drawn
        me: dict[str, Any] = {}
    else:
        name = roster_name(db, uid)
        try:
            me = mw.identity(db, CORE_USERS_SHEET_ID, uid, roster_name=name)
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nobody's profile is drawn for an unread account
            log.warning("my profile: the account row could not be read (%s)", type(exc).__name__)
            raise mw.Refused({"status": 502, "reason": "unreadable",
                              "message": f"Who you are could not be read ({type(exc).__name__}), "
                                         "so nothing is shown."}) from exc
    try:
        # App Control opens the requirements (the master always); a client's own profile carries none to open
        reqs_open = requirements_open(user, reads) if role != "client" or mode == MODE_MASS else False
        return profile(reads, CORE_USERS_SHEET_ID, mode=mode, me=me, uid=uid, person=person, client=client,
                       role=role, scope_why=scope_why, db=db, reqs_open=reqs_open)
    except NoSuchPerson as exc:
        raise mw.Refused({"status": 404, "reason": "person", "message": str(exc)}) from exc
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("my profile: the profile failed (%s)", type(exc).__name__)
        raise mw.Refused({"status": 503, "reason": "unreadable",
                          "message": f"My Profile could not be put together ({type(exc).__name__})."}) from exc


def my_profile_view(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myProfileView: /hub-lanes/my-profile off asa-hub-db; the relay decides the scope, this read never widens it."""
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("My Profile is drawn for a person, never the service")
    if gsjs.trim(gsjs.or_blank(payload.get("member"))) or user.get("visiting_member"):
        return {"status": 403, "reason": "visit", "message": MY_PROFILE_VISIT}
    role = gsjs.trim(gsjs.or_blank(user.get("role"))).lower()
    if role in MY_PROFILE_ROLES_REFUSED:
        raise Defer("the relay refuses this role")
    gate = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    # the account's own page: App Control's row naming its badge opens it, no client scope narrowing it
    if gate.get("open") is not True and gate.get("named") is not True:
        raise Defer("App Control does not open My Profile to this account here")
    scope = scope_of(user, payload)
    person = gsjs.trim(gsjs.or_blank(payload.get("person")))
    client = gsjs.trim(gsjs.or_blank(payload.get("client")))
    if (person or client) and scope["mode"] != MODE_MASS:
        return {"status": 403, "reason": "scope", "message": MY_PROFILE_OWN_ONLY}
    if person and client:
        return {"status": 400, "reason": "person", "message": "Choose a person or a client, not both."}
    if person and not PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    if client and not CLIENT_RE.fullmatch(client):
        return {"status": 400, "reason": "person", "message": "That client cannot be read."}
    try:
        data = build(sess, scope, person, client)
    except mw.Refused as exc:
        return dict(exc.env)
    import editions  # noqa: PLC0415 - editions reads the scope this module reads
    if editions.hides_for(sess).get("copy_mirrored") and isinstance(data.get("requirements"), dict):
        # Settings › My Work keeps the "copy was mirrored" line to the master
        data["requirements"]["copy_why"] = ""
    return {"status": 200, "data": data}


EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
EMAIL_TAKEN = "This e-mail already belongs to another account, so it cannot sign you in. Nothing was added."


def _account_emails(raw: Any) -> list[str]:
    """profileParseEmails_: the extra e-mails a users row keeps (a JSON list, or words between commas)."""
    s = gsjs.trim(gsjs.or_text(raw))
    if not s:
        return []
    if s.startswith("["):
        try:
            got = json.loads(s)
            return [gsjs.trim(gsjs.or_text(e)).lower() for e in got] if isinstance(got, list) else []
        except ValueError:
            pass
    return [e.lower() for e in re.split(r"[,;|\s]+", s) if e]


def my_profile_email_free(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myProfileEmailFree: whether an e-mail may join the signed-in account. Sign-in (userByEmail_) takes an extra
    e-mail only when exactly one account holds it, so one another account holds, as its sign-in or an extra one, is
    taken. Says free or taken, never whose."""
    user = sess.user or {}
    uid = gsjs.trim(gsjs.or_text(user.get("id")))
    if not uid or user.get("is_service") is True or user.get("visiting_member"):
        return {"status": 403, "message": "Only your own account takes an e-mail here."}
    email = gsjs.trim(gsjs.or_text(payload.get("email"))).lower()
    if not EMAIL_RE.fullmatch(email) or len(email) > 120:
        return {"status": 400, "message": "That is not an e-mail address."}
    try:
        rows = sess.reads.hub_rows("users")
    except hubdb.Unreadable as exc:
        return {"status": 503, "message": f"The accounts could not be read ({exc}). Nothing was added."}
    if not rows:
        return {"status": 503, "message": "The accounts could not be read. Nothing was added."}
    for r in rows:
        if gsjs.trim(gsjs.or_text(r.get("user_id"))) == uid or gsjs.trim(gsjs.or_text(r.get("merged_into"))):
            continue
        if gsjs.trim(gsjs.or_text(r.get("email"))).lower() == email or email in _account_emails(r.get("emails")):
            return {"status": 200, "data": {"email": email, "free": False, "message": EMAIL_TAKEN}}
    return {"status": 200, "data": {"email": email, "free": True}}


# the relay's state a payload may hand in (relay_state) is bound for the whole read; this read names no relay table
ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"myProfileView": relay_state.bound(my_profile_view),
                                                                   "myProfileEmailFree": my_profile_email_free}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "myProfileView": {"roles": POLICY_ROLES,
                      "params": {"person": "string", "client": "string", "mode": "string", "why": "string",
                                 "member": "string"}},
    "myProfileEmailFree": {"roles": POLICY_ROLES, "params": {"email": "string"}}}
