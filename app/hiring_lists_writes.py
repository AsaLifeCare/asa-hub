"""The generic writes on the hiring resources Main.gs route()'s live adapters answer (app/hiring_lists.py): none of them
is written from a list — each refused in its adapter's words after its gate, nothing kept."""
from __future__ import annotations

from typing import Any, Callable

import hiring_lists as HL
import locations as L
import screening as SG
import writes as W
from writes import Decision


def _candidates(sess: L.Session, payload: dict) -> Decision:
    """talentRoute_ create/update/delete: the board is moved by its own doors, never by the resource."""
    refused = HL.candidates_gate(sess)
    if refused:
        return Decision(refused)
    return Decision({"status": 405, "message": SG.strings(sess.reads, "refuse.talent.read_only")})


def _onboarding(message: str) -> Callable[[L.Session, dict], Decision]:
    def door(sess: L.Session, payload: dict) -> Decision:
        """onboardingRoute_ create/update/delete: the stage is derived from the paperwork, never moved."""
        refused = HL.onboarding_gate(sess)
        if refused:
            return Decision(refused)
        return Decision({"status": 405, "message": message})
    return door


def _pool(sess: L.Session, payload: dict) -> Decision:
    """talentPoolRoute_: the roster mirrors the legacy workbook."""
    refused = HL.pool_gate(sess)
    if refused:
        return Decision(refused)
    return Decision({"status": 405, "message": HL.POOL_READ_ONLY})


def _recruitment(sess: L.Session, payload: dict) -> Decision:
    """recruitmentRoute_: the envelopes are Dropbox Sign's, mirrored by the sync."""
    refused = HL.recruitment_gate(sess)
    if refused:
        return Decision(refused)
    return Decision({"status": 405, "message": SG.strings(sess.reads, "refuse.recruit.read_only")})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    **{"candidates" + v: _candidates for v in ("Create", "Update", "Delete")},
    "onboardingCreate": _onboarding(HL.ONB_CREATE), "onboardingUpdate": _onboarding(HL.ONB_MOVE),
    "onboardingDelete": _onboarding(HL.ONB_MOVE),
    **{"talentPool" + v: _pool for v in ("Create", "Update", "Delete")},
    **{"recruitment" + v: _recruitment for v in ("Create", "Update", "Delete")}}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
