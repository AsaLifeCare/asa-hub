"""Settings' platform configuration answered off asa-hub-db (AlertsConfig.gs hiringAlertsGet): every catalogue row with
its value, note and group, where the catalogue came from (AlertsCatalog.gs), the resolved test mode and who can sign a
scorecard. The config is the runtime book's dissolved facts with Python's own saves laid over them
(editions.laid_config); the save is alerts_config_writes.py's."""
from __future__ import annotations

import json
import time
from typing import Any

import candidates as CND
import gsjs
import house_tables as HT
import hubdb
import interviews as IV
import locations as L
import scope as sc
import smart_comms_desk as SCD
import staff_views
from scope import Defer

APP_ID = "alerts-config"
CONFIG_TAB = "hiring_alerts_config"
CATALOG_TAB = "hiring_alerts_catalog"
# Prefs.gs CONFIG_BADGE_TAB: the Settings-sections matrix, whose `access` row names who changes feature access
CONFIG_BADGE_TAB = "config_badge_access"
# AlertsCatalog.gs: the closed vocabulary of groups, the one a row falls to, the key a plain map cannot carry
CATALOG_GROUPS = ("messages", "recipients", "timing", "guard", "test", "alerts", "access", "clients", "hiringapp",
                  "platform", "mywork")
GROUP_FALLBACK = "alerts"
REFUSED_KEYS = ("__proto__",)
# a degraded catalogue read is said once an hour (HIRING_ALERTS_CATALOG_SAID_TTL)
SAID_EVERY_S = 3600.0
SAID_BY = "asa-hub:config"
_SAID: dict[str, float] = {"at": 0.0}
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

