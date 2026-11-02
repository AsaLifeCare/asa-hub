"""THE EDIT OVERLAY — an edit lands on the relay's disk first, and its sheet write waits in the write ledger.
Readers lay the pending cells over the master JSON, the slices, the packs and the kept copies until a source…"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import house_directory
import house_images

ROOT = Path(os.getenv("HUB_EDIT_OVERLAY_DIR", "/srv/app-packs/edit-overlay"))
STATE_FILE = "overlay.json"
FORMAT = "hub-edit-overlay/1"
# a slice copied from the mirror lags the sheet: this long after the write, what it holds is the sheet's
SETTLE_S = float(os.getenv("HUB_EDIT_SETTLE_S", "900"))
# a written edit no source confirmed is laid no longer than this
RETIRE_AFTER_S = float(os.getenv("HUB_EDIT_RETIRE_AFTER_S", "3600"))
# settled edits stay this long for the queue's own read
KEEP_SETTLED_S = float(os.getenv("HUB_EDIT_KEEP_SETTLED_S", "21600"))
# past this many pending edits the overlay takes no more, and the door answers directly
MAX_ACTIVE = int(os.getenv("HUB_EDIT_MAX_ACTIVE", "500"))
# a queued edit bound to no ledger entry this long after it was laid never reached the queue
UNBOUND_S = 120.0
# the sheet writes the ledger may deliver in a minute, and how many seconds of them may leave at once
WRITES_PER_MIN = max(1.0, float(os.getenv("HUB_SHEET_WRITES_PER_MIN", "40")))
BURST_S = max(1.0, float(os.getenv("HUB_SHEET_WRITES_BURST_S", "10")))
PAUSE_FIRST_S = 30.0
PAUSE_MAX_S = 600.0
ENTITIES_BOOK = os.getenv("HUB_CLIENT_ENTITIES_SHEET_ID", "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI")

ACTIVE = ("queued", "written")
EDITIONS_KEY = "mywork_editions"
EDITION_ROLES = ("admin", "manager", "staff")
EDITION_IDS = ("locations.house", "locations.staffRemove", "locations.incidents", "locations.documents",
               "locations.notesAny", "locations.clientsAdd", "locations.assets", "clients.profile", "clients.care",
               "clients.family", "clients.medication", "clients.transportation", "staff.profile", "staff.employment",
               "staff.hr", "staff.compliance", "staff.hrIssues", "staff.documentation", "staff.driving",
               "staff.mais", "staff.ist", "staff.preferences", "staff.notes",
               "staff.notesEdit", "ssa.profile", "ssa.notes", "ssa.documents", "ssa.activity", "family.profile",
               "family.notes", "family.calls", "family.incidents", "family.create", "family.documents",
               "scheduling.calendar", "scheduling.builder", "scheduling.settings", "scheduling.timeOffApprove",
               "transportation.trips", "transportation.vehicles", "transportation.settings",
               "emergencyContacts.directory", "candidates.information", "candidates.pipeline", "candidates.notes",
               "candidates.interviews", "candidates.documents", "clientCandidates.information",
               "clientCandidates.intake", "clientCandidates.pipeline", "clientCandidates.notes",
               "clientCandidates.documents", "certDocs.review", "myCalendar.anyone", "myInbox.anyone",
               "myInbox.directors", "smartComms.words", "smartComms.switch", "smartComms.audience",
               "smartComms.pacing", "smartComms.ai", "smartComms.recording", "smartComms.replies", "forms.answers",
               "forms.links", "docs.library", "support.requests", "support.settings", "learning.skills",
               "recon.review", "recon.settings")
EDITION_MAX_PEOPLE = 100
MAX_CHANGES = 40

HOUSE_FIELDS = ("home_name", "address", "region", "telephone", "manager_name", "manager_phone", "calendar_link",
                "thumbnail_url")
HOUSE_PHONES = ("telephone", "manager_phone")
# the registry columns the houses slice draws; the others show in the house's overview alone
HOUSE_IN_SLICE = ("home_name", "address", "region", "thumbnail_url")
# the House Supplies inventory (Estate.gs houseInventory) and the columns an asset edit writes
INVENTORY_TAB = "houseInventory"
ASSET_FIELDS = ("item", "current_condition", "est_expiration_year", "cost_to_replace", "replacement_frequency")
NOTE_FIELDS = ("details", "priority", "client_key", "state")
NOTE_PRIORITIES = ("low", "normal", "high", "urgent")
NOTE_STATES = ("open", "resolved")
NOTE_EDIT_STATES = ("open", "resolved", "removed")
NOTE_FOLDED = {"priority": "normal", "state": "open"}
SUPPLY_FIELDS = ("qty", "category", "note")
SUPPLY_KINDS = ("count", "delivery", "par")
ORDER_DAYS = 7
# a client_name change moves the incident to another client: that one goes to its door
INCIDENT_FIELDS = ("your_name", "incident_category", "incident_location", "incident_date", "incident_time",
                   "incident_reported_date", "incident_reported_time", "employees_involved", "summary_of_incident",
                   "immediate_action_taken", "cause_and_contributing_factors", "prevention_plan")
INCIDENT_TOP = ("your_name", "incident_category", "incident_location", "incident_date", "incident_time")
REPAIR_FIELDS = ("repair_type", "urgency_level", "please_describe_the_issue", "status", "resolution_notes")
RESOLVED = frozenset({"completed", "cancelled", "canceled"})

# ── Clients: the profile pencil (ClientProfiles.gs clientProfileSave `changes`) ──
CLIENT_APP = "client-profiles"
CLIENTS_TAB = "clients"
# the panel's fields the overlay lays (CP_SAVE_FIELDS); a house move writes through to the Master: that one is its door's
CLIENT_FIELDS = ("dob", "home_address", "client_number", "initials", "medicaid_id", "house_manager",
                 "house_manager_phone", "house_manager_email", "guardian_name", "guardian_relationship",
                 "guardian_email", "guardian_phone", "guardian_address", "ssa_name", "ssa_email", "ssa_phone",
                 "outcome", "ama_date", "start_date", "isp_signed_date", "self_admin_assessment", "self_admin_expires",
                 "media_release", "medical_supply", "truelink_consent", "guardianship_papers", "workshop",
                 "workshop_phone", "workshop_address", "transportation", "transportation_phone", "payee_rep",
                 "payee_rep_phone", "payee_rep_email", "food_stamp", "spending_limit")
# the clients columns a panel name writes (CP_SAVE_ALIASES)
CLIENT_COLUMNS = {"guardian_name": "guardianName"}
CLIENT_DATES = ("dob", "ama_date", "start_date", "self_admin_expires", "isp_signed_date")
CLIENT_PHONES = ("house_manager_phone", "guardian_phone", "ssa_phone", "workshop_phone", "transportation_phone",
                 "payee_rep_phone")
# where clientProfileDetails draws each field: (block, slot)
CLIENT_SHOWN = {
    "client_number": ("client", "client_number"), "medicaid_id": ("identity", "medicaid_id"),
    "home_address": ("home", "home_address"), "house_manager": ("home", "house_manager"),
    "house_manager_phone": ("home", "house_manager_phone"), "house_manager_email": ("home", "house_manager_email"),
    "guardian_relationship": ("guardian", "relationship"), "guardian_email": ("guardian", "email"),
    "guardian_address": ("guardian", "address"), "guardian_phone": ("guardian", "phone"),
    "ssa_email": ("guardian", "ssa_email"), "ssa_phone": ("guardian", "ssa_phone"),
    "outcome": ("services", "outcome"), "ama_date": ("services", "ama_date"), "start_date": ("services", "start_date"),
    "self_admin_assessment": ("services", "self_admin_assessment"),
    "self_admin_expires": ("services", "self_admin_expires"), "media_release": ("services", "media_release"),
    "medical_supply": ("services", "medical_supply"), "truelink_consent": ("services", "truelink_consent"),
    "guardianship_papers": ("services", "guardianship_papers"), "workshop": ("day", "workshop"),
    "workshop_phone": ("day", "workshop_phone"), "workshop_address": ("day", "workshop_address"),
    "transportation": ("day", "transportation"), "transportation_phone": ("day", "transportation_phone"),
    "payee_rep": ("financial", "payee_rep"), "payee_rep_phone": ("financial", "payee_rep_phone"),
    "payee_rep_email": ("financial", "payee_rep_email"), "food_stamp": ("financial", "food_stamp"),
    "spending_limit": ("financial", "spending_limit")}
CLIENT_BLOCKS = ("client", "identity", "home", "guardian", "services", "day", "financial")
GUARDIAN_NON_PERSON = frozenset({"self", "none", "n/a", "na", "no guardian", "no legal guardian", "not applicable",
                                 "unknown", "tbd", "n a", "-", "--"})
_NEVER_WRITTEN = re.compile(r"ssn|social|tlcard|debitcard|cardnumber|cardlast|^dc|pin|securitycode|cvv|ccv")
_CLIENT_KEY = re.compile(r"^[A-Za-z0-9_.\-]{1,120}$")
_ISO_DAY = re.compile(r"^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T\s]|$)")
_US_DAY = re.compile(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})")
_BARE_DAY = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
_PLAIN_GUARDIAN = re.compile(r"^[A-Za-z][A-Za-z.' \-]{0,46}[A-Za-z.]$")
_SSN_SHAPE = re.compile(r"(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}(?=[^0-9]|$)")
_LONG_RUN = re.compile(r"(^|[^0-9])([0-9]{9}|[0-9]{13,19})(?=[^0-9]|$)")
_SPACE_GAP = re.compile("[\x1c-\x1f\x85\N{ZERO WIDTH NO-BREAK SPACE}]")

# ── Clients: a care row over the plan (ClientProfiles.gs clientProfileOverride, kind care) ──
OVERRIDES_TAB = "client_overrides"
CARE_TABS = ("daily", "health", "goals", "home")
CARE_FIELDS = ("record", "text", "removed")
CARE_TEXT_MAX, CARE_RECORD_MAX, CARE_GIST_MAX = 30000, 500, 160
_CARE_BULLET = re.compile("^[\\s•●◦▪*\\-–]+")
# a cell the sheet would take as a number, a truth, a time or a date: the door files it and reads it back its own way
_SHEET_TAKES = re.compile(r"^[^A-Za-z]*$|^(true|false)$|^[+-]?[0-9]*\.?[0-9]+e[+-]?[0-9]+$|"
                          r"^[0-9]{1,2}(:[0-9]{2}){0,2}\s*[ap]\.?m\.?$|"
                          r"^([0-9]{1,2}\s+)?(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|"
                          r"sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?(\s+[0-9]{1,4})?,?(\s+[0-9]{2,4})?$",
                          re.I)

# ── Clients: a chart row (Meds.gs emarMedUpdate `changes`, emarMedDelete) — the client's eMAR rows ──
MEDS_TAB = "medications"
MEDS_FIELDS = ("name", "dose", "times", "route", "freq", "discontinued")
MEDS_CELL_MAX = 500
_MED_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
_TIME_RUN = re.compile(r"[0-9]{3,4}")

HOUSE_TAB, NOTES_TAB, SUPPLY_TAB = "entity_homes", "house_notes", "houseSupplies"
DOORS: dict[str, dict[str, Any]] = {
    "clientProfileSave": {"tab": CLIENTS_TAB, "book": "hub:" + CLIENTS_TAB, "edition": "clients.profile",
                          "view": "client", "app": CLIENT_APP},
    "clientProfileOverride": {"tab": OVERRIDES_TAB, "book": "hub:" + OVERRIDES_TAB, "edition": "clients.care",
                              "view": "care", "app": CLIENT_APP},
    "emarMedUpdate": {"tab": MEDS_TAB, "book": "hub:" + MEDS_TAB, "edition": "clients.medication", "view": "meds",
                      "app": CLIENT_APP},
    "emarMedDelete": {"tab": MEDS_TAB, "book": "hub:" + MEDS_TAB, "edition": "clients.medication", "view": "meds",
                      "app": CLIENT_APP},
    "locationHouseSave": {"tab": HOUSE_TAB, "book": ENTITIES_BOOK, "edition": "locations.house", "view": "house"},
    "locationNoteEdit": {"tab": NOTES_TAB, "book": "hub:" + NOTES_TAB, "edition": "locations.house", "view": "notes"},
    "locationNoteState": {"tab": NOTES_TAB, "book": "hub:" + NOTES_TAB, "edition": "locations.house", "view": "notes"},
    "locationNoteAdd": {"tab": NOTES_TAB, "book": "hub:" + NOTES_TAB, "edition": "locations.house", "view": "notes"},
    "locationSupplyEdit": {"tab": SUPPLY_TAB, "book": "house:" + SUPPLY_TAB, "edition": "locations.house",
                           "view": "supplies"},
    "locationSupplyEntry": {"tab": SUPPLY_TAB, "book": "house:" + SUPPLY_TAB, "edition": "locations.house",
                            "view": "supplies"},
    "locationIncidentEdit": {"tab": "uiIncidents", "book": "estate:uiIncidents", "edition": "locations.incidents",
                             "view": "row"},
    "locationRepairEdit": {"tab": "workOrders", "book": "estate:workOrders", "edition": "locations.house",
                           "view": "row"},
    "locationAssetEdit": {"tab": INVENTORY_TAB, "book": "estate:" + INVENTORY_TAB, "edition": "locations.assets",
                          "view": "supplies"},
}
# the reads an overlay is laid over on their way out (each its app's), and the slices it is laid into as they are written
READ_APPS = {"locationOverview": "locations", "locationNotes": "locations", "locationSupplies": "locations",
             "locationRepairs": "locations", "locationIncidents": "locations", "clientProfileDetails": CLIENT_APP,
             "clientProfileCare": CLIENT_APP, "clientProfileMeds": CLIENT_APP}
READS = frozenset(READ_APPS)
SLICES = {"houses": HOUSE_TAB, "workOrders": "workOrders", "uiIncidents": "uiIncidents", CLIENTS_TAB: CLIENTS_TAB}
# the app packs an overlay is laid over
PACK_APPS = frozenset({"locations", CLIENT_APP})
PACK = "pack"

_HOUSE_RE = re.compile(r"^[A-Z]{2,4}\d{3,6}$")
_CODE_END = re.compile(r"([A-Z]{2,4}\d{3,6})\s*$")
_FIELD_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_ROW_ID = re.compile(r"^r\d{1,7}$")
_URL = re.compile(r"https?://[^\s\[\]]+")
_NUM = re.compile(r"^-?\d+(\.\d+)?$")


# ── the cells, as the Locations doors read and write them ────────────────────
def js_str(v: Any) -> str:
    """String(v) as JavaScript says it; '' for null and for an object (hubEditText_)."""
    if v is None or isinstance(v, (dict, list)):
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isfinite(v) and v.is_integer():
            return str(int(v))
        return repr(v)
    return str(v)


def text(v: Any, limit: int = 0) -> str:
    """locationsText_: whitespace folded."""
    s = " ".join(js_str(v).split())
    return s[:limit] if limit else s


def cell(v: Any) -> str:
    """locationsCell_: the cell as text, trimmed."""
    return js_str(v).strip()


def num(v: Any) -> float | int | None:
    """locationsNum_: a plain number or None; words and blanks are never 0."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    s = str(v).strip().replace(",", "")
    if not _NUM.match(s):
        return None
    n = float(s)
    return int(n) if n.is_integer() and "." not in s else n


