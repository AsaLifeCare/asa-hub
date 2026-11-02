"""The master's own session switch (apps-script/BeAnother.gs) off asa-hub-db and app.auth_sessions: who may start one
(beAnotherMayStart_), the accounts offered (beAnotherAccounts_), a child session's fail-closed resolution
(beAnotherResolveRow_) and the auth answers' block (beAnotherAuthBlock_). The doors are app/auth_doors.py's. Nothing
here writes a line anywhere."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import account_profile as AP
import auth_store as AS
import gsjs
import locations as L
import scope as sc

TTL = timedelta(hours=2)
UNKNOWN = {"status": 404, "message": "Unknown action."}
PICK = {"status": 400, "message": "Pick the account to act as."}
NO_ACCOUNT = {"status": 404, "message": "No account with that id."}
MERGED = {"status": 409, "message": "That account was merged into another one — pick the keeper instead."}
BLOCKED = {"status": 409, "message": "That account is blocked — it sees nothing to act as."}
OWN = {"status": 409, "message": "That is your own account — there is nobody else to be."}
BUSY = {"status": 503, "message": "Another sign-in change is being written — press again in a moment."}

s_ = gsjs.str_


def user_row(users: list[dict], uid: Any) -> dict | None:
    """beAnotherUserRow_: the first row with this user_id."""
    return next((u for u in users if s_(u.get("userid")) == s_(uid)), None)


def live(row: dict | None) -> bool:
    """beAnotherLive_."""
    return bool(row) and s_(row.get("active")).lower() != "false" and not s_(row.get("mergedinto"))


def may_start(user: dict | None, acting: dict | None, visiting: bool) -> bool:
    """beAnotherMayStart_: the hardcoded master, as themselves, visiting nobody."""
    if not user or user.get("is_service") or acting or visiting:
        return False
    return sc.is_master_email(s_(user.get("email")))


def resolve(cur: Any, users: list[dict], s: dict[str, Any], th: str, now: datetime) -> tuple[dict, dict] | None:
    """beAnotherResolveRow_ (FAIL-CLOSED): (the target's users row, the acting context), or None — the parent a live
    session of the real account and never a child itself, the real account live and the master, the target live and
    not the master, and now before min(expiry, created_at + 2 h)."""
    try:
        created = s.get("created_at")
        if not isinstance(created, datetime) or s.get("revoked_at") is not None:
            return None
        until = min(s["expires_at"], created + TTL)
        if not until > now:
            return None
        real_id, parent_th, target_id = s_(s.get("real_user_id")), s_(s.get("parent_token_hash")), s_(s.get("user_id"))
        if not real_id or not parent_th or not target_id or parent_th == th or target_id == real_id:
            return None
        parent = AS.session_of(cur, parent_th)
        if parent is None or parent["real_user_id"] or parent["parent_token_hash"] or parent["user_id"] != real_id:
            return None
        if not AS.session_live(parent, now):
            return None
        real, target = user_row(users, real_id), user_row(users, target_id)
        if not live(real) or not sc.is_master_email(s_(real.get("email"))):
            return None
        if not live(target) or sc.is_master_email(s_(target.get("email"))):
            return None
        ctx = {"real": {"id": real_id, "email": s_(real.get("email")), "display_name": s_(real.get("displayname"))},
               "target": {"id": target_id, "email": s_(target.get("email")),
                          "display_name": s_(target.get("displayname")), "role": s_(target.get("role")) or "staff"},
               "until": gsjs.iso(until), "until_at": until, "th": th, "parent_th": parent_th}
        return target, ctx
    except Exception:  # noqa: BLE001 - FAIL-CLOSED: anything unreadable is nobody
        return None


def auth_block(me: dict | None, acting: dict | None, now: datetime) -> dict | None:
    """beAnotherAuthBlock_: acting → both identities; the plain master → acting null; anybody else → None (the key is
    left out)."""
    if not me or me.get("is_service"):
        return None
    if acting:
        if s_(acting["target"]["id"]) != s_(me.get("id")):
            return None
        return {"real": {"id": s_(acting["real"]["id"]), "email": s_(acting["real"]["email"]),
                         "display_name": s_(acting["real"]["display_name"])},
                "acting": {"id": s_(me.get("id")), "display_name": s_(me.get("display_name")),
                           "email": s_(me.get("email")), "role": s_(me.get("role")), "types": me.get("types") or [],
                           "until": acting["until"],
                           "expires_in_ms": max(0, int((acting["until_at"] - now).total_seconds() * 1000))}}
    if sc.is_master_email(s_(me.get("email"))):
        return {"real": {"id": s_(me.get("id")), "email": s_(me.get("email")),
                         "display_name": s_(me.get("display_name"))}, "acting": None}
    return None


def accounts(users: list[dict]) -> list[dict[str, Any]]:
    """beAnotherAccounts_: every account worth acting as — merged rows and the master left out, blocked ones marked."""
    out = []
    for u in users:
        uid, email = s_(u.get("userid")), s_(u.get("email"))
        if not uid or s_(u.get("mergedinto")) or sc.is_master_email(email):
            continue
        out.append({"id": uid, "display_name": s_(u.get("displayname")), "email": email,
                    "role": s_(u.get("role")) or "staff", "types": sc.types_from_raw(u.get("types")),
                    "title": s_(u.get("title")), "avatar": s_(u.get("avatar")),
                    "active": s_(u.get("active")).lower() != "false", "home_tenant": s_(u.get("hometenant")),
                    "system_hidden": s_(u.get("systemhidden")).lower() == "true"})
    out.sort(key=lambda a: (a["display_name"] or a["email"]).lower())
    return out


def worn(reads: L.Reads, target: dict) -> dict[str, Any]:
    """userPublic_ of the account worn: the platform mailbox stays with the real sign-in."""
    pub = AP.public(reads, target)
    pub["mail_reader"] = False
    return pub
