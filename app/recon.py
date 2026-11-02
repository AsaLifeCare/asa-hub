"""Time Reconciliation (apps-script/Recon.gs) on Python: the runs, the errors, the thresholds and a day's shifts read
where they live — the runs and the errors in Postgres once uploaded (app.resource_rows), the copy before; the worked
side off the Hub's own PsiAnywhere record (app/recon_psi.py: the full punches house); the planned roster off the house
calendars' live copy (asa_house_calendar_live). A run covers one of PsiAnywhere's pay periods (app/psi_periods.py:
14 days, Sunday to Saturday) or a range of 35 days at most; the daily auto run covers the current and the previous
period. The "Cleaned Location" workbook import and the report upload stay as doors (no route is ever deleted) and still
keep their punches, but no run reads them any more: that tab was rewritten each period and keyed by row number, so it
held old punches many times and skipped the current ones.

The heavy part of a write is prepared here, as a read the relay asks first: an upload kept on the server and parsed, an
import read off the master workbook's copy (or the legacy folder in Drive), a run's detections; its write then only
records what was prepared, sealed by this service so nothing else can hand it in. The reads name staff and clients, so
they answer the people the writes let in (app/recon_gate.py) and the service alone."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import client_writes as CW
import drive as dr
import gsjs
import hotline as HL
import house_tables as HT
import hubdb
import locations as L
import psi_periods as PP
import recon_detect as D
import recon_psi as PSI
import recon_report as REP
import recon_roster as RO
import resource_rows as RR
import scope as sc
import sheet_resources as SR
from scope import Defer

APP_ID = "time-recon"
# Scheduling › Time Reconciliation: the App Control row the operator's access sheet (2026-10-29) opens the app by
FEATURE = "scheduling.timeReconciliation"
PUNCHES_TAB = "time_punches"
RUNS_TAB = "recon_runs"
ERRORS_TAB = "recon_errors"
CONFIG_TAB = "finance_config"
CONFIG_KEY = "reconThresholds"
# the resources these tabs are kept as in Postgres (sheet_resources.SPECS), uploaded by reconUpload
RESOURCES = {"timePunches": PUNCHES_TAB, "reconRuns": RUNS_TAB, "reconErrors": ERRORS_TAB}
RESOURCE_OF = {tab: r for r, tab in RESOURCES.items()}
# Settings › Editions: who else, beside the admins, the managers and the master
EDITION = {"review": "recon.review", "settings": "recon.settings"}
# RECON_DEFAULTS
DEFAULTS = {"gapMin": 5, "overlapMin": 45, "missingCoveragePct": 15, "smartRunDays": 2}
ERROR_STATUSES = ("Open", "Excused", "Covered", "Verified", "Flagged", "Reviewed")
RUN_STATUSES = ("Review", "Reviewed")
TYPES = ("missing", "noEnd", "dupe", "gap", "overlap")
ERROR_FIELDS = ("type", "date", "location", "employeeId", "employeeName", "consumers", "startTime", "endTime", "hours",
                "detail")
RUNS_SHOWN = 20
MEANINGS = {
    "gapMin": "a consumer without staff longer than this many minutes is a coverage gap",
    "overlapMin": "concurrent staff on one consumer longer than this many minutes is double coverage",
    "missingCoveragePct": "a scheduled shift with less punch coverage than this percent is missing coverage",
    "smartRunDays": "how many days back the Smart Comms sweep may report runs from",
    "auto": "on = run the current and the previous pay period from PsiAnywhere's record once a day, riding the "
            "machine reads"}
WRITERS_ONLY = "This action is for admin or manager."
# where a run's worked side is read (stamped on the run row), and the longest range one run reads: a pay period is 14
# days, and a month with its edges is the most a person may ask at once
SOURCE = "psi"
MAX_RUN_DAYS = 35
# the fields an anomaly is the same anomaly by, run after run (the consumer only where the anomaly is the consumer's)
CONSUMER_KEYED = ("gap", "overlap")
# HUB_POLICY params of the doors that gate themselves, in declaration order: (key, required, type); a prepare read
# shares its write's
PARAMS: dict[str, tuple[tuple[str, bool, str], ...]] = {
    "reconUploadReport": (("filename", True, "string"), ("contentBase64", True, "string")),
    "reconImportLatest": (("fileId", False, "string"),),
    "reconRun": (("dateFrom", False, "string"), ("dateTo", False, "string")),
    "reconShiftsForDate": (("date", True, "string"), ("location", True, "string")),
    "reconAiSuggest": (("errorId", True, "string"),),
    "reconErrorRemind": (("errorId", True, "string"),)}
# a prepared answer is kept by its write within this long of being made
PREPARED_MAX_S = 900
_SEAL_KEY = os.getenv("HUB_APP_TOKEN", "").encode() or os.urandom(32)
# reconAutoSweep_'s mark: one pass a day, a missed one retried the same day (CacheService's 72000 s)
AUTO_EVERY_S = 72000
AUTO_TABLE = "app.recon_auto"
AUTO_ACTOR = "auto-recon-sweep"
COPY_MARKER = "[withheld"
_STORED_TIME = re.compile(r"^18\d\d-\d\d-\d\dT(\d\d):(\d\d):(\d\d)")
_STORED_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})T00:00:00")

s_ = gsjs.str_


def withheld(v: Any) -> bool:
    if isinstance(v, str):
        return v.startswith(COPY_MARKER)
    if isinstance(v, dict):
        return any(withheld(x) for x in v.values())
    if isinstance(v, list):
        return any(withheld(x) for x in v)
    return False


def js_type(v: Any) -> str:
    """Array.isArray(v) ? 'array' : typeof v."""
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string" if isinstance(v, str) else "object"


def shown(env: dict[str, Any]) -> dict[str, Any]:
    if withheld(env.get("data")):
        raise Defer("the copy withholds a cell this answer shows")
    return env


def _ref(reads: L.Reads, tab: str) -> hubdb.TabRef | None:
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of {tab}")
    return res.ref


def kept(reads: L.Reads, tab: str) -> str:
    """The resource a tab is kept as in Postgres once uploaded (Recon's own, or one its app declares, as
    finance_config); '' while the copy holds it."""
    resource = RESOURCE_OF.get(tab, "") or (HT.resource_of(tab) or "")
    if not resource:
        return ""
    return resource if reads.once("sheetres_up:" + resource, lambda: RR.uploaded(reads.db, resource)) else ""


def rows(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_: Postgres' rows once the tab is uploaded there, else readAll_ of the copy with Python's kept edits."""
    resource = kept(reads, tab)
    if resource:
        return SR.rows(reads, resource)
    got = reads.once("recon:" + tab, lambda: reads.db.sheetdb_rows(_ref(reads, tab)))
    return [dict(r) for r in got]


