"""Potential Clients (Main.gs RESOURCES.potentialClients) read from Postgres (app/resource_rows.py, uploaded from the
potentialClients sheet): the referrals pipeline, read through the generic list and get (sheet_resources) by the master,
the service and whoever App Control's Client Candidates row opens the whole app to (the operator's access sheet,
2026-10-29: the referrals are Client Candidates' data, app/client_candidates.py viewer); anyone else is refused. The
referrals themselves are found and scored outside the Hub and land on the sheet; the relay brings the new ones in on
its clock (potentialClientsUpload: rows not here yet added, rows nothing here has touched brought up to date, a row the
Hub changed never touched)."""
from __future__ import annotations

from typing import Any, Callable

import client_candidates as CC
import locations as L
import scope as sc
import sheet_resources as SR

APP_ID = "potential-clients"
RESOURCE = "potentialClients"
SHUT = {"status": 403, "message": "App Control does not open Client Candidates to this account."}


def refused(sess: L.Session) -> dict[str, Any] | None:
    """The master first, the service; else Client Candidates' own gate (FAIL-CLOSED: a view it cannot settle is shut)."""
    user = sess.user or {}
    if sc.is_real_master(user) or user.get("is_service") is True:
        return None
    try:
        return None if CC.viewer(sess) is not None else SHUT
    except sc.Defer:
        return SHUT


def leads_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return refused(sess) or SR.list_rows(sess, RESOURCE, payload)


def leads_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return refused(sess) or SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"potentialClientsList": leads_list,
                                                                    "potentialClientsGet": leads_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
