"""Staff's visit line (apps-script/StaffProfiles.gs staffProfileVisit) decided off asa-hub-db: who opened which section
of whose profile, one row per visitor, person and section in a quiet window, kept in app.edits over the
staff_profile_visits tab; Staff's Activity reads it, and it is never logged elsewhere. The quiet window is held in this
process, as Apps Script held it in its script cache."""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

import candidate_papers as CP
import gsjs
import locations as L
import staff as SP
import staff_writes as SW
import writes as W
from writes import Decision

VISITS_HEADER = ("id", "staff_key", "staff_name", "section", "visitor_email", "visitor_name", "at")
SECTIONS = ("profile", "clients", "locations", "calendar", "preferences", "driving", "employment", "documents", "compliance",
            "performance", "hr", "pay", "actions", "activity")
# SP_VISIT_QUIET_SECONDS
QUIET_S = 1800.0
NOT_RECORDED = {"status": 200, "data": {"recorded": False}}

_quiet: dict[str, float] = {}
_quiet_lock = threading.Lock()


def _quiet_held(key: str) -> bool:
    with _quiet_lock:
        until = _quiet.get(key)
        if until is not None and until <= time.time():
            _quiet.pop(key, None)
            until = None
    return until is not None


def _hold(key: str) -> None:
    now = time.time()
    with _quiet_lock:
        for k in [k for k, until in _quiet.items() if until <= now]:
            _quiet.pop(k, None)
        _quiet[key] = now + QUIET_S


def visit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileVisit: a viewer who sees every staff member whole opened a section of this person's profile. A
    session the relay says leaves no line, a visit or the service identity is never recorded."""
    if not SP.whole_gate(sess):
        return Decision(SP.unknown())
    user = sess.user
    if not user or user.get("unlogged") or user.get("visiting_member") or user.get("is_service"):
        return Decision(dict(NOT_RECORDED))
    p = payload if isinstance(payload, dict) else {}
    section = SW.sp_text(p.get("section")).lower()
    if section not in SECTIONS:
        return W.refuse(400, "section: one of " + ", ".join(SECTIONS) + ".")
    ctx = SP.person_for(sess, p.get("staff"))
    if ctx.get("refused"):
        return SW.refused(ctx["refused"])
    email = gsjs.str_(user.get("email")).lower()
    quiet = "spv_" + gsjs.name_key(email) + "_" + ctx["key"] + "_" + section
    if _quiet_held(quiet):
        return Decision(dict(NOT_RECORDED))
    reads = sess.reads
    if CP.gate_holds(reads, CP.BOOK_GATE):
        # held once per window, like a recorded visit: the funnel's own held note is never repeated per section open
        _hold(quiet)
        return Decision(dict(NOT_RECORDED))
    res = W.tab_of(reads, SP.VISITS_TAB)
    rec = {"id": W.mint("SV_"), "staff_key": ctx["key"], "staff_name": ctx["name"], "section": section,
           "visitor_email": email, "visitor_name": W.who(user), "at": W.now_iso(reads)}
    kept = W.append_record(res, VISITS_HEADER, rec, ctx["key"])
    _hold(quiet)
    return W.final({"status": 200, "data": {"recorded": True}}, [kept], ctx["key"])


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"staffProfileVisit": visit}
POLICY: dict[str, dict[str, Any]] = {"staffProfileVisit": {
    "roles": ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer"),
    "params": {"staff": "string", "section": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"staffProfileVisit": {"status": 409, "message": W.BUSY}}
