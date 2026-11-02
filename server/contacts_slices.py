"""The cortex's contact list, as one slice — and as the payload the relay hands to Apps Script.
WHY THIS EXISTS."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg2
import psycopg2.extras

RESOURCES = ("cortexContacts",)

# The People house's own column order — roster_sync's PEOPLE_HEADER plus the guardian column Clients.gs added later.
PEOPLE_FIELDS = (
    "id", "name", "first_name", "last_name", "role", "status",
    "email", "phone", "city", "state", "employee_id", "start_date", "end_date",
    "avatar", "source", "source_coverage", "external_id", "updated_at",
)

SOURCE = "ops.employees"

# A row nothing has touched for a day after the newest one is a ghost — _persist_bucket upserts and never deletes…
_GHOST_WINDOW = timedelta(days=1)

# The fields whose per-field provenance travels with the row, so the Hub can say WHICH system knew a value ("phone…
_PROVENANCE_FIELDS = ("first_name", "last_name", "role", "status", "email", "phone",
                      "city", "state", "employee_id", "start_date", "end_date")

# --------------------------------------------------------------------------- THE GATES — one per field.

# Words the job-application form leaks into a person's fields.
FORM_WORDS = re.compile(
    r"ssn|social security|applica|street|zip|date of birth|\bdob\b|\[|\]|home phone|"
    r"mobile phone|please explain|branch|position|signature|initial|last first|"
    r"p\.?o\.? box|louisville|44641|http|www\.|\.com\b|@",
    re.IGNORECASE,
)
# Test and probe people never travel — a rehearsal is not a contact.
TEST_WORDS = re.compile(r"\btest\b|\bteste\b|\bprobe\b|\bdiag\b|\bsample\b|\bdummy\b|\bplaceholder\b",
                        re.IGNORECASE)

_NAME_TOKEN = re.compile(r"^[a-z][a-z'\-\.]*$")
_STATUS_VOCAB = {
    "active", "inactive", "archived", "pending", "unknown", "other", "admin",
    "onboarding", "on leave", "offboarding", "terminated", "away", "off",
}
# Roles the estate actually uses.
_ROLE_VOCAB = {
    "staff", "admin", "administrator", "manager", "director", "dsp",
    "direct support professional", "direct support professional (dsp)",
    "house manager", "hm", "nurse", "rn", "lpn", "qidp", "supervisor",
    "division supervisor", "coordinator", "software engineer", "hr", "finances",
    "quality", "entity", "guardian", "client", "interviewer", "onboarding",
}
_ROLE_FREE = re.compile(r"^[a-z][a-z /&\-\(\)\.]{1,39}$")
_EMAIL = re.compile(r"^[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}$")
_EMPLOYEE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_.]{0,19}$")
_STATE = re.compile(r"^[A-Za-z]{2}$|^[A-Za-z][A-Za-z ]{2,29}$")
_CITY = re.compile(r"^[A-Za-z][A-Za-z .'\-]{1,39}$")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def _text(v: Any, cap: int = 200) -> str:
    """A cell's text: control characters out, whitespace collapsed, capped."""
    s = "" if v is None else str(v)
    s = _CTRL.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:cap]


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def clean_name(v: Any) -> str:
    """A person's name: two to five alphabetic words, no form text, no digits, no test marker, at most sixty…"""
    s = _text(v, 80)
    if not s or len(s) > 60:
        return ""
    if FORM_WORDS.search(s) or TEST_WORDS.search(s) or re.search(r"\d", s):
        return ""
    tokens = _ascii(s).lower().split(" ")
    if not (2 <= len(tokens) <= 5):
        return ""
    if not all(_NAME_TOKEN.match(t) for t in tokens):
        return ""
    return s


def clean_name_part(v: Any) -> str:
    """first_name / last_name: one to three alphabetic words."""
    s = _text(v, 60)
    if not s or FORM_WORDS.search(s) or re.search(r"\d", s):
        return ""
    tokens = _ascii(s).lower().split(" ")
    if not (1 <= len(tokens) <= 3) or not all(_NAME_TOKEN.match(t) for t in tokens):
        return ""
    return s


