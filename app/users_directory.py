"""The users directory (apps-script/HubCore.gs usersList) read off asa-hub-db: every account the copy's users tab
holds, but a row the manual merge folded and the master's own, as userPublic_ answers it, for an admin or a house
manager. A request away from headquarters never reaches here — the relay hands a tenant's envelope to Apps Script — so
tenantUserVisible_ keeps every row."""
from __future__ import annotations

from typing import Any, Callable

import account_profile as AP
import gsjs
import locations as L
import scope as sc

APP_ID = "users-directory"
# hubDenied_ (HubCore.gs)
DENIED = {"status": 403, "message": "Requires an admin or manager account"}


def s_(v: Any) -> str:
    return gsjs.str_(v)


def users_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """usersList: the house manager badge is the special release for a manager; every other manager is refused."""
    user = sess.user or {}
    is_hm = bool(user) and s_(user.get("role")) == "manager" and "HM" in sc.types_from_raw(user.get("types"))
    if not user or (s_(user.get("role")) != "admin" and not is_hm):
        return dict(DENIED)
    reads = sess.reads
    out: list[dict[str, Any]] = []
    for u in reads.users():
        # a row folded by the manual merge left the lists; the master account is never a row in one
        if s_(u.get("mergedinto")) or sc.is_master_email(u.get("email")):
            continue
        pub = AP.public(reads, u)
        # the session's own answer (authMe), never a directory fact
        pub.pop("my_world", None)
        pub["active"] = s_(u.get("active")).lower() != "false"
        pub["created_at"] = s_(u.get("createdat"))
        pub["last_login"] = s_(u.get("lastlogin"))
        out.append(pub)
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"usersList": users_list}
POLICY: dict[str, dict[str, Any]] = {"usersList": {"roles": ("admin", "manager")}}
