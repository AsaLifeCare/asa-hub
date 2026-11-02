"""Bundle.gs configLane on Python behind its switch (`config-lane`): the configuration the relay reads once per cycle
for every screen and for its own gates — the place, the three views policies, the sidebar shelf, the company menu, the
sheet-built apps, the resolved test mode, the Smart Comms gates and notice switches, and the parts of Settings › My
Work, Alerts I receive and App Control access the relay obeys — off asa-hub-db, for the relay's own identity alone.
A part that cannot be read is left out, as the lane's part() leaves it; a config that cannot be read is no answer."""
from __future__ import annotations

import logging
from typing import Any, Callable

import alert_receive as AR
import app_builder as AB
import app_control as AC
import client_care_people as CCP
import door_gate as DG
import gsjs
import hiring_flow as HF
import house_tables as HT
import hubdb
import locations as L
import prefs
import scope as sc
import smart_comms_desk as SCD
import support_raise as SR

log = logging.getLogger("asa-hub-app")

APP_ID = "config-lane"
s_ = gsjs.str_

# Prefs.gs: the workspace shelf and the company menu
SECTIONS_TAB, PLACEMENT_TAB, MENU_TAB = "app_sections", "app_placement", "user_menu_links"
# NoticeSituations.gs HUB_NOTICE_KINDS (the relay's web_notices.CATALOGUE), each one situation web_notice_<kind>
NOTICE_PREFIX = "web_notice_"
NOTICE_KINDS = ("call_off", "open_shift", "application", "training_needed", "window_closed", "decided", "not_chosen",
                "withdrawn", "training_decided", "filled", "swap_offered", "swap_answered", "swap_done", "swap_ended",
                "no_call_no_show", "late_call", "time_off_asked", "time_off_decided", "time_off_scheduled",
                "time_off_ended")
# AlertsConfig.gs MYWORK_HIDE_KEYS, with each key's default as AlertsCatalog.gs ships it
HIDE_KEYS = {p: "mywork_hide_" + p for p in ("header", "source_notes", "missing_row", "completed", "inbox_sources",
                                              "ssa_updated", "ssa_county", "ssa_count", "ssa_role", "sched_hours",
                                              "record_notes", "client_activity", "client_group_titles",
                                              "staff_doc_counts", "family_details")}
HIDE_SHIPPED = {k: ("yes" if p in ("ssa_updated", "ssa_county", "ssa_count", "ssa_role", "sched_hours", "record_notes",
                                    "client_activity", "client_group_titles", "staff_doc_counts", "family_details")
                    else "no") for p, k in HIDE_KEYS.items()}
# MYWORK_HIDE_FAIL_CLOSED: only a plain no shows what these hide
HIDE_FAIL_CLOSED = frozenset({"sched_hours"})
CATALOG_TAB = "hiring_alerts_catalog"
MYWORK_WORLD_KEY, MYWORK_WORLD_SEEN_KEY = "mywork_hide_world", "mywork_hide_world_seen"


def _why(exc: BaseException) -> str:
    return str(exc) or type(exc).__name__


def or_number(v: Any, fallback: Any) -> Any:
    """Number(v) || fallback, as JSON.stringify writes it."""
    return prefs.or_number(v, fallback)


# ---- the shelf, the menu and the sheet-built apps --------------------------------------------------------------------

def shelf(reads: L.Reads, user: dict[str, Any]) -> dict[str, Any]:
    """appShelfGet: the sections in order, each app's section (the last row wins), each section's apps in order."""
    sections = []
    for i, r in enumerate(AC.tab_rows(reads, SECTIONS_TAB)):
        sid = s_(r.get("sectionid"))
        if not sid:
            continue
        sections.append({"id": sid, "label": s_(r.get("label")) or sid, "tint": s_(r.get("tint")) or "blue",
                         "icon": s_(r.get("icon")), "position": or_number(r.get("position"), i + 1)})
    sections.sort(key=lambda x: x["position"])
    cut = sc.my_work_apps_cut_for(user, reads.config())
    placement: dict[str, str] = {}
    ranked: dict[str, list[dict[str, Any]]] = {}
    for p, r in enumerate(AC.tab_rows(reads, PLACEMENT_TAB)):
        app_id, sec_id = s_(r.get("appid")), s_(r.get("sectionid"))
        if not app_id or not sec_id or app_id in cut:
            continue
        placement[app_id] = sec_id
        ranked.setdefault(sec_id, []).append({"id": app_id, "at": or_number(r.get("position"), p + 1)})
    order = {k: [x["id"] for x in sorted(v, key=lambda x: x["at"])] for k, v in ranked.items()}
    return {"sections": sections, "placement": placement, "order": order}


