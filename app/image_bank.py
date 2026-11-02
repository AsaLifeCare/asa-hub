"""Image Bank read from Postgres (app/resource_rows.py): the `photos` resource (uploaded from ASA Data — Photos, its
Data tab), the platform's picture
library, through the generic list and get (sheet_resources) — a client reads only the pictures that name them — and
the photos slice, filled by the list for the relay's own identity. Not the people's own photos (app/photos.py)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "imagebank"


def bank_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "photos", payload)


def bank_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "photos", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"imageBankList": bank_list,
                                                                    "imageBankGet": bank_get}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