def clean_role(role: Any, provenance: dict | None) -> str:
    """The job title the platform may repeat, or ''."""
    r = _text(role, 120)
    if not r:
        return ""
    if (provenance or {}).get("role") == "erp" and not FORM_WORDS.search(r):
        return r[:80]
    low = _ascii(r).lower()
    if low in _ROLE_VOCAB:
        return r
    if FORM_WORDS.search(r) or re.search(r"\d", r) or not _ROLE_FREE.match(low):
        return ""
    if len(low.split(" ")) > 5:
        return ""
    return r


def clean_status(v: Any) -> str:
    s = _ascii(_text(v, 40)).lower()
    if s == "active test":
        return ""              # a rehearsal row's status is not a status
    return s if s in _STATUS_VOCAB else ""


def clean_email(v: Any) -> str:
    s = _ascii(_text(v, 120)).lower()
    if not s or not _EMAIL.match(s):
        return ""
    if TEST_WORDS.search(s.split("@")[0]):
        return ""
    return s


def phone_digits(v: Any) -> str:
    """Ten US digits, or ''."""
    d = re.sub(r"\D+", "", _text(v, 40))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10:
        return ""
    if d[0] in "01" or len(set(d)) < 3:
        return ""
    return d


def clean_phone(v: Any) -> str:
    d = phone_digits(v)
    return f"{d[:3]}-{d[3:6]}-{d[6:]}" if d else ""


_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%b %d, %Y", "%B %d, %Y",
                 "%d %b %Y", "%Y/%m/%d")


def clean_date(v: Any) -> str:
    """A calendar day as YYYY-MM-DD, from the shapes the sources use, or ''."""
    if isinstance(v, datetime):
        return v.date().isoformat() if 1940 <= v.year <= 2100 else ""
    s = _text(v, 40)
    if not s:
        return ""
    # a timestamp's day is its first ten characters; a plain day is itself
    for cand in (s, s[:10].strip()):
        for fmt in _DATE_FORMATS:
            try:
                dt = datetime.strptime(cand, fmt)
            except ValueError:
                continue
            return dt.date().isoformat() if 1940 <= dt.year <= 2100 else ""
    return ""


def clean_employee_id(v: Any) -> str:
    s = _text(v, 40)
    return s if s and _EMPLOYEE_ID.match(s) and not FORM_WORDS.search(s) else ""


def clean_city(v: Any) -> str:
    s = _text(v, 60)
    return s if s and _CITY.match(_ascii(s)) and not FORM_WORDS.search(s) else ""


def clean_state(v: Any) -> str:
    s = _text(v, 40)
    if not s or not _STATE.match(_ascii(s)) or FORM_WORDS.search(s):
        return ""
    return s.upper() if len(s) == 2 else s


def _iso(ts: Any) -> str:
    if ts is None:
        return ""
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(ts)


