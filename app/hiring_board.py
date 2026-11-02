"""The Hiring pipeline board's decisions and moves (HubCore.gs setDecision and moveStage, Onboarding.gs onboardingExtend
and onboardingManualComplete) on Python: what each press is refused for before a record is read, the day an
extension runs to, where the onboarding calendar hears a move, and what a manual onboarding attests. The board's own
reads are talent_pipeline's; the records these doors keep are hiring_board_writes'."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import locations as L
import onboarding as OB
from gsjs import NY

s_ = CND.s_
WRITERS = ("admin", "manager")
DAY_MS = 86400000.0

# HubCore.gs hubSetDecision_ / hubSetDecisionHeld_
VALUES = ("Advance", "Decline")
SCORECARD_SIGNS = ("The interview recommendation is signed on the interviewer's scorecard — open the Scorecard to "
                   "record it. Nothing was written.")
DECLINED = {"advance-decision": "Declined after the phone screen", "resume-decision": "Resume declined"}
# Onboarding.gs OB_WINDOW_AFTER_DEFAULT / OB_COL_ACCESS_UNTIL
WINDOW_AFTER_DAYS = 7
ACCESS_UNTIL = "onboarding_access_until"
MANUAL_ONLY = "Manual onboarding applies to candidates AT the Onboarding stage."
# onboardingManualComplete: the packet's flags a manual onboarding fills where blank
PACKET_FLAGS = ("PacketAcknowledged", "BackgroundCheck", "DocumentsComplete", "CompleteTraining",
                "QuestionnaireComplete", "TutorialsComplete")

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}


def decision_refusal(checkpoint: str, value: str) -> dict[str, Any] | None:
    """hubSetDecision_'s own refusals: Advance or Decline, on a checkpoint this writer answers."""
    if value not in VALUES:
        return {"status": 400, "message": "decision must be Advance or Decline"}
    if checkpoint == "interview-recommendation":
        return {"status": 400, "message": SCORECARD_SIGNS}
    if checkpoint not in CW.DECISIONS:
        return {"status": 400, "message": f'unknown checkpoint "{checkpoint}"'}
    return None


def screen_closed(cand: dict) -> dict[str, Any] | None:
    """hubSetDecisionHeld_: the phone screen is decided at the phone screen — anywhere else, where the card is."""
    at = CW.stage_of(cand.get("status"))
    if at == "phone-screen":
        return None
    who = s_(cand.get("candidatename")) or s_(cand.get("candidateid"))
    later = at in CW.STAGE_ORDER and CW.STAGE_ORDER.index(at) > CW.STAGE_ORDER.index("phone-screen")
    here = CW.STAGE_TO_STATUS.get(at) or s_(cand.get("status")) or "another stage"
    return {"status": 409, "already_at": at or None,
            "message": f"{who} is {'already' if later else 'still'} at {here} — "
                       f"{'the phone screen was decided' if later else 'the phone screen is not open yet'}. "
                       "Reload to see it. Nothing was written."}


def extend_until(reads: L.Reads, p: dict) -> tuple[str, dict[str, Any] | None]:
    """onboardingExtend's day: the date asked, else that many days from now (1–90, else seven), at 23:59:59.999 on the
    script's clock."""
    raw = s_(p.get("until"))
    if raw:
        ms = CND.js_date_ms(raw)
        if ms is None:
            return "", {"status": 400, "message": "until must be a date."}
    else:
        days = CND.js_parse_int(p.get("days"))
        if math.isnan(days) or days < 1 or days > 90:
            days = WINDOW_AFTER_DAYS
        ms = CND.now_ms(reads) + days * DAY_MS
    try:
        local = datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)
    except (OverflowError, OSError, ValueError):
        return "", {"status": 400, "message": "until must be a date."}
    return gsjs.iso(local.replace(hour=23, minute=59, second=59, microsecond=999000)), None


def calendar_entering(was: Any, word: Any) -> bool | None:
    """hubOnboardingCalendarNote_: True as the card enters Onboarding, False as it leaves it forward, None otherwise."""
    st_from, st_to = CND.stage_of(was), CND.stage_of(word)
    if st_to == "onboarding" and st_from != "onboarding":
        return True
    if st_from == "onboarding" and st_to and st_to != "onboarding":
        return False
    return None


def packet_cells(found: dict, cid: str, by: str, now: str) -> dict[str, str]:
    """onboardingManualComplete on the packet row a half-used portal left: the blanks filled, nothing overwritten, the
    graduation id stamped so the row stays findable."""
    cells = {col: "TRUE" for col in PACKET_FLAGS if not CND.packet_truthy(OB.field(found, col))}
    if not OB.field(found, "CompletedAt"):
        cells["CompletedAt"] = now
    if not OB.field(found, "GradCandidateId"):
        cells["GradCandidateId"] = cid
    cells["updated_by"] = "asa-hub:manual-onboarding:" + by
    cells["updated_at"] = now
    return cells


def manual_fields(by: str, now: str, portal: bool, notes: str) -> dict[str, str]:
    """onboardingManualComplete's marks on the card: the method a column (the sweep branches on it), the line who
    attested it and when."""
    return {"manual_onboarding": "true", "manual_onboarding_method": "portal" if portal else "attested",
            "manual_onboarding_by": "asa-hub:" + by + " at " + now
            + (" — confirmed a portal visit that was already complete" if portal
               else " — attested (walked through by e-mail)") + (" — " + notes if notes else "")}
