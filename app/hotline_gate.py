"""Who may hear the hotline's names on the live stream: the relay's hotline desk gate (hotline_desk.app_access, lib/
badgeAccess badgeAllowsApp plus its containment) for Smart Comms, answered off asa-hub-db's copy of the Core book with
the kept edits laid, never off Google: where the copy cannot vouch for a grant the door stays shut, as the relay's did
when neither its mirror nor its live read could."""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import house_tables as HT
import hubdb
import locations as L
import scope as sc

APP_ID = "smartcomms"
CORE_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
APP_LABELS = {"smartcomms": "Smart Comms", "clients": "Client Care"}
CONTAINED_ROLES = frozenset({"client", "onboarding", "interviewer"})
TENANT_BASIC_APPS = frozenset({"myasa", "users", "chat", "suggestions", "teamboard", "calendar", "playground"})
FRESH_S = float(os.getenv("HUB_MIRROR_TRUST_MAX", "7200"))
# when App Control last changed a grant, kept beside the slices as the relay's hotline desk keeps it
ACCESS_WRITTEN_FILE = Path(os.getenv("HUB_ACCESS_WRITTEN_FILE") or
                           str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".access-written-at"))

# the reader of asa-hub-db (main.py's DB) and of the kept edits laid over it (main.py's _own); set by live_plane
DB: list[Any] = [None]
OWN: list[Callable[[], Any] | None] = [None]
# the ids Settings > My Work keeps to the master's own session, and the accounts that see them too (the config lane)
APP_CUT: list[Callable[[], Any]] = []
APP_SEEN: list[Callable[[], Any]] = []


def _access_written_kept() -> float:
    try:
        return float(ACCESS_WRITTEN_FILE.read_text().strip())
    except (OSError, ValueError):
        return 0.0


ACCESS_WRITTEN_AT = [_access_written_kept()]


def note_access_written() -> None:
    """App Control changed who reaches which app: an older copy stops vouching."""
    ACCESS_WRITTEN_AT[0] = time.time()
    try:
        ACCESS_WRITTEN_FILE.write_text(f"{ACCESS_WRITTEN_AT[0]:.3f}")
    except OSError:
        pass


def words(cell: Any) -> list[str]:
    """A badge cell ("ADMIN, MANAGER") as its words, upper-cased."""
    return [b.strip().upper() for b in re.split(r"[,;|\n]+", str(cell if cell is not None else "")) if b.strip()]


def list_cell(cell: Any) -> list[str]:
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


def _listed(readers: list[Callable[[], Any]]) -> frozenset[str]:
    if not readers:
        return frozenset()
    try:
        return frozenset(str(x) for x in (readers[0]() or ()))
    except Exception:  # noqa: BLE001 - FAIL-OPEN for the cut, nobody let in for the seen
        return frozenset()


def _text(v: Any) -> str:
    return "" if v is None else str(v)


def core(uid: str, app_id: str) -> dict[str, Any]:
    """The gate's rows off the Core book's copy, the kept edits laid, with how old the copy is (as the relay's mirror
    read: the first users row of the account, the last rule and tenants rows of the app)."""
    db = DB[0]
    token = hubdb.OWN.set(OWN[0]() if OWN[0] is not None else None)
    try:
        users = HT.book_tab(L.Reads(db, None), CORE_ID, "users")
        rules = HT.book_tab(L.Reads(db, None), CORE_ID, "app_badge_access")
        tenants_ref = HT.book_tab(L.Reads(db, None), CORE_ID, "app_tenant_access")
        user = None
        if users is not None:
            for _rn, raw in db.rows(users):
                if _text(raw.get("user_id")) == str(uid or ""):
                    user = {k: _text(v) for k, v in raw.items()}
                    break
        rule: list[str] = []
        for _rn, raw in (db.rows(rules) if rules is not None else []):
            if _text(raw.get("app_id")) == app_id:
                rule = words(raw.get("badges"))
        tenants: list[str] = []
        for _rn, raw in (db.rows(tenants_ref) if tenants_ref is not None else []):
            if _text(raw.get("app_id")) == app_id:
                tenants = list_cell(raw.get("tenants"))
        book = db.book(CORE_ID)
    finally:
        hubdb.OWN.reset(token)
    age = None
    if users is not None and rules is not None and book is not None:
        age = max(0.0, time.time() - db.as_of({CORE_ID}))
    return {"source": "mirror", "user": user, "rule": rule, "tenants": tenants, "age_s": age,
            "sync_ok": book is not None and str(book.status or "").strip().lower() in ("ok", hubdb.RECORD_STATUS)}


