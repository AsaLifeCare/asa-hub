"""Hiring's writes, gathered from each area's write module under one app id, one store and one receipt book
(app.hiring_writes / app.hiring_receipts); the clocks' marks (app.hiring_marks, app.talent_marks) made beside them.
hiringUpload brings the resources the areas keep in app.resource_rows into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import behavior as B
import behavior_writes
import cjis_writes
import employee_db_writes
import hiring_board_writes
import hiring_engine_writes
import hiring_flow_writes
import hiring_hired_writes
import hiring_intake_writes
import hiring_lists_writes
import hiring_outreach_writes
import hiring_packet_writes
import hiring_public_writes
import hiring_papers_writes
import hiring_riders_writes
import hiring_sim_writes
import interview_flow_writes
import locations as L
import mail_log_writes
import psi_punches as PP
import psi_punches_writes
import resource_rows as RR
import resume_intake_writes
import screening_writes
import talent_pipeline_writes
import talent_recruitment_writes
import talent_riders_writes
import talent_scraper_writes
import talent_writes
from writes import Decision

AREAS = (hiring_outreach_writes, talent_pipeline_writes, talent_writes, talent_scraper_writes,
         talent_recruitment_writes, hiring_sim_writes, hiring_flow_writes, hiring_hired_writes, hiring_packet_writes,
         interview_flow_writes, screening_writes, resume_intake_writes, cjis_writes, behavior_writes,
         psi_punches_writes, talent_riders_writes, hiring_riders_writes, hiring_intake_writes, mail_log_writes,
         hiring_engine_writes, hiring_papers_writes, hiring_lists_writes, hiring_board_writes, hiring_public_writes,
         employee_db_writes)
# each area's own upload door folded into the app's one
UPLOADS = {"talentUpload": talent_pipeline_writes.UPLOAD_SPECS,
           "behaviorUpload": {B.SIGNALS: {"tab": B.SIGNALS_TAB}, B.READINGS: {"tab": B.READINGS_TAB}},
           "psiPunchesUpload": {PP.RESOURCE: {"tab": PP.TAB}}}

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {}
POLICY: dict[str, dict[str, Any]] = {}
BUSY_OF: dict[str, dict[str, Any]] = {}
for _area in AREAS:
    _twice = set(ACTIONS) & set(_area.ACTIONS)
    if _twice:
        raise RuntimeError(f"hiring: {_area.__name__} names doors another area has: {sorted(_twice)}")
    ACTIONS.update(_area.ACTIONS)
    POLICY.update(_area.POLICY)
    BUSY_OF.update(getattr(_area, "BUSY_OF", {}))
for _door in UPLOADS:
    ACTIONS.pop(_door, None)
    POLICY.pop(_door, None)
    BUSY_OF.pop(_door, None)
ACTIONS["hiringUpload"] = RR.upload_door({r: s for specs in UPLOADS.values() for r, s in specs.items()})
POLICY["hiringUpload"] = {}
BUSY_OF["hiringUpload"] = {"status": 409, "message": "Hiring is being moved right now — try again in a moment."}


class Store(hiring_hired_writes.Store):
    """app.hiring_writes and app.hiring_receipts, the hiring marks, and the recruitment clock's marks."""

    def ensure(self) -> str:
        why = super().ensure()
        if why or getattr(self, "_talent", False):
            return why
        with self._lock:
            try:
                c = self.conn()
                for stmt in talent_recruitment_writes.ddl() + hiring_engine_writes.ddl():
                    c.execute(stmt)
                self._talent = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the doors defer meanwhile
                self._drop()
                self._ready = False
                self.why = f"the recruitment clock's marks are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why
