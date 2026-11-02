"""My asa.'s week (Main.gs RESOURCES.weekItems) read from Postgres (app/resource_rows.py, uploaded from the week_items
sheet): each person's own items alone (ownedBy ownerId), through the generic list and get (sheet_resources)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "myasa"
RESOURCE = "weekItems"


def week_items_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def week_items_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"weekItemsList": week_items_list,
                                                                    "weekItemsGet": week_items_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
