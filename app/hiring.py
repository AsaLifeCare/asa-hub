"""Hiring: the hiring Apps Script books ported to Python, one app id behind one switch. Each area keeps its own module
(the outreach letters, the talent pipeline, the scraper, the recruitment sync, the simulator, the flow and the matrix,
Hired, the packet, the interview flow, the screens, the résumés, CJIS, behavior, the PSI punches); this module gathers
their reads."""
from __future__ import annotations

from typing import Any, Callable

import behavior
import hiring_board
import cjis
import employee_db
import hiring_engine
import hiring_flow
import hiring_hired
import hiring_intake
import hiring_lists
import hiring_outreach
import hiring_packet
import hiring_public
import hiring_papers
import hiring_riders
import hiring_sim
import interview_flow
import locations as L
import mail_log
import psi_punches
import resume_intake
import screening
import talent
import talent_pipeline
import talent_recruitment
import talent_riders
import talent_scraper

APP_ID = "hiring"
AREAS = (hiring_outreach, talent_pipeline, talent, talent_scraper, talent_recruitment, hiring_sim, hiring_flow,
         hiring_hired, hiring_packet, interview_flow, screening, resume_intake, cjis, behavior, psi_punches,
         talent_riders, hiring_riders, hiring_intake, mail_log, hiring_engine, hiring_papers, hiring_lists,
         hiring_board, hiring_public, employee_db)

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
for _area in AREAS:
    _twice = set(ACTIONS) & set(_area.ACTIONS)
    if _twice:
        raise RuntimeError(f"hiring: {_area.__name__} names doors another area has: {sorted(_twice)}")
    ACTIONS.update(_area.ACTIONS)
    POLICY.update(_area.POLICY)
