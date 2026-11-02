"""Visits & EVV (Main.gs RESOURCES.visits, in the care workbook) read from Postgres through the generic list and get
(sheet_resources, uploaded from visits — a tab the book may not hold yet, so it can start empty): every visit for staff
and above, a client the visits that name them (clientScoped)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "visits"
RESOURCE = "visits"


def visits_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def visits_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"visitsList": visits_list, "visitsGet": visits_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
