"""App Control's reads on Python behind their switch (`app-control`): the three access matrices every session reads
(Prefs.gs appBadgeAccessGet), the master's own read of the accounts App Control is shared with and a delegate's own
view of its apps' rows (AppControlDelegates.gs appControlDelegatesGet, appControlDelegateGet), off asa-hub-db. Every
App Control write stays Apps Script's: its saves remove rows and are read at once by Apps Script's own gates, and the
relay holds these reads (503) while a change of who reads what settles into the copy."""
from __future__ import annotations

import json
from typing import Any, Callable

import door_gate as DG
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc

APP_ID = "app-control"
APP_BADGE_TAB, APP_TENANT_TAB, CONFIG_BADGE_TAB = "app_badge_access", "app_tenant_access", "config_badge_access"
# AppControlDelegates.gs
DELEGATES_KEY = "mywork_appcontrol_delegates"
DELEGATE_ROLES = ("admin", "manager", "staff")
DELEGATE_MAX = 100
# Prefs.gs appIsMasterOnly_ (SPA: MASTER_ONLY_APPS)
MASTER_ONLY_APPS = ("app-control", "credentials", "mail")
CONFIG_UNREAD = "The platform config could not be read, so the list is not shown. Try again."

s_ = gsjs.str_


def master_only(app_id: Any) -> bool:
    """appIsMasterOnly_: the apps no badge, tenant or override row may touch."""
    return s_(app_id) in MASTER_ONLY_APPS


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def json_parse(text: str) -> Any:
    """JSON.parse: NaN and Infinity are refused."""
    return json.loads(text, parse_constant=_no_constant)


def tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_ of HUB_DB's tab (its house when moved; its own table once kept there); a tab not there yet
    reads as none, as the ensure before it makes it."""
    if HT.tabled(tab):
        return HT.normalized(reads, HT.kept_ref(reads, tab))
    res = reads.db.resolve(tab)
    if res.runtime:
        raise sc.Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return reads.db.normalized_rows(res.ref)


def tenants_of(raw: Any) -> list[str]:
    """str_(tenants).split(',').map(trim).filter(String)."""
    return [t for t in (gsjs.trim(x) for x in s_(raw).split(",")) if t]


def cut(m: dict[str, Any], ids: list[str]) -> dict[str, Any]:
    """hubMyWorkAppsCut_: a copy of an app-keyed map without the cut ids; the map itself when nothing is cut."""
    if not ids:
        return m
    return {k: v for k, v in m.items() if k not in ids}


def badge_access_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """appBadgeAccessGet: the badge matrix, the settings sections' and the tenants', in one read — the apps Settings ›
    My Work keeps to the master's own session cut from the badge and tenant rows."""
    refused = DG.refusal(sess, "appBadgeAccessGet", payload, GS_POLICY)
    if refused:
        return refused
    reads, user = sess.reads, sess.user or {}
    rules: dict[str, list[str]] = {}
    for r in tab_rows(reads, APP_BADGE_TAB):
        i = s_(r.get("appid"))
        if i:
            rules[i] = sc.types_from_raw(r.get("badges"))
    cfg: dict[str, list[str]] = {}
    for r in tab_rows(reads, CONFIG_BADGE_TAB):
        i = s_(r.get("sectionid"))
        if i:
            cfg[i] = sc.types_from_raw(r.get("badges"))
    ten: dict[str, list[str]] = {}
    for r in tab_rows(reads, APP_TENANT_TAB):
        i = s_(r.get("appid"))
        if i:
            ten[i] = tenants_of(r.get("tenants"))
    # an unreadable config is no answer here, never an uncut one
    ids = sc.my_work_apps_cut_for(user, reads.config())
    return {"status": 200, "data": {"rules": cut(rules, ids), "configRules": cfg, "tenantRules": cut(ten, ids)}}


# ---- App Control shared with a person (AppControlDelegates.gs) ---------------------------------------------------

def delegate_apps(items: Any) -> list[str]:
    """hubAcDelegateApps_: each id once, never a control's id, never a master-only app; at most 200."""
    out: list[str] = []
    for a in items if isinstance(items, list) else []:
        i = gsjs.trim(gsjs.or_blank(a))[:80]
        if not i or "." in i or master_only(i) or i in out:
            continue
        out.append(i)
    return out[:200]


