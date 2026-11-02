"""Med Deliveries (Main.gs RESOURCES.medDeliveries, a clinical tab) read from Postgres through the generic list and get
(sheet_resources, uploaded from med_deliveries — a tab the book does not hold yet, so it starts empty): employees read
every row, a client only the rows that name them, a trainee none."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "med-deliveries"
RESOURCE = "medDeliveries"


def deliveries_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def deliveries_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"medDeliveriesList": deliveries_list,
                                                                    "medDeliveriesGet": deliveries_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