def menu_links(reads: L.Reads) -> dict[str, Any]:
    """userMenuLinksList: every link with an id, by its sort (99 when none)."""
    out = []
    for r in AC.tab_rows(reads, MENU_TAB):
        lid = s_(r.get("id"))
        if not lid:
            continue
        out.append({"id": lid, "label": s_(r.get("label")), "icon": s_(r.get("icon")) or "link",
                    "href": s_(r.get("href")), "external": s_(r.get("external")).lower() == "true",
                    "badges": sc.types_from_raw(r.get("badges")), "sort": or_number(r.get("sort"), 99),
                    "updated_at": s_(r.get("updatedat")), "updated_by": s_(r.get("updatedby"))})
    out.sort(key=lambda x: x["sort"])
    return {"links": out}


# ---- the switches ----------------------------------------------------------------------------------------------------

def test_mode(cfg: dict[str, str]) -> dict[str, Any]:
    """The lane's test_mode over hubTestModeState_: a word the switch does not know is unreadable and on."""
    st = SCD.test_mode_state(cfg)
    word = gsjs.trim(gsjs.or_text(cfg.get("test_mode"))).lower()
    if st["unrecognized"]:
        return {"unreadable": 'test_mode reads "' + st["unrecognized"][:40] + '", a word the switch does not know '
                              "(on or off) — held as on until it is saved as one of them",
                "on": True, "word": word, "explicit": True}
    return {"on": bool(st["on"]), "word": word or ("on" if st["on"] else "off"), "explicit": bool(st["explicit"])}


def situation_switches(reads: L.Reads, ids: list[str]) -> dict[str, bool]:
    """Each situation's switch (smartOn_ of its last row), off when it has no row."""
    rows = {gsjs.or_blank(r.get("id")): r for r in SCD.situations(reads)}
    return {i: bool(i in rows and SCD.smart_on(rows[i].get("enabled"))) for i in ids}


def unread_situations(exc: BaseException) -> str:
    return ("the situations tab could not be read (" + _why(exc)[:160] + ")")[:200]


def hide_defaults(reads: L.Reads) -> dict[str, str]:
    """hubMyWorkHideDefaults_ for the eleven switches: the catalogue's default, a blank one the shipped one; the
    shipped copy when the catalogue's house is not there."""
    out = dict(HIDE_SHIPPED)
    db = reads.db
    if HT.tabled(CATALOG_TAB):
        headers, rows = HT.raw(reads, CATALOG_TAB)
    else:
        if not db.house_moved(CATALOG_TAB):
            return out
        res = db.resolve(CATALOG_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the configuration catalogue's book")
            return out
        headers, rows = list(res.ref.headers), db.rows(res.ref)
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
    if "key" not in head:
        return out
    at_key = headers[head.index("key")]
    at_value = headers[head.index("default_value")] if "default_value" in head else None
    for _rn, raw in rows:
        k = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(at_key), "hub")))
        if k not in out:
            continue
        v = gsjs.or_blank(hubdb.typed(raw.get(at_value), "hub")) if at_value is not None else ""
        out[k] = v if gsjs.trim(v) else HIDE_SHIPPED[k]
    return out


def hide_read(reads: L.Reads, cfg: dict[str, str]) -> dict[str, bool]:
    """hubMyWorkHideRead_: anything not plainly yes hides nothing; a fail-closed part hides unless plainly no."""
    shipped: dict[str, str] | None = None
    out: dict[str, bool] = {}
    for part, key in HIDE_KEYS.items():
        if key in cfg:
            raw = cfg[key]
        else:
            shipped = shipped if shipped is not None else hide_defaults(reads)
            raw = shipped[key]
        v = gsjs.trim(gsjs.or_blank(raw)).lower()
        out[part] = v not in ("no", "off", "false", "0") if part in HIDE_FAIL_CLOSED else v in ("yes", "on", "true",
                                                                                               "1")
    return out