def delegates_parse(raw: Any) -> list[dict[str, Any]]:
    """hubAcDelegatesParse_ (FAIL-CLOSED): [{id, apps, may_change}], each account once; a blank or malformed cell
    shares nothing."""
    text = gsjs.trim(gsjs.or_blank(raw))
    if not text:
        return []
    try:
        items = json_parse(text)
    except (ValueError, RecursionError):
        return []
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for d in items[:DELEGATE_MAX]:
        if not isinstance(d, dict):
            continue
        i = gsjs.trim(gsjs.or_blank(d.get("id")))[:80]
        if not i or i in seen:
            continue
        seen.add(i)
        out.append({"id": i, "apps": delegate_apps(d.get("apps")), "may_change": d.get("may_change") is True})
    return out


def delegates_read(reads: L.Reads) -> list[dict[str, Any]]:
    """hubAcDelegatesRead_ (FAIL-CLOSED): a config that cannot be read shares nothing."""
    try:
        cfg = reads.config() or {}
    except Exception:  # noqa: BLE001 - FAIL-CLOSED, as hubAcDelegatesRead_
        return []
    return delegates_parse(cfg.get(DELEGATES_KEY))


def rule_app(rule_id: Any) -> str:
    """hubAcRuleApp_: the row id itself, or what stands before the dot of a control's id."""
    t = gsjs.trim(gsjs.or_blank(rule_id))
    dot = t.find(".")
    return t[:dot] if dot > 0 else t


def delegate_for(reads: L.Reads, user: dict[str, Any] | None) -> dict[str, Any] | None:
    """hubAcDelegateFor_ (FAIL-CLOSED): the delegation this session holds, {apps, may_change}, or None — never the
    master's, the service's or a visit's."""
    try:
        if not user or user.get("is_service") is True or user.get("visiting_member"):
            return None
        if sc.is_real_master(user) or sc.is_master_email(gsjs.or_text(user.get("email"))):
            return None
        if gsjs.trim(gsjs.or_text(user.get("role"))).lower() not in DELEGATE_ROLES:
            return None
        uid = gsjs.trim(gsjs.or_text(user.get("id")))
        if not uid:
            return None
        for d in delegates_read(reads):
            if d["id"] != uid:
                continue
            return {"apps": list(d["apps"]), "may_change": d["may_change"] is True} if d["apps"] else None
        return None
    except Exception:  # noqa: BLE001 - FAIL-CLOSED, as hubAcDelegateFor_
        return None


def delegate_covers(grant: dict[str, Any] | None, rule_id: Any) -> bool:
    """hubAcDelegateCovers_: an app on the delegation's list, or a control inside one."""
    if not grant or not isinstance(grant.get("apps"), list):
        return False
    app = rule_app(rule_id)
    return bool(app) and not master_only(app) and app in grant["apps"]


def delegates_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """appControlDelegatesGet: the master's own read of the list; everybody else the unadvertised 404."""
    refused = DG.refusal(sess, "appControlDelegatesGet", payload, GS_POLICY)
    if refused:
        return refused
    if not sc.is_real_master(sess.user):
        return dict(DG.UNKNOWN)
    try:
        cfg = sess.reads.config() or {}
    except Exception:  # noqa: BLE001 - never answered as "nobody": a list saved over one nobody read would replace it
        return {"status": 503, "message": CONFIG_UNREAD}
    raw = gsjs.trim(gsjs.or_blank(cfg.get(DELEGATES_KEY)))
    malformed = False
    if raw:
        try:
            malformed = not isinstance(json_parse(raw), list)
        except (ValueError, RecursionError):
            malformed = True
    return {"status": 200, "data": {"delegates": delegates_parse(raw), "malformed": malformed}}


def delegate_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """appControlDelegateGet: a delegate's own read — its apps, May change, and each listed app's rows of the badge
    matrix (a control's row inside one of them too); the 404 for anybody App Control is not shared with."""
    refused = DG.refusal(sess, "appControlDelegateGet", payload, GS_POLICY)
    if refused:
        return refused
    # hubAcDelegateAtHome_: away from home the place gate above has already answered
    grant = delegate_for(sess.reads, sess.user)
    if not grant:
        return dict(DG.UNKNOWN)
    every = (sess.reads.app_rules() or {}).get("rules") or {}
    rules = {rid: list(v) if isinstance(v, list) else [] for rid, v in every.items() if delegate_covers(grant, rid)}
    return {"status": 200, "data": {"apps": list(grant["apps"]), "may_change": grant["may_change"], "rules": rules}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "appBadgeAccessGet": badge_access_get, "appControlDelegatesGet": delegates_get,
    "appControlDelegateGet": delegate_get}
# HUB_POLICY as Prefs.gs and AppControlDelegates.gs declare it, asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {"appBadgeAccessGet": {}, "appControlDelegatesGet": {"roles": ("admin",)},
                                        "appControlDelegateGet": {}}
# main.policy_gate asks nothing: each door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
