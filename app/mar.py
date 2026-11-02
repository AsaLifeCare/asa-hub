"""MAR — Med Administration (Main.gs RESOURCES.marEntries, a clinical tab) read from Postgres: the medication passes
in app.resource_rows (`marEntries`, uploaded from mar_entries — the eMAR history copied once, then every pass recorded
here) through the generic list and get (sheet_resources): employees read every row, a client only the rows that name
them, a trainee none. Clients › Medication reads its passes from here once the rows are uploaded."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "mar"
RESOURCE = "marEntries"


def mar_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def mar_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"marEntriesList": mar_list,
                                                                    "marEntriesGet": mar_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
