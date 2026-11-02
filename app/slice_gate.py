"""The slices App Control decides beside their roles (the operator's access sheet, 2026-10-29): a slice file
(/snapshot/<resource>.json, front_door.gate), the bang (/snapshot/all.json) and a place's bundle (live_bundle) hand one
of these only to the master, or to a viewer whose whole view an App Control row opens — the row of the app that owns
the data, or the row of an app the manifest says reads the slice (its `apps`). A slice carries every row, so a view
narrowed to a person's own clients (a family member's) never opens one; whoever it is refused to reads the resource on
the live path, where the door's own gate decides. Every slice not named here still answers its roles alone."""
from __future__ import annotations

import logging
import time
from typing import Any, Iterable

import locations as L
import scope as sc

log = logging.getLogger("asa-hub-app.slice-gate")

# resource → the App Control rows that own its data, besides the rows of the apps that read it
OWNERS: dict[str, tuple[str, ...]] = {
    # the staff roster: Staff's Whole team row (a House Manager, a Team Lead or a DSP opens their own profile alone)
    "people": ("staff-profiles.team",),
    # Staff Candidates: the candidates and the legacy talent pool (interviews.HIRING_APP)
    "candidates": ("staff-candidates",),
    "talentPool": ("staff-candidates",),
    # Client Candidates: the referrals (app/potential_clients.py)
    "potentialClients": ("client-candidates",),
    # Clients: the records, the plans and the doctor dates (a family member opens their own client alone)
    "clients": ("client-profiles",),
    "isps": ("client-profiles",),
    "drAppointments": ("client-profiles",),
    # the faces the Clients and SSA rosters draw from this slice alone (clientReads.ts, ssaReads.ts: no other copy)
    "photos": ("client-profiles", "ssa-profiles"),
    # the rows of the apps that read them (their pages fall back to their own doors)
    "uiIncidents": (),
    "houses": (),
    "workOrders": (),
    # what the operator's Site Navigation sheet shuts to House Mgr, Team Lead and DSP (10-30): the HR tracker (HR
    # Admin), the support queue (Support Requests), the punches (Time Reconciliation, Activity > Shifts), attendance
    # (Performance), the punch board (Time Reconciliation, Builder) and Smart Comms' calls, texts and windows (Activity)
    "staffIssues": ("staff-profiles.hrAdmin",),
    "supportQueue": ("support-desk",),
    "psiPunches": ("scheduling.timeReconciliation", "staff-profiles.activity"),
    "commAttendance": ("staff-profiles.performance",),
    "commPunchBoard": ("scheduling.timeReconciliation", "scheduling.builder"),
    "commCalls": ("staff-profiles.activity",),
    "commWorkItems": ("staff-profiles.activity",),
    "commWhen": ("staff-profiles.activity",),
    "commWhenMoments": ("staff-profiles.activity",),
    "smartCommsActivity": ("staff-profiles.activity",),
    "smartCommsDesk": ("staff-profiles.activity",),
    "commRoutes": ("staff-profiles.activity",),
}
# decided by their own rows alone, never by the manifest's reading apps (smartcomms names HM); the generic verbs and
# the support queue's own doors give the same verdict (sheet_resources.gate, hotline_queue._readable)
OWNERS_ALONE = frozenset({"staffIssues", "supportQueue", "psiPunches", "commAttendance", "commPunchBoard", "commCalls",
                          "commWorkItems", "commWhen", "commWhenMoments", "smartCommsActivity", "smartCommsDesk",
                          "commRoutes"})
# the views that are every row
WHOLE = ("master", "all")
HELD_S = 60.0
HELD_MAX = 5000
_HELD: dict[Any, tuple[float, dict[str, bool]]] = {}
# the role an SSA's or a FAMILY's slices are matched by: a word no manifest entry names, so only the slices every
# session reads answer (the operator's FIX BADGES sheet, 10-30: their own clients alone, through the doors' scope)
FAMILY_ROLE = "family"
_ROLES_HELD: dict[Any, tuple[float, str]] = {}