def app_access(uid: str, role: str, app_id: str = APP_ID, fresh_s: float = FRESH_S, *, is_master: bool | None = None,
               refuse_roles: tuple[str, ...] | list[str] | frozenset[str] = (), app_label: str = "") -> dict[str, Any]:
    """{open, reason, why, via}: hotline_desk.app_access on asa-hub-db's copy."""
    label = app_label or APP_LABELS.get(app_id) or app_id

    def closed(reason: str, why: str) -> dict[str, Any]:
        return {"open": False, "reason": reason, "why": why, "via": ""}

    def opened(via: str, why: str) -> dict[str, Any]:
        return {"open": True, "reason": "", "why": why, "via": via}

    session_role = str(role or "").strip().lower()
    refused = {str(r).strip().lower() for r in refuse_roles if str(r).strip()}
    if not uid and not session_role:
        return closed("session", "This session carries no account.")
    if session_role in refused:
        return closed("restricted", f"{label} is not served to the {session_role} role here.")
    if is_master is True:
        return opened("master", "the master's view is never narrowed")
    if not str(uid or "").strip():
        return closed("session", "This session carries no account id, so the door stays closed.")
    if app_id in _listed(APP_CUT) and str(uid).strip() not in _listed(APP_SEEN):
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    mirror: dict[str, Any] | None = None
    mirror_error = ""
    try:
        mirror = core(uid, app_id)
    except Exception as exc:  # noqa: BLE001
        mirror_error = f"The access record could not be read ({type(exc).__name__})."

    def narrowed(user: dict[str, Any] | None) -> dict[str, Any] | None:
        if user is None:
            return None
        if str(user.get("active") or "").strip().lower() == "false":
            return closed("restricted", "This account is not active.")
        if app_id in list_cell(user.get("app_denials")):
            return closed("badge", f"{label} was removed from this account in App Access.")
        account_role = str(user.get("role") or "").strip().lower()
        if account_role in refused:
            return closed("restricted", f"{label} is not served to the {account_role} role here.")
        return None

    if mirror is not None:
        hit = narrowed(mirror["user"])
        if hit:
            return hit
    if session_role == "admin" and is_master is None:
        if mirror is None or mirror["user"] is None:
            return closed("unreadable", " ".join(x for x in (
                mirror_error or "This account is not in the access copy yet.", "So the door stays closed.") if x))
        return opened("admin_floor", "the admin floor, standing in for a master flag not yet seen")
    vouches = (mirror is not None and mirror["user"] is not None and mirror["sync_ok"]
               and mirror["age_s"] is not None and mirror["age_s"] <= fresh_s
               and time.time() - mirror["age_s"] >= ACCESS_WRITTEN_AT[0])
    if not vouches:
        if mirror is None:
            return closed("unreadable", f"{mirror_error} So the door stays closed.")
        if mirror["user"] is None:
            return closed("unreadable", "This account is not in the access copy yet, so the door stays closed.")
        return closed("stale", "The access record is too old to vouch for a grant, so the door stays closed.")
    user = mirror["user"]
    rule = list(mirror["rule"] or [])
    account_role = str(user.get("role") or "").strip().lower()
    for word in sorted({session_role, account_role} & CONTAINED_ROLES):
        if word.upper() not in rule:
            return closed("restricted", f"{label} is not open to {word} accounts unless App Access names that role.")
    home = str(user.get("home_tenant") or "").strip()
    tenants = list(mirror["tenants"] or [])
    if home and tenants and app_id not in TENANT_BASIC_APPS and home not in tenants:
        return closed("restricted", f"{label} is not installed for this account's home tenant.")
    if not rule:
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")
    worn = set(words(user.get("types")))
    # the role word counts as a badge, but not one a family account wears for another column (scope.role_counts)
    for word in (session_role, account_role):
        if word and sc.role_counts(user.get("types"), word):
            worn.add(word.upper())
    for word in list(worn):
        stands = sc.BADGE_FOLLOWS.get(word)
        if stands:
            worn.add(stands)
    if worn & set(rule):
        return opened(mirror["source"], "badge")
    return closed("badge", f"{label} is not open to this account's badges.")
