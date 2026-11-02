"""Who reads a released app and how far (ViewerScope.gs), the master (Auth.gs) and the editions (Editions.gs)."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import editions
import gsjs

# Auth.gs HUB_MASTER_ACCOUNT: fixed in code, never a cell
MASTER_ACCOUNT = "asatech@asalifecare.com"
# Profile.gs HUB_USER_TYPES and HUB_BADGE_FOLLOWS
# SSA and FAMILY (the operator's FIX BADGES sheet, 10-30): the sheet's two columns, and there is no GUARDIAN badge
USER_TYPES = ("ADMIN", "ADMINISTRATOR", "PLATFORMLEAD", "DIRECTOR", "SUPERVISOR", "TEAMLEAD", "MANAGER", "HM",
              "STAFF", "INTERVIEWER", "ONBOARDING", "ENTITY", "FAMILY", "CLIENT", "SSA")
# a cell written before 10-30 says GUARDIAN for the Family column: read as FAMILY
BADGE_RENAMED = {"GUARDIAN": "FAMILY"}
# TEAMLEAD stands in for nobody (the operator's rule, 2026-10-29): only the rows that name it open for it
BADGE_FOLLOWS = {"SUPERVISOR": "DIRECTOR", "PLATFORMLEAD": "DIRECTOR"}
# RoleBadge.tsx BADGE_ORDER: the order of access the badges give, the highest first; MASTER is the master's own;
# TEAMLEAD directly over HM, the column the operator's matrix gives it being the house manager's
BADGE_ORDER = ("MASTER", "PLATFORMLEAD", "DIRECTOR", "SUPERVISOR", "ADMINISTRATOR", "ADMIN", "ENTITY", "MANAGER",
               "TEAMLEAD", "HM", "INTERVIEWER", "STAFF", "CLIENT", "FAMILY", "SSA", "ONBOARDING")
# the word a person reads for a badge, where it is not the badge itself
BADGE_READS = {"PLATFORMLEAD": "PLATFORM LEAD", "TEAMLEAD": "TEAM LEAD", "HM": "HOUSE MANAGER"}
# ViewerScope.gs; an SSA and a family member are each opened by their own badge
VIEWER_NARROW = ("FAMILY", "CLIENT", "SSA")
# the badges that make an account a family-column one whatever its role says (role_counts): never opened through STAFF
FAMILY_TICKS = ("FAMILY", "SSA")
VIEWER_OPENS = {"client": ("CLIENT",), "guardian": ("FAMILY",), "ssa": ("SSA",)}
VIEWER_KIND_RANK = ("client", "guardian", "ssa")
VIEWER_DAYS_DEFAULT = 30
# Settings › Editions: the catalogue is app/editions.py's, the one list every gate reads
EDITIONS_KEY = editions.EDITIONS_KEY
EDITION_ROLES = editions.EDITION_ROLES
EDITION_MAX_PEOPLE = editions.EDITION_MAX_PEOPLE
EDITIONS = editions.IDS
# AlertsConfig.gs: the app list the master keeps to the master's own session, and who sees it too
MYWORK_APPS_KEY = "mywork_hide_apps"
MYWORK_APPS_SEEN_KEY = "mywork_hide_apps_seen"
# the Mail app, cut by its own switch (editions.MY_WORK_HIDES mail_app) besides being the master's alone
MAIL_APP = "mail"


class Defer(Exception):
    """This read needs what the port does not carry; Apps Script answers it."""


def types_from_raw(raw: Any) -> list[str]:
    """userTypesFromRaw_: the known badges, once each, in the order written."""
    items = raw if isinstance(raw, list) else re.split(r"[,;|\n]+", gsjs.or_blank(raw))
    out: list[str] = []
    for t in items:
        v = gsjs.trim(gsjs.or_text(t)).upper()
        v = BADGE_RENAMED.get(v, v)
        if v and v in USER_TYPES and v not in out:
            out.append(v)
    return out


def badges_worn(types_raw: Any, role_raw: Any) -> list[str]:
    """userBadgesWorn_: the badges, the role read as one, and the badges each one follows."""
    out = types_from_raw(types_raw)
    role = gsjs.trim(gsjs.or_blank(role_raw)).upper()
    role = BADGE_RENAMED.get(role, role)
    if role and role not in out:
        out.append(role)
    follows: list[str] = []
    for b in out:
        stands = BADGE_FOLLOWS.get(b)
        if stands and stands not in out and stands not in follows:
            follows.append(stands)
    return out + follows


def role_counts(types_raw: Any, role_raw: Any) -> bool:
    """The FAMILY/SSA-wearer rule (lib/badgeAccess.ts roleWordCounts): an account whose ticked badges include FAMILY
    or SSA is matched on its badges alone — its role word (staff, or client on a guardian's account) is never counted
    as a badge where App Control's rows are matched; the rows name SSA and FAMILY themselves (the operator's FIX BADGES
    sheet, 10-30)."""
    return not any(t in FAMILY_TICKS for t in types_from_raw(types_raw))


def badges_matched(types_raw: Any, role_raw: Any) -> list[str]:
    """badges_worn as App Control's rows match them: the role read as a badge only where role_counts lets it."""
    return badges_worn(types_raw, role_raw if role_counts(types_raw, role_raw) else "")