def raw_rows(reads: L.Reads, tab: str) -> list[dict]:
    """Each row's cells as the copy keeps their text: what a write names as the sheet's value before it."""
    def read() -> list[dict]:
        ref = _ref(reads, tab)
        if ref is None:
            return []
        return [{h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in ref.headers if h}
                for _rn, raw in reads.db.rows(ref)]
    return [dict(r) for r in reads.once("recon_raw:" + tab, read)]


def books(reads: L.Reads, *tabs: str) -> tuple[str, ...]:
    out: list[str] = []
    for t in tabs:
        sid = "" if kept(reads, t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


def source_default(reads: L.Reads) -> dict[str, str]:
    """reconSourceDefault_."""
    return {"mode": "masterSheet", "spreadsheetId": reads.db.prop("RECON_SOURCE_ID"),
            "punchesTab": "Cleaned Location", "staffMapTab": "Staff Mapping", "clientMapTab": "Client to Location"}


def _js_number(v: Any) -> float:
    """Number(v), for the values a saved threshold holds."""
    if v is None:
        return float("nan")
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return 0.0
    try:
        return float(s) if re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", s) else float("nan")
    except ValueError:
        return float("nan")


def _saved(reads: L.Reads) -> list[Any]:
    """Each reconThresholds row's JSON, in the tab's order (None where it does not parse)."""
    out = []
    for r in rows(reads, CONFIG_TAB):
        if gsjs.str_(r.get("key")) != CONFIG_KEY:
            continue
        try:
            out.append(json.loads(gsjs.str_(r.get("value")) or "{}"))
        except (ValueError, RecursionError):
            out.append(None)
    return out


def config(reads: L.Reads) -> dict[str, Any]:
    """reconConfig_: the defaults, a saved reconThresholds row over them (its JSON read back through str_, as
    listRows_ and str_ hand it to Apps Script)."""
    out: dict[str, Any] = dict(DEFAULTS)
    out["source"] = source_default(reads)
    try:
        for saved in _saved(reads):
            if not saved or not isinstance(saved, dict):
                continue
            for key in DEFAULTS:
                n = _js_number(saved.get(key))
                if n == n and n > 0:
                    out[key] = n
            if isinstance(saved.get("source"), dict):
                # RECON_SOURCE_DEFAULT is named by no file: the loop throws and the defaults stand for the source
                break
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - the defaults stand
        pass
    return out


def auto_on(reads: L.Reads) -> bool:
    """Whether the daily auto run is on: the `auto` reconConfigSet saved (the last row that says one), on unless off."""
    said = "on"
    for saved in _saved(reads):
        if isinstance(saved, dict) and saved.get("auto") not in (None, ""):
            said = gsjs.js_str(saved.get("auto"))
    return said.lower() != "off"


def stored_time(v: Any) -> str:
    """reconStoredTime_: '1899-12-30T21:30:00.000Z' → '9:30:00 PM'; anything else passes through."""
    s = gsjs.str_(v)
    m = _STORED_TIME.match(s)
    if not m:
        return s
    h = int(m.group(1))
    ap = "PM" if h >= 12 else "AM"
    h = h % 12 or 12
    return f"{h}:{m.group(2)}:{m.group(3)} {ap}"


def stored_day(v: Any) -> str:
    """reconStoredDay_."""
    s = gsjs.str_(v)
    m = _STORED_DAY.match(s)
    return m.group(1) if m else s


def heal(row: dict) -> dict:
    """reconHealStamps_."""
    out = dict(row)
    out["startTime"] = stored_time(out.get("startTime"))
    out["endTime"] = stored_time(out.get("endTime"))
    out["date"] = stored_day(out.get("date"))
    return out


def newest_first(runs: list[dict]) -> list[dict]:
    return sorted(runs, key=lambda r: gsjs.str_(r.get("createdAt")), reverse=True)


def anomaly_key(e: dict) -> str:
    """What makes an error the same anomaly from one run to the next: its type, day, place, person (the id, else the
    name in lower case), start, and — for a gap or an overlap, which are the consumer's — the consumers. A new run
    carries a resolution forward by it (app/recon_writes.py _store_run)."""
    kind = s_(e.get("type"))
    return "|".join([kind, stored_day(e.get("date")), s_(e.get("location")),
                     s_(e.get("employeeId")) or s_(e.get("employeeName")).lower(), stored_time(e.get("startTime")),
                     s_(e.get("consumers")) if kind in CONSUMER_KEYED else ""])


def by_place(errors: list[dict]) -> list[dict]:
    """Errors in the queue's order: place, day, then the clock (by its minutes, never its text)."""
    def at(e: dict) -> tuple:
        m = D.parse_time_min(e.get("startTime"))
        return (s_(e.get("location")), s_(e.get("date")), m if m is not None else 1441, s_(e.get("startTime")))
    return sorted(errors, key=at)


def read_refused(sess: L.Session) -> dict[str, Any] | None:
    """The reads' gate: the service, or a session app/recon_gate.py lets read (the master; else one App Control opens
    Time Reconciliation to who is an admin, a manager or named by the Review edition) — the errors name staff and
    clients."""
    import recon_gate as RG  # noqa: PLC0415 - it imports this module
    user = sess.user
    if (user or {}).get("is_service") is True:
        return None
    if RG.may_read(sess.reads, user, sc.is_real_master(user)):
        return None
    return {"status": 403, "message": RG.READERS_ONLY}


def writer(user: dict | None) -> bool:
    return CW.writer(user)


def app_open(sess: L.Session) -> bool:
    """App Control's word on Time Reconciliation for a read: the master first; else Scheduling's Time Reconciliation row
    or the app's own row opening every row to this viewer (the errors name staff and clients). FAIL-CLOSED: a row
    that defers opens nothing."""
    user = sess.user
    if sc.is_real_master(user):
        return True
    for app in (FEATURE, APP_ID):
        try:
            g = sc.profile_app_gate(app, user, sess.reads.scope_sources())
        except Defer:
            continue
        if g.get("open") is True and g["scope"].get("kind") == "all":
            return True
    return False


def badge_opens(sess: L.Session) -> bool:
    """Scheduling's Time Reconciliation row opens every row to this viewer AND names a badge the account has ticked
    (the role word never): the operator, 10-30, "Faça de acordo os badges". FAIL-CLOSED."""
    user = sess.user
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    try:
        g = sc.profile_app_gate(FEATURE, user, sess.reads.scope_sources())
    except Defer:
        return False
    rule = (sess.reads.app_rules().get("rules") or {}).get(FEATURE) or []
    return (g.get("open") is True and g["scope"].get("kind") == "all"
            and any(b in rule for b in sc.badges_worn(user.get("types"), "")))


def generic_refused(sess: L.Session, verb: str) -> dict[str, Any] | None:
    """sheet_resources.gate's word on this app's own tables (timePunches, reconRuns, reconErrors) through the generic
    verbs (reconErrorsList and the rest, front_door's route): the same gate as its own doors, whatever door asks — a
    list or a get answers the readers (read_refused); a create, an update or a delete the service and the admins and
    managers who write alone, never an edition (its people resolve an error through reconErrorResolve, which keeps the
    record)."""
    if verb in ("list", "get"):
        return read_refused(sess)
    user = sess.user or {}
    if user.get("is_service") is True or writer(user):
        return None
    return {"status": 403, "message": WRITERS_ONLY}


def edition_holds(sess: L.Session, eid: str) -> bool:
    """A person the edition lists, Time Reconciliation open to them, from their own account."""
    user = sess.user or {}
    if user.get("is_service") is True or user.get("visiting_member"):
        return False
    if not sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources()).get("open"):
        return False
    return sc.edition_allows(eid, user, sess.reads.config())


