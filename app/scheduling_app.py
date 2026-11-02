"""Scheduling as one switchable app: the board's three reads and the Builder's; its writes are scheduling_writes'."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import scheduling as SCH
import scheduling_builder as SB

APP_ID = SCH.APP_ID
ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {**SCH.ACTIONS, **SB.ACTIONS}
POLICY: dict[str, dict[str, Any]] = {**SCH.POLICY, **{a: SB.POLICY[a] for a in SB.ACTIONS}}
