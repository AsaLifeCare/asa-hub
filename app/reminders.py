"""Reminders (the company's shared list, Main.gs RESOURCES.reminders) read from Postgres (app/resource_rows.py, uploaded
from the reminders sheet): everyone who can open the app sees the same list through the generic list and get
(sheet_resources); a client or a trainee is refused at the data."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "reminders"


def reminders_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "reminders", payload)


def reminders_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "reminders", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"remindersList": reminders_list,
                                                                    "remindersGet": reminders_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
