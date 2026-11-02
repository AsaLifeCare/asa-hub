"""Client Care's doors that were still Apps Script's, on Python behind their own switch (`client-care`): the views
policy (client_care_people) and the plans' contacts read by the model, with the eMAR import's guard
(client_care_sweeps). Their writes are client_care_writes'."""
from __future__ import annotations

from typing import Any, Callable

import client_care_people as CCP
import client_care_sweeps as CCS
import locations as L

APP_ID = "client-care"

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {**CCP.READ_ACTIONS, **CCS.READ_ACTIONS}
POLICY: dict[str, dict[str, Any]] = {a: p for a, p in {**CCP.POLICY, **CCS.POLICY}.items() if a in ACTIONS}
