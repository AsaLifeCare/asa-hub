"""The changes a world's tab takes, as World.gs, WorldDefaults.gs and SheetDb.gs made them with SpreadsheetApp, written
in the `rows` grammar (app/book_ops.py ROWS_SPEC) that app/world_store.py lays and keeps: a tab made with its header
(insertSheet), its header widened (ensureHeader_), rows seeded into a tab just made, rows deleted where a column holds
a value (worldDeleteRows_, deleteRowById_) or where a default's leftover matches (worldDefaultCleanup_), the first row
of an id changed (updateRowById_), rows appended (setValues under the last row, createRow_) — every value kept exactly
as setValues kept it."""
from __future__ import annotations

from typing import Any

import gsjs
from client_rename import js_json


def value(v: Any) -> Any:
    """serialize_: what setValues is handed for a value — null blank, an object its JSON, anything else as it is."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return js_json(v)
    return v


def make(header: list[str], widen: bool, seed: list[dict] | None = None) -> dict[str, Any]:
    """insertSheet with its header (and the rows seeded on birth) when the tab is missing; ensureHeader_ when
    `widen`."""
    spec: dict[str, Any] = {"header": list(header)}
    if widen:
        spec["grow"] = list(header)
    if seed:
        spec["seed"] = seed
    return spec


def drop(column: str, value_: str, first: bool = False) -> dict[str, Any]:
    """worldDeleteRows_: every row whose column (its header folded) holds the value, trimmed; deleteRowById_ (`first`):
    the first such row alone."""
    return {"drop": {"column": column, "value": value_, **({"first": True} if first else {})}}


def swap(header: list[str], app_id: str, rows: list[dict]) -> dict[str, Any]:
    """worldAppsSheet_, then worldDeleteRows_ on the app id, then its rows appended: an app's rows replaced whole. An
    app's rows share their app id and world_apps has no id column, so a retry is kept from adding them twice by the
    delete before the append, not by `unique`."""
    return {"header": list(header), "grow": list(header), "drop": {"column": "app_id", "value": app_id},
            "append": rows}


def marks(header: list[str], rows: list[dict]) -> dict[str, Any]:
    """worldDefaultsMarker_ and its marks: an app id marked once."""
    return {"header": list(header), "append": rows, "unique": header[0]}


def record(header: list[str] | None, keys: list[str], cells: dict[str, Any]) -> dict[str, Any]:
    """worldMintTab_ (a tab made from the record's keys when the world has none), then createRow_: the header widened
    by the record's keys, the row appended unless its id is there already."""
    spec: dict[str, Any] = {"grow": list(keys), "append": [cells], "unique": "id"}
    if header is not None:
        spec["header"] = list(header)
    return spec


def update(keys: list[str], rid: str, cells: dict[str, Any]) -> dict[str, Any]:
    """updateRowById_: the header widened by the merged record's keys, the first row of the id given the cells."""
    return {"grow": list(keys), "update": {"key": gsjs.trim(rid), "cells": cells}}


# worldDefaultCleanup_'s rules: rows an older seed left, matched exactly; the owner's empty drafts stay
JUNK: dict[str, list[dict[str, str]]] = {
    "petsList": [{"column": "name", "equals": ""}, {"column": "notes", "prefix": "Read:"}],
    "plateMeals": [{"column": "description", "prefix": "Read the guide:"}],
    "doctorVisits": [{"column": "doctor", "equals": ""}, {"column": "notes", "prefix": "Looking for:"}],
    "vitalReadings": [{"column": "value", "equals": ""}]}


def purge(tab: str) -> dict[str, Any]:
    """worldDefaultCleanup_ on one tab."""
    return {"purge": [dict(c) for c in JUNK[tab]]}