def opens(sess: L.Session, resource: str, apps: Iterable[str] = ()) -> bool:
    """Blocking: whether this viewer may read the slice whole — always one not named here; the master first; else an
    owning row or a reading app's row that opens every row to them. FAIL-CLOSED: a row that defers opens nothing."""
    if resource not in OWNERS:
        return True
    user = sess.user
    if sc.is_real_master(user):
        return True
    if not user or user.get("is_service"):
        return False
    reading = () if resource in OWNERS_ALONE else apps or ()
    for app in dict.fromkeys([*OWNERS[resource], *(a for a in reading if isinstance(a, str) and a)]):
        try:
            g = sc.profile_app_gate(app, user, sess.reads.scope_sources())
        except sc.Defer:
            continue
        if g.get("open") is True and g["scope"].get("kind") in WHOLE:
            return True
    return False


def apps_of(manifest: Iterable[dict[str, Any]]) -> dict[str, list[str]]:
    """The manifest's reading apps of each slice named here."""
    return {str(e.get("resource") or ""): list(e.get("apps") or []) for e in manifest
            if str(e.get("resource") or "") in OWNERS}


def verdicts(s: Any, manifest: Iterable[dict[str, Any]]) -> dict[str, bool]:
    """Blocking: opens() for every slice named here, for a front-door session (front_door.Session) — the master's own
    session whatever is read; else its caller built as main.py builds a door's (lane_gate.in_session), held a minute.
    Every one shut, and nothing held, when the caller cannot be built or App Control cannot be read."""
    if s.master:
        return dict.fromkeys(OWNERS, True)
    hit = _HELD.get(s)
    if hit is not None and time.time() < hit[0]:
        return hit[1]
    import lane_gate as LG  # noqa: PLC0415 - it imports the front door, which imports this module
    reading = apps_of(manifest)
    try:
        got = LG.in_session(s, lambda sess: {r: opens(sess, r, reading.get(r, ())) for r in OWNERS})
    except Exception as exc:  # noqa: BLE001 - a gate that cannot decide stays shut
        log.warning("slice gate: App Control could not be asked for %s (%s)", s.uid or "?", type(exc).__name__)
        return dict.fromkeys(OWNERS, False)
    if len(_HELD) >= HELD_MAX:
        _HELD.clear()
    _HELD[s] = (time.time() + HELD_S, got)
    return got


def shut(s: Any, manifest: Iterable[dict[str, Any]]) -> frozenset[str]:
    """Blocking: the slices this session may not read whole."""
    return frozenset(r for r, ok in verdicts(s, manifest).items() if not ok)


def slice_role(s: Any) -> str:
    """Blocking: the role a front-door session's slices are matched by (the manifest's roles): its own, except an
    SSA's or a FAMILY's whatever its role says (scope.role_counts), which is FAMILY_ROLE; held a minute. The master's
    own session is never asked. FAIL-CLOSED: a caller that cannot be built reads as FAMILY_ROLE, and is not held."""
    if s.master:
        return s.role
    hit = _ROLES_HELD.get(s)
    if hit is not None and time.time() < hit[0]:
        return hit[1]
    import lane_gate as LG  # noqa: PLC0415 - it imports the front door, which imports this module
    try:
        family = LG.in_session(s, lambda sess: not sc.role_counts((sess.user or {}).get("types"),
                                                                  (sess.user or {}).get("role")))
    except Exception as exc:  # noqa: BLE001 - a gate that cannot decide stays shut
        log.warning("slice gate: the badges of %s could not be read (%s)", s.uid or "?", type(exc).__name__)
        return FAMILY_ROLE
    role = FAMILY_ROLE if family else s.role
    if len(_ROLES_HELD) >= HELD_MAX:
        _ROLES_HELD.clear()
    _ROLES_HELD[s] = (time.time() + HELD_S, role)
    return role


def forget(uids: frozenset[str] | None) -> None:
    """front_door.SESSIONS_FORGOTTEN: an account write or a sign-out drops what was held for those accounts."""
    if uids is None:
        _HELD.clear()
        _ROLES_HELD.clear()
        return
    for held in (_HELD, _ROLES_HELD):
        for key in list(held):
            if getattr(key, "uid", "") in uids:
                held.pop(key, None)