def house_code(v: Any) -> str:
    s = js_str(v).strip().upper()
    return s if _HOUSE_RE.match(s) else ""


def code_at_end(v: Any) -> str:
    m = _CODE_END.search(js_str(v).strip().upper())
    return m.group(1) if m else ""


def first_url(v: Any) -> str:
    m = _URL.search(js_str(v))
    return m.group(0) if m else ""


def phone_key(v: Any) -> str:
    """contactPhoneKey_: ten digits, a leading 1 dropped; '' otherwise."""
    d = re.sub(r"\D", "", js_str(v))
    if len(d) >= 11 and d[0] == "1":
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def fold(v: Any) -> str:
    """clientNameKey_: lower case, letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", js_str(v).lower())


def when_ms(v: Any) -> float:
    """Date.parse for the shapes the sheets hold; 0 for none."""
    s = js_str(v).strip()
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000.0
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).timestamp() * 1000.0
        except ValueError:
            continue
    return 0.0


def js_round(x: float) -> float:
    """Math.round: halves go up."""
    return float(math.floor(x + 0.5))


def same(a: Any, b: Any) -> bool:
    """Two cells hold one value: text folded, a sheet's leading quote dropped, numbers by value."""
    x, y = text(a).lstrip("'"), text(b).lstrip("'")
    if x == y:
        return True
    nx, ny = num(x), num(y)
    return nx is not None and ny is not None and float(nx) == float(ny)


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{int((epoch % 1) * 1000):03d}Z"


def epoch_of(v: Any) -> float:
    ms = when_ms(v)
    return ms / 1000.0 if ms else 0.0


# ── Settings › Editions, as Editions.gs keeps it ─────────────────────────────
def parse_editions(raw: Any) -> dict[str, dict[str, Any]]:
    """hubEditionsParse_: {edition: {on, people}}; a blank or malformed list opens nothing."""
    out: dict[str, dict[str, Any]] = {}
    s = js_str(raw).strip()
    if not s:
        return out
    try:
        got = json.loads(s)
    except ValueError:
        return out
    if not isinstance(got, list):
        return out
    for e in got:
        if not isinstance(e, dict):
            continue
        eid = js_str(e.get("id")).strip()
        if eid not in EDITION_IDS or eid in out:
            continue
        people: list[str] = []
        for p in e.get("people") if isinstance(e.get("people"), list) else []:
            pid = js_str(p).strip()[:80]
            if pid and pid not in people and len(people) < EDITION_MAX_PEOPLE:
                people.append(pid)
        out[eid] = {"on": e.get("on") is True, "people": people}
    return out


def holds(editions: dict[str, dict[str, Any]] | None, edition: str, uid: str, role: str) -> bool:
    """FAIL-CLOSED, hubEditionAllows_ past the master: the edition on, the account on its list, an employee's role."""
    if not editions or not uid or str(role or "").strip().lower() not in EDITION_ROLES:
        return False
    held = editions.get(edition)
    return bool(held) and held.get("on") is True and uid in (held.get("people") or [])


# ── planning an edit: what the door would write, or why the door must answer it ──
def _changes(payload: dict[str, Any]) -> list[dict[str, str]] | None:
    """hubEditChanges_: one or more {field, value, expected}, each field once; None for anything else."""
    got = payload.get("changes")
    if not isinstance(got, list) or not got or len(got) > MAX_CHANGES:
        return None
    seen: set[str] = set()
    out = []
    for c in got:
        c = c if isinstance(c, dict) else {}
        field = js_str(c.get("field")).strip()
        if not _FIELD_RE.match(field) or field in seen:
            return None
        seen.add(field)
        out.append({"field": field, "value": js_str(c.get("value")).strip(), "expected": js_str(c.get("expected"))})
    return out


def _entry(action: str, key: str, house: str, fields: dict[str, Any], prior: dict[str, Any],
           surfaces: Iterable[str], kind: str = "edit", row: dict[str, Any] | None = None) -> dict[str, Any]:
    door = DOORS[action]
    out = {"action": action, "kind": kind, "tab": door["tab"], "book": door["book"], "key": key, "house": house,
           "app": door.get("app", "locations"), "fields": fields, "prior": prior, "surfaces": sorted(set(surfaces))}
    if row is not None:
        out["row"] = row
    return out