def scope_of(kind: str, why: str = "") -> dict[str, Any]:
    return {"kind": kind, "client_keys": [], "house_codes": [], "ssa_keys": [], "family_keys": [], "why": why or ""}


def why_of(what: str, exc: BaseException) -> str:
    return f"{what} could not be read ({str(exc)[:120]})."


def user_from_row(row: dict[str, Any]) -> dict[str, Any]:
    """userPublic_'s fields a gate reads, off one users row (normalised headers)."""
    try:
        denials = json.loads(gsjs.str_(row.get("appdenials")) or "[]")
    except ValueError:
        denials = []
    return {"id": gsjs.str_(row.get("userid")), "email": gsjs.str_(row.get("email")),
            "display_name": gsjs.str_(row.get("displayname")), "role": gsjs.str_(row.get("role")) or "staff",
            "home_tenant": gsjs.str_(row.get("hometenant")), "client_key": gsjs.str_(row.get("clientkey")),
            "types": types_from_raw(row.get("types")), "app_denials": denials if isinstance(denials, list) else [],
            "visiting_member": "", "is_service": False}


def is_master_email(email: Any) -> bool:
    return gsjs.trim(gsjs.or_text(email)).lower() == MASTER_ACCOUNT


def highest_badge(types: Any, is_master: bool = False) -> str:
    """The ONE badge a person's own corners draw (RoleBadge.tsx HighestBadge), by BADGE_ORDER; '' when none."""
    raw = types
    if isinstance(raw, str) and raw.strip().startswith("["):
        try:
            raw = json.loads(raw)
        except ValueError:
            pass
    words = raw if isinstance(raw, (list, tuple)) else re.split(r"[,;|\n]+", str(raw or ""))
    worn = {str(w).strip().upper() for w in words if str(w).strip()}
    if is_master:
        worn.add("MASTER")
    return next((b for b in BADGE_ORDER if b in worn), "")


def badge_reads(badge: str) -> str:
    return BADGE_READS.get(badge, badge)


def platform_lead(u: dict[str, Any] | None) -> bool:
    """An account wearing the Platform Lead badge itself: wherever the platform names its directors, one is among them
    (the operator's rule, 2026-10-28) — the badge stands for a Director in every check through BADGE_FOLLOWS."""
    return bool(u) and "PLATFORMLEAD" in badges_worn((u or {}).get("types"), (u or {}).get("role"))


def settings_lead(user: dict[str, Any] | None) -> bool:
    """The master, or an account whose ticked badges hold PLATFORMLEAD (never the role word): the only ones the
    platform's own Settings sections answer (the operator, 10-30: hidden "de diretores para baixo incluindo os
    diretores", the master and the Platform Lead exactly as they were)."""
    if is_real_master(user):
        return True
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    return "PLATFORMLEAD" in types_from_raw(user.get("types"))


# the doors only those Settings sections call: answered for settings_lead alone (main.policy_gate)
SETTINGS_LEAD_DOORS = frozenset({
    "hiringAlertsGet", "hiringAlertsSet", "contactSweepInstall", "usersPhoneBackfill", "peopleSyncFromPlatform",
    "resolverAudit", "rpcAbilities", "syncFromLegacy", "commsSync", "policiesFetch", "invitesList", "inviteSend",
    "inviteRevoke", "hotlineConfigSet", "scraperConfigSet", "finSettingsSet", "finImportCard", "truelinkSync",
    "istHouseState", "istHouseSet", "helpfulContactsCreate", "helpfulContactsDelete", "platformMemberMine",
    "platformMemberLeave", "myWorldAccessList", "myWorldAccessSet"})


def is_real_master(user: dict[str, Any] | None) -> bool:
    """hubIsRealMaster_: the master in its own session, never a visit or the service."""
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    return gsjs.str_(user.get("role")) == "admin" and is_master_email(user.get("email"))


