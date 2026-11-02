"""Equipment & Assets (Main.gs RESOURCES.equipment, in the apps workbook) read from Postgres through the generic list and
get (sheet_resources, uploaded from equipment — a tab the book may not hold yet, so it can start empty): route()'s own
gates, a client narrowed to the rows that name them."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "equipment"
RESOURCE = "equipment"


def equipment_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def equipment_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"equipmentList": equipment_list,
                                                                    "equipmentGet": equipment_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
