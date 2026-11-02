"""Expenses (Main.gs RESOURCES.expenseReports, in the apps workbook) read from Postgres through the generic list and get
(sheet_resources, uploaded from expenseReports — a tab the book may not hold yet, so it can start empty): employees
read every report, a client none."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "expenses"
RESOURCE = "expenseReports"


def reports_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def reports_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"expenseReportsList": reports_list,
                                                                    "expenseReportsGet": reports_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
