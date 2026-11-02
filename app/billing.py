"""Billing & Payers (Main.gs RESOURCES.billingClaims, the care workbook's billing_claims) read from Postgres through the
generic list and get (sheet_resources, uploaded from billing_claims): every claim for staff and above, a client the
claims that name them (clientScoped)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import sheet_resources as SR

APP_ID = "billing"
RESOURCE = "billingClaims"


def claims_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def claims_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"billingClaimsList": claims_list,
                                                                    "billingClaimsGet": claims_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