# AlertsCatalog.gs HIRING_ALERTS_CATALOG_SHIPPED: the last-resort copy — the keys, their group, their default
SHIPPED: tuple[dict[str, str], ...] = tuple({"key": k, "group": g, "value": v} for k, g, v in (
    ("clients_views_master", "clients", "directory, record, unique"),
    ("clients_toolbar_master", "clients", "share, export, add"),
    ("hiring_views_master", "hiringapp", "pipeline, flow"),
    ("platform_email_enabled", "platform", "yes"),
    ("platform_mail_badges", "guard", "DIRECTOR"),
    ("contact_sweep_hours", "guard", "2"),
    ("potclients_views_master", "guard", "pipeline, unique"),
    ("sms_recipients", "recipients", "+13309195559, +13309197779, +13309195558"),
    ("escalation_floor_sms", "recipients", "+13309195559, +13309197779, +13309195558"),
    ("opt_out_phrases", "platform", ""),
    ("opt_in_phrases", "platform", ""),
    ("wrong_number_phrases", "platform", ""),
    ("test_mode", "test", ""),
    ("test_redirect_sms", "test", ""),
    ("test_redirect_email", "test", ""),
    ("packet_rehearsal_number", "test", ""),
    ("copilot_badges", "access", ""),
    ("myworld_badges", "access", ""),
    ("smartcomms_widget_badges", "access", "DIRECTOR, ADMINISTRATOR, ADMIN, MANAGER"),
    ("franchise_view_badges", "access", ""),
    ("appgrid_badges", "access", ""),
    ("behavior_all_badges", "access", "ADMIN, ADMINISTRATOR, DIRECTOR, MANAGER, HM"),
    ("render_sheet_edit_badges", "access", ""),
    ("email_recipients", "recipients",
     "admin@abrighterdawninc.com, ty.bond@asalifecare.com, asatech@asalifecare.com"),
    ("hiring_team_emails", "recipients",
     "arthur.torres@asalifecare.com, ty.bond@asalifecare.com, admin@abrighterdawninc.com"),
    ("interview_supervisor_name", "recipients", "Tieara Kennemore"),
    ("msg_packet_request_sms", "messages",
     "Hi DSP, this is ASA Lifecare. To finish your onboarding we still need your signed New Hire packet. Please "
     "check your inbox for your New Hire packet and complete it."),
    ("msg_packet_request_email_subject", "messages", "Your signed New Hire packet — ASA Lifecare"),
    ("msg_packet_request_email", "messages",
     "Hi DSP,\n\nTo finish your onboarding we still need your signed New Hire packet.\nPlease check your inbox for "
     "your New Hire packet and complete it.\n\nASA Lifecare"),
    ("test_banner", "test", ""),
    ("interview_scorecard_emails", "access", ""),
    ("hiring_timezone", "platform", ""),
    ("packet_hold_hours", "timing", ""),
    ("onboarding_window_before_days", "timing", ""),
    ("onboarding_window_after_days", "timing", ""),
    ("messages_paused", "platform", ""),
    ("msg_date_accepted", "messages",
     "Hub: could not read the accepted in-person date for {name}.\nPhone: {phone} · Email: {email}\n{screen}\n"
     "{report}Action: open the Hiring Pipeline card and press Manual on Date accepted."),
    ("msg_hired_complete", "messages",
     "Hub: {name} reached Hired. What was checked: {checked}. Uploaded documents are not part of this check.\n"
     "Phone: {phone} · Email: {email}\nThey stay on the last step of the Hiring Pipeline for one more day, then move "
     "to Users as staff automatically."),
    ("msg_hired_missing", "messages",
     "Hub: {name} reached Hired, but these items are missing:\n{missing}\nPhone: {phone} · Email: {email}\nThey "
     "still stay one more day on the pipeline and then move to Users as staff — chase the missing items in the "
     "Onboarding Tracker."),
    ("staff_guard_mode", "guard", "shadow"),
    ("staff_guard_mode_public", "guard", "shadow"),
    ("staff_guard_block_statuses", "guard", "active, admin"),
    ("staff_guard_test_phones", "guard", "+13309195558"),
    ("staff_guard_test_emails", "guard",
     "asatech*@asalifecare.com, asatechjk@gmail.com, silvajhonatanbrito@gmail.com"),
    ("staff_guard_shared_emails", "guard",
     "info@asalifecare.com, hr@asalifecare.com, admin@asalifecare.com, support@asalifecare.com"),
    ("mywork_hide_header", "mywork", "no"),
    ("mywork_hide_source_notes", "mywork", "no"),
    ("mywork_hide_missing_row", "mywork", "no"),
    ("mywork_hide_completed", "mywork", "no"),
    ("mywork_hide_inbox_sources", "mywork", "no"),
    ("mywork_hide_ssa_updated", "mywork", "yes"),
    ("mywork_hide_ssa_county", "mywork", "yes"),
    ("mywork_hide_ssa_count", "mywork", "yes"),
    ("mywork_hide_ssa_role", "mywork", "yes"),
    ("mywork_hide_sched_hours", "mywork", "yes"),
    ("mywork_hide_record_notes", "mywork", "yes"),
    ("mywork_hide_client_activity", "mywork", "yes"),
    ("mywork_hide_client_group_titles", "mywork", "yes"),
    ("mywork_hide_staff_doc_counts", "mywork", "yes"),
    ("mywork_hide_family_details", "mywork", "yes"),
    ("mywork_hide_apps", "mywork", ""),
    ("mywork_hide_apps_seen", "mywork", ""),
    ("mywork_hide_world", "mywork", "no"),
    ("mywork_hide_world_seen", "mywork", ""),
    ("mywork_hide_myasa", "mywork", "no"),
    ("mywork_hide_myasa_seen", "mywork", ""),
    ("mywork_appcontrol_delegates", "mywork", ""),
    ("mywork_editions", "mywork", ""),
    ("mywork_auto_sr_late_show", "mywork", "no"),
    ("mywork_auto_sr_no_call_no_show", "mywork", "no"),
    ("mywork_auto_sr_punch_missing", "mywork", "no"),
    ("mywork_auto_sr_incident", "mywork", "no"),
    ("mywork_auto_sr_general_requests", "mywork", "no"),
    ("mywork_auto_sr_vehicle", "mywork", "no"),
    ("mywork_auto_sr_payroll", "mywork", "no"),
    ("mywork_auto_sr_adp_update", "mywork", "no"),
    ("mywork_auto_sr_time_off", "mywork", "no"),
))


