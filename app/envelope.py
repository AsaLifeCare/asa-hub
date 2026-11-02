"""Where a session stands, settled once before any door as Main.gs doPost settles it: the place the envelope names
(Tenant.gs tenantContext_), then the person a visit names (Members.gs memberContext_), then, for the generic verbs
alone, a world (World.gs worldContext_); then the default deny away from headquarters. The relay hands the envelope's
tenant, member, world and resource in its signed x-hub-user as `place`; nothing a payload says of them is read, and
the master is the relay's word alone (main.py's session).

During a visit the identity IS the visited person: their id, e-mail and name, the role and badges clamped to the
caller's (memberClampRole_, memberClampTypes_), so every door answers "mine" for them and a write lands in their
environment (hubOwnedGate_). The account signed in is kept whole under `caller` (HUB_CALLER) and answers the doors
HUB_CALLER_OWN_ACTIONS names. Every refusal is the 404 that admits nothing; what cannot be read is a 503.

The settled user carries `place`: the envelope's own words (tenant, member, world, resource) and what they settled
to — tenant_id (hubTenantId_, '' at headquarters), member_id (hubMemberId_), visiting (the visited e-mail the
system log names, log_actor) and world_id (HUB_WORLD_CTX's worldId). A module whose doors are right wherever the session stands — each reads the settled place, or needs
none — names them in PLACE_SAFE; any other door that depends on the place answers 503 away from headquarters."""
from __future__ import annotations

from typing import Any

import gsjs
import hubdb
import locations as L
import scope as sc
from scope import Defer

AXES = ("tenant", "member", "world", "resource")
GENERIC = frozenset({"list", "get", "create", "update", "delete"})
NOT_FOUND = {"status": 404, "message": "Not found."}
UNKNOWN = {"status": 404, "message": "Unknown action."}
TENANTS_TAB = "tenants"
MEMBERS_TAB = "platform_members"
# AlertsConfig.gs MYWORK_WORLD_KEY, MYWORK_WORLD_SEEN_KEY
WORLD_KEY = "mywork_hide_world"
WORLD_SEEN_KEY = "mywork_hide_world_seen"
# Members.gs HUB_ROLE_RANK
ROLE_RANK = {"admin": 4, "manager": 3, "staff": 2, "onboarding": 1, "client": 1}
# Main.gs HUB_CALLER_OWN_ACTIONS: facts about who is signed in, answered for the caller during a visit
CALLER_OWN = frozenset({"platformMembersList", "platformMemberAsk", "platformMemberAuthorize", "platformMemberRemove",
                        "platformMemberCheck", "platformMemberSweep", "tenantsList", "worldGet", "worldEnsure",
                        "myWorldAccessList", "myWorldAccessSet", "profileUpdate", "platformMemberMine",
                        "platformMemberLeave"})
# Tenant.gs HUB_TENANT_SAFE_ACTIONS: the named actions that run away from headquarters
TENANT_SAFE = frozenset({
    "authLogin", "authLogout", "authMe", "authStatus", "placeProfileGet", "profileUpdate", "userProfileDeep",
    "prefsGet", "prefsSet", "appBadgeAccessGet", "appAccessSetBulk", "appShelfGet", "appShelfSet", "userMenuLinksList",
    "clientViewsPolicy", "hiringViewsPolicy", "potClientsViewsPolicy", "appsBuilt", "tenantsList", "tenantEnsure",
    "worldGet", "worldEnsure", "worldAppsList", "worldAppUpsert", "worldAppDelete", "platformMembersList",
    "platformMemberRemove", "myWorldAccessList", "myWorldAccessSet", "platformMemberMine", "platformMemberLeave",
    "hubBoot", "platformMemberCheck", "platformMemberAsk", "platformMemberAuthorize", "platformMemberSweep",
    "invitesList", "inviteSend", "inviteRevoke", "playgroundGenerate", "appBuilderUpsert", "appUpsert", "appDelete",
    "usersList", "chatOverview", "chatMessages", "chatSend", "chatPing", "chatMarkRead", "chatReact", "logsList",
    "companyCalendar", "userCreate", "userUpdate", "selfTest"})