def wears_from(user: dict[str, Any] | None, badge: str) -> bool:
    """A badge worn (with the ones HUB_BADGE_FOLLOWS stands it for) ranked `badge` or above in BADGE_ORDER; the master
    in its own session always, never a visit or the service."""
    if is_real_master(user):
        return True
    if not user or user.get("is_service") or user.get("visiting_member") or badge not in BADGE_ORDER:
        return False
    above = BADGE_ORDER[:BADGE_ORDER.index(badge) + 1]
    # an SSA's or a FAMILY's role word is never a rank (role_counts)
    return any(b in above for b in badges_matched(user.get("types"), user.get("role")))


def client_key_of(user: dict[str, Any]) -> str:
    """hubClientKeyOf_: a client account's own key, and the client an SSA's or a FAMILY's account is linked to,
    whatever its role says (role_counts)."""
    if not user or user.get("is_service"):
        return ""
    if gsjs.str_(user.get("role")) != "client" and role_counts(user.get("types"), user.get("role")):
        return ""
    return gsjs.str_(user.get("client_key"))


def list_cell(raw: Any) -> list[str]:
    """hubMyWorkListRead_: a list cell's ids, once each."""
    out: list[str] = []
    for x in re.split(r"[,;\s]+", gsjs.or_blank(raw)):
        i = gsjs.trim(x)[:80]
        if i and i not in out:
            out.append(i)
    return out


def my_work_apps_cut_for(user: dict[str, Any], config: dict[str, str]) -> list[str]:
    """hubMyWorkAppsCutFor_: the ids kept to the master's own session, unless this account is on the seen list; and
    the Mail app while its own switch cuts it, whoever the seen list names."""
    if user.get("is_service") is True or is_real_master(user):
        return []
    cut = list_cell(config.get(MYWORK_APPS_KEY))
    uid = gsjs.trim(gsjs.or_text(user.get("id")))
    if cut and not user.get("visiting_member") and uid and uid in list_cell(config.get(MYWORK_APPS_SEEN_KEY)):
        cut = []
    if editions.mail_hidden(config) and MAIL_APP not in cut:
        cut = [*cut, MAIL_APP]
    return cut


def editions_parse(raw: Any) -> dict[str, dict[str, Any]]:
    """hubEditionsParse_ (app/editions.py): the stored list, each known edition once."""
    return editions.parse(raw)


def edition_allows(eid: str, user: dict[str, Any], config: dict[str, str]) -> bool:
    """hubEditionAllows_ (app/editions.py): the master always; else an employee on the edition's list while its key
    is on, read from the config as Reads.config() lays it."""
    return editions.allows(eid, user, config)


def editions_for(user: dict[str, Any], app: str, config: dict[str, str]) -> list[str]:
    return [e for e, a in EDITIONS if a == app and edition_allows(e, user, config)]


class ScopeSources:
    """What the scope reads, handed in so the rules stay apart from the books."""

    def __init__(self, *, users: Callable[[], list[dict]], rules: Callable[[], dict[str, Any]],
                 config: Callable[[], dict[str, str]], houses_of: Callable[[list[str]], dict[str, Any]],
                 ssa_match: Callable[[dict], dict[str, Any]] | None = None,
                 ssas_of: Callable[[list[str]], dict[str, Any]] | None = None,
                 family_of: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
                 guardian_wards: Callable[[dict], dict[str, Any]] | None = None,
                 family_key_of: Callable[[Any], str] | None = None,
                 named: Callable[[dict], dict[str, Any]] | None = None,
                 live_keys: Callable[[list[str]], dict[str, Any]] | None = None) -> None:
        self.users = users
        self.rules = rules
        self.config = config
        self.houses_of = houses_of
        # an SSA or a FAMILY account (hubViewerSsaMatch_, hubViewerSsasOf_); without them it is deferred
        self.ssa_match = ssa_match
        self.ssas_of = ssas_of
        self.family_of = family_of
        # an SSA or a FAMILY account with no client linked: the clients whose records give its e-mail as their guardian's
        self.guardian_wards = guardian_wards
        self.family_key_of = family_key_of
        self.named = named
        # the client keys among some whose record is live (an SSA's or a FAMILY's linked ward)
        self.live_keys = live_keys


def viewer_of(user: dict[str, Any] | None) -> dict[str, Any] | None:
    """hubViewerOf_ at home: the session's own account (a visit is never routed here)."""
    if not user or user.get("is_service"):
        return None
    if user.get("visiting_member"):
        raise Defer("a visit reads the visited account's row")
    denials = user.get("app_denials")
    return {"user": user, "client_key": client_key_of(user), "denials": denials if isinstance(denials, list) else []}


