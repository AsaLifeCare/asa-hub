"""doPost's gates before a door these modules answer (Main.gs), in its order: the place first — an account homed away
from headquarters stands in its place (Tenant.gs tenantContext_), where an action not declared safe there is the
unknown action — then the action's declaration (Resolver.gs hubPolicyGate_: its roles, its typed parameters). The
relay hands Python no envelope naming a tenant, a world or a member, so the place is the account's own."""
from __future__ import annotations

from typing import Any

import gsjs
import locations as L
import scope as sc

UNKNOWN = {"status": 404, "message": "Unknown action."}
# hubDenied_ (HubCore.gs)
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# of the doors these modules answer, the ones Tenant.gs HUB_TENANT_SAFE_ACTIONS declares safe away from home
TENANT_SAFE = frozenset({"appBadgeAccessGet", "potClientsViewsPolicy"})

s_ = gsjs.str_


def tenant_rows(reads: L.Reads) -> list[dict]:
    """tenantsRows_ (FAIL-CLOSED): the tenants tab, normalised; a directory that cannot be read lists none."""
    def read() -> list[dict]:
        try:
            import house_tables as HT  # noqa: PLC0415 - writes imports this module, and house_tables imports writes

            return reads.db.normalized_rows(HT.where(reads, "tenants").ref)
        except Exception:  # noqa: BLE001 - FAIL-CLOSED, as tenantsRows_: no row answers for headquarters
            return []
    return reads.once("door_gate:tenants", read)


def home_from(rows: list[dict]) -> str:
    """tenantHomeFrom_: the active row typed hq, else the first row's id, else none."""
    for r in rows:
        if s_(r.get("type")) == "hq" and s_(r.get("status")) != "archived":
            return s_(r.get("tenantid"))
    return s_(rows[0].get("tenantid")) if rows else ""


def away(reads: L.Reads, user: dict[str, Any] | None) -> bool:
    """hubAwayTenant_ once tenantContext_ resolved an envelope naming no tenant: an account homed in a place other
    than headquarters stands there; the master and the service stand nowhere."""
    if not user or user.get("is_service"):
        return False
    mine = s_(user.get("home_tenant"))
    if not mine or sc.is_master_email(user.get("email")):
        return False
    home = home_from(tenant_rows(reads))
    return not (home and mine == home)


def _type_of(v: Any) -> str:
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "object"


def refusal(sess: L.Session, action: str, payload: dict, policy: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """The answer doPost gives before the door, or None: away from home an action not declared safe there is the
    unknown action; then hubPolicyGate_ — the declared roles (none: any session), the required and typed
    parameters."""
    user = sess.user or {}
    if action not in TENANT_SAFE and away(sess.reads, user):
        return dict(UNKNOWN)
    pol = policy.get(action) or {}
    roles = tuple(pol.get("roles") or ())
    if roles and not user.get("is_service") and gsjs.js_str(user.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}
    for key, rule in (pol.get("params") or {}).items():
        val = payload.get(key) if isinstance(payload, dict) else None
        missing = val is None or (isinstance(val, str) and val == "")
        if rule.get("required") and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and rule.get("type") and _type_of(val) != rule["type"]:
            return {"status": 400, "message": f"{key} must be {rule['type']}, got {_type_of(val)}."}
    return None