# the doors whose answer does not depend on the place stood in: Tenant.gs HUB_PLACE_EXEMPT, and tenantsList (Studio.gs),
# which narrows by the caller's reach (tenantReachIds_), never by the place
PLACE_FREE = frozenset({
    "placeProfileGet", "profileUpdate", "hubBoot", "platformMemberMine", "platformMemberLeave", "prefsGet", "prefsSet",
    "appShelfGet", "appShelfSet", "appAccessSetBulk", "playgroundGenerate", "platformMemberRemove",
    "platformMemberAuthorize", "platformMemberSweep", "myWorldAccessList", "myWorldAccessSet", "appBadgeAccessGet",
    "userMenuLinksList", "clientViewsPolicy", "hiringViewsPolicy", "potClientsViewsPolicy", "chatMessages", "chatPing",
    "chatMarkRead", "chatReact", "selfTest", "tenantsList"})

s_ = gsjs.str_


class Refused(Exception):
    """doPost's own answer before any door."""

    def __init__(self, answer: dict[str, Any]) -> None:
        super().__init__(str(answer.get("message") or ""))
        self.answer = dict(answer)


# ---- the envelope's words and what they settled to ---------------------------------------------------------------

def axes(said: dict[str, Any]) -> dict[str, str]:
    """The relay's word on where the envelope stands (x-hub-user's `place`)."""
    place = said.get("place") if isinstance(said.get("place"), dict) else {}
    return {k: gsjs.trim(gsjs.or_blank(place.get(k)))[:120] for k in AXES}


def place_of(user: dict[str, Any] | None) -> str:
    """hubTenantId_: the place the session stands in, '' at headquarters."""
    place = (user or {}).get("place")
    return s_(place.get("tenant_id")) if isinstance(place, dict) else ""


def caller_of(user: dict[str, Any] | None) -> dict[str, Any]:
    """HUB_CALLER, else the session's own: the account signed in."""
    u = user or {}
    return u["caller"] if isinstance(u.get("caller"), dict) else u


def log_actor(user: dict[str, Any] | None) -> str:
    """hubSysLog_'s actor: the session's e-mail; during a visit the account at the keyboard, "<caller e-mail>
    (visiting <the visited e-mail, else their id>)", whichever door answered."""
    u = user or {}
    place = u.get("place") if isinstance(u.get("place"), dict) else {}
    keyboard = s_(caller_of(u).get("email"))
    if s_(place.get("member_id")) and keyboard:
        return keyboard + " (visiting " + s_(place.get("visiting")) + ")"
    return s_(u.get("email"))


# ---- the places (Tenant.gs) --------------------------------------------------------------------------------------

def ids_for(home: Any, extra: Any) -> list[str]:
    """tenantIdsForUser_: the home place, then each listed place once."""
    out: list[str] = []
    h = s_(home)
    if h:
        out.append(h)
    for t in s_(extra).split(",") if s_(extra) else ():
        t = gsjs.trim(t)
        if t and t not in out:
            out.append(t)
    return out


def tenants_rows(reads: L.Reads) -> list[dict]:
    """tenantsRows_: the platform's tenants, in their own table (house_tables.where); a tab not made lists no place, a
    book the copy does not hold is unreadable (said, never read as no place)."""
    import house_tables as HT  # noqa: PLC0415 - writes imports this module, and house_tables imports writes

    def read() -> list[dict]:
        res = HT.where(reads, TENANTS_TAB)
        if res.ref is None:
            if res.book_known and not res.runtime:
                return []
            raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind the tenants tab")
        return reads.db.normalized_rows(res.ref)
    return reads.once("envelope:tenants", read)


def home_from(rows: list[dict]) -> str:
    """tenantHomeFrom_: the row typed hq and not archived, else the first row's."""
    for r in rows:
        if s_(r.get("type")) == "hq" and s_(r.get("status")) != "archived":
            return s_(r.get("tenantid"))
    return s_(rows[0].get("tenantid")) if rows else ""


def tenant_resolve(rows: list[dict], raw: Any, who: dict[str, Any] | None) -> dict[str, Any] | None:
    """tenantResolve_: None at headquarters, {tenantId} where `who` may stand, {error} where it may not; the master
    stands in every active place."""
    if not who:
        return None
    home = home_from(rows)
    master = who.get("is_master") is True
    allowed = [i for i in (s_(t.get("tenantid")) for t in rows if s_(t.get("status")) != "archived") if i] \
        if master else ids_for(who.get("hometenant"), who.get("tenants"))
    wanted = s_(raw)
    if not wanted:
        wanted = "" if master else s_(who.get("hometenant"))
    if not wanted or (home and wanted == home):
        if master or not allowed:
            return None
        return None if home in allowed else {"error": dict(NOT_FOUND)}
    if wanted not in allowed:
        return {"error": dict(NOT_FOUND)}
    return {"tenantId": wanted}