def wards_scope(kind: str, keys: list[str], v: dict[str, Any], src: ScopeSources) -> dict[str, Any]:
    """The clients an SSA or a FAMILY account answers for: their houses and the SSA records that name them."""
    out = scope_of(kind)
    out["client_keys"] = sorted({gsjs.str_(k) for k in keys if k})
    houses = src.houses_of(out["client_keys"])
    out["house_codes"] = houses["codes"]
    ssas = src.ssas_of(out["client_keys"])
    out["ssa_keys"] = ssas["keys"]
    out["why"] = " ".join(list(houses["why"]) + list(ssas["why"]))
    return out


def client_scope(kind: str, v: dict[str, Any], src: ScopeSources) -> dict[str, Any]:
    """hubViewerClientScope_: a CLIENT's own record and the houses it lives in now. The operator's FIX BADGES sheet
    (10-30) for the other two, SSA ("ssa") and FAMILY ("guardian"): its own live ward when one is linked, else the live
    clients whose records name it as guardian (guardian_email) or as SSA (ssa_email, else the SSA name)."""
    if kind != "client" and (src.ssas_of is None or src.ssa_match is None):
        raise Defer("an SSA or a family member is matched on the client records")
    if kind == "client":
        if not v["client_key"]:
            return scope_of("none", "This account is not linked to a client, so it is shown nothing.")
        out = scope_of(kind)
        out["client_keys"] = [v["client_key"]]
        houses = src.houses_of(out["client_keys"])
        out["house_codes"] = houses["codes"]
        out["why"] = " ".join(houses["why"])
        return out
    if v["client_key"]:
        # a client set inactive, or archived, is no longer reached, linked or matched (FAIL-CLOSED)
        got = src.live_keys([v["client_key"]]) if src.live_keys else {"keys": [], "why": ""}
        if not got["keys"]:
            return scope_of("none", got.get("why") or "The client linked to this account is no longer live, so it "
                                                       "is shown nothing.")
        return wards_scope(kind, got["keys"], v, src)
    # its clients are the live ones whose records name it, as guardian (guardian_email) or as SSA (ssa_email, else the
    # SSA name); the badge decides the app (SSA or Families), never which side of the record names it (the operator,
    # 10-30: "Andi Chumley é family", the guardian of Evelyn Chumley)
    wards = src.guardian_wards(v["user"]) if src.guardian_wards else {"keys": [], "why": ""}
    named = src.ssa_match(v["user"])
    keys = sorted(set(wards["keys"]) | set((named.get("scope") or {}).get("client_keys") or []
                                            if named["is"] == "ssa" else []))
    why = wards.get("why") or (named.get("why") if named["is"] == "unknown" else "") or ""
    if not keys:
        return scope_of("none", why or "No live client record names this account as its guardian or its SSA, so it "
                                       "is shown nothing.")
    return wards_scope(kind, keys, v, src)


def scope_merge(parts: list[dict[str, Any]], whys: list[str]) -> dict[str, Any]:
    """hubViewerScopeMerge_: every key of each part, the widest kind, every reason once."""
    kind = ""
    for p in parts:
        rank = VIEWER_KIND_RANK.index(p["kind"]) if p["kind"] in VIEWER_KIND_RANK else -1
        if rank > (VIEWER_KIND_RANK.index(kind) if kind in VIEWER_KIND_RANK else -1):
            kind = p["kind"]
    out = scope_of(kind)
    for f in ("client_keys", "house_codes", "ssa_keys", "family_keys"):
        seen: set[str] = set()
        for p in parts:
            if f == "ssa_keys" and kind == "ssa" and p["kind"] != "ssa":
                continue
            seen.update(k for k in p.get(f) or [] if k)
        out[f] = sorted(seen)
    said: list[str] = []
    for w in [p.get("why") for p in parts] + list(whys):
        if w and w not in said:
            said.append(w)
    out["why"] = " ".join(said)
    return out


