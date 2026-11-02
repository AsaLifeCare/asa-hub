"""The signed-in account's own profile (apps-script/Profile.gs) off asa-hub-db: its profile for a place away from home
(placeProfileGet, the user_place_profiles tab) and the account as a save answers it (Auth.gs userPublic_). profileUpdate
is in app/account_profile_writes.py."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import platform_mail as PM
import scope as sc
import staff as SP
from scope import Defer

APP_ID = "account-profile"
# Profile.gs USER_PLACE_PROFILES_TAB and its header (hubTabEnsure_)
PLACE_TAB = "user_place_profiles"
PLACE_HEADERS = ("user_id", "place", "display_name", "title", "avatar", "updated_at")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def place_tab(reads: L.Reads) -> hubdb.Resolved:
    """placeProfilesSheet_ off the copy; a book the copy does not hold is not Apps Script's failure."""
    res = reads.db.resolve(PLACE_TAB)
    if res.runtime:
        raise Defer(f"{PLACE_TAB} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {PLACE_TAB}")
    return res


def place_profile(reads: L.Reads, uid: Any, place: str) -> dict[str, str] | None:
    """placeProfileGet_: the first row of this account at this place; None when it has none."""
    for r in reads.db.normalized_rows(place_tab(reads).ref):
        if s_(r.get("userid")) == s_(uid) and s_(r.get("place")) == s_(place):
            return {"display_name": s_(r.get("displayname")), "title": s_(r.get("title")),
                    "avatar": s_(r.get("avatar"))}
    return None


def parse_emails(raw: Any) -> list:
    """profileParseEmails_."""
    if isinstance(raw, list):
        return raw
    s = s_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
        return got if isinstance(got, list) else []
    except ValueError:
        return [x for x in re.split(r"\s*[;,]\s*", s) if x]


def _parsed(raw: str, empty: str, kind: type) -> Any:
    """JSON.parse(cell || empty), kept only when it is of the kind the field holds."""
    try:
        got = json.loads(raw or empty)
    except ValueError:
        return kind()
    return got if isinstance(got, kind) else kind()


def tenant_ids(u: dict) -> list[str]:
    """tenantIdsForUser_."""
    out: list[str] = []
    home = s_(u.get("hometenant"))
    if home:
        out.append(home)
    extra = s_(u.get("tenants"))
    if extra:
        for t in extra.split(","):
            t = gsjs.trim(t)
            if t and t not in out:
                out.append(t)
    return out


def haystack(types_raw: Any, role_raw: Any) -> str:
    """hubBadgeHaystack_: the badges and the role word as one upper-case text, with what a worn badge stands for."""
    have = gsjs.or_text(types_raw).upper()
    role = gsjs.trim(gsjs.or_text(role_raw).upper())
    if role:
        have = have + "," + role if have else role
    for worn, stands in sc.BADGE_FOLLOWS.items():
        if worn in have:
            have = have + "," + stands
    return have


def _named(cfg: str, have: str) -> bool:
    return any(b and b in have for b in (gsjs.trim(x).upper() for x in cfg.split(",")))


def shell_feature_on(reads: L.Reads, key: str, types_raw: Any, email: Any, role_raw: Any) -> bool:
    """hubShellFeatureOn_: the master always; an empty badge list is on for everyone."""
    if email and sc.is_master_email(email):
        return True
    cfg = s_(reads.config().get(key))
    if not gsjs.trim(cfg):
        return True
    return _named(cfg, haystack(types_raw, role_raw))


def granted_feature_on(reads: L.Reads, key: str, types_raw: Any, email: Any, role_raw: Any) -> bool:
    """hubGrantedFeatureOn_: the master always; else a badge the list names, none when it names none."""
    if sc.is_master_email(email):
        return True
    cfg = s_(reads.config().get(key))
    if not gsjs.trim(cfg):
        return False
    return _named(cfg, haystack(types_raw, role_raw))


def candidate_id(reads: L.Reads, u: dict) -> str:
    """The users row's candidate, else candidateIdByEmail_: the first candidate filed under the account's address."""
    own = s_(u.get("candidateid"))
    if own:
        return own
    needle = s_(u.get("email")).lower()
    if not needle:
        return ""

    def index() -> dict[str, str]:
        idx: dict[str, str] = {}
        rows, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
        for r in [] if why else rows or []:
            e = s_(r.get("email")).lower()
            if e and e not in idx:
                idx[e] = s_(r.get("candidateid"))
        return idx
    return reads.once("ap:candidate_by_email", index).get(needle, "")


def public(reads: L.Reads, u: dict) -> dict[str, Any]:
    """userPublic_: the account as every screen reads it, off its users row."""
    overrides: Any
    try:
        overrides = json.loads(s_(u.get("permoverrides")) or "{}")
    except ValueError:
        overrides = {}
    if gsjs.falsy(overrides):
        overrides = {}
    email = s_(u.get("email"))
    return {"id": s_(u.get("userid")), "email": email, "display_name": s_(u.get("displayname")),
            "role": s_(u.get("role")) or "staff", "home_tenant": s_(u.get("hometenant")), "tenants": tenant_ids(u),
            # memberWorldRole_ of an account that is no service
            "world_role": "owner",
            "is_master": sc.is_master_email(email), "title": s_(u.get("title")), "phone": s_(u.get("phone")),
            "phones": SP._parse_phones(u.get("phones")), "emails": parse_emails(u.get("emails")),
            "armed": bool(s_(u.get("passhash"))), "avatar": s_(u.get("avatar")), "overrides": overrides,
            "candidate_id": candidate_id(reads, u), "client_key": s_(u.get("clientkey")),
            "people_id": s_(u.get("peopleid")), "roster_status": s_(u.get("rosterstatus")),
            "employee_id": s_(u.get("employeeid")), "start_date": s_(u.get("startdate")),
            "end_date": s_(u.get("enddate")),
            "contact_sources": _parsed(s_(u.get("contactsources")), "{}", dict),
            "contact_synced_at": s_(u.get("contactsyncedat")), "system_type": s_(u.get("systemtype")),
            "system_hidden": s_(u.get("systemhidden")).lower() == "true",
            "types": sc.types_from_raw(u.get("types")),
            "must_change_password": s_(u.get("mustchange")).lower() == "true",
            "app_denials": _parsed(s_(u.get("appdenials")), "[]", list),
            "mail_reader": PM.can_read(reads, {"email": email, "types": s_(u.get("types")), "is_service": False}),
            "copilot_star": shell_feature_on(reads, "copilot_badges", u.get("types"), u.get("email"), u.get("role")),
            "apps_grid": shell_feature_on(reads, "appgrid_badges", u.get("types"), u.get("email"), u.get("role")),
            "smartcomms_widget": shell_feature_on(reads, "smartcomms_widget_badges", u.get("types"), u.get("email"),
                                                  u.get("role")),
            "my_world": True,
            "franchise_view": granted_feature_on(reads, "franchise_view_badges", u.get("types"), email,
                                                 u.get("role"))}


def place_profile_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """placeProfileGet: the signed-in account's own profile for one place; no row answers {profile: null}."""
    user = sess.user
    if not user or user.get("is_service"):
        return dict(DENIED)
    place = s_((payload or {}).get("place"))[:80]
    if not place:
        return {"status": 400, "message": "place required"}
    return {"status": 200, "data": {"profile": place_profile(sess.reads, user.get("id"), place)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"placeProfileGet": place_profile_get}
POLICY: dict[str, dict[str, Any]] = {"placeProfileGet": {}}