def tenant_context(reads: L.Reads, raw: Any, user: dict[str, Any]) -> dict[str, Any] | None:
    """tenantContext_: the place off the session's own account (never a visit's, never the service's)."""
    if not user or user.get("is_service"):
        return None
    wanted, mine = s_(raw), s_(user.get("home_tenant"))
    if not wanted and not mine:
        return None
    return tenant_resolve(tenants_rows(reads), wanted, {"is_master": sc.is_real_master(user), "hometenant": mine,
                                                        "tenants": ",".join(user.get("tenants") or [])})


# ---- the visit (Members.gs) --------------------------------------------------------------------------------------

def members_rows(reads: L.Reads) -> list[dict]:
    """membersRows_: the member rows where hubTabSheet_ opens them; a tab not made brings nobody in, a book the copy
    does not hold is unreadable."""
    def read() -> list[dict]:
        res = reads.db.resolve(MEMBERS_TAB)
        if res.ref is None:
            if res.book_known and not res.runtime:
                return []
            raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind the platform members tab")
        return reads.db.normalized_rows(res.ref)
    return reads.once("envelope:members", read)


def member_resolve(rows: list[dict], users: list[dict], raw: Any, user: dict[str, Any] | None) -> dict | None:
    """memberResolve_: the account an active row of the caller's own brings in; never the master's account. Every
    refusal is 404, never 403: a 403 admits the row exists."""
    wanted = s_(raw)
    if not wanted or not user or user.get("is_service"):
        return None
    for m in rows:
        if s_(m.get("memberid")) != wanted:
            continue
        if s_(m.get("status")) != "active" or s_(m.get("owneruserid")) != s_(user.get("id")):
            break
        row = next((u for u in users if s_(u.get("userid")) == s_(m.get("memberuserid"))), None)
        if row is None or sc.is_master_email(row.get("email")):
            break
        scope = "work" if s_(m.get("scope")).lower() == "work" else "work_world"
        return {"memberId": wanted, "userId": s_(row.get("userid")), "email": s_(row.get("email")),
                "name": s_(row.get("displayname")), "role": s_(row.get("role")) or "staff",
                "types": s_(row.get("types")), "scope": scope}
    return {"error": dict(NOT_FOUND)}


def member_context(reads: L.Reads, raw: Any, user: dict[str, Any]) -> dict[str, Any] | None:
    """memberContext_."""
    if not s_(raw) or not user or user.get("is_service"):
        return None
    return member_resolve(members_rows(reads), reads.users(), raw, user)


def _rank(role: Any) -> int:
    return ROLE_RANK.get(s_(role).lower(), 0)


def visited(caller: dict[str, Any], m: dict[str, Any]) -> dict[str, Any]:
    """doPost's visit: the session becomes the visited person, at the weaker of the two roles (memberClampRole_) and
    with the badges both hold (memberClampTypes_); the caller's places travel."""
    role = s_(m["role"]) if _rank(m["role"]) <= _rank(caller.get("role")) else s_(caller.get("role"))
    mine = sc.types_from_raw(caller.get("types"))
    return {"id": m["userId"], "email": m["email"], "display_name": m["name"], "role": role,
            "types": [t for t in sc.types_from_raw(m["types"]) if t in mine],
            "home_tenant": caller.get("home_tenant"), "tenants": list(caller.get("tenants") or []), "client_key": "",
            "app_denials": [], "is_service": False, "visiting_member": m["memberId"], "acting_for": m["userId"]}


# ---- the world (World.gs, AlertsConfig.gs) -----------------------------------------------------------------------

def worlds_rows(reads: L.Reads) -> list[dict]:
    """worldRows_: My World's registry in Postgres (app/world_store.py)."""
    import world_store as WS  # noqa: PLC0415 - the store reaches back into the doors' modules
    return WS.registry_rows(reads)


def world_withheld(reads: L.Reads, caller: dict[str, Any] | None) -> bool:
    """worldWithheld_ (hubMyWorldHiddenFor_), asked of the account signed in: never the service or the master in its
    own session, nobody while the switch is off, never an account on its seen list; FAIL-OPEN."""
    try:
        u = caller or {}
        if not u or u.get("is_service") is True or sc.is_real_master(u):
            return False
        if not u.get("visiting_member") and gsjs.or_text(u.get("role")) == "admin" \
                and sc.is_master_email(u.get("email")):
            return False
        cfg = reads.config()
        if gsjs.trim(gsjs.or_blank(cfg.get(WORLD_KEY))).lower() not in ("on", "true", "1", "yes"):
            return False
        if u.get("visiting_member"):
            return True
        uid = gsjs.trim(gsjs.or_text(u.get("id")))
        return not (uid and uid in sc.list_cell(cfg.get(WORLD_SEEN_KEY)))
    except Exception:  # noqa: BLE001 - the .gs's own catch: unreadable keeps nothing from anybody
        return False


