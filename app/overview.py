"""Overview (the workspace home) read from Postgres (app/resource_rows.py): its page's one data source, the `activity`
resource (uploaded from ASA Data — Activity, its Data tab), through the generic list and get (sheet_resources); a client reads it whole, as the resource
is declared open to them."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "overview"


def activity_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "activity", payload)


def activity_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "activity", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"activityList": activity_list,
                                                                    "activityGet": activity_get}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