def _hub_name_key(v: Any) -> str:
    """The Hub's own collision key (bulkNameKey_ / clientNameKey_): letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", _ascii(str(v or "")).lower())


def project(row: dict) -> tuple[dict | None, str]:
    """One ops.employees row → (one People-shaped contact, '') or (None, why it was refused)."""
    name_key = _text(row.get("name_key"), 80)
    if not name_key:
        return None, "no name_key"
    profile = row.get("profile") or {}
    if not isinstance(profile, dict):
        profile = {}
    provenance = profile.get("_provenance") or {}
    if not isinstance(provenance, dict):
        provenance = {}
    name = clean_name(row.get("display_name")) or clean_name(profile.get("full_name"))
    if not name:
        return None, "name"
    dropped: list[str] = []

    def gate(field: str, value: str, raw: Any) -> str:
        if _text(raw) and not value:
            dropped.append(field)
        return value

    coverage = row.get("source_coverage") or []
    if not isinstance(coverage, (list, tuple)):
        coverage = [str(coverage)]
    out = {
        # roster_sync's id law, kept so people_types decisions keep matching
        "id": f"PPL_{name_key[:28]}",
        "name": name,
        "first_name": gate("first_name", clean_name_part(profile.get("first_name")), profile.get("first_name")),
        "last_name": gate("last_name", clean_name_part(profile.get("last_name")), profile.get("last_name")),
        "role": gate("role", clean_role(profile.get("role"), provenance), profile.get("role")),
        "status": gate("status", clean_status(row.get("status") or profile.get("status")),
                       row.get("status") or profile.get("status")),
        "email": gate("email", clean_email(profile.get("email")), profile.get("email")),
        "phone": gate("phone", clean_phone(profile.get("phone")), profile.get("phone")),
        "city": gate("city", clean_city(profile.get("city")), profile.get("city")),
        "state": gate("state", clean_state(profile.get("state")), profile.get("state")),
        "employee_id": gate("employee_id", clean_employee_id(profile.get("employee_id")), profile.get("employee_id")),
        "start_date": gate("start_date", clean_date(profile.get("start_date")), profile.get("start_date")),
        "end_date": gate("end_date", clean_date(profile.get("end_date")), profile.get("end_date")),
        "avatar": "",
        "source": SOURCE,
        "source_coverage": ",".join(_text(c, 20) for c in coverage if _text(c, 20)),
        "external_id": name_key,
        "updated_at": _iso(row.get("updated_at")),
        # beside the house columns: the keys the Hub matches on, computed once here so both sides agree on the shape
        "kind": "employee",
        "hub_name_key": _hub_name_key(name),
        "phone_key": phone_digits(profile.get("phone")),
        "provenance": {k: _text(provenance[k], 20) for k in _PROVENANCE_FIELDS
                       if _text(provenance.get(k), 20)},
        # honest about the filter: which fields it emptied on this row
        "dropped": dropped,
    }
    return out, ""


def _build(dsn: str) -> tuple[list[dict], str | None, dict]:
    quality: dict[str, Any] = {"refused": {}, "dropped": {}, "collisions": 0, "aliases": 0}
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute("SELECT max(updated_at) AS at FROM ops.employees")
        top = cur.fetchone()
        newest = top["at"] if top else None
        if newest is None:
            return [], None, quality
        # the cortex's own alias table: an alias must never come back as a second person once it was folded there
        aliases: set[str] = set()
        try:
            cur.execute("SELECT name_key FROM ops.identity_overrides "
                        "WHERE canonical_key IS NOT NULL AND canonical_key <> name_key")
            aliases = {str(r["name_key"]) for r in cur.fetchall()}
        except psycopg2.Error:
            conn.rollback()
            aliases = set()
        cur.execute(
            "SELECT name_key, display_name, status, profile, source_coverage, updated_at "
            "FROM ops.employees WHERE updated_at >= %s ORDER BY updated_at DESC, name_key",
            (newest - _GHOST_WINDOW,))
        by_id: dict[str, dict] = {}
        for r in cur.fetchall():
            if str(r.get("name_key") or "") in aliases:
                quality["aliases"] += 1
                continue
            out, why = project(dict(r))
            if not out:
                quality["refused"][why] = quality["refused"].get(why, 0) + 1
                continue
            for f in out["dropped"]:
                quality["dropped"][f] = quality["dropped"].get(f, 0) + 1
            # two name_keys sharing their first 28 characters share an id — the newest row (the query's order) keeps…
            if out["id"] in by_id:
                quality["collisions"] += 1
                continue
            by_id[out["id"]] = out
    rows = sorted(by_id.values(), key=lambda x: x["external_id"])
    return rows, _iso(newest), quality


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """build_one's dispatch shape, same as hr_slices.build."""
    if resource not in RESOURCES:
        raise KeyError(resource)
    rows, at, _quality = _build(dsn)
    return rows, at


def build_with_quality(dsn: str) -> tuple[list[dict], str | None, dict]:
    """The hand-off's read: the rows AND what the filter refused, for the log."""
    return _build(dsn)


def handoff_payload(rows: list[dict], source_at: str | None) -> dict:
    """What the relay POSTs to `peopleSyncFromPlatform`: the People-shaped columns only — the matching keys and…"""
    lean = [{k: r.get(k, "") for k in PEOPLE_FIELDS} for r in rows]
    return {"rows": lean, "source_at": source_at or "", "source": SOURCE,
            "count": len(lean)}


if __name__ == "__main__":  # a read-only probe: counts, never rows
    import os
    import sys
    dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    got, at, q = _build(dsn)
    print(json.dumps({"rows": len(got), "source_at": at, "quality": q,
                      "with_email": sum(1 for r in got if r["email"]),
                      "with_phone": sum(1 for r in got if r["phone_key"]),
                      "with_role": sum(1 for r in got if r["role"])}, indent=1))
