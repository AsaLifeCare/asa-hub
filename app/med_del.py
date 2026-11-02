"""Med Delegation (MedDel.gs, MedDelCatalog.gs) read from Postgres: the Med Admin certification renewals, one flow per
employee and level, in app.resource_rows (`medDelFlows`, uploaded from meddel_flows), each with its next step; the
lane's catalogue (settings, levels, active statuses) read off the meddel_catalog house as MedDelCatalog.gs reads it,
the employee Master off the Employee Database's copy."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import staff as SP
from gsjs import NY, SheetDate

APP_ID = "med-delegation"
RESOURCE = "medDelFlows"
TAB = "meddel_flows"
CATALOG_TAB = "meddel_catalog"
CONFIG_KEY = "medDelConfig"
DAY_MS = 86400000.0
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

# MEDDEL_DEFAULTS
DEFAULTS: dict[str, Any] = {
    "skillsCheckEmail": "reedh@starkdd.org", "skillsCheckAddress": "2950 Whipple Avenue NW, Canton, OH",
    "employer": "Asa LifeCare", "transcriptsSpreadsheetId": "", "transcriptsTab": "Other - Transcripts",
    "windowDays": 60, "phase2ResendDays": 3, "phase3WindowStart": 2, "phase3WindowEnd": 12, "phase3EveryDays": 2,
    "scrapeAfterDays": 7, "cancelAfterDays": 60}
# MEDDEL_HEADER: a flow's columns, in the tab's order
HEADER = ("id", "createdAt", "updatedAt", "employeeId", "employeeName", "nameKey", "medLevel", "certExpDate", "phone",
          "email", "phase", "overallStatus", "phase1Status", "phase1Date", "phase1Notes", "phase2Status",
          "phase2LastSMS", "phase2SmsCount", "phase2ReceivedDate", "phase3Status", "phase3LastSMS", "phase3SmsCount",
          "phase4Status", "phase4ScheduledDate", "phase4ReminderSent", "skillsDoneDate", "phase5Status",
          "phase5ScrapeDate", "newExpDate", "cancelReason", "notes", "commsStartedAt", "commsResendAt",
          "commsReliasAt", "commsSkillsAt", "commsScrapeAlertAt", "skillsEmailSentAt", "transitions")
LEVELS = ("Med 1", "Med 2", "Med 3")
LEVEL_COLUMNS = {"Med 1": "med_1_exp_date", "Med 2": "med_2_exp_date", "Med 3": "med_3_exp_date"}
LEVEL_HEADERS = {"Med 1": "Med 1 Exp Date", "Med 2": "Med 2 Exp Date", "Med 3": "Med 3 Exp Date"}
# the Master's SSN, date of birth, login and password never enter flow state
MASTER_FIELDS = ("employee", "name", "status", "first_name", "last_name", "phone_number", "email", "address", "city",
                 "state", "zip", "med_1_exp_date", "med_2_exp_date", "med_3_exp_date")
ACTIVE_STATUSES = ("yes", "other", "active")
# MedDelCatalog.gs
CATALOG_KINDS = ("setting", "level", "active_status")
FORBIDDEN = re.compile(r"(ssn|social[_ ]?sec|date[_ ]?of[_ ]?birth|\bdob\b|birth[_ ]?date|password|passwd|\bpwd\b|"
                       r"\blogin\b|username|\bpin\b)", re.I)
COLUMN_OK = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
HEADER_OK = re.compile(r"(expir|\bexp\b|renew)", re.I)

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager") and not (user or {}).get("is_service")


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


# ---- the pure helpers -------------------------------------------------------------------------------------------

def _local_ms(y: int, mo: int, d: int) -> float | None:
    """new Date(y, m - 1, d) on the script's clock."""
    try:
        return datetime(y, mo, d, tzinfo=NY).timestamp() * 1000.0
    except ValueError:
        return None