def log_line(actor: dict, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record(actor, action, detail, status)


def dissolved(reads: L.Reads) -> None:
    """hubTabEnsure_'s runtime sheet: the config tab is the depot's facts, the only config Python reads."""
    if not reads.db.dissolved(CONFIG_TAB):
        raise Defer("the platform config is a sheet tab, not the depot's facts")


# ---- the catalogue (AlertsCatalog.gs) ------------------------------------------------------------------------------

def _cell(raw: dict, head: Any) -> str:
    """String(row[at] == null ? '' : row[at]) of the cell getValues() hands back; '' for a column not there."""
    return "" if head is None else gsjs.or_blank(hubdb.typed(raw.get(head), "hub"))


def catalog_from_sheet(reads: L.Reads) -> dict[str, Any]:
    """hiringAlertsCatalogFromSheet_: the catalogue exactly as its house holds it — {rows, read, why}."""
    db = reads.db
    headers: list[Any] | None = None
    if HT.tabled(CATALOG_TAB):
        headers, placed = HT.raw(reads, CATALOG_TAB)
        lines = [raw for _rn, raw in placed]
    elif db.house_moved(CATALOG_TAB):
        res = db.resolve(CATALOG_TAB)
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the configuration catalogue's book")
        if res.ref is not None:
            headers, lines = list(res.ref.headers), [raw for _rn, raw in db.rows(res.ref)]
    if headers is None:
        return {"rows": [], "read": False, "why": "no " + CATALOG_TAB + " house is declared, or it did not open"}
    if not any(any(v not in (None, "") for v in raw.values()) for raw in lines):
        return {"rows": [], "read": False, "why": "the catalogue tab carries no rows under its header"}
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
    if "key" not in head:
        return {"rows": [], "read": False,
                "why": "the catalogue header has no `key` column (found: " + ", ".join(head) + ")"}

    def at(name: str) -> Any:
        return headers[head.index(name)] if name in head else None

    h_key, h_group, h_value, h_note = at("key"), at("group"), at("default_value"), at("note")
    rows: list[dict[str, str]] = []
    where: dict[str, int] = {}
    doubled = 0
    refused: list[str] = []
    for raw in lines:
        key = gsjs.trim(_cell(raw, h_key))
        if not key:
            continue
        if key in REFUSED_KEYS:
            if key not in refused:
                refused.append(key)
            continue
        row = {"key": key, "group": gsjs.trim(_cell(raw, h_group)) or GROUP_FALLBACK, "value": _cell(raw, h_value),
               "note": _cell(raw, h_note)}
        # a key twice keeps its first place and its last words
        if key not in where:
            where[key] = len(rows)
            rows.append(row)
        else:
            rows[where[key]] = row
            doubled += 1
    if not rows:
        return {"rows": [], "read": False, "refused": refused, "why": "the catalogue tab has a header and no key rows"}
    return {"rows": rows, "read": True, "doubled": doubled, "refused": refused, "why": ""}


def catalog_merge(got: dict[str, Any]) -> dict[str, Any]:
    """hiringAlertsCatalogMerge_: the sheet's rows, plus any key only the shipped copy knows, and what was corrected
    or refused said in one message (My Work's keys never named in it)."""
    by_shipped: dict[str, dict[str, str]] = {}
    for d in SHIPPED:
        k = gsjs.trim(gsjs.or_text(d.get("key")))
        if k:
            by_shipped[k] = d

    def blank(v: Any) -> bool:
        return gsjs.trim(gsjs.or_blank(v)) == ""

    rows: list[dict[str, Any]] = []
    have: set[str] = set()
    repaired: list[str] = []
    for r in got.get("rows") or []:
        ship = by_shipped.get(r["key"])
        group = r["group"]
        if group not in CATALOG_GROUPS:
            fell = (gsjs.trim(gsjs.or_text(ship.get("group"))) if ship else "") or GROUP_FALLBACK
            if fell not in CATALOG_GROUPS:
                fell = GROUP_FALLBACK
            repaired.append(r["key"] + ': group "' + group + '" is not one the platform draws — showing it under "'
                            + fell + '"')
            group = fell
        value = r["value"]
        if blank(value) and ship and not blank(ship.get("value")):
            repaired.append(r["key"] + ": its default cell is empty — using the default shipped with the code, so "
                                       "nothing restores an empty list")
            value = gsjs.js_str(ship.get("value"))
        have.add(r["key"])
        rows.append({"key": r["key"], "group": group, "value": value, "note": r["note"], "shipped": ship is not None})
    only: list[str] = []
    for d in SHIPPED:
        key = gsjs.trim(gsjs.or_text(d.get("key")))
        if not key or key in have:
            continue
        have.add(key)
        only.append(key)
        rows.append({"key": key, "group": gsjs.trim(gsjs.or_text(d.get("group"))) or GROUP_FALLBACK,
                     "value": gsjs.or_blank(d.get("value")), "note": "", "shipped": True})
    refused = got.get("refused") or []
    says: list[str] = []
    named = [k for k in only if not my_work_key(k)]
    repaired_said = [line for line in repaired if not my_work_key(line)]
    if not got.get("read"):
        says.append("The configuration catalogue could not be read from its house (" + gsjs.js_str(got.get("why"))
                    + "). The keys below are the last-resort copy shipped with the code and they have no notes. The "
                      "values are the live ones and still rule; nothing else has changed.")
    elif named:
        says.append(f"{len(named)} key(s) are not in the catalogue and are showing without their note: "
                    + ", ".join(named) + ".")
    if refused:
        says.append("Refused as a key name: " + ", ".join(refused) + ". A configuration key is read into a plain map "
                    "and those names cannot be stored in one, so a field by that name could never hold a value.")
    if repaired_said:
        says.append("Corrected while reading the catalogue — " + "; ".join(repaired_said) + ".")
    return {"rows": rows, "ok": bool(got.get("read")) and not only and not repaired and not refused,
            "read": bool(got.get("read")), "source": "sheet" if got.get("read") else "shipped", "tab": CATALOG_TAB,
            "sheet_keys": len(got.get("rows") or []), "doubled": got.get("doubled") or 0, "shipped_only": only,
            "repaired": repaired, "refused": refused, "message": " ".join(says)}


def catalog(reads: L.Reads) -> dict[str, Any]:
    """hiringAlertsCatalog_: the whole catalogue, once per request; a degraded read said once an hour."""
    def read() -> dict[str, Any]:
        out = catalog_merge(catalog_from_sheet(reads))
        if out["message"] and time.time() - _SAID["at"] >= SAID_EVERY_S:
            _SAID["at"] = time.time()
            log_line({"email": SAID_BY}, "hiring_alerts_catalog", out["message"], 200 if out["read"] else 500)
        return out
    return reads.once("alerts_catalog", read)


def catalog_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """hiringAlertsCatalogRows_: every configuration key in catalogue order."""
    return catalog(reads)["rows"]


# ---- test mode, My Work's switches, feature access, the scorecard ------------------------------------------------

def shared_warning(st: dict[str, Any]) -> str:
    """hubTestSharedWarning_: nothing is redirected any more, so there is no room to warn about."""
    return ""


def test_mode_word_known(raw: Any) -> bool:
    """hubTestModeWordKnown_: a word test_mode is read by (the rehearsal words are on too); a blank cell is known."""
    w = gsjs.trim(gsjs.or_blank(raw)).lower()
    return not w or w in SCD.TEST_ON_WORDS or w in SCD.TEST_OFF_WORDS or w in SCD.REHEARSAL_WORDS


def test_mode_refusal(nxt: dict[str, Any] | None, values: dict[str, Any] | None) -> str:
    """hubTestModeRefusal_: why this whole config may not be saved, '' when it may — a word the switch does not know
    whatever else the save touches, and a tester list with an entry nobody can name when the save touches a list."""
    nxt = nxt or {}
    touches_mode = values is None or "test_mode" in values
    if touches_mode and not test_mode_word_known(nxt.get("test_mode")):
        return ('Test mode is "on" or "off" — "' + gsjs.trim(gsjs.js_str(nxt.get("test_mode")))[:40]
                + '" is a word the switch does not know. Choose one of the two positions and save again.')
    if not (values is None or "test_redirect_sms" in values or "test_redirect_email" in values):
        return ""
    st = SCD.test_mode_state(nxt)
    if st["dropped"]:
        return ("Not a usable recipient: " + ", ".join(st["dropped"]) + ". Numbers are +1XXXXXXXXXX and addresses "
                "need an @ — an entry that does not parse is a tester nobody can name.")
    return ""


def my_work_key(key: Any) -> bool:
    """hubMyWorkHideKey_: one of the My Work display switches — the master's pen alone."""
    return gsjs.or_blank(key).startswith("mywork_")


def my_work_master(user: dict[str, Any] | None) -> bool:
    """hubMyWorkHideMaster_, FAIL-CLOSED: the master in its own session."""
    try:
        return sc.is_real_master(user)
    except Exception:  # noqa: BLE001 - anything unreadable is not the master
        return False


def access_matrix_may_edit(reads: L.Reads, user: dict[str, Any] | None) -> bool:
    """accessMatrixMayEdit_: an admin at home — the master, or one wearing a badge the Settings-sections matrix's
    `access` row names; no rule written, the master alone."""
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    if gsjs.str_(user.get("role")) != "admin":
        return False
    if sc.is_master_email(gsjs.str_(user.get("email"))):
        return True
    worn = sc.badges_worn(user.get("types"), user.get("role"))
    for row in CND.read_tab(reads, CONFIG_BADGE_TAB):
        if gsjs.str_(row.get("sectionid")) != "access":
            continue
        # a rule exists: it names somebody here, or nobody
        return any(b in worn for b in sc.types_from_raw(row.get("badges")))
    return False


def who_can_record(reads: L.Reads) -> dict[str, Any]:
    """interviewWhoCanRecord_: who can sign a scorecard by route — the role or a badge that interviews, the list, the
    hiring.interview grant — so the screen can warn that removing an address leaves a grant in place."""
    out: dict[str, Any] = {"by_role": [], "by_list": IV.scorecard_emails(reads), "by_grant": []}
    try:
        users = reads.users()
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - the .gs's own catch
        out["unreadable"] = True
        return out
    for u in users:
        if gsjs.str_(u.get("active")).lower() == "false":
            continue
        email = gsjs.str_(u.get("email")).lower()
        if not email:
            continue
        if gsjs.str_(u.get("role")) == "interviewer":
            out["by_role"].append(email)
            continue
        types = sc.types_from_raw(gsjs.str_(u.get("types")))
        if "INTERVIEWER" in types or "HM" in types:
            out["by_role"].append(email)
            continue
        try:
            ov = json.loads(gsjs.str_(u.get("permoverrides")) or "{}") or {}
        except (ValueError, RecursionError):
            ov = {}
        if isinstance(ov, dict) and ov.get("hiring.interview") is True:
            out["by_grant"].append(email)
    return out


# ---- the door ----------------------------------------------------------------------------------------------------

def hiring_alerts_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringAlertsGet: the config for the Settings screens, admin only — each catalogue row with its live value (its
    default while it has none), where the keys came from, the RESOLVED test mode and who can sign a scorecard.
    Settings › My Work's rows are the master's to read: every other admin gets neither the values nor the key names."""
    user = sess.user
    if not user or user.get("role") != "admin":
        return dict(DENIED)
    reads = sess.reads
    dissolved(reads)
    cfg = reads.config()
    cat = catalog(reads)
    st = SCD.test_mode_state(cfg)
    warning = shared_warning(st)
    sees = my_work_master(user)
    shown = [d for d in cat["rows"] if sees or not my_work_key(d["key"])]
    rows = []
    for d in shown:
        note = d["note"]
        if d["key"] == "test_redirect_sms" and warning:
            note = note + " — " + warning
        rows.append({"key": d["key"], "value": cfg[d["key"]] if d["key"] in cfg else d["value"], "note": note,
                     "default_value": d["value"], "group": d["group"] or GROUP_FALLBACK})
    return {"status": 200, "data": {
        "rows": rows,
        "catalogue": {"ok": cat["ok"], "read": cat["read"], "source": cat["source"], "tab": cat["tab"],
                      "keys": len(shown), "sheet_keys": cat["sheet_keys"],
                      "shipped_only": [k for k in cat["shipped_only"] if sees or not my_work_key(k)],
                      "repaired": [line for line in cat["repaired"] if sees or not my_work_key(line)],
                      "refused": cat["refused"], "message": cat["message"]},
        "test_mode": {"on": st["on"], "explicit": st["explicit"], "unrecognized": st["unrecognized"],
                      "sms": st["sms"], "emails": st["emails"], "dropped": st["dropped"], "shared": st["shared"],
                      "shared_warning": warning},
        "scorecard": who_can_record(reads)}}


ACTIONS = {"hiringAlertsGet": hiring_alerts_get}
# HUB_POLICY: the roles each door is declared for
POLICY: dict[str, dict[str, Any]] = {"hiringAlertsGet": {"roles": ("admin",)}}
