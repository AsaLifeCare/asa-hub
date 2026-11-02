"""Shift Board (Calendar Builder's Week page, Main.gs RESOURCES.events): the schedule's own events read from Postgres
through the generic list and get (sheet_resources, resource scheduleEvents). The Hub's events tab is the engine's trail,
whose rows carry no date, so no event the Week page shows ever lived there: the resource starts empty. The roster's
real hours are laid beside these rows by the relay (shift_slices.build_schedule_events)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "shiftboard"
RESOURCE = "scheduleEvents"


def events_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def events_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"scheduleEventsList": events_list,
                                                                    "scheduleEventsGet": events_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