def date_ms(v: Any) -> float | None:
    """medDelDateMs_."""
    if v is None or v == "":
        return None
    if isinstance(v, SheetDate):
        return v.at.timestamp() * 1000.0
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return _local_ms(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return _local_ms(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return gsjs.date_parse(s)


def days(ms: float, now: float) -> int:
    """medDelDays_."""
    return math.floor((ms - now) / DAY_MS)


def iso_day(ms: float) -> str:
    """medDelIsoDay_: the UTC calendar day."""
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime("%Y-%m-%d")


def phone_tail(v: Any) -> str:
    """medDelPhoneTail_."""
    return re.sub(r"\D+", "", "" if v is None else gsjs.js_str(v))[-10:]


def num(v: Any) -> str:
    """String(n) of a setting."""
    return gsjs.num_str(v) if isinstance(v, (int, float)) else gsjs.js_str(v)


def _int(v: Any) -> int:
    """parseInt(v, 10) || 0."""
    m = re.match(r"^\s*([+-]?\d+)", gsjs.or_blank(v))
    return int(m.group(1)) if m else 0


def transcript_reply(rows: list[dict], tail: str, after_ms: float) -> bool:
    """medDelTranscriptReply_."""
    if not tail:
        return False
    return any(phone_tail(r.get("participant")) == tail and float(r.get("atMs") or 0) > after_ms for r in rows or ())


def starkdd_params(master: dict, level: Any, employer: Any) -> dict[str, str]:
    """medDelStarkddParams_."""
    r = master or {}
    return {"first_name": gsjs.or_text(r.get("first_name")), "last_name": gsjs.or_text(r.get("last_name")),
            "email": gsjs.or_text(r.get("email")), "phone": gsjs.or_text(r.get("phone_number")),
            "address": gsjs.or_text(r.get("address")), "city": gsjs.or_text(r.get("city")),
            "state": gsjs.or_text(r.get("state")), "zip": gsjs.or_text(r.get("zip")),
            "med_level": gsjs.or_text(level), "employer": gsjs.or_text(employer)}


def mais_cert(result: Any) -> dict[str, Any]:
    """medDelMaisCert_."""
    for c in ((result or {}).get("certifications") or []) if isinstance(result, dict) else []:
        c = c or {}
        if "Medication" in gsjs.or_text(c.get("type")):
            return {"certFound": True, "newExpDate": gsjs.or_text(c.get("expiration"))}
    return {"certFound": False, "newExpDate": ""}


def config_merge(saved: Any) -> dict[str, Any]:
    """medDelConfigMerge_."""
    out = dict(DEFAULTS)
    if not isinstance(saved, dict):
        return out
    for key, dflt in DEFAULTS.items():
        if isinstance(dflt, (int, float)):
            n = SP.js_number(saved.get(key))
            if not math.isnan(n) and n > 0:
                out[key] = int(n) if n == int(n) else n
        else:
            s = gsjs.trim("" if saved.get(key) is None else gsjs.js_str(saved.get(key)))
            if s:
                out[key] = s
    return out


def transition(entry: dict) -> dict[str, str]:
    return {k: gsjs.or_blank(entry.get(k)) for k in ("at", "by", "from", "to", "note")}


def trail(v: Any) -> list:
    """A flow's transitions as a list: the cell's JSON, else none."""
    if isinstance(v, list):
        return list(v)
    try:
        got = json.loads(gsjs.or_blank(v) or "[]")
    except ValueError:
        return []
    return got if isinstance(got, list) else []


def next_step(f: dict, now: float, cfg: dict) -> dict[str, str]:
    """medDelNextStep_: what card and board say; `when` only when a real date exists."""
    status = gsjs.or_text(f.get("overallStatus")) or "active"
    if status == "complete":
        return {"label": "Renewal complete" + (" — new expiration " + s_(f["newExpDate"]) if f.get("newExpDate")
                                               else ""), "when": "", "waiting": "none"}
    if status == "cancelled":
        return {"label": "Cancelled" + (" — " + s_(f["cancelReason"]) if f.get("cancelReason") else ""), "when": "",
                "waiting": "none"}
    n = SP.js_number(f.get("phase"))
    phase = 1 if math.isnan(n) or n == 0 else n
    if phase == 1:
        return {"label": "StarkDD renewal application is submitted on the next daily sweep", "when": "",
                "waiting": "sweep"}
    if phase == 2:
        if gsjs.js_str(f.get("phase2Status")) == "awaiting_response":
            last = date_ms(f.get("commsResendAt") or f.get("phase2LastSMS")) or now
            return {"label": "Waiting for the employee to confirm the signed application (re-asked every "
                             + num(cfg["phase2ResendDays"]) + " days)",
                    "when": iso_day(last + cfg["phase2ResendDays"] * DAY_MS), "waiting": "employee"}
        return {"label": "Employee confirmed — an admin marks the final application as received", "when": "",
                "waiting": "admin"}
    if phase == 3:
        return {"label": "Online Relias course — reminders every " + num(cfg["phase3EveryDays"]) + " days between day "
                         + num(cfg["phase3WindowStart"]) + " and day " + num(cfg["phase3WindowEnd"])
                         + " after the application", "when": "", "waiting": "employee"}
    if phase == 4:
        if gsjs.js_str(f.get("phase4Status")) == "date_scheduled" and f.get("phase4ScheduledDate"):
            return {"label": "Skills check scheduled — reminder SMS to the employee the day before",
                    "when": gsjs.js_str(f["phase4ScheduledDate"])[:10], "waiting": "date"}
        return {"label": "Scheduling e-mail sent — an admin sets the skills check date", "when": "", "waiting": "admin"}
    anchor = date_ms(f.get("skillsDoneDate") or f.get("phase4ScheduledDate")) or now
    return {"label": "MAIS verification scrape " + num(cfg["scrapeAfterDays"])
                     + " days after the skills check; the Master is updated when the cert appears",
            "when": iso_day(anchor + cfg["scrapeAfterDays"] * DAY_MS), "waiting": "sweep"}


# ---- the flows ----------------------------------------------------------------------------------------------------

def _cell(v: Any) -> str:
    """medDelReadFlows_' cell: a Date as cellText_, anything else String()."""
    if isinstance(v, SheetDate):
        return gsjs.js_str(hubdb.cell_text(v))
    return "" if v is None else gsjs.js_str(v)


def flows(reads: L.Reads) -> list[dict]:
    """medDelReadFlows_: every flow with an id, its cells as text and its transitions a list — inside a write, as the
    write's own cursor sees them."""
    cols = RR.columns(reads, RESOURCE)
    out = []
    for _k, cells in RR.table_rows(reads, RESOURCE):
        row = {h: _cell(hubdb.typed(cells.get(h), "hub")) for h in cols if h}
        if not row.get("id"):
            continue
        row["transitions"] = trail(row.get("transitions"))
        out.append(row)
    return out


# ---- the catalogue ----------------------------------------------------------------------------------------------

def _switch(v: Any) -> str:
    """medDelCatalogSwitch_: '?' is not 'off'."""
    s = gsjs.trim("" if v is None else gsjs.js_str(v)).lower()
    if not s:
        return "on"
    if s in ("yes", "y", "on", "true", "1", "enabled"):
        return "on"
    if s in ("no", "n", "off", "false", "0", "disabled"):
        return "off"
    return "?"


def catalog_rows(reads: L.Reads) -> dict[str, Any]:
    """medDelCatalogRows_: never ok with no rows on a failure."""
    try:
        res = reads.db.resolve(CATALOG_TAB)
    except Exception as exc:  # noqa: BLE001 - the house could not be opened: the shipped values stand
        return {"ok": False, "rows": [], "why": "the catalogue house could not be opened: " + type(exc).__name__}
    if res.ref is None:
        return {"ok": False, "rows": [], "why": "no workbook answers for `" + CATALOG_TAB + "` — the house is not minted "
                                                "yet, or its pointer HUB_HOUSE_MEDDEL_CATALOG_ID is missing"}
    hdr = [gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers]
    if "kind" not in hdr or "name" not in hdr:
        return {"ok": False, "rows": [], "why": "the catalogue header has no `kind`/`name` columns — it is not the "
                                                "catalogue"}
    rows = []
    for _rn, raw in reads.db.rows(res.ref):
        row = {h: gsjs.trim(_cell(hubdb.typed(raw.get(h0), "hub"))) for h, h0 in zip(hdr, res.ref.headers) if h}
        if not row.get("kind") and not row.get("name"):
            continue
        rows.append(row)
    return {"ok": True, "why": "", "rows": rows}


def catalog_legacy(reads: L.Reads) -> dict | None:
    """medDelCatalogLegacy_: the medDelConfig row of financeConfig, JSON."""
    saved = None
    try:
        res = reads.db.resolve("financeConfig")
        for _rn, raw in (reads.db.rows(res.ref) if res.ref is not None else []):
            if s_(raw.get("key")) != CONFIG_KEY:
                continue
            try:
                saved = json.loads(s_(raw.get("value")) or "{}")
            except ValueError:
                saved = None
    except Exception:  # noqa: BLE001 - as the port: no legacy row
        return None
    return saved if isinstance(saved, dict) else None


def catalog_build(read: dict, legacy: dict | None) -> dict[str, Any]:
    """medDelCatalogBuild_: resolved per group, never all or nothing."""
    out: dict[str, Any] = {"ok": bool(read and read.get("ok")), "why": gsjs.or_blank((read or {}).get("why")),
                           "source": "code", "groups": {"settings": "code", "levels": "code", "statuses": "code"},
                           "refused": [], "settings": None, "levels": [], "levelColumns": {}, "levelHeaders": {},
                           "activeStatuses": {}, "masterFields": []}
    saved: dict[str, Any] = dict(legacy) if isinstance(legacy, dict) else {}
    rows = (read.get("rows") or []) if read and read.get("ok") else []
    levels: list[str] = []
    columns: dict[str, str] = {}
    headers: dict[str, str] = {}
    statuses: dict[str, int] = {}
    setting_rows = level_rows = status_rows = 0
    for row in rows:
        row = row or {}
        kind = re.sub(r"[\s-]+", "_", gsjs.trim(gsjs.or_blank(row.get("kind"))).lower())
        name = gsjs.trim(gsjs.or_blank(row.get("name")))
        if not kind or not name:
            continue
        if kind not in CATALOG_KINDS:
            out["refused"].append(f'row "{name}": unknown kind "{kind}"')
            continue
        sw = _switch(row.get("enabled"))
        if sw == "?":
            out["refused"].append(f'row "{name}": "{gsjs.trim(gsjs.js_str(row.get("enabled")))}" in `enabled` is '
                                  "neither yes nor no — the row was left ON, because a cell nobody can read must never "
                                  "be the thing that switches something off")
        on = sw != "off"
        if kind == "setting":
            setting_rows += 1
            if on:
                saved[name] = row.get("value")
            continue
        if kind == "active_status":
            status_rows += 1
            if on:
                statuses[name.lower()] = 1
            continue
        level_rows += 1
        if not on:
            continue
        column = gsjs.trim(gsjs.or_blank(row.get("value"))).lower()
        header = gsjs.trim(gsjs.or_blank(row.get("label")))
        shipped_header = LEVEL_HEADERS.get(name, "")
        if column and FORBIDDEN.search(column):
            out["refused"].append(f'level "{name}": the column "{column}" names protected employee data and was '
                                  "refused")
            column = ""
        elif column and not COLUMN_OK.match(column):
            out["refused"].append(f'level "{name}": "{gsjs.js_str(row.get("value"))}" is not a Master column name')
            column = ""
        if header and FORBIDDEN.search(header):
            out["refused"].append(f'level "{name}": the write-back header "{header}" names protected employee data '
                                  "and was refused — nothing is ever written there")
            header = ""
        elif header and header != shipped_header and not HEADER_OK.search(header):
            out["refused"].append(f'level "{name}": "{header}" does not read like an expiration column on the Master, '
                                  "so the renewed date is not written under it")
            header = ""
        column = column or LEVEL_COLUMNS.get(name, "")
        if not column:
            out["refused"].append(f'level "{name}": no usable Master column — the level was skipped')
            continue
        header = header or shipped_header
        if not header:
            out["refused"].append(f'level "{name}": no Master header to write the renewed date back under — fill in '
                                  "`label` with that column's header on the Master")
        if name not in levels:
            levels.append(name)
        columns[name] = column
        headers[name] = header
    out["settings"] = config_merge(saved)
    ok = bool(read and read.get("ok"))
    if ok and setting_rows:
        out["groups"]["settings"] = "sheet"
    if ok and level_rows and levels:
        out["levels"], out["levelColumns"], out["levelHeaders"] = levels, columns, headers
        out["groups"]["levels"] = "sheet"
    else:
        if ok and level_rows and not levels:
            out["refused"].append("every level row was switched off or unusable — the shipped levels stand")
        out["levels"], out["levelColumns"], out["levelHeaders"] = list(LEVELS), dict(LEVEL_COLUMNS), dict(LEVEL_HEADERS)
    for k, v in LEVEL_HEADERS.items():
        if not out["levelHeaders"].get(k):
            out["levelHeaders"][k] = v
    if ok and status_rows and statuses:
        out["activeStatuses"] = statuses
        out["groups"]["statuses"] = "sheet"
    else:
        if ok and status_rows:
            out["refused"].append("every employment status row was switched off — the shipped statuses stand, "
                                  "because an empty list would cancel every open renewal")
        out["activeStatuses"] = {k: 1 for k in ACTIVE_STATUSES}
    fields: list[str] = []
    for f in list(MASTER_FIELDS) + [out["levelColumns"].get(lv, "") for lv in out["levels"]]:
        if f and f not in fields and not (f not in MASTER_FIELDS and FORBIDDEN.search(f)):
            fields.append(f)
    out["masterFields"] = fields
    g = out["groups"]
    if "sheet" in g.values():
        out["source"] = "sheet" if all(v == "sheet" for v in g.values()) else "mixed"
    if not out["why"] and ok and "code" in g.values():
        out["why"] = ("the catalogue was read but some of it is not filled in — settings: " + g["settings"]
                      + ", levels: " + g["levels"] + ", employment statuses: " + g["statuses"])
    return out


def catalog(reads: L.Reads) -> dict[str, Any]:
    """medDelCatalog_, once per request."""
    return reads.once("meddel:catalog", lambda: catalog_build(catalog_rows(reads), catalog_legacy(reads)))


def catalog_state(cat: dict) -> dict[str, Any]:
    """medDelCatalogState_."""
    return {"ok": bool(cat.get("ok")), "why": gsjs.or_blank(cat.get("why")), "source": gsjs.or_text(cat.get("source"))
            or "code", "groups": cat.get("groups"), "refused": list(cat.get("refused") or [])[:10],
            "levels": list(cat.get("levels") or [])}


# ---- sources: the Master, people, the transcripts -----------------------------------------------------------------

def master_rows(reads: L.Reads, cat: dict) -> list[dict]:
    """medDelMasterRows_: the whitelisted fields of every Master row, and its display name; none when unreadable."""
    try:
        got = SP.cert_read_tab(reads, SP.cert_source_tab(reads, "master"))
    except Exception:  # noqa: BLE001 - as the port: an unreadable Master starts nothing
        return []
    out = []
    for r in got:
        p = {f: r[f] for f in cat["masterFields"] if f in r}
        p["_displayName"] = gsjs.trim(gsjs.or_text(p.get("employee") or p.get("name")))
        out.append(p)
    return out


def people_rows(reads: L.Reads) -> list[dict]:
    """listRows_('people')."""
    return reads.once("meddel:people", lambda: SP._people(reads))


def people_by_key(reads: L.Reads, merged: bool) -> dict[str, dict]:
    """medDelPeopleByKey_ (merged, without the ISP clients) or the seed's own plain read: the first row per name key."""
    out: dict[str, dict] = {}
    try:
        people = people_rows(reads)
        if merged:
            people = SP.without_isp_clients(reads, SP.people_merged(reads, people))
    except Exception:  # noqa: BLE001 - an unresolved person is noted, never guessed
        return out
    for p in people:
        k = gsjs.name_key(p.get("name"))
        if k and k not in out:
            out[k] = p
    return out


def transcript_rows(reads: L.Reads, cfg: dict) -> list[dict]:
    """medDelTranscriptRows_: who wrote in, and when."""
    try:
        sid = gsjs.or_text(cfg.get("transcriptsSpreadsheetId")) or reads.db.prop("EMP360_MASTER_DATA_ID")
        ref = reads.tab_of(sid, gsjs.or_text(cfg.get("transcriptsTab")), "the transcripts") if sid else None
        if ref is None:
            return []
        keys = [hubdb.estate_key(h) for h in ref.headers]
        out = []
        for _rn, raw in reads.db.rows(ref):
            row = {k: hubdb.typed(raw.get(h), "hub") for k, h in zip(keys, ref.headers) if k}
            at = date_ms(row.get("received_at")) or date_ms(row.get("transcript_created"))
            out.append({"participant": "" if row.get("participant") is None else gsjs.js_str(row["participant"]),
                        "atMs": 0 if at is None else at})
        return out
    except Exception:  # noqa: BLE001 - as the port: no reply read is no reply
        return []


# ---- the doors ----------------------------------------------------------------------------------------------------

def flows_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """medDelFlows: every flow (filtered by phase and status), active first then by expiry, each with its next step,
    the counts and the catalogue's state."""
    if not writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cat = catalog(sess.reads)
    cfg = cat["settings"]
    now = now_ms(sess.reads)
    phase, status = s_(p.get("phase")), s_(p.get("status"))
    every = flows(sess.reads)
    shown = [f for f in every if (not phase or f.get("phase") == phase)
             and (not status or f.get("overallStatus") == status)]
    counts: dict[str, Any] = {"active": 0, "complete": 0, "cancelled": 0, "byPhase": {}}
    for f in every:
        st = f.get("overallStatus", "")
        counts[st] = counts.get(st, 0) + 1
        if st == "active":
            counts["byPhase"][f.get("phase", "")] = counts["byPhase"].get(f.get("phase", ""), 0) + 1
    shown.sort(key=lambda f: (f.get("overallStatus") != "active", date_ms(f.get("certExpDate")) or 0))
    data = [{**f, "nextStep": next_step(f, now, cfg)} for f in shown]
    return {"status": 200, "data": {"flows": data, "counts": counts, "catalogue": catalog_state(cat)}}


def flows_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The medDelFlows / medDelFlowsRaw slices, for the relay's own identity: listRows_ of the flows."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    return {"status": 200, "data": RR.read_all(sess.reads, RESOURCE)}


def generic_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def generic_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "medDelFlows": flows_list, "medDelFlowsSlice": flows_slice, "medDelFlowsList": generic_list,
    "medDelFlowsGet": generic_get}
POLICY: dict[str, dict[str, Any]] = {"medDelFlows": {"roles": ("admin", "manager")}, "medDelFlowsSlice": {},
                                     "medDelFlowsList": {}, "medDelFlowsGet": {}}