def viewer_scope_build(user: dict[str, Any] | None, rule: list[str] | None, src: ScopeSources) -> dict[str, Any]:
    """hubViewerScopeBuild_: master, every house (a wide badge), or narrowed to the viewer's own clients."""
    if not user or user.get("is_service"):
        return scope_of("none", "No person is signed in.")
    if is_real_master(user):
        return scope_of("master")
    v = viewer_of(user)
    if v is None:
        return scope_of("none", "Whose view this is could not be told, so nothing is shown.")
    words = badges_worn(v["user"].get("types"), v["user"].get("role"))
    counted = [w for w in words if w in rule] if rule else words
    shut = "This app is not open to this account's badges." if rule else "This account wears no badge these apps answer."

    def opens(kind: str) -> bool:
        return any(w in counted for w in VIEWER_OPENS[kind])

    if not counted:
        return scope_of("none", shut)
    client = gsjs.str_(v["user"].get("role")).lower() == "client"
    ticked = badges_worn(v["user"].get("types"), "")

    def wide(w: str) -> bool:
        return w not in VIEWER_NARROW

    if not client and any(w in ticked and wide(w) for w in counted):
        return scope_of("all")
    parts: list[dict[str, Any]] = []
    whys: list[str] = []
    unlinked = ""
    if any(w in words for w in FAMILY_TICKS) and (src.ssa_match is None or src.ssas_of is None):
        raise Defer("an SSA or a family member is matched on the client records")
    # the operator's FIX BADGES sheet (10-30): SSA and FAMILY, each opened by its own badge alone (client_scope)
    for badge, kind in (("SSA", "ssa"), ("FAMILY", "guardian")):
        if badge in words and opens(kind):
            own = client_scope(kind, v, src)
            if own["kind"] != "none":
                parts.append(own)
            else:
                whys.append(own["why"])
    # a role word counts for an SSA or a family member only where role_counts lets it (the sheet: neither is DSP)
    if not client and role_counts(v["user"].get("types"), v["user"].get("role")) and any(wide(w) for w in counted):
        return scope_of("all")
    # a CLIENT's own record; the client link of an SSA or a FAMILY account is its ward's, read above
    if "CLIENT" in words and opens("client") and not any(t in words for t in FAMILY_TICKS):
        own = client_scope("client", v, src)
        if own["kind"] != "none":
            parts.append(own)
        else:
            unlinked = own["why"]
    if not parts:
        return scope_of("none", " ".join(whys) or unlinked or shut)
    return scope_merge(parts, whys)


def profile_app_gate(app_id: str, user: dict[str, Any] | None, src: ScopeSources) -> dict[str, Any]:
    """hubProfileAppGate_: App Control's row for the app, then the viewer's scope; FAIL-CLOSED."""
    def closed(why: str) -> dict[str, Any]:
        return {"open": False, "scope": scope_of("none", why)}

    if not app_id:
        return closed("No app was named.")
    if not user or user.get("is_service"):
        return closed("No person is signed in.")
    if is_real_master(user):
        return {"open": True, "scope": scope_of("master")}
    v = viewer_of(user)
    if v is None:
        return closed("Whose view this is could not be told.")
    if app_id in v["denials"]:
        return closed("This app was removed from this account in App Control.")
    # rules the database cannot hand over are Apps Script's to read: the caller defers, never a closed door
    got = src.rules()
    rule = list((got.get("rules") or {}).get(app_id) or [])
    if rule and app_id in my_work_apps_cut_for(user, src.config()):
        rule = []
    if not rule:
        return closed("No badge is written for this app in App Control, so it is the master's alone.")
    tenants = (got.get("tenants") or {}).get(app_id) or []
    home = gsjs.str_(v["user"].get("home_tenant"))
    if home and tenants and home not in tenants:
        return closed("This app is not installed for this account's home tenant.")
    # whether the row names a badge this account counts: an account's own page (My Work, My Profile) opens on it alone
    named = any(w in rule for w in badges_matched(v["user"].get("types"), v["user"].get("role")))
    scope = viewer_scope_build(user, rule, src)
    return {"open": scope["kind"] != "none", "scope": scope, "named": named}


def app_rules(badge_rows: list[dict], tenant_rows: list[dict]) -> dict[str, Any]:
    """hubProfileAppRulesRead_: app id → badges, app id → tenants."""
    rules: dict[str, list[str]] = {}
    tenants: dict[str, list[str]] = {}
    for r in badge_rows:
        i = gsjs.str_(r.get("appid"))
        if i:
            rules[i] = types_from_raw(r.get("badges"))
    for r in tenant_rows:
        i = gsjs.str_(r.get("appid"))
        if i:
            tenants[i] = [gsjs.trim(x) for x in gsjs.str_(r.get("tenants")).split(",") if gsjs.trim(x)]
    return {"rules": rules, "tenants": tenants}


def viewer_days(raw: Any) -> int:
    """hubViewerDays_: the property when it is 1 to 366, else 30."""
    s = gsjs.str_(raw)
    n = int(s) if re.fullmatch(r"\d{1,3}", s) else 0
    return n if 1 <= n <= 366 else VIEWER_DAYS_DEFAULT