def _plan_house(payload: dict[str, Any], code: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    edit = view.get("edit")
    if not isinstance(edit, dict) or not edit:
        return "the relay holds no registry row for the house"
    if payload.get("home_name") is None or text(payload.get("home_name")) != text(edit.get("home_name")):
        return "the house row's witness is not the relay's"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    by_abbreviation = bool(house_code(edit.get("abbreviation")))
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f, value = c["field"], c["value"][:500]
        if f not in HOUSE_FIELDS:
            return f"{f} is not a field the overlay writes"
        if c["expected"] != text(edit.get(f)):
            return f"{f} changed since it was opened"
        if f in HOUSE_PHONES and value:
            d = phone_key(value)
            if not d:
                return f"{f} is not a phone number"
            value = f"({d[:3]}) {d[3:6]}-{d[6:]}"
        if f == "home_name":
            if not value:
                return "a house keeps a name"
            if not by_abbreviation and code_at_end(value) != code:
                return "the name must still end in the house code"
        if f == "calendar_link" and value and not value.lower().startswith("https://"):
            return "a link is an https:// address"
        if f == "thumbnail_url" and house_images.url_house(value) != code:
            return "a house photo is one the relay keeps for the house"
        fields[f] = value
        prior[f] = text(edit.get(f))
    surfaces = [PACK] + (["slice:houses"] if set(fields) & set(HOUSE_IN_SLICE) else [])
    return [_entry("locationHouseSave", code, code, fields, prior, surfaces)], {"written": list(fields), "refused": []}


def _note_of(view: dict[str, Any], nid: str) -> dict[str, Any] | None:
    for n in view.get("notes") or []:
        if isinstance(n, dict) and cell(n.get("id")) == nid:
            return n
    return None


def _client_keys(view: dict[str, Any]) -> dict[str, str]:
    return {cell(c.get("client_key")): text(c.get("name")) for c in view.get("clients") or []
            if isinstance(c, dict) and cell(c.get("client_key"))}


def _plan_note_edit(payload: dict[str, Any], code: str, view: dict[str, Any], author: dict[str, str],
                    any_note: bool, now: float) -> tuple[list, dict] | str:
    nid = text(payload.get("id"), 80)
    note = _note_of(view, nid) if nid else None
    if note is None:
        return "the relay holds no such note at the house"
    if not any_note and cell(note.get("by")) != author.get("name"):
        return "somebody else's note is its door's to refuse"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    clients = _client_keys(view)
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in NOTE_FIELDS:
            return f"{f} is not a field of a house note"
        folded = f in NOTE_FOLDED
        before = (cell(note.get(f)).lower() or NOTE_FOLDED[f]) if folded else cell(note.get(f))
        if (c["expected"].lower() if folded else c["expected"]) != before:
            return f"{f} changed since it was opened"
        value = c["value"].lower() if folded else c["value"]
        if f == "details":
            if not value:
                return "a note says something"
            value = value[:4000]
        if f == "priority" and value not in NOTE_PRIORITIES:
            return "not a priority"
        if f == "state" and value not in NOTE_EDIT_STATES:
            return "not a note state"
        if f == "client_key" and value and value not in clients:
            return "not a current client of the house"
        fields[f] = value
        prior[f] = before
        if f == "state":
            fields["state_by"], fields["state_at"] = author.get("name", ""), iso(now)
            prior["state_by"], prior["state_at"] = cell(note.get("state_by")), cell(note.get("state_at"))
    if "client_key" in fields:
        fields["client_name"] = clients.get(fields["client_key"], "")
    return ([_entry("locationNoteEdit", nid, code, fields, prior, [PACK])],
            {"written": [c["field"] for c in changes], "refused": []})


def _plan_note_state(payload: dict[str, Any], code: str, view: dict[str, Any], author: dict[str, str],
                     now: float) -> tuple[list, dict] | str:
    nid = text(payload.get("id"), 80)
    state = text(payload.get("state")).lower()
    if not nid or state not in NOTE_STATES:
        return "the note or its state is not well formed"
    if house_code(payload.get("house")) != code:
        return "a state change without its house is its door's"
    note = _note_of(view, nid)
    if note is None:
        return "the relay holds no such note at the house"
    stamp = iso(now)
    fields = {"state": state, "state_by": author.get("name", ""), "state_at": stamp}
    prior = {"state": cell(note.get("state")).lower() or "open", "state_by": cell(note.get("state_by")),
             "state_at": cell(note.get("state_at"))}
    answer = {"note": {"id": nid, "house": code, "state": state, "state_by": fields["state_by"], "state_at": stamp}}
    return [_entry("locationNoteState", nid, code, fields, prior, [PACK])], answer


def _plan_note_add(payload: dict[str, Any], code: str, view: dict[str, Any], author: dict[str, str],
                   now: float) -> tuple[list, dict] | str:
    details = js_str(payload.get("details")).strip()[:4000]
    if not details:
        return "a note says something"
    priority = text(payload.get("priority")).lower() or "normal"
    if priority not in NOTE_PRIORITIES:
        return "not a priority"
    clients = _client_keys(view)
    client_key = text(payload.get("client_key"), 120)
    if client_key and client_key not in clients:
        return "not a current client of the house"
    nid = "HN_" + str(uuid.uuid4())
    note = {"id": nid, "house": code, "client_key": client_key, "client_name": clients.get(client_key, ""),
            "priority": priority, "details": details, "state": "open", "by": author.get("name", ""), "at": iso(now),
            "state_by": "", "state_at": ""}
    entry = _entry("locationNoteAdd", nid, code, {}, {}, [PACK], kind="append", row=note)
    return [entry], {"note": dict(note)}


def _supply_entry_of(view: dict[str, Any], eid: str) -> dict[str, Any] | None:
    for item in (view.get("supplies") or {}).get("consumables") or []:
        for e in item.get("entries") or [] if isinstance(item, dict) else []:
            if isinstance(e, dict) and cell(e.get("id")) == eid:
                return e
    return None


def _plan_supply_edit(payload: dict[str, Any], code: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    eid = text(payload.get("id"), 80)
    entry = _supply_entry_of(view, eid) if eid else None
    if entry is None:
        return "the relay holds no such supplies entry at the house"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in SUPPLY_FIELDS:
            return f"{f} stays as recorded"
        if f == "qty":
            n = num(entry.get("qty"))
            before = js_str(n) if n is not None else cell(entry.get("qty"))
        else:
            before = text(entry.get(f))
        if c["expected"] != before:
            return f"{f} changed since it was opened"
        if f == "qty":
            value = num(c["value"])
            if value is None or value < 0:
                return "a quantity is a number, zero or more"
        else:
            value = text(c["value"], 60 if f == "category" else 500)
        fields[f] = value
        prior[f] = entry.get(f)
    return ([_entry("locationSupplyEdit", eid, code, fields, prior, [PACK])],
            {"written": [c["field"] for c in changes], "refused": []})


def _plan_supply_add(payload: dict[str, Any], code: str, view: dict[str, Any], author: dict[str, str],
                     now: float) -> tuple[list, dict] | str:
    supplies = view.get("supplies")
    if not isinstance(supplies, dict) or supplies.get("ledger_ready") is not True:
        return "the supplies ledger is not ready at the relay"
    item = text(payload.get("item"), 120)
    kind = text(payload.get("kind")).lower()
    qty = num(payload.get("qty"))
    if not item or kind not in SUPPLY_KINDS or qty is None or qty < 0:
        return "the entry is not well formed"
    after = None
    raw_after = payload.get("on_hand_after")
    if kind == "delivery" and raw_after not in (None, ""):
        after = num(raw_after)
        if after is None or after < 0:
            return "the count after the delivery is not a number"
    eid = "LS_" + str(uuid.uuid4())
    rec = {"id": eid, "house": code, "item": item, "qty": qty, "needed_by": "", "status": "", "kind": kind,
           "category": text(payload.get("category"), 60), "on_hand_after": "" if after is None else after,
           "at": iso(now), "by": author.get("name", ""), "note": text(payload.get("note"), 500)}
    entry = _entry("locationSupplyEntry", eid, code, {}, {}, [PACK], kind="append", row=rec)
    return [entry], {"entry": dict(rec)}


def _plan_row(action: str, payload: dict[str, Any], code: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    rid = text(payload.get("id"), 20)
    if not _ROW_ID.match(rid):
        return "the row id is not well formed"
    row = view.get("row")
    if not isinstance(row, dict) or cell(row.get("id")) != rid:
        return "the relay holds no such row"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    allowed = INCIDENT_FIELDS if action == "locationIncidentEdit" else REPAIR_FIELDS
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in allowed:
            return f"{f} goes to its door"
        before = js_str(row.get(f))
        if text(c["expected"]) != text(before):
            return f"{f} changed since it was opened"
        fields[f] = c["value"][:4000]
        prior[f] = before
    tab = DOORS[action]["tab"]
    return ([_entry(action, rid, code, fields, prior, [PACK, "slice:" + tab])],
            {"written": [c["field"] for c in changes], "refused": []})


def _plan_asset_edit(payload: dict[str, Any], code: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    """locationAssetEdit: one of the house's House Inventory rows, as the relay's pack lists it."""
    rid = text(payload.get("id"), 20)
    if not _ROW_ID.match(rid):
        return "the row id is not well formed"
    assets = (view.get("supplies") or {}).get("assets") if isinstance(view.get("supplies"), dict) else None
    row = next((a for a in assets or [] if isinstance(a, dict) and cell(a.get("id")) == rid), None)
    if row is None:
        return "the relay holds no such asset at the house"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in ASSET_FIELDS:
            return f"{f} goes to its door"
        before = js_str(row.get(f))
        if text(c["expected"]) != text(before):
            return f"{f} changed since it was opened"
        if f == "item" and not text(c["value"]):
            return "an asset keeps its name"
        fields[f] = c["value"][:4000]
        prior[f] = before
    return ([_entry("locationAssetEdit", rid, code, fields, prior, [PACK])],
            {"written": [c["field"] for c in changes], "refused": []})


def client_key(v: Any) -> str:
    """The client a profile edit names (clientProfilesClient_'s shape); '' otherwise."""
    s = js_str(v).strip()
    return s if _CLIENT_KEY.match(s) else ""


def subject_of(action: str, payload: Any) -> str:
    """What the door's edit is about: the house code, or the client key; '' when it is not well formed."""
    if action not in DOORS or not isinstance(payload, dict):
        return ""
    if DOORS[action].get("app") == CLIENT_APP:
        return client_key(payload.get("client"))
    return house_code(payload.get("house"))


def day_of(v: Any) -> str:
    """apptDay_ for the shapes the overlay lays: yyyy-MM-dd, or M/D/YYYY as yyyy-MM-dd; '' otherwise."""
    s = js_str(v).strip()
    m = _ISO_DAY.match(s)
    if m:
        return m.group(1)
    m = _US_DAY.match(s)
    return f"{m.group(3)}-{m.group(1).zfill(2)[-2:]}-{m.group(2).zfill(2)[-2:]}" if m else ""


def age_of(dob: str, today: str) -> int | None:
    """cpAge_: whole years on `today`, both yyyy-MM-dd; None outside 0-129."""
    b, t = _BARE_DAY.match(dob or ""), _BARE_DAY.match(today or "")
    if not b or not t:
        return None
    years = int(t.group(1)) - int(b.group(1)) - (1 if t.group(2) + t.group(3) < b.group(2) + b.group(3) else 0)
    return years if 0 <= years < 130 else None


def phone_shown(v: Any) -> str:
    """cpPhone_: ten digits as (330) 555-0101, anything else as written."""
    s = js_str(v).strip()
    if not s:
        return ""
    d = re.sub(r"[^0-9]", "", s)
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else s


def initials_of(name: Any) -> str:
    """cpInitials_: the words' first letters, at most three."""
    return "".join(w[0].upper() for w in js_str(name).split() if w)[:3]


def guardian_is_person(v: Any) -> bool:
    """guardianIsPerson_: a name, not "self", "none", "n/a" or a "no guardian" sentence."""
    s = re.sub(r"[.]+$", "", js_str(v).strip().lower())
    if not s or s in GUARDIAN_NON_PERSON:
        return False
    return not (re.match(r"^(no|none|not)\b", s) and re.search(r"guardian|listed|applicable|assigned", s))


def guardian_shown(v: str) -> str | None:
    """The guardian as the profile draws it; None for a name only the door's own cleaning reads."""
    if not v or not guardian_is_person(v):
        return v
    if not _PLAIN_GUARDIAN.match(v) or re.match(r"(?i)(legal\s+)?guardian", v) or re.search(r"\s-\s", v):
        return None
    return re.sub(r"[\s,;:.\-]+$", "", re.sub(r"[.,;:\s]+$", "", v))


def _client_value(field: str, value: str) -> str | None:
    """The value as the door files it and the read shows it; None when only the door may judge it."""
    value = re.sub(r"\s+", " ", value)
    if len(value.encode("utf-16-le")) > 1000:
        return None
    if value[:1] in ("=", "+", "-", "@") or _SSN_SHAPE.search(value) or _LONG_RUN.search(value):
        return None
    if field in CLIENT_DATES and value and not (_ISO_DAY.match(value) or _US_DAY.match(value)):
        return None
    if field == "guardian_name" and guardian_shown(value) is None:
        return None
    return value


def _plan_client(payload: dict[str, Any], key: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    if payload.get("fields") is not None:
        return "the fields save goes to its door"
    details = view.get("details")
    edit = details.get("edit") if isinstance(details, dict) else None
    if not isinstance(edit, dict) or not edit:
        return "the relay holds no profile of the client"
    if details.get("degraded") or text((details.get("client") or {}).get("client_key")) != key:
        return "the relay's copy of the profile is not whole"
    if text(edit.get("status")) != "Active":
        return "an inactive client's profile is its door's"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    # the spaces JavaScript and Python trim and fold differently: the door reads those itself
    if any(_SPACE_GAP.search(js_str(c.get("value")) + js_str(c.get("expected")))
           for c in payload["changes"] if isinstance(c, dict)):
        return "a value carries a space the door reads its own way"
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if _NEVER_WRITTEN.search(re.sub(r"[^a-z0-9]+", "", f.lower().replace("#", "no"))):
            return f"{f} is protected: its door refuses it"
        if f not in CLIENT_FIELDS:
            return f"{f} goes to its own door"
        if c["expected"] != js_str(edit.get(f)):
            return f"{f} changed since it was opened"
        value = _client_value(f, c["value"])
        if value is None:
            return f"{f} is read its own way by the door"
        fields[f] = value
        prior[f] = js_str(edit.get(f))
    entry = {"action": "clientProfileSave", "kind": "edit", "tab": CLIENTS_TAB, "book": DOORS["clientProfileSave"]["book"],
             "key": key, "house": "", "app": CLIENT_APP, "fields": fields, "prior": prior,
             "surfaces": sorted({PACK, "slice:" + CLIENTS_TAB})}
    return [entry], {"written": [c["field"] for c in changes], "refused": []}


def care_verbatim(v: Any, limit: int = 0) -> str:
    """cpVerbatim_: carriage returns off, a line's trailing blanks off, trimmed."""
    s = re.sub(r"[ \t]+\n", "\n", js_str(v).replace("\r", "")).strip()
    return s[:limit] if limit else s


def care_gist(v: Any) -> str:
    """cpGist_: the first line with words, bullets off, at most 160 characters."""
    for line in care_verbatim(v).split("\n"):
        s = _CARE_BULLET.sub("", line).strip()
        if s:
            return s if len(s) <= CARE_GIST_MAX else s[:CARE_GIST_MAX - 3] + "…"
    return ""


def _care_cell(value: str) -> bool:
    """The door files it and its read shows it as the overlay draws it: no number, date or long digit run."""
    if any(ord(ch) > 0xFFFF for ch in value) or _SPACE_GAP.search(value):
        return False
    return not value or not (_SHEET_TAKES.match(value) or _SSN_SHAPE.search(value) or _LONG_RUN.search(value))


def care_key(client: str, tab: str) -> str:
    """A care entry's record: the client's tab, so each tab's read confirms its own."""
    return f"{client}|{tab}"


def _plan_care(payload: dict[str, Any], key: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    if text(payload.get("kind")).lower() != "care":
        return "a family member is its door's"
    tab = text(payload.get("tab")).lower()
    if tab not in CARE_TABS:
        return "the tab is its door's to judge"
    target = text(payload.get("target"), 200)
    if not target:
        return "a new care record takes the id its door mints"
    care = view.get("care")
    rows = care.get("rows") if isinstance(care, dict) and text(care.get("tab")) == tab else None
    if not isinstance(rows, list):
        return "the relay holds no copy of the care tab"
    row = next((r for r in rows if isinstance(r, dict) and js_str(r.get("id")) == target
                and isinstance(r.get("edit"), dict) and r["edit"]), None)
    if row is None:
        return "the relay holds no such care record"
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    if any(_SPACE_GAP.search(js_str(c.get("value")) + js_str(c.get("expected")))
           for c in payload["changes"] if isinstance(c, dict)):
        return "a value carries a space the door reads its own way"
    live = {"record": js_str(row["edit"].get("record")), "text": js_str(row.get("text")),
            "removed": js_str(row["edit"].get("removed"))}
    after = dict(live)
    fields: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in CARE_FIELDS:
            return f"{f} is its door's to refuse"
        if c["expected"] != live[f]:
            return f"{f} changed since it was opened"
        if f == "removed":
            value = "Yes" if re.match(r"^(yes|true|1)$", c["value"], re.I) else ""
        elif f == "text":
            value = c["value"].replace("\r", "")
            if len(value) > CARE_TEXT_MAX:
                return "the text is cut by its door"
        else:
            value = re.sub(r"\s+", " ", c["value"])
            if len(value) > CARE_RECORD_MAX:
                return "the title is cut by its door"
        fields[f] = after[f] = value
    if not after["record"] and after["removed"] != "Yes":
        return "a care record needs its title: its door says so"
    # every cell the door files, the unchanged ones too
    if not (_care_cell(after["record"]) and _care_cell(after["text"])):
        return "a value is read its own way by the door"
    entry = {"action": "clientProfileOverride", "kind": "edit", "tab": OVERRIDES_TAB,
             "book": DOORS["clientProfileOverride"]["book"], "key": care_key(key, tab), "house": "", "app": CLIENT_APP,
             "target": target, "fields": fields, "prior": {f: live[f] for f in fields}, "surfaces": [PACK]}
    return [entry], {"written": [c["field"] for c in changes], "refused": []}


def meds_times(v: Any) -> list[str]:
    """medsTimesOf_: every 3-4 digit run, colons off, as HH:MM."""
    return [t.zfill(4)[:2] + ":" + t.zfill(4)[2:] for t in _TIME_RUN.findall(js_str(v).replace(":", ""))]


def _meds_details(edit: dict[str, Any], times: str) -> str:
    """cpMedsBuild_'s DETAILS cell: dose, type, frequency and times, the blank ones left out."""
    return " · ".join(s for s in (js_str(edit.get("dose")), js_str(edit.get("route")), js_str(edit.get("freq")), times) if s)


def _meds_row(row: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any] | None:
    """A chart row as cpMedsBuild_ draws it once the fields are written; None when its read draws it its own way."""
    edit = row.get("edit")
    if not isinstance(edit, dict) or any(f not in edit for f in MEDS_FIELDS):
        return None
    # the read cuts a cell at 500: a cut one draws its details from the cell itself
    if any(len(js_str(edit.get(f))) >= MEDS_CELL_MAX for f in ("name", "dose", "route", "freq")):
        return None
    # the row as read must be the one its edit cells draw
    if (js_str(row.get("record")) != js_str(edit.get("name"))
            or js_str(row.get("status")) != ("Discontinued" if js_str(edit.get("discontinued")) else "Active")):
        return None
    shown = next((t for t in (js_str(edit.get("times")), "") if _meds_details(edit, t) == js_str(row.get("details"))),
                 None)
    if shown is None:
        return None
    after = {**{f: js_str(edit.get(f)) for f in MEDS_FIELDS}, **{f: js_str(v) for f, v in fields.items()}}
    return {**row, "record": after["name"] if "name" in fields else row.get("record"),
            "details": _meds_details(after, after["times"] if "times" in fields else shown),
            "status": "Discontinued" if after["discontinued"] else "Active", "edit": after}


def _med_cell(value: str) -> bool:
    """The door files it as written and reads it back so: no formula lead, no JSON, nothing _care_cell refuses."""
    return value[:1] not in ("=", "+", "-", "@", "{", "[") and len(value) <= MEDS_CELL_MAX and _care_cell(value)


def _plan_meds(action: str, payload: dict[str, Any], key: str, view: dict[str, Any]) -> tuple[list, dict] | str:
    mid = js_str(payload.get("id")).strip()
    if not _MED_ID.match(mid) or mid != js_str(payload.get("id")):
        return "the id is its door's to judge"
    meds = view.get("meds")
    rows = meds.get("rows") if isinstance(meds, dict) and text(meds.get("tab")) == "meds" else None
    if not isinstance(rows, list):
        return "the relay holds no copy of the client's chart"
    hits = [r for r in rows if isinstance(r, dict) and js_str(r.get("id")) == mid]
    if len(hits) != 1 or not isinstance(hits[0].get("edit"), dict) or not hits[0]["edit"]:
        return "the relay holds no such chart row"
    row = hits[0]
    entry = {"action": action, "kind": "edit", "tab": MEDS_TAB, "book": DOORS[action]["book"], "key": key, "house": "",
             "app": CLIENT_APP, "target": mid, "surfaces": [PACK]}
    if action == "emarMedDelete":
        if len(rows) == 1:
            return "the chart's last row leaves through its door, which says the chart is empty"
        return [{**entry, "fields": {"removed": "Yes"}, "prior": {"removed": ""}}], \
            {"removed": mid, "written": ["removed"], "refused": []}
    changes = _changes(payload)
    if changes is None:
        return "the changes are not well formed"
    if any(_SPACE_GAP.search(js_str(c.get("value")) + js_str(c.get("expected")))
           for c in payload["changes"] if isinstance(c, dict)):
        return "a value carries a space the door reads its own way"
    edit = row["edit"]
    fields: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in MEDS_FIELDS:
            return f"{f} is its door's to refuse"
        if c["expected"] != js_str(edit.get(f)):
            return f"{f} changed since it was opened"
        if f == "times":
            times = meds_times(c["value"])
            # the door files "HHMM" runs in quotes; the read cuts its cell at 500
            if len(times) * 7 > MEDS_CELL_MAX:
                return "the times are cut by the read"
            value = " ".join(times)
        else:
            value = re.sub(r"\s+", " ", c["value"])
            if not _med_cell(value):
                return f"{f} is read its own way by the door"
        if f == "name" and not value:
            return "a medicine keeps its name: its door says so"
        fields[f] = value
    if _meds_row(row, fields) is None:
        return "the relay cannot draw the row as its read does"
    return [{**entry, "fields": fields, "prior": {f: js_str(edit.get(f)) for f in fields}}], \
        {"written": [c["field"] for c in changes], "refused": []}


def plan(action: str, payload: dict[str, Any], view: dict[str, Any], *, author: dict[str, str],
         any_note: bool = False, now: float | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]] | str:
    """The entries an edit lays and the door's own answer to it; a sentence when the door must answer it itself."""
    if action not in DOORS or not isinstance(payload, dict):
        return "not a door the overlay carries"
    if DOORS[action].get("app") == CLIENT_APP:
        key = client_key(payload.get("client"))
        if not key:
            return "the client is not well formed"
        try:
            if action == "clientProfileOverride":
                return _plan_care(payload, key, view)
            if DOORS[action]["tab"] == MEDS_TAB:
                return _plan_meds(action, payload, key, view)
            return _plan_client(payload, key, view)
        except Exception as exc:  # noqa: BLE001 - a plan that cannot be made is the door's to answer
            return f"the edit could not be planned ({type(exc).__name__})"
    code = house_code(payload.get("house"))
    if not code:
        return "the house is not well formed"
    now = time.time() if now is None else now
    try:
        if action == "locationHouseSave":
            return _plan_house(payload, code, view)
        if action == "locationNoteEdit":
            return _plan_note_edit(payload, code, view, author, any_note, now)
        if action == "locationNoteState":
            return _plan_note_state(payload, code, view, author, now)
        if action == "locationNoteAdd":
            return _plan_note_add(payload, code, view, author, now)
        if action == "locationSupplyEdit":
            return _plan_supply_edit(payload, code, view)
        if action == "locationSupplyEntry":
            return _plan_supply_add(payload, code, view, author, now)
        if action == "locationAssetEdit":
            return _plan_asset_edit(payload, code, view)
        return _plan_row(action, payload, code, view)
    except Exception as exc:  # noqa: BLE001 - a plan that cannot be made is the door's to answer
        return f"the edit could not be planned ({type(exc).__name__})"


# ── a write Python decided (asa-hub-app), laid as the overlay's own: its plan checked, its entry built here ──
PYTHON_FIELDS = {"locationHouseSave": HOUSE_FIELDS,
                 "locationNoteEdit": NOTE_FIELDS + ("state_by", "state_at", "client_name"),
                 "locationNoteState": ("state", "state_by", "state_at"),
                 "locationSupplyEdit": SUPPLY_FIELDS,
                 "locationIncidentEdit": INCIDENT_FIELDS,
                 "locationRepairEdit": REPAIR_FIELDS}
PYTHON_APPENDS = {"locationNoteAdd": ("HN_", ("id", "house", "client_key", "client_name", "priority", "details",
                                              "state", "by", "at", "state_by", "state_at")),
                  "locationSupplyEntry": ("LS_", ("id", "house", "item", "qty", "needed_by", "status", "kind",
                                                  "category", "on_hand_after", "at", "by", "note"))}


def _cell_value(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float)) and not (isinstance(v, float) and not math.isfinite(v))


def _python_client_entries(action: str, lay: Any) -> list[dict[str, Any]] | str:
    """FAIL-CLOSED: a Clients write Python decided, laid only where the overlay draws it as the door's read does."""
    if not isinstance(lay, dict) or lay.get("kind") != "edit":
        return "the plan is not an edit of this door"
    client = client_key(lay.get("house"))
    key = js_str(lay.get("key")).strip()
    fields = lay.get("fields")
    if not client or not isinstance(fields, dict) or not fields or not all(isinstance(v, str) for v in fields.values()):
        return "the plan names no client or no cells"
    said = lay.get("prior") if isinstance(lay.get("prior"), dict) else {}
    prior = {f: js_str(said.get(f)) if said.get(f) is not None else "" for f in fields}
    entry = {"action": action, "kind": "edit", "book": DOORS[action]["book"], "house": "", "app": CLIENT_APP,
             "fields": dict(fields), "prior": prior}
    if action == "clientProfileSave":
        if key != client:
            return "a profile edit is keyed by its client"
        if any(f not in CLIENT_FIELDS or _SPACE_GAP.search(v) or _client_value(f, v) != v for f, v in fields.items()):
            return "a value is read its own way by the door"
        return [{**entry, "tab": CLIENTS_TAB, "key": client, "surfaces": sorted({PACK, "slice:" + CLIENTS_TAB})}]
    target = js_str(lay.get("target")).strip()
    if action == "clientProfileOverride":
        tab = key[len(client) + 1:] if key.startswith(client + "|") else ""
        if tab not in CARE_TABS or not target or len(target) > 200:
            return "a care row names its client's tab and its record"
        for f, v in fields.items():
            if f not in CARE_FIELDS or (f == "removed" and v not in ("Yes", "")):
                return f"{f} is its door's to refuse"
            if f == "text" and (len(v) > CARE_TEXT_MAX or "\r" in v or not _care_cell(v)):
                return "the text is read its own way by the door"
            if f == "record" and (len(v) > CARE_RECORD_MAX or re.sub(r"\s+", " ", v) != v or not _care_cell(v)):
                return "the title is read its own way by the door"
        if "record" in fields and not fields["record"] and fields.get("removed") != "Yes":
            return "a care record needs its title: its door says so"
        return [{**entry, "tab": OVERRIDES_TAB, "key": care_key(client, tab), "target": target, "surfaces": [PACK]}]
    if DOORS[action]["tab"] != MEDS_TAB or key != client or not _MED_ID.match(target):
        return "a chart row names its client and its id"
    if action == "emarMedDelete":
        if fields != {"removed": "Yes"}:
            return "a removal takes the row off, nothing else"
    else:
        for f, v in fields.items():
            if f not in MEDS_FIELDS:
                return f"{f} is its door's to refuse"
            if f == "times":
                if not re.fullmatch(r"([0-9]{2}:[0-9]{2}( [0-9]{2}:[0-9]{2})*)?", v) or len(v.split()) * 7 > MEDS_CELL_MAX:
                    return "the times are read their own way by the door"
            elif not _med_cell(v) or re.sub(r"\s+", " ", v) != v:
                return f"{f} is read its own way by the door"
        if "name" in fields and not fields["name"]:
            return "a medicine keeps its name: its door says so"
    return [{**entry, "tab": MEDS_TAB, "key": client, "target": target, "surfaces": [PACK]}]


def python_entries(action: str, lay: Any) -> list[dict[str, Any]] | str:
    """FAIL-CLOSED: the entry Python's plan lays, built by the overlay's own rules; a sentence when it is not one."""
    door = DOORS.get(action)
    if door is not None and door.get("app") == CLIENT_APP:
        try:
            return _python_client_entries(action, lay)
        except Exception as exc:  # noqa: BLE001 - a plan that cannot be laid is the door's to answer
            return f"the edit could not be laid ({type(exc).__name__})"
    if door is None or door.get("app", "locations") != "locations" or not isinstance(lay, dict):
        return "not a Locations door the overlay carries"
    house = house_code(lay.get("house"))
    key = js_str(lay.get("key")).strip()
    if not house or not key or len(key) > 120:
        return "the plan names no house or row"
    if action in PYTHON_APPENDS:
        prefix, cols = PYTHON_APPENDS[action]
        row = lay.get("row")
        if lay.get("kind") != "append" or not isinstance(row, dict) or not key.startswith(prefix):
            return "the plan is not a new row of this door"
        if cell(row.get("id")) != key or house_code(row.get("house")) != house or not set(row) <= set(cols) \
                or not all(_cell_value(v) for v in row.values()):
            return "the new row does not hold together"
        return [_entry(action, key, house, {}, {}, [PACK], kind="append", row=dict(row))]
    allowed = PYTHON_FIELDS.get(action)
    fields, prior = lay.get("fields"), lay.get("prior")
    if allowed is None or lay.get("kind") != "edit" or not isinstance(fields, dict) or not fields:
        return "the plan is not an edit of this door"
    if not set(fields) <= set(allowed) or not all(_cell_value(v) for v in fields.values()):
        return "the plan writes a field this door does not"
    if not isinstance(prior, dict):
        prior = {}
    if action == "locationHouseSave":
        if key != house:
            return "a house row is keyed by its code"
        surfaces = [PACK] + (["slice:houses"] if set(fields) & set(HOUSE_IN_SLICE) else [])
    elif door["view"] == "row":
        if not _ROW_ID.match(key):
            return "the row id is not well formed"
        surfaces = [PACK, "slice:" + door["tab"]]
    else:
        surfaces = [PACK]
    return [_entry(action, key, house, dict(fields), {f: prior.get(f) for f in fields if f in prior}, surfaces)]


# ── the store ────────────────────────────────────────────────────────────────
class Overlay:
    """The pending edits, held in memory and written whole to one 0600 file on every change."""

    def __init__(self, root: Path | str | None = None, clock: Callable[[], float] = time.time) -> None:
        self.root = Path(root) if root is not None else ROOT
        self.clock = clock
        self._lock = threading.RLock()
        self._entries: dict[str, dict[str, Any]] = {}
        self._meta: dict[str, Any] = {}
        self._loaded = False
        self._active = 0
        self.why = ""

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            if not self.root.parent.is_dir():
                self.why = f"{self.root.parent} is not mounted"
                return
            self.root.mkdir(mode=0o700, exist_ok=True)
            path = self.root / STATE_FILE
            if path.is_file():
                doc = json.loads(path.read_text(encoding="utf-8"))
                for e in doc.get("entries") or []:
                    if isinstance(e, dict) and e.get("id"):
                        self._entries[str(e["id"])] = e
                self._meta = dict(doc.get("meta") or {})
            self._count()
        except Exception as exc:  # noqa: BLE001 - an unreadable store takes no edit; every door answers directly
            self.why = f"the overlay could not be read ({type(exc).__name__})"

    def _count(self) -> None:
        self._active = sum(1 for e in self._entries.values() if e.get("state") in ACTIVE)

    def _save(self) -> None:
        body = json.dumps({"format": FORMAT, "meta": self._meta, "entries": list(self._entries.values())},
                          separators=(",", ":"), default=str)
        fd, temp = tempfile.mkstemp(dir=str(self.root), prefix=f".{STATE_FILE}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                out.write(body)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temp, self.root / STATE_FILE)
            temp = ""
        finally:
            if temp:
                try:
                    os.unlink(temp)
                except OSError:
                    pass
        self._count()

    def ready(self) -> bool:
        with self._lock:
            self._load()
            return not self.why

    def busy(self) -> bool:
        """Never raises: is any edit laid now?"""
        if not self._loaded:
            with self._lock:
                self._load()
        return self._active > 0

    def add(self, entries: list[dict[str, Any]], author: dict[str, str]) -> list[dict[str, Any]]:
        """Lay the entries, queued; raises when the disk refused (nothing is laid then)."""
        with self._lock:
            self._load()
            if self.why:
                raise OSError(self.why)
            if self._active + len(entries) > MAX_ACTIVE:
                raise OSError("the overlay is full")
            now = self.clock()
            laid = []
            for e in entries:
                eid = "E" + uuid.uuid4().hex[:24]
                laid.append({**e, "id": eid, "at": now, "author": {"uid": author.get("uid", ""),
                                                                   "name": author.get("name", "")},
                             "state": "queued", "confirmed": [], "ledger": "", "write_id": ""})
            for e in laid:
                self._entries[e["id"]] = e
            try:
                self._save()
            except Exception:
                for e in laid:
                    self._entries.pop(e["id"], None)
                self._count()
                raise
            return [dict(e) for e in laid]

    def bind(self, ids: Iterable[str], ledger: str, write_id: str) -> None:
        with self._lock:
            for eid in ids:
                e = self._entries.get(eid)
                if e is not None:
                    e["ledger"], e["write_id"] = ledger, write_id
            self._safe_save()

    def _safe_save(self) -> None:
        try:
            self._save()
        except Exception:  # noqa: BLE001 - memory still holds it; the next change writes it again
            self._count()

    def get(self, eid: str) -> dict[str, Any] | None:
        with self._lock:
            e = self._entries.get(eid)
            return dict(e) if e else None

    def written(self, ids: Iterable[str], data: Any) -> tuple[list[dict], list[dict]]:
        """The door answered: (entries written, entries refused with the door's words); refused fields roll back."""
        data = data if isinstance(data, dict) else {}
        refused = {js_str(r.get("field")): text(r.get("why")) for r in data.get("refused") or [] if isinstance(r, dict)}
        current = data.get("current") if isinstance(data.get("current"), dict) else {}
        made = data.get("note") if isinstance(data.get("note"), dict) else data.get("entry")
        real = js_str(made.get("id")).strip() if isinstance(made, dict) else ""
        now = self.clock()
        done, lost = [], []
        with self._lock:
            for eid in ids:
                e = self._entries.get(eid)
                if e is None or e.get("state") != "queued":
                    continue
                if e.get("kind") == "append":
                    if real and real != e["key"]:
                        e["key"] = real
                        if isinstance(e.get("row"), dict):
                            e["row"]["id"] = real
                    e.update(state="written", written_at=now)
                    done.append(dict(e))
                    continue
                asked = dict(e.get("fields") or {})
                kept, why = {}, []
                for f, v in asked.items():
                    if f in refused:
                        why.append(f"{f}: {refused[f]}")
                    elif f in current and not same(current[f], v):
                        why.append(f"{f} changed since it was opened (now \"{text(current[f], 80)}\")")
                    else:
                        kept[f] = v
                if "state" not in kept:
                    kept.pop("state_by", None)
                    kept.pop("state_at", None)
                if "client_key" not in kept:
                    kept.pop("client_name", None)
                gone = {f: v for f, v in asked.items() if f not in kept}
                prior = e.get("prior") or {}
                if kept:
                    e.update(fields=kept, state="written", written_at=now)
                    done.append(dict(e))
                if why:
                    if not kept:
                        e.update(state="refused", settled_at=now, why="; ".join(why))
                    lost.append({**dict(e), "fields": gone, "prior": {f: prior[f] for f in gone if f in prior},
                                 "partial": bool(kept), "why": "; ".join(why)})
            self._safe_save()
        return done, lost

    def refuse(self, ids: Iterable[str], why: str) -> list[dict[str, Any]]:
        """The write will never land: its entries leave every reader."""
        now = self.clock()
        out = []
        with self._lock:
            for eid in ids:
                e = self._entries.get(eid)
                if e is None or e.get("state") not in ACTIVE:
                    continue
                e.update(state="refused", settled_at=now, why=text(why, 400))
                out.append(dict(e))
            if out:
                self._safe_save()
        return out

    def delivered_unconfirmed(self, ids: Iterable[str]) -> list[dict[str, Any]]:
        """Delivered with no receipt: written, for the sources to confirm."""
        now = self.clock()
        out = []
        with self._lock:
            for eid in ids:
                e = self._entries.get(eid)
                if e is not None and e.get("state") == "queued":
                    e.update(state="written", written_at=now, unconfirmed=True)
                    out.append(dict(e))
            if out:
                self._safe_save()
        return out

    def layer(self, tab: str, surface: str, house: str = "", key: str = "") -> list[dict[str, Any]]:
        """The entries laid over this tab on this surface (one house's, one record's), oldest first."""
        if not self._active:
            return []
        with self._lock:
            out = [e for e in self._entries.values()
                   if e.get("tab") == tab and (not house or e.get("house") == house) and (not key or e.get("key") == key)
                   and (e.get("state") == "queued"
                        or (e.get("state") == "written" and surface in (e.get("surfaces") or [])
                            and surface not in (e.get("confirmed") or [])))]
            return [dict(e) for e in sorted(out, key=lambda x: float(x.get("at") or 0))]

    def observe(self, tab: str, surface: str, seen: dict[str, Any], source_at: float, authoritative: bool,
                match: Callable[[dict[str, Any], Any], bool] | None = None) -> int:
        """A source read at `source_at` shows these rows (key -> row or None): written edits it holds are confirmed."""
        if not self._active or not source_at:
            return 0
        confirmed = 0
        with self._lock:
            now = self.clock()
            for e in self._entries.values():
                if (e.get("tab") != tab or e.get("state") != "written" or surface not in (e.get("surfaces") or [])
                        or surface in (e.get("confirmed") or []) or e.get("key") not in seen):
                    continue
                at = float(e.get("written_at") or 0)
                if source_at <= at:
                    continue
                row = seen[e["key"]]
                if not (authoritative or source_at > at + SETTLE_S or (match is not None and match(e, row))):
                    continue
                e.setdefault("confirmed", []).append(surface)
                confirmed += 1
                if all(s in e["confirmed"] for s in e.get("surfaces") or []):
                    e.update(state="retired", settled_at=now)
            if confirmed:
                self._safe_save()
        return confirmed

    def sweep(self) -> dict[str, list[dict[str, Any]]]:
        """Retire what no source confirmed in time, refuse what never reached the queue, drop the long settled."""
        out: dict[str, list[dict[str, Any]]] = {"retired": [], "unbound": []}
        with self._lock:
            self._load()
            now = self.clock()
            changed = False
            for eid, e in list(self._entries.items()):
                state = e.get("state")
                if state == "written" and now - float(e.get("written_at") or 0) > RETIRE_AFTER_S:
                    e.update(state="retired", settled_at=now, why="no source confirmed it in time")
                    out["retired"].append(dict(e))
                    changed = True
                elif state == "queued" and not e.get("ledger") and now - float(e.get("at") or 0) > UNBOUND_S:
                    e.update(state="refused", settled_at=now, why="the relay stopped before the write was queued")
                    out["unbound"].append(dict(e))
                    changed = True
                elif state not in ACTIVE and now - float(e.get("settled_at") or e.get("at") or 0) > KEEP_SETTLED_S:
                    self._entries.pop(eid, None)
                    changed = True
            if changed:
                self._safe_save()
        return out

    def bound_queued(self) -> list[dict[str, Any]]:
        with self._lock:
            self._load()
            return [dict(e) for e in self._entries.values() if e.get("state") == "queued" and e.get("ledger")]

    def note_editions(self, editions: dict[str, dict[str, Any]], at: float) -> None:
        """Settings › Editions as a save through the relay just wrote them: newer than any copy older than `at`."""
        with self._lock:
            self._load()
            if at >= float(self._meta.get("editions_at") or 0):
                self._meta["editions"], self._meta["editions_at"] = editions, at
                if not self.why:
                    self._safe_save()

    def editions_seen(self) -> tuple[dict[str, dict[str, Any]] | None, float]:
        """The editions the relay last saw saved, and when; (None, 0) before it saw one."""
        with self._lock:
            self._load()
            got = self._meta.get("editions")
            return (got if isinstance(got, dict) else None), float(self._meta.get("editions_at") or 0)

    def summary(self) -> dict[str, Any]:
        """Counts by state and the pending edits, never a cell's value."""
        with self._lock:
            self._load()
            now = self.clock()
            counts: dict[str, int] = {}
            pending = []
            for e in sorted(self._entries.values(), key=lambda x: float(x.get("at") or 0)):
                counts[e.get("state", "?")] = counts.get(e.get("state", "?"), 0) + 1
                if e.get("state") in ACTIVE:
                    pending.append({"id": e["id"], "action": e.get("action"), "house": e.get("house"),
                                    "tab": e.get("tab"), "state": e.get("state"),
                                    "fields": sorted((e.get("fields") or {}).keys()) or [e.get("kind")],
                                    "age_s": round(now - float(e.get("at") or now), 1),
                                    "by": (e.get("author") or {}).get("name", ""),
                                    "confirmed": e.get("confirmed") or []})
            return {"disk": self.why or "ok", "counts": counts, "pending": pending[:200]}


# ── laying the edits over what a reader holds ────────────────────────────────
def _by_key(layer: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for e in layer:
        out.setdefault(str(e.get("key")), []).append(e)
    return out


def _house_label(home_name: str, code: str) -> str:
    return house_directory.label_of(home_name, code) if home_name else code


def patch_houses(rows: list[Any], layer: list[dict[str, Any]], *, undo: bool = False) -> list[Any]:
    """The houses slice with the registry edits laid (or, `undo`, their prior values put back)."""
    keyed = _by_key(layer)
    if not keyed:
        return rows
    out = []
    for row in rows:
        code = str(row.get("code") or "").upper() if isinstance(row, dict) else ""
        if code not in keyed:
            out.append(row)
            continue
        r = dict(row)
        for e in keyed[code]:
            vals = e.get("prior") if undo else e.get("fields")
            vals = vals if isinstance(vals, dict) else {}
            # a row that no longer shows the edit is somebody else's now: its prior is not put back over it
            if undo and not _houses_match(e, r):
                continue
            if "home_name" in vals and text(vals["home_name"]):
                label = _house_label(text(vals["home_name"]), code)
                r["label"] = label
                r["title"] = f"{label} - {code}" if label and label != code else code
            if "address" in vals:
                r["address"] = text(vals["address"])
            if "region" in vals and text(vals["region"]):
                r["city"] = text(vals["region"])
            if "thumbnail_url" in vals:
                r["photo"] = _house_photo(vals["thumbnail_url"], code)
        out.append(r)
    return out


def _house_photo(v: Any, code: str) -> dict[str, str]:
    """The houses slice's photo for a registry thumbnail (house_slices): a photo kept here, else the registry's."""
    url = first_url(v)
    if house_images.url_house(url) == code:
        return {"src": url, "source": "upload"}
    return {"src": url, "source": "registry"} if url else {"src": "", "source": ""}


def _houses_match(e: dict[str, Any], row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    vals = e.get("fields") or {}
    code = str(e.get("key") or "")
    checks = []
    if "home_name" in vals:
        checks.append(text(row.get("label")) == text(_house_label(text(vals["home_name"]), code)))
    if "address" in vals:
        checks.append(text(row.get("address")) == text(vals["address"]))
    if "region" in vals and text(vals["region"]):
        checks.append(text(row.get("city")) == text(vals["region"]))
    if "thumbnail_url" in vals:
        checks.append(text((row.get("photo") or {}).get("src") if isinstance(row.get("photo"), dict) else "")
                      == text(first_url(vals["thumbnail_url"])))
    return bool(checks) and all(checks)


def _row_match(e: dict[str, Any], row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    return all(same(row.get(f), v) for f, v in (e.get("fields") or {}).items())


def houses_source_at(rows: list[Any]) -> float:
    """When the registry under the houses slice was read (its `sources` entry); 0 when unsaid."""
    for row in rows[:1]:
        for s in (row.get("sources") if isinstance(row, dict) else None) or []:
            if isinstance(s, dict) and s.get("key") == "registry":
                return epoch_of(s.get("read_at"))
    return 0.0


def patch_rows(rows: list[Any], layer: list[dict[str, Any]], *, undo: bool = False) -> list[Any]:
    """An estate slice (workOrders, uiIncidents) with the row edits laid by row id."""
    keyed = _by_key(layer)
    if not keyed:
        return rows
    out = []
    for row in rows:
        rid = cell(row.get("id")) if isinstance(row, dict) else ""
        if rid not in keyed:
            out.append(row)
            continue
        r = dict(row)
        for e in keyed[rid]:
            if undo:
                if _row_match(e, r):
                    r.update(e.get("prior") or {})
            else:
                r.update(e.get("fields") or {})
        out.append(r)
    return out


def _client_row_key(row: Any) -> str:
    """A clients row's key as the profile door finds its row: client_key, else the folded name."""
    if not isinstance(row, dict):
        return ""
    return cell(row.get("client_key")) or fold(row.get("name"))


def _clients_match(e: dict[str, Any], row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    cols = [(CLIENT_COLUMNS.get(f, f), v) for f, v in (e.get("fields") or {}).items()]
    cols = [(c, v) for c, v in cols if c in row]
    return bool(cols) and all(same(row.get(c), v) for c, v in cols)


def patch_clients(rows: list[Any], layer: list[dict[str, Any]], *, undo: bool = False) -> list[Any]:
    """The clients slice with the profile edits laid on each client's first row, a withheld column never written."""
    keyed = _by_key(layer)
    if not keyed:
        return rows
    try:
        import redaction  # noqa: PLC0415 - the copies' one withholding rule
    except Exception:  # noqa: BLE001 - no rule, nothing laid in a copy
        return rows
    out: list[Any] = []
    done: set[str] = set()
    for row in rows:
        key = _client_row_key(row)
        if not key or key not in keyed or key in done:
            out.append(row)
            continue
        done.add(key)
        r = dict(row)
        held = set(redaction.withheld_columns(r)) | set(redaction.secret_named_columns(r))
        for e in keyed[key]:
            # a row that no longer shows the edit is somebody else's now: its prior is not put back over it
            if undo and not _clients_match(e, r):
                continue
            vals = e.get("prior") if undo else e.get("fields")
            for f, v in (vals if isinstance(vals, dict) else {}).items():
                col = CLIENT_COLUMNS.get(f, f)
                if col in r and col not in held:
                    r[col] = v
        out.append(r)
    return out


def _patch_slice_rows(resource: str, rows: list[Any], layer: list[dict[str, Any]], undo: bool = False) -> list[Any]:
    if resource == "houses":
        return patch_houses(rows, layer, undo=undo)
    if resource == CLIENTS_TAB:
        return patch_clients(rows, layer, undo=undo)
    return patch_rows(rows, layer, undo=undo)


def patch_slice(resource: str, payload: dict[str, Any], overlay: Overlay, *, observe: bool = True) -> dict[str, Any]:
    """A slice about to be written: what its source confirms is retired, the rest is laid over its rows."""
    tab = SLICES.get(resource)
    if not tab or not overlay.busy() or not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return payload
    rows = payload["rows"]
    surface = "slice:" + resource
    if observe:
        if resource == "houses":
            seen = {str(r.get("code") or "").upper(): r for r in rows if isinstance(r, dict)}
            overlay.observe(tab, surface, seen, houses_source_at(rows), False, _houses_match)
        elif resource == CLIENTS_TAB:
            seen = {}
            for r in rows:
                k = _client_row_key(r)
                if k and k not in seen:
                    seen[k] = r
            overlay.observe(tab, surface, seen, epoch_of(payload.get("source_at")), False, _clients_match)
        else:
            seen = {cell(r.get("id")): r for r in rows if isinstance(r, dict)}
            overlay.observe(tab, surface, seen, epoch_of(payload.get("source_at")), False, _row_match)
    layer = overlay.layer(tab, surface)
    if not layer:
        return payload
    return {**payload, "rows": _patch_slice_rows(resource, rows, layer)}


def undo_slice(resource: str, payload: dict[str, Any], gone: list[dict[str, Any]], overlay: Overlay) -> dict[str, Any]:
    """A slice that showed refused edits: their prior values back, the edits still pending laid again."""
    tab = SLICES.get(resource)
    if not tab or not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return payload
    mine = [e for e in gone if e.get("tab") == tab]
    rows = payload["rows"]
    if mine:
        rows = _patch_slice_rows(resource, rows, mine, undo=True)
    layer = overlay.layer(tab, "slice:" + resource)
    if layer:
        rows = _patch_slice_rows(resource, rows, layer)
    return {**payload, "rows": rows}


def patch_overview(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    keyed = _by_key(layer)
    code = str(((data.get("house") or {}) if isinstance(data.get("house"), dict) else {}).get("code") or "").upper()
    if code not in keyed:
        return data
    out = dict(data)
    house = dict(out.get("house") or {})
    edit = dict(out.get("edit") or {})
    rm = dict(out.get("registry_manager") or {})
    for e in keyed[code]:
        for f, v in (e.get("fields") or {}).items():
            edit[f] = text(v)
            if f in ("home_name", "address", "region"):
                house[f] = text(v)
            elif f == "telephone":
                house["phone"] = text(v)
            elif f in ("calendar_link", "thumbnail_url"):
                house[f] = first_url(v)
            elif f == "manager_name":
                rm["name"] = text(v)
            elif f == "manager_phone":
                rm["phone"] = text(v)
    out.update(house=house, edit=edit, registry_manager=rm)
    return out


def patch_notes(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    if not layer or not isinstance(data.get("notes"), list):
        return data
    notes = [dict(n) if isinstance(n, dict) else n for n in data["notes"]]
    have = {cell(n.get("id")) for n in notes if isinstance(n, dict)}
    for e in layer:
        if e.get("kind") == "append":
            row = e.get("row") if isinstance(e.get("row"), dict) else None
            if row and cell(row.get("id")) not in have:
                notes.append(dict(row))
                have.add(cell(row.get("id")))
            continue
        for n in notes:
            if isinstance(n, dict) and cell(n.get("id")) == e.get("key"):
                n.update(e.get("fields") or {})
    notes = [n for n in notes if not (isinstance(n, dict) and str(n.get("state") or "").lower() == "removed")]
    notes.sort(key=lambda n: str(n.get("at") or "") if isinstance(n, dict) else "", reverse=True)
    out = dict(data)
    out["notes"] = notes
    out["open_count"] = sum(1 for n in notes if isinstance(n, dict) and n.get("state") == "open")
    if any(e.get("kind") == "append" for e in layer):
        out["exists"] = True
    return out


def supply_figures(entries: list[dict[str, Any]], order_days: float = ORDER_DAYS) -> dict[str, Any]:
    """locationsSupplyItem_: one consumable's figures from its ledger lines."""
    lst = sorted(entries, key=lambda e: str(e.get("at") or ""))

    def last(pred: Callable[[dict[str, Any]], bool]) -> dict[str, Any] | None:
        for e in reversed(lst):
            if pred(e):
                return e
        return None

    par = last(lambda e: e.get("kind") == "par")
    d = last(lambda e: e.get("kind") == "delivery")
    latest = last(lambda e: e.get("kind") == "count")
    out: dict[str, Any] = {"in_stock": None, "par": par.get("qty") if par else None, "status": None, "checked": "",
                           "consumption": None, "rate_per_day": None, "days_of_cover": None, "last_delivery": None,
                           "measured": False}
    current, checked = None, ""
    if d:
        out["last_delivery"] = {"at": d.get("at"), "qty": d.get("qty"), "on_hand_after": d.get("on_hand_after")}
        base = d.get("on_hand_after")
        if base is None:
            before = last(lambda e: e.get("kind") == "count" and str(e.get("at")) <= str(d.get("at")))
            base = before["qty"] + d["qty"] if before else None
        c = last(lambda e: e.get("kind") == "count" and str(e.get("at")) > str(d.get("at")))
        if c:
            current, checked = c.get("qty"), c.get("at")
        elif base is not None:
            current, checked = base, d.get("at")
        if c and base is not None:
            out["consumption"] = base - c["qty"]
            out["measured"] = True
            days = (when_ms(c.get("at")) - when_ms(d.get("at"))) / 86400000.0
            if days > 0:
                rate = out["consumption"] / days
                out["rate_per_day"] = js_round(rate * 100) / 100
                if rate > 0:
                    out["days_of_cover"] = js_round((c["qty"] / rate) * 10) / 10
    elif latest:
        current, checked = latest.get("qty"), latest.get("at")
    out["in_stock"], out["checked"] = current, checked
    if current is not None:
        cover = out["days_of_cover"]
        if current <= 0 or (cover is not None and cover < float(order_days or ORDER_DAYS)):
            out["status"] = "order_now"
        elif out["par"] is not None and current < out["par"]:
            out["status"] = "low"
        else:
            out["status"] = "in_stock"
    return out


def patch_supplies(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    if not layer or not isinstance(data.get("consumables"), list):
        return data
    items = [dict(c, entries=[dict(x) for x in c.get("entries") or [] if isinstance(x, dict)])
             if isinstance(c, dict) else c for c in data["consumables"]]
    touched: set[int] = set()
    for e in layer:
        if e.get("kind") == "append":
            row = e.get("row") if isinstance(e.get("row"), dict) else None
            if not row or any(cell(x.get("id")) == cell(row.get("id")) for c in items if isinstance(c, dict)
                              for x in c["entries"]):
                continue
            line = {"id": cell(row.get("id")), "kind": row.get("kind"), "qty": row.get("qty"),
                    "on_hand_after": num(row.get("on_hand_after")), "at": cell(row.get("at")),
                    "by": text(row.get("by")), "category": text(row.get("category")), "note": text(row.get("note"))}
            k = fold(row.get("item"))
            at = next((i for i, c in enumerate(items) if isinstance(c, dict) and fold(c.get("item")) == k), -1)
            if at == -1:
                items.append({"item": text(row.get("item")), "category": "", "entries": []})
                at = len(items) - 1
            items[at]["entries"].append(line)
            touched.add(at)
            continue
        for i, c in enumerate(items):
            if not isinstance(c, dict):
                continue
            for x in c["entries"]:
                if cell(x.get("id")) == e.get("key"):
                    x.update(e.get("fields") or {})
                    touched.add(i)
    order = data.get("order_days") or ORDER_DAYS
    for i in touched:
        c = items[i]
        figures = supply_figures(c["entries"], order)
        named = [x for x in c["entries"] if text(x.get("category"))]
        newest = max(named, key=lambda x: str(x.get("at") or ""), default=None)
        entries = sorted(c["entries"], key=lambda x: str(x.get("at") or ""), reverse=True)
        items[i] = {**c, **figures, "item": c.get("item"),
                    "category": text(newest.get("category")) if newest else c.get("category", ""),
                    "entries": entries}
    items.sort(key=lambda c: str(c.get("item") or "").lower() if isinstance(c, dict) else "")
    return {**data, "consumables": items}


def _resolved(status: Any) -> bool:
    return re.sub(r"[\s_-]+", " ", js_str(status).lower()).strip() in RESOLVED


def patch_repairs(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    keyed = _by_key(layer)
    if not keyed or not isinstance(data.get("rows"), list):
        return data
    only_open = data.get("resolved") is False
    rows, flipped = [], 0
    for row in data["rows"]:
        rid = cell(row.get("id")) if isinstance(row, dict) else ""
        if rid not in keyed:
            rows.append(row)
            continue
        r = dict(row)
        was = bool(r.get("resolved"))
        for e in keyed[rid]:
            r.update(e.get("fields") or {})
        r["resolved"] = _resolved(r.get("status"))
        flipped += int(r["resolved"]) - int(was)
        if only_open and r["resolved"]:
            continue
        rows.append(r)
    out = {**data, "rows": rows}
    if "open_count" in data and isinstance(data.get("open_count"), int):
        out["open_count"] = max(0, data["open_count"] - flipped)
        out["resolved_count"] = max(0, int(data.get("resolved_count") or 0) + flipped)
    return out


def categories(v: Any) -> list[str]:
    """locationsCategories_: commas outside parentheses separate them."""
    if isinstance(v, list):
        return [js_str(x).strip() for x in v if js_str(x).strip()]
    s = js_str(v).strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            got = json.loads(s)
            if isinstance(got, list):
                return [js_str(x).strip() for x in got if js_str(x).strip()]
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
    return [x.strip() for x in out if x.strip()]


def patch_incidents(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    keyed = _by_key(layer)
    if not keyed or not isinstance(data.get("rows"), list):
        return data
    rows = []
    for row in data["rows"]:
        rid = cell(row.get("id")) if isinstance(row, dict) else ""
        if rid not in keyed:
            rows.append(row)
            continue
        r = dict(row)
        full = dict(r.get("row") or {}) if isinstance(r.get("row"), dict) else {}
        for e in keyed[rid]:
            for f, v in (e.get("fields") or {}).items():
                full[f] = cell(v)
                if f in INCIDENT_TOP:
                    r[f] = cell(v)
        if full:
            r["row"] = full
        r["categories"] = categories(r.get("incident_category"))
        rows.append(r)
    rows.sort(key=lambda r: (when_ms(r.get("incident_date")) if isinstance(r, dict) else 0,
                             when_ms((r.get("row") or {}).get("timestamp")) if isinstance(r, dict) else 0),
              reverse=True)
    out = {**data, "rows": rows}
    if isinstance(data.get("categories"), list):
        out["categories"] = sorted({c for r in rows if isinstance(r, dict) for c in r.get("categories") or []})
    return out


_PART_TABS = {"overview": HOUSE_TAB, "notes": NOTES_TAB, "supplies": SUPPLY_TAB, "repairs": "workOrders",
              "incidents": "uiIncidents"}
_READ_PARTS = {"locationOverview": "overview", "locationNotes": "notes", "locationSupplies": "supplies",
               "locationRepairs": "repairs", "locationIncidents": "incidents"}
_PATCHERS: dict[str, Callable[[dict[str, Any], list[dict[str, Any]]], dict[str, Any]]] = {
    "overview": patch_overview, "notes": patch_notes, "supplies": patch_supplies, "repairs": patch_repairs,
    "incidents": patch_incidents}


def patch_assets(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    """The supplies part's House Inventory rows with the asset edits laid by row id."""
    if not layer or not isinstance(data.get("assets"), list):
        return data
    return {**data, "assets": patch_rows(data["assets"], [{**e, "fields": {f: cell(v) for f, v in
                                                                          (e.get("fields") or {}).items()}}
                                                          for e in layer])}


# a second tab a part carries: the supplies part's assets are the House Supplies inventory's rows
_PART_ALSO = {"supplies": (INVENTORY_TAB, patch_assets)}


def patch_part(part: str, data: Any, overlay: Overlay, house: str, source_at: float = 0.0) -> Any:
    """One pack part or one read's answer: confirmed by its own read when it has one, then laid over."""
    if part not in _PATCHERS or not isinstance(data, dict) or not overlay.busy():
        return data
    for tab, patcher in [(_PART_TABS[part], _PATCHERS[part])] + ([_PART_ALSO[part]] if part in _PART_ALSO else []):
        if source_at:
            # Apps Script read the sheet itself: an edit written before that read is in it, shown or cut away
            overlay.observe(tab, PACK, {e["key"]: None for e in overlay.layer(tab, PACK, house)}, source_at, True)
        layer = overlay.layer(tab, PACK, house)
        if layer:
            data = patcher(data, layer)
    return data


def patch_pack(data: Any, overlay: Overlay, house: str, source_at: float = 0.0) -> Any:
    """A Locations pack: every part it carries."""
    if not isinstance(data, dict) or not isinstance(data.get("parts"), dict) or not overlay.busy():
        return data
    parts = dict(data["parts"])
    for name in _PART_TABS:
        if name in parts:
            parts[name] = patch_part(name, parts[name], overlay, house, source_at)
    return {**data, "parts": parts}


def patch_answer(action: str, payload: Any, data: Any, overlay: Overlay, source_at: float = 0.0) -> Any:
    """A Locations or Clients read's answer on its way to the screen."""
    if action == "clientProfileDetails":
        key = client_key(payload.get("client")) if isinstance(payload, dict) else ""
        return patch_client_part(data, overlay, key, source_at) if key else data
    if action == "clientProfileCare":
        key = client_key(payload.get("client")) if isinstance(payload, dict) else ""
        tab = text(payload.get("tab")).lower() if isinstance(payload, dict) else ""
        return patch_care_part(data, overlay, key, tab, source_at) if key and tab in CARE_TABS else data
    if action == "clientProfileMeds":
        key = client_key(payload.get("client")) if isinstance(payload, dict) else ""
        tab = (text(payload.get("tab")).lower() or "meds") if isinstance(payload, dict) else ""
        return patch_meds_part(data, overlay, key, source_at) if key and tab == "meds" else data
    part = _READ_PARTS.get(action)
    if not part or not isinstance(payload, dict):
        return data
    house = house_code(payload.get("house"))
    if not house:
        return data
    return patch_part(part, data, overlay, house, source_at)


def today_ny() -> str:
    """Today in New York (locationsToday_), for a birthdate's age."""
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:  # noqa: BLE001 - no zone data: no age is drawn rather than a wrong one
        return ""


def patch_details(data: dict[str, Any], layer: list[dict[str, Any]], today: str = "") -> dict[str, Any]:
    """A client's profile (cpDetailsBuild_'s shape) with the profile edits laid as its read draws them."""
    if not layer or not isinstance(data, dict) or not isinstance(data.get("edit"), dict):
        return data
    edit = dict(data["edit"])
    blocks = {b: dict(data[b]) for b in CLIENT_BLOCKS if isinstance(data.get(b), dict)}

    def put(block: str, slot: str, value: Any) -> None:
        if block in blocks:
            blocks[block][slot] = value

    for e in layer:
        for f, raw in (e.get("fields") or {}).items():
            v = js_str(raw)
            edit[f] = v
            if f in CLIENT_SHOWN:
                block, slot = CLIENT_SHOWN[f]
                put(block, slot, phone_shown(v) if f in CLIENT_PHONES else (day_of(v) or v) if f in CLIENT_DATES else v)
            elif f == "dob":
                put("client", "dob", day_of(v))
                put("client", "age", age_of(day_of(v), today or today_ny()))
            elif f == "initials":
                put("client", "initials", v or initials_of((blocks.get("client") or {}).get("name")))
            elif f == "guardian_name":
                shown = guardian_shown(v)
                shown = v if shown is None else shown
                if text(shown) != text((blocks.get("guardian") or {}).get("name")):
                    put("guardian", "person_id", "")
                put("guardian", "name", shown)
            elif f == "ssa_name":
                if text(v) != text((blocks.get("guardian") or {}).get("ssa_name")):
                    put("guardian", "ssa_person_id", "")
                put("guardian", "ssa_name", v)
    return {**data, **blocks, "edit": edit}


def patch_client_part(data: Any, overlay: Overlay, key: str, source_at: float = 0.0) -> Any:
    """A client's details (the pack's part, or clientProfileDetails's answer): confirmed by its own read, then laid."""
    if not isinstance(data, dict) or not key or not overlay.busy():
        return data
    if source_at:
        # Apps Script read the clients tab itself: an edit written before that read is in it
        overlay.observe(CLIENTS_TAB, PACK, {e["key"]: None for e in overlay.layer(CLIENTS_TAB, PACK, key=key)},
                        source_at, True)
    layer = overlay.layer(CLIENTS_TAB, PACK, key=key)
    return patch_details(data, layer) if layer else data


def patch_care(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    """One Care & Support tab (cpCareBuild_'s shape), its rows corrected or hidden as cpCareOverridden_ draws them."""
    if not layer or not isinstance(data, dict) or not isinstance(data.get("rows"), list):
        return data
    rows = list(data["rows"])
    for e in layer:
        target, fields = js_str(e.get("target")), e.get("fields") or {}
        at = next((i for i, r in enumerate(rows) if isinstance(r, dict) and js_str(r.get("id")) == target
                   and isinstance(r.get("edit"), dict)), -1)
        if at < 0:
            continue
        row = rows[at]
        if js_str(fields.get("removed")) == "Yes":
            rows.pop(at)
            continue
        record = text(fields["record"] if "record" in fields else row["edit"].get("record"))
        body = care_verbatim(fields["text"] if "text" in fields else row.get("text"), CARE_TEXT_MAX)
        rows[at] = {"id": row.get("id"), "record": record, "date": iso(float(e.get("at") or 0))[:10],
                    "details": care_gist(body), "status": "Current", "source": "Edited in the Hub", "text": body,
                    "edit": {"record": record, "removed": ""}}
    statuses: list[str] = []
    for r in rows:
        s = js_str(r.get("status")) if isinstance(r, dict) else ""
        if s and s not in statuses:
            statuses.append(s)
    return {**data, "rows": rows, "statuses": statuses}


def patch_care_part(data: Any, overlay: Overlay, key: str, tab: str, source_at: float = 0.0) -> Any:
    """A client's care tab (the pack's part, or clientProfileCare's answer): confirmed by its own read, then laid."""
    if not isinstance(data, dict) or not key or tab not in CARE_TABS or not overlay.busy():
        return data
    record = care_key(key, tab)
    if source_at:
        # Apps Script read the overrides itself: an edit written before that read is in it
        overlay.observe(OVERRIDES_TAB, PACK, {record: None}, source_at, True)
    layer = overlay.layer(OVERRIDES_TAB, PACK, key=record)
    return patch_care(data, layer) if layer else data


def _meds_rank(row: dict[str, Any]) -> tuple[int, str]:
    """cpMedsBuild_'s order: Active first, then by name (localeCompare, near enough: case folded)."""
    return (0 if js_str(row.get("status")) == "Active" else 1, js_str(row.get("record")).casefold())


def patch_meds(data: dict[str, Any], layer: list[dict[str, Any]]) -> dict[str, Any]:
    """Medication › Medications (cpMedsBuild_'s shape): chart rows changed or taken off as its read draws them."""
    if not layer or not isinstance(data, dict) or not isinstance(data.get("rows"), list):
        return data
    rows = list(data["rows"])
    for e in layer:
        target, fields = js_str(e.get("target")), e.get("fields") or {}
        at = next((i for i, r in enumerate(rows) if isinstance(r, dict) and js_str(r.get("id")) == target
                   and isinstance(r.get("edit"), dict) and r["edit"]), -1)
        if at < 0:
            continue
        row = rows.pop(at)
        if js_str(fields.get("removed")) == "Yes":
            continue
        new = _meds_row(row, fields)
        if new is None:
            after = {**row["edit"], **fields}
            new = {**row, "record": after.get("name", row.get("record")), "edit": after,
                   "status": "Discontinued" if js_str(after.get("discontinued")) else "Active"}
        if _meds_rank(new) == _meds_rank(row):
            rows.insert(at, new)
            continue
        # a renamed or (dis)continued row takes its place in the read's order; the others keep theirs
        rows.insert(next((i for i, r in enumerate(rows) if isinstance(r, dict) and _meds_rank(new) < _meds_rank(r)),
                         len(rows)), new)
    statuses: list[str] = []
    for r in rows:
        s = js_str(r.get("status")) if isinstance(r, dict) else ""
        if s and s not in statuses:
            statuses.append(s)
    return {**data, "rows": rows, "statuses": statuses}


def patch_meds_part(data: Any, overlay: Overlay, key: str, source_at: float = 0.0) -> Any:
    """A client's chart (the pack's part, or clientProfileMeds's answer): confirmed by its own read, then laid."""
    if not isinstance(data, dict) or not key or not overlay.busy():
        return data
    if source_at:
        # Apps Script read the chart itself: an edit written before that read is in it
        overlay.observe(MEDS_TAB, PACK, {key: None}, source_at, True)
    layer = overlay.layer(MEDS_TAB, PACK, key=key)
    return patch_meds(data, layer) if layer else data


def patch_client_pack(data: Any, overlay: Overlay, key: str, source_at: float = 0.0) -> Any:
    """A client's pack (Clients): its details part, its care tabs and its chart."""
    if not isinstance(data, dict) or not isinstance(data.get("parts"), dict) or not overlay.busy():
        return data
    if js_str(data.get("client")).strip() not in ("", key):
        return data
    parts = dict(data["parts"])
    if isinstance(parts.get("details"), dict):
        parts["details"] = patch_client_part(parts["details"], overlay, key, source_at)
    for tab in CARE_TABS:
        if isinstance(parts.get("care_" + tab), dict):
            parts["care_" + tab] = patch_care_part(parts["care_" + tab], overlay, key, tab, source_at)
    if isinstance(parts.get("meds"), dict):
        parts["meds"] = patch_meds_part(parts["meds"], overlay, key, source_at)
    return {**data, "parts": parts}


# ── the pace the queue keeps with the sheets ─────────────────────────────────
_QUOTA_RE = re.compile(r"quota|too many|rate ?limit|exceeded|try again later|service invoked", re.I)


def quota_said(status: int, message: Any = "") -> bool:
    """Google said slow down: a 429, or a quota sentence."""
    return int(status or 0) == 429 or bool(_QUOTA_RE.search(js_str(message)))


class Pacer:
    """A token bucket over the ledger's deliveries: `per_min` writes a minute, slowed and paused when Google balks."""

    def __init__(self, per_min: float = WRITES_PER_MIN, burst_s: float = BURST_S,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.ceiling = max(1.0, float(per_min))
        self.rate = self.ceiling
        self.burst_s = max(1.0, float(burst_s))
        self.clock = clock
        self.tokens = self.capacity()
        self.at = clock()
        self.paused_until = 0.0
        self.pause_s = PAUSE_FIRST_S
        self.pressures = 0
        self.last_pressure = ""
        self.delivered = 0

    def capacity(self) -> float:
        return max(1.0, self.rate * self.burst_s / 60.0)

    def _fill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity(), self.tokens + (now - self.at) * self.rate / 60.0)
        self.at = now

    def room(self) -> int:
        """How many writes may leave together now (at least one, once its wait is over)."""
        self._fill()
        return max(1, int(min(self.tokens, self.capacity())))

    def wait_s(self, n: int = 1) -> float:
        """Seconds until `n` writes may leave."""
        self._fill()
        now = self.clock()
        need = min(float(max(1, n)), self.capacity())
        wait = 0.0 if self.tokens >= need else (need - self.tokens) * 60.0 / self.rate
        return max(wait, self.paused_until - now, 0.0)

    def take(self, n: int = 1) -> None:
        self._fill()
        self.tokens -= max(1, n)
        self.delivered += max(1, n)

    def pressure(self, why: str) -> float:
        """Google pushed back: a pause that doubles each time, and half the pace until it recovers."""
        now = self.clock()
        self.pressures += 1
        self.last_pressure = js_str(why)[:160]
        self.paused_until = max(self.paused_until, now + self.pause_s)
        held = self.pause_s
        self.pause_s = min(PAUSE_MAX_S, self.pause_s * 2)
        self.rate = max(self.ceiling / 8.0, self.rate / 2.0)
        self.tokens = min(self.tokens, 0.0)
        return held

    def relief(self) -> None:
        """A delivery Google took: the pace climbs back a write a minute at a time."""
        self.pause_s = max(PAUSE_FIRST_S, self.pause_s / 2)
        self.rate = min(self.ceiling, self.rate + 1.0)

    def state(self) -> dict[str, Any]:
        self._fill()
        now = self.clock()
        return {"per_min": round(self.rate, 2), "ceiling_per_min": self.ceiling, "tokens": round(self.tokens, 2),
                "paused_s": round(max(0.0, self.paused_until - now), 1), "pressures": self.pressures,
                "last_pressure": self.last_pressure, "delivered": self.delivered}