def params_refused(action: str, p: dict) -> dict[str, Any] | None:
    """hubPolicyGate_'s params, after the roles."""
    for key, required, kind in PARAMS[action]:
        val = p.get(key)
        missing = val is None or (isinstance(val, str) and val == "")
        if required and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and js_type(val) != kind:
            return {"status": 400, "message": f"{key} must be {kind}, got {js_type(val)}."}
    return None


def admin_gate(sess: L.Session, action: str, p: dict) -> dict[str, Any] | None:
    """roles: ['admin', 'manager'], the params, then hubIsWriter_ — the doors no edition opens; the screen's Run, Remind
    and AI also open to a badge Scheduling's Time Reconciliation row names (badge_opens)."""
    user = sess.user or {}
    service = user.get("is_service") is True
    by_badge = action in BADGE_DOORS and not service and not writer(user) and badge_opens(sess)
    if not service and gsjs.js_str(user.get("role")) not in ("admin", "manager") and not by_badge:
        return {"status": 403, "message": WRITERS_ONLY}
    return params_refused(action, p) or (None if writer(user) or by_badge else CW.denied())


# the doors on Time Reconciliation's own screen a badge the row names presses, as an admin does
BADGE_DOORS = ("reconRun", "reconErrorRemind", "reconAiSuggest")


