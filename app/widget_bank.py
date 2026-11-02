"""Widgets (the widget bank) read from Postgres (app/resource_rows.py): the `widgets` resource (uploaded from ASA Data
— Widgets, its Data tab), the
indicator specs everyone reads and only admins and managers curate, through the generic list and get
(sheet_resources) — and the widgets slice, filled by the list for the relay's own identity."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "widgets"


def widgets_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "widgets", payload)


def widgets_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "widgets", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"widgetsList": widgets_list,
                                                                    "widgetsGet": widgets_get}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