def alert_receive_off(reads: L.Reads) -> dict[str, list[str]]:
    """arLane_: by account id, the alerts each holder turned off, in catalogue order; nobody without one."""
    out: dict[str, list[str]] = {}
    for uid, off in SR.receive_off(reads).items():
        parts = [p for p in AR.PARTS if (off or {}).get(p) is True]
        if parts:
            out[uid] = parts
    return out


# ---- the lane --------------------------------------------------------------------------------------------------------

def config_lane(sess: L.Session, payload: dict) -> dict[str, Any]:
    """configLane: the platform-wide configuration, in one answer, for the relay's own identity."""
    reads, user = sess.reads, sess.user or {}
    if user.get("is_service") is not True:
        return dict(DG.UNKNOWN)
    # the relay's identity carries no place: headquarters, read from its own books
    out: dict[str, Any] = {"place": "", "own_workbook": False, "built_at": gsjs.iso(reads.now)}
    cfg = reads.config()

    def part(name: str, fn: Callable[[], dict[str, Any]]) -> None:
        try:
            got = fn()
        except Exception as exc:  # noqa: BLE001 - one part's refusal is not the lane's failure
            log.warning("configLane: %s left out (%s)", name, _why(exc)[:160])
            return
        if isinstance(got, dict) and got.get("status") == 200:
            out[name] = got.get("data")

    part("hiringViews", lambda: HF.views_policy(sess, {}))
    part("clientViews", lambda: CCP.views_policy(sess, {}))
    part("potClientsViews", lambda: prefs.pot_clients_views_policy(sess, {}))
    part("shelf", lambda: {"status": 200, "data": shelf(reads, user)})
    part("menuLinks", lambda: {"status": 200, "data": menu_links(reads)})
    # App Studio's own door (app/app_builder.py): the ops on their way laid, a missing tab queued on first touch
    part("appsBuilt", lambda: AB.ACTIONS["appsBuilt"](sess, {}))
    # FAIL-CLOSED: a word the switch does not know holds, said as unreadable
    try:
        out["test_mode"] = test_mode(cfg)
    except Exception as exc:  # noqa: BLE001
        out["test_mode"] = {"unreadable": _why(exc)[:200]}
    try:
        out["smart_gates"] = situation_switches(reads, [g["id"] for g in SCD.HUB_GATES])
    except Exception as exc:  # noqa: BLE001 - said, never spent as "not armed"
        out["smart_gates_unreadable"] = unread_situations(exc)
    try:
        out["notice_situations"] = situation_switches(reads, [NOTICE_PREFIX + k for k in NOTICE_KINDS])
    except Exception as exc:  # noqa: BLE001
        out["notice_situations_unreadable"] = unread_situations(exc)
    try:
        out["my_work_hide"] = hide_read(reads, cfg)
    except Exception as exc:  # noqa: BLE001
        out["my_work_hide_unreadable"] = _why(exc)[:200]
    out["my_work_apps"] = sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY))
    out["my_work_apps_seen"] = sc.list_cell(cfg.get(sc.MYWORK_APPS_SEEN_KEY))
    out["my_world_hide"] = gsjs.trim(gsjs.or_blank(cfg.get(MYWORK_WORLD_KEY))).lower() in ("on", "true", "1", "yes")
    out["my_world_seen"] = sc.list_cell(cfg.get(MYWORK_WORLD_SEEN_KEY))
    try:
        out["alert_receive_off"] = alert_receive_off(reads)
    except Exception as exc:  # noqa: BLE001 - nobody is cut
        log.warning("configLane: alert_receive_off left out (%s)", _why(exc)[:160])
    out["app_control_writers"] = [d["id"] for d in AC.delegates_read(reads) if d["may_change"] and d["apps"]]
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"configLane": config_lane}
# main.policy_gate asks nothing: the door answers the relay's identity alone
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