def world_resolve(rows: list[dict], wid: str, user: dict[str, Any] | None,
                  visit: dict[str, Any] | None) -> dict[str, Any]:
    """worldResolve_: the world for its owner — `user` is the identity the session is, so during a visit the visited
    person — or for a member Members.gs resolved whose door is open (work_world). Every refusal is 404, never 403: a
    403 would admit the world exists."""
    deny = {"error": {"status": 404, "message": 'No world "' + wid + '".'}}
    if not user or user.get("is_service"):
        return deny
    for r in rows:
        if s_(r.get("world_id")) != wid:
            continue
        owner = s_(r.get("owner_user_id"))
        may_visit = visit is not None and visit.get("scope") == "work_world" and owner == s_(visit.get("userId"))
        if not may_visit and owner != s_(user.get("id")):
            return deny
        return {"worldId": wid}
    return deny


def world_context(reads: L.Reads, raw: Any, user: dict[str, Any], visit: dict[str, Any] | None,
                  caller: dict[str, Any]) -> dict[str, Any] | None:
    """worldContext_: None when no world is named; else the world or its 404."""
    wid = s_(raw)
    if not wid:
        return None
    if not user or user.get("is_service") or world_withheld(reads, caller):
        return world_resolve([], wid, user, visit)
    return world_resolve(worlds_rows(reads), wid, user, visit)


# ---- doPost --------------------------------------------------------------------------------------------------------

def settle(user: dict[str, Any], said: dict[str, Any], reads: L.Reads, action: str, module: Any = None) -> dict:
    """doPost between the session and the door, in its order: the tenant, the member, the world (generic verbs alone),
    then the default deny away from headquarters, then whom the door answers for. `said["asked"]` is the action the
    envelope named where the relay asks another door for it (a generic verb, a write's preparation). Away from
    headquarters a door its module does not name PLACE_SAFE, whose answer depends on the place, is not answered (503):
    the account's home place is all it reads; a world's rows are answered by the doors a module names WORLD_SAFE
    alone."""
    if not user or user.get("is_service") or user.get("public"):
        return user
    ax = axes(said)
    asked = s_(said.get("asked")) or action
    generic = asked in GENERIC
    place_safe = action in getattr(module, "PLACE_SAFE", ())
    row = next((u for u in reads.users() if s_(u.get("userid")) == s_(user.get("id"))
                and not s_(u.get("mergedinto"))), None)
    me = {**user, "tenants": ids_for(row.get("hometenant"), row.get("tenants")) if row else []}
    t = tenant_context(reads, ax["tenant"], me)
    if t and t.get("error"):
        raise Refused(t["error"])
    place = {**ax, "tenant_id": s_((t or {}).get("tenantId")), "member_id": "", "visiting": "", "world_id": ""}
    who, visit = me, None
    if ax["member"]:
        m = member_context(reads, ax["member"], me)
        if m and m.get("error"):
            raise Refused(m["error"])
        if m:
            visit, who = m, visited(me, m)
            place.update(member_id=m["memberId"], visiting=m["email"] or m["userId"])
    if ax["world"] and generic:
        if action not in getattr(module, "WORLD_SAFE", ()):
            raise Defer("a world's rows are answered by My World's doors alone")
        w = world_context(reads, ax["world"], who, visit, me) or {}
        if w.get("error"):
            raise Refused(w["error"])
        place.update(world_id=s_(w.get("worldId")), tenant_id="")
    here = place["tenant_id"]
    if here and not generic and asked not in TENANT_SAFE:
        raise Refused(UNKNOWN)
    homed_away = bool(s_((tenant_context(reads, "", me) or {}).get("tenantId")))
    if (here or homed_away) and asked not in PLACE_FREE and not place_safe:
        raise Defer("this door does not read the place the session stands in")
    if visit is None:
        return {**me, "place": place}
    if asked in CALLER_OWN:
        return {**me, "place": place}
    return {**who, "place": place, "caller": {**me, "place": place}}