def actor(user: dict | None) -> str:
    u = user or {}
    return "service" if u.get("is_service") is True else s_(u.get("email"))


# ---- what a read prepares for its write, sealed ---------------------------------------------------------------------

def _canon(v: Any) -> Any:
    if isinstance(v, float):
        return int(v) if math.isfinite(v) and v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {str(k): _canon(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_canon(x) for x in v]
    return v


def _mac(data: dict) -> str:
    text = json.dumps(_canon({k: v for k, v in data.items() if k != "seal"}), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True)
    return hmac.new(_SEAL_KEY, text.encode(), hashlib.sha256).hexdigest()


def seal(door: str, by: str, data: dict) -> dict[str, Any]:
    """The prepared answer, named for its write and its person, sealed by this service."""
    out = {**data, "door": door, "by": by, "at": int(time.time())}
    out["seal"] = _mac(out)
    return out


def unsealed(door: str, by: str, got: Any) -> dict[str, Any] | None:
    """The prepared answer a write was handed, when this service made it for this write and person just now."""
    if not isinstance(got, dict) or not isinstance(got.get("seal"), str):
        return None
    if not hmac.compare_digest(got["seal"], _mac(got)):
        return None
    if got.get("door") != door or got.get("by") != by:
        return None
    at = got.get("at")
    if not isinstance(at, (int, float)) or abs(time.time() - at) > PREPARED_MAX_S:
        return None
    return got


# ---- the reads ----------------------------------------------------------------------------------------------------

def recon_runs(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconRuns: the twenty newest runs (a run a newer one superseded is no longer among them)."""
    refused = read_refused(sess)
    if refused:
        return refused
    return shown({"status": 200, "data": {"runs": newest_first(rows(sess.reads, RUNS_TAB))[:RUNS_SHOWN]}})


def recon_errors(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconErrors: with a runId, that run's errors as they were; without one, the live errors of every run — each
    anomaly once, a newer run having superseded the rows of the days it covers — in the queue's order (place, day,
    clock). Open unless a status is asked for ('all' for every one)."""
    refused = read_refused(sess)
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    for key in ("runId", "status"):
        if p.get(key) not in (None, "") and not isinstance(p.get(key), str):
            return {"status": 400, "message": f"{key} must be string, got {js_type(p.get(key))}."}
    run_id = gsjs.str_(p.get("runId"))
    status = gsjs.str_(p.get("status")) or "Open"
    errors = [heal(r) for r in rows(reads, ERRORS_TAB) if (not run_id or gsjs.str_(r.get("runId")) == run_id)
              and (status.lower() == "all" or gsjs.str_(r.get("status")) == status)]
    return shown({"status": 200, "data": {"runId": run_id, "errors": errors if run_id else by_place(errors)}})


def recon_config_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconConfigGet: the thresholds in force, the import's source and what each one means."""
    user = sess.user or {}
    # Settings › Time Reconciliation is the master's and the Platform Lead's (scope.settings_lead); recon.settings adds
    lead = user.get("is_service") is True or sc.settings_lead(user)
    if not (writer(user) and lead) and not edition_holds(sess, EDITION["settings"]):
        if gsjs.js_str(user.get("role")) not in ("admin", "manager") and user.get("is_service") is not True:
            return {"status": 403, "message": "This action is for admin or manager."}
        return CW.denied()
    cfg = config(sess.reads)
    src = cfg["source"]
    return {"status": 200, "data": {
        "gapMin": cfg["gapMin"], "overlapMin": cfg["overlapMin"], "missingCoveragePct": cfg["missingCoveragePct"],
        "smartRunDays": cfg["smartRunDays"], "auto": gsjs.js_str(cfg.get("auto") or "on"),
        "source": {k: gsjs.str_(src.get(k)) for k in ("mode", "spreadsheetId", "punchesTab", "staffMapTab",
                                                       "clientMapTab")},
        "meanings": dict(MEANINGS)}}


def shifts_for_date(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconShiftsForDate: one day at one place — the shifts its house calendars planned there, PsiAnywhere's punches
    there, and `elsewhere`: the punches that day at other houses of the people planned there (where a missing shift's
    person was instead)."""
    refused = read_refused(sess)
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    refused = params_refused("reconShiftsForDate", p)
    if refused:
        return refused
    reads = sess.reads
    day, place = s_(p.get("date")), s_(p.get("location"))
    if PP.day_of(day) is None:
        return {"status": 400, "message": "date must be a day written yyyy-mm-dd."}
    planned = RO.load_shifts(reads, day, day, place)
    worked = sorted(PSI.punches(reads, day, day), key=lambda x: (x["startMin"] is None, x["startMin"] or 0))
    punches = [{"employeeId": x["employeeId"], "employeeName": x["employeeName"], "startTime": x["startTime"],
                "endTime": x["endTime"], "hours": D.num(x["hours"]), "consumers": x["consumers"]}
               for x in worked if x["location"] == place]
    people = {x["matchKey"] for x in planned}
    elsewhere = [{"employeeName": x["employeeName"], "location": x["location"], "startTime": x["startTime"],
                  "endTime": x["endTime"]} for x in worked
                 if x["matchKey"] in people and x["location"] not in (place, D.NOT_FOUND)]
    shifts = [{"employeeId": x["employeeId"], "employeeName": x["employeeName"], "startTime": x["startTime"],
               "endTime": x["endTime"], "raw": x["raw"]} for x in planned]
    return {"status": 200, "data": {"date": day, "location": place, "shifts": shifts, "punches": punches,
                                    "elsewhere": elsewhere}}


AI_ASK = ("You are helping a home-care agency operations manager reconcile a time report against the planned roster. "
          "Suggest in 1-2 plain factual sentences how to resolve this discrepancy (what to check, who to confirm "
          "with, or the likely explanation). Do not invent facts beyond the record. Answer with JSON: "
          '{"suggestion": "..."}\n\n')


def ai_suggest(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconAiSuggest: the model proposes how one error might be resolved — shown, never written as a resolution."""
    p = payload if isinstance(payload, dict) else {}
    refused = admin_gate(sess, "reconAiSuggest", p)
    if refused:
        return refused
    rid = s_(p.get("errorId"))
    row = next((r for r in rows(sess.reads, ERRORS_TAB) if gsjs.or_blank(r.get("id")) == rid), None)
    if row is None:
        return {"status": 404, "message": "No recon error with that id"}
    ask = (AI_ASK + "Error type: " + s_(row.get("type")) + "\nDate: " + stored_day(row.get("date")) + "\nLocation: "
           + s_(row.get("location")) + "\nEmployee: " + s_(row.get("employeeName")) + "\nConsumers: "
           + s_(row.get("consumers")) + "\nStart: " + stored_time(row.get("startTime")) + "  End: "
           + stored_time(row.get("endTime")) + "  Hours: " + s_(row.get("hours")) + "\nDetail: " + s_(row.get("detail")))
    content, via = HL.answer(ask)
    if not content:
        return {"status": 502, "message": "AI suggestion failed: " + (via or "no provider")}
    try:
        parsed = json.loads(re.sub(r"^```(?:json)?|```$", "", content.strip()).strip())
        suggestion = s_(parsed.get("suggestion")) if isinstance(parsed, dict) else ""
    except (ValueError, RecursionError):
        suggestion = s_(content)
    if not suggestion:
        return {"status": 502, "message": "AI returned an empty suggestion"}
    return {"status": 200, "data": {"suggestion": suggestion}}


# ---- the prepares: the heavy half of each write, read first by the relay -------------------------------------------

def upload_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconUploadReport's reading: the report kept on the server, parsed, cleaned, placed and resolved."""
    p = payload if isinstance(payload, dict) else {}
    refused = admin_gate(sess, "reconUploadReport", p)
    if refused:
        return refused
    reads = sess.reads
    b64 = gsjs.or_text(p.get("contentBase64"))
    if not b64:
        return {"status": 400, "message": "No file attached"}
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return {"status": 400, "message": "The file is not valid base64"}
    if not data:
        return {"status": 400, "message": "The file is empty"}
    if len(data) > REP.REPORT_MAX:
        return {"status": 400, "message": "The file is over 15MB"}
    filename = gsjs.trim(gsjs.or_text(p.get("filename")) or "location-report")
    try:
        fid, path = REP.keep(data, filename, reads.now)
    except OSError as exc:
        return {"status": 502, "message": f"Could not archive the report: {type(exc).__name__}"}
    try:
        got = REP.report_rows(reads, data, filename)
    except ValueError as exc:
        return {"status": 400, "message": f"Could not parse the report: {exc}"}
    cleaned = REP.clean_report_rows(got, REP.client_house_map(reads))
    if not cleaned:
        return {"status": 400, "message": "No punch rows found in that report"}
    shaped = REP.shape_punches(reads, cleaned, fid)
    return {"status": 200, "data": seal("reconUploadReport", actor(sess.user), {**shaped, "fileId": fid,
                                                                                "path": path})}


def _already(source: dict, period: dict, file_id: str) -> dict[str, Any]:
    return {"answer": {"alreadyImported": True, "source": source, "entries": 0, "locations": [], "unmapped": [],
                       "period": period, "fileId": file_id}}


def _master(reads: L.Reads, cfg: dict) -> dict[str, Any]:
    """reconImportMasterSheet_: the master workbook's tabs read off asa-hub-db, never off Google."""
    src = cfg["source"]
    sid, tab = s_(src.get("spreadsheetId")), s_(src.get("punchesTab"))
    if not sid or reads.db.book(sid) is None:
        return {"status": 502, "message": "The master reconciliation workbook (" + sid + ") is not in the Hub's "
                                          "database — check the ID."}
    reads.db.note_book(sid)
    ref = reads.db.tab(sid, tab)
    if ref is None:
        return {"status": 502, "message": 'The "' + tab + '" tab is missing from the master reconciliation workbook'}
    client_map = REP.client_house_map(reads)
    cm = reads.db.tab(sid, s_(src.get("clientMapTab")))
    if cm is not None:
        client_map.update(REP.master_client_map(cm, reads.db.rows(cm)))
    sm = reads.db.tab(sid, s_(src.get("staffMapTab")))
    names = REP.staff_map(sm, reads.db.rows(sm)) if sm is not None else None
    cleaned = REP.master_rows(ref, reads.db.rows(ref), client_map)
    if not cleaned:
        return {"status": 400, "message": 'No punch rows found in the "' + tab + '" tab'}
    source_file = "master:" + tab
    held = rows(reads, PUNCHES_TAB)
    keys = {s_(r.get("sourceKey")) for r in held if s_(r.get("sourceFile")) == source_file and s_(r.get("sourceKey"))}
    fresh, skipped = REP.filter_new(cleaned, keys)
    source = {"fileId": sid, "name": "MASTER TIME RECONCILIATION — " + tab, "modifiedTime": gsjs.iso(reads.now)}
    if not fresh:
        return {"status": 200, "data": _already(source, REP.find_import(held, source_file)["period"], sid)}
    return {"status": 200, "data": {"mode": "master", "sourceFile": source_file, "source": source, "fileId": sid,
                                    "skipped": skipped, **REP.shape_punches(reads, fresh, source_file, names)}}


def _legacy(reads: L.Reads, p: dict) -> dict[str, Any]:
    """reconImportLegacyFolder_: the newest report of the legacy portal's Drive folder (or the one named), read as an
    upload is."""
    folder = s_(reads.db.prop("RECON_LEGACY_FOLDER_ID"))
    drv = reads.need_drive()
    try:
        drv.file(folder, "id,trashed")
    except Exception:  # noqa: BLE001 - said as Apps Script said it
        return {"status": 502, "message": "The legacy report archive is not accessible by its folder ID (" + folder
                                          + ") from this account — check the ID and the sharing."}
    fields = "id,name,mimeType,modifiedTime,trashed"
    wanted = s_(p.get("fileId"))
    if wanted:
        try:
            meta = drv.file(wanted, fields)
        except Exception:  # noqa: BLE001 - not accessible is not here
            meta = None
        if not meta or meta.get("trashed"):
            return {"status": 404, "message": "No accessible report file with id " + wanted}
    else:
        meta = None
        try:
            files = drv.children(folder, False, "id,name,mimeType,modifiedTime")
        except Exception:  # noqa: BLE001 - said as Apps Script said it
            return {"status": 502, "message": "The legacy report archive is not accessible by its folder ID ("
                                              + folder + ") from this account — check the ID and the sharing."}
        for f in files:
            if meta is None or s_(f.get("modifiedTime")) > s_(meta.get("modifiedTime")):
                meta = f
        if meta is None:
            return {"status": 404, "message": "The legacy report archive is empty"}
    fid, name, mime = s_(meta.get("id")), s_(meta.get("name")), s_(meta.get("mimeType"))
    source = {"fileId": fid, "name": name, "modifiedTime": s_(meta.get("modifiedTime"))}
    prior = REP.find_import(rows(reads, PUNCHES_TAB), fid)
    if prior["found"]:
        return {"status": 200, "data": _already(source, prior["period"], fid)}
    try:
        if mime.startswith(dr.GOOGLE_NATIVE):
            text = drv.export(fid, "text/csv", REP.REPORT_MAX).decode("utf-8", "replace")
            data = b""
        else:
            data, text = drv.media(fid, REP.REPORT_MAX), ""
    except Exception as exc:  # noqa: BLE001 - said as Apps Script said it
        return {"status": 502, "message": f"Could not download the report file: {type(exc).__name__}"}
    try:
        got = REP.converted_rows(text) if not data else REP.report_rows(reads, data, name)
    except ValueError as exc:
        return {"status": 400, "message": f"Could not parse the report: {exc}"}
    cleaned = REP.clean_report_rows(got, REP.client_house_map(reads))
    if not cleaned:
        return {"status": 400, "message": "No punch rows found in that report"}
    return {"status": 200, "data": {"mode": "legacy", "source": source, "fileId": fid,
                                    **REP.shape_punches(reads, cleaned, fid)}}


def import_prepared(reads: L.Reads, p: dict) -> dict[str, Any]:
    """reconImportLatest's reading: the source the reconThresholds row chooses."""
    cfg = config(reads)
    if gsjs.js_str(cfg["source"].get("mode")).lower() == "legacyfolder":
        return _legacy(reads, p)
    return _master(reads, cfg)


def import_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconImportLatest's reading, read first by the relay."""
    p = payload if isinstance(payload, dict) else {}
    refused = admin_gate(sess, "reconImportLatest", p)
    if refused:
        return refused
    env = import_prepared(sess.reads, p)
    if env.get("status") == 200:
        env["data"] = seal("reconImportLatest", actor(sess.user), env["data"])
    return env


def run_range(p: dict, today: date) -> tuple[str, str] | dict[str, Any]:
    """The days a run covers: dateFrom to dateTo as asked, or — both left out — the pay period holding today. One end
    alone, a day not written yyyy-mm-dd, a range backwards or longer than MAX_RUN_DAYS is refused in plain words."""
    a_said, b_said = s_(p.get("dateFrom")).strip(), s_(p.get("dateTo")).strip()
    if not a_said and not b_said:
        cur = PP.period(today, today)
        return cur["from"], cur["to"]
    if not a_said or not b_said:
        return {"status": 400, "message": "Give both dateFrom and dateTo, or neither for the current pay period."}
    a, b = PP.day_of(a_said), PP.day_of(b_said)
    if a is None or b is None:
        return {"status": 400, "message": "dateFrom and dateTo must be days written yyyy-mm-dd."}
    if a > b:
        return {"status": 400, "message": f"dateFrom ({a.isoformat()}) is after dateTo ({b.isoformat()})."}
    days = (b - a).days + 1
    if days > MAX_RUN_DAYS:
        return {"status": 400, "message": f"A run covers one pay period, {MAX_RUN_DAYS} days at most: "
                                          f"{a.isoformat()}–{b.isoformat()} is {days} days."}
    return a.isoformat(), b.isoformat()


def period_label(day_from: str, day_to: str) -> str:
    """PsiAnywhere's text for [day_from, day_to] when it is exactly one of its pay periods, else ''."""
    a = PP.day_of(day_from)
    if a is None:
        return ""
    per = PP.period(a)
    return per["label"] if per["from"] == day_from and per["to"] == day_to else ""


def record_as_of(reads: L.Reads) -> datetime:
    """The moment a run judges at (New York's clock): now — or, when PsiAnywhere's record last changed before now, that
    change (its newest entry written or patched). The record is read a few times a day, so a shift that ended after
    the last read is judged by the next run, never against clock-ins nobody has read yet."""
    now = reads.now.astimezone(PP.NEW_YORK)
    got = reads.db.query("select max(updated_at) from app.resource_rows where resource = %s", (PSI.PUNCHES,))
    last = got[0][0] if got else None
    if not isinstance(last, datetime):
        return now
    last = (last if last.tzinfo is not None else last.replace(tzinfo=timezone.utc)).astimezone(PP.NEW_YORK)
    return min(now, last)


def run_prepared(reads: L.Reads, p: dict) -> dict[str, Any]:
    """reconRun's detections over one pay period (the current one unless dateFrom and dateTo say another range):
    PsiAnywhere's punches of those days (app/recon_psi.py) against the planned roster of the same days, the missing
    shifts and ends judged as of the record's last read (record_as_of: the current period holds today, still in
    progress). The workbook's punches (timePunches) are never read: a run is PsiAnywhere's record or nothing."""
    got = run_range(p, PP.today_ny(reads.now))
    if isinstance(got, dict):
        return got
    day_from, day_to = got
    cfg = config(reads)
    punches = PSI.punches(reads, day_from, day_to)
    if not punches:
        return {"status": 400, "message": f"PsiAnywhere has no entries on file for {day_from}–{day_to} yet."}
    as_of = record_as_of(reads)
    found = D.detect_all(punches, RO.load_shifts(reads, day_from, day_to), cfg, as_of)
    counts = {k: len(found[k]) for k in TYPES}
    errors = [{f: e.get(f) for f in ERROR_FIELDS} for k in TYPES for e in found[k]]
    return {"status": 200, "data": {"run": {"dateFrom": day_from, "dateTo": day_to, **counts,
                                            "total": sum(counts.values()), "suppressed": found["suppressed"],
                                            "source": SOURCE, "period": period_label(day_from, day_to),
                                            "asOf": as_of.isoformat(timespec="seconds")},
                                    "errors": errors}}


def run_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconRun's reading, read first by the relay."""
    p = payload if isinstance(payload, dict) else {}
    refused = admin_gate(sess, "reconRun", p)
    if refused:
        return refused
    env = run_prepared(sess.reads, p)
    if env.get("status") == 200:
        env["data"] = seal("reconRun", actor(sess.user), env["data"])
    return env


def last_auto(reads: L.Reads) -> float | None:
    """When the auto run last ran (reconAutoRecord's mark)."""
    got = reads.db.query(f"select extract(epoch from ran_at) from {AUTO_TABLE} where id = 1")
    return float(got[0][0]) if got and got[0][0] is not None else None


def auto_periods(today: date) -> list[dict[str, Any]]:
    """The pay periods the daily run covers: the previous one (late punches and edits still land in it) and the
    current one, oldest first."""
    cur = PP.period(today, today)
    return [PP.period(date.fromisoformat(cur["from"]) - timedelta(days=1), today), cur]


def auto_sweep(sess: L.Session, payload: dict) -> dict[str, Any]:
    """reconAutoSweep_ (the relay's clock): while the auto run is on and has not run in 20 hours, a run prepared over
    the previous and over the current pay period from PsiAnywhere's record — one refused (no entries yet) kept with its
    words; reconAutoRecord keeps each run that was found and the mark. Nothing is imported any more."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    if not auto_on(reads):
        return {"status": 200, "data": {"due": False, "why": "the daily auto run is off"}}
    at = last_auto(reads)
    if at is not None and time.time() - at < AUTO_EVERY_S:
        return {"status": 200, "data": {"due": False, "why": "ran at " + gsjs.iso(datetime.fromtimestamp(
            at, timezone.utc))}}
    runs = [{"period": per["id"], **run_prepared(reads, {"dateFrom": per["from"], "dateTo": per["to"]})}
            for per in auto_periods(PP.today_ny(reads.now))]
    return {"status": 200, "data": seal("reconAutoSweep", "service", {"due": True, "runs": runs})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "reconRuns": recon_runs, "reconErrors": recon_errors, "reconConfigGet": recon_config_get,
    "reconShiftsForDate": shifts_for_date, "reconAiSuggest": ai_suggest, "reconUploadPrepare": upload_prepare,
    "reconImportPrepare": import_prepare, "reconRunPrepare": run_prepare, "reconAutoSweep": auto_sweep,
}
# the roles are each door's own gate (an edition lets its people in beside them)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
