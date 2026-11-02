"""Client Care's writes that were still Apps Script's, on Python behind their own switch (`client-care`): an incident's
review status, an appointment's pencil and an incident reported from a profile (client_care_records), the guardians
added to the roster and the directory's quick edit (client_care_people), the plans' contacts kept (client_care_sweeps).
Each door's own gate decides; the rows go where the platform keeps them — Postgres for a kept resource, app.edits for
a book other apps still read."""
from __future__ import annotations

from typing import Any, Callable

import client_care_people as CCP
import client_care_records as CCR
import client_care_sweeps as CCS
import client_secrets as CSE
import locations as L
from writes import Decision

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {**CCR.WRITE_ACTIONS, **CCP.WRITE_ACTIONS,
                                                             **CCS.WRITE_ACTIONS, **CSE.WRITE_ACTIONS}
POLICY: dict[str, dict[str, Any]] = {a: p for a, p in {**CCR.POLICY, **CCP.POLICY, **CCS.POLICY, **CSE.POLICY}.items()
                                     if a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {**CCR.BUSY_OF, **CCP.BUSY_OF, **CCS.BUSY_OF, **CSE.BUSY_OF}
Store = CCS.Store
