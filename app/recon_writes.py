"""Time Reconciliation's writes (apps-script/Recon.gs): the punches, the runs and the errors kept in Postgres
(app.resource_rows) once reconUpload has brought their tabs there — an error resolved, reopened or queued for a reminder,
a run closed, an upload's or an import's punches (kept, though no run reads them now), a run with its errors
(superseding what earlier runs found on its days, their resolutions carried) — and the thresholds saved on the shared
finance_config tab through app.edits. Each heavy write only records what its prepare read made (app/recon.py); a run
and a reminder raise nothing themselves: their rows are the queue the Smart Comms event lane reads."""
from __future__ import annotations

import json
import logging
import math
import re
import time
from typing import Any, Callable

import client_writes as CW
import gsjs
import locations as L
import mail_designs as MD
import recon as R
import recon_report as REP
import resource_rows as RR
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Somebody else is changing Time Reconciliation right now — try again."
WRITERS_ONLY = R.WRITERS_ONLY
ADMIN_ONLY = "This action is for admin."
SAVED = "In force on the next run — no deploy, no sheet."
STALE = "What was read for this change is out of date or was not read here, so nothing was written. Try again."
# HUB_POLICY params, in declaration order: (key, required, type)
PARAMS = {"reconErrorResolve": (("errorId", True, "string"), ("status", True, "string"), ("note", False, "string")),
          "reconRunClose": (("runId", True, "string"), ("status", True, "string")),
          "reconConfigSet": ()}
# commSituationId_('recon.punch_reminder', 'recon_punch_reminder')
REMIND_SITUATION = ("recon.punch_reminder", "recon_punch_reminder")
PUNCH_FIELDS = ("date", "employeeRaw", "employeeId", "employeeName", "workCode", "start", "end", "totalHours",
                "consumers", "location", "sourceFile")

s_ = gsjs.str_


def js_parse_int(v: Any) -> float:
    """parseInt(v, 10)."""
    m = re.match(r"^[+-]?\d+", gsjs.trim(gsjs.or_blank(v)))
    return float(int(m.group(0))) if m else math.nan


def _params(action: str, p: dict) -> dict[str, Any] | None:
    """hubPolicyGate_'s params, after the roles."""
    for key, required, kind in PARAMS[action]:
        val = p.get(key)
        missing = val is None or (isinstance(val, str) and val == "")
        if required and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and R.js_type(val) != kind:
            return {"status": 400, "message": f"{key} must be {kind}, got {R.js_type(val)}."}
    return None


def _writer_gate(sess: L.Session, action: str, p: dict, eid: str) -> tuple[dict | None, str]:
    """The writers' roles (an edition's people beside them), the params, then hubIsWriter_; the edition that let in."""
    user = sess.user or {}
    service = user.get("is_service") is True
    by_edition = not service and not R.writer(user) and R.edition_holds(sess, eid)
    # a badge Scheduling's Time Reconciliation row names decides as its readers do (the operator's badges, 10-30)
    by_badge = not service and not R.writer(user) and not by_edition and R.badge_opens(sess)
    if not service and gsjs.js_str(user.get("role")) not in ("admin", "manager") and not by_edition and not by_badge:
        return {"status": 403, "message": WRITERS_ONLY}, ""
    refused = _params(action, p)
    if refused:
        return refused, ""
    if not R.writer(user) and not by_edition and not by_badge:
        return CW.denied(), ""
    return None, eid if by_edition else ""


def _update(reads: L.Reads, tab: str, rid: str, patch: dict, edition: str
            ) -> tuple[dict[str, Any] | None, dict | None, tuple]:
    """updateRowById_ on the copy: the row merged with the patch and updatedAt, kept as its changed cells; or its
    refusal."""
    fresh = R.books(reads, tab)
    if not rid:
        return {"status": 400, "message": 'Missing required "id" in payload.'}, None, fresh
    row = next((r for r in R.rows(reads, tab) if gsjs.or_blank(r.get("id")) == rid), None)
    if row is None:
        return {"status": 404, "message": f'No "{tab}" record with id "{rid}".'}, None, fresh
    now = W.now_iso(reads)
    cells = {**{k: v for k, v in patch.items() if k != "createdAt"}, "updatedAt": now}
    merged = {**row, **cells}
    res = W.tab_of(reads, tab)
    if res.ref is None:
        raise Defer(f"{tab} holds no tab in the copy")
    if any(k not in res.ref.headers for k in cells):
        raise Defer(f"a change naming a column {tab} does not have")
    W.gate(reads)
    sid, name = W.where_of(res)
    was = next((r for r in R.raw_rows(reads, tab) if r.get("id") == rid), {})
    rec = W.kept_record(sid, name, "edit", "id", rid, rid, cells, before={k: was.get(k, "") for k in cells},
                        edition=edition)
    return None, {"merged": merged, "rec": rec}, fresh


def _kept(answer: dict[str, Any], edits: list[dict], subject: str, fresh: tuple[str, ...], edition: str) -> Decision:
    d = W.final(answer, edits, subject, edition)
    d.fresh = fresh
    return d


def _changed(sess: L.Session, tab: str, rid: str, patch: dict, edition: str,
             answer_of: Callable[[dict], dict[str, Any]]) -> Decision:
    """updateRowById_: in Postgres once the tab is kept there (a column the patch names added), else on the copy
    through app.edits."""
    reads = sess.reads
    resource = R.kept(reads, tab)
    if not resource:
        no, got, fresh = _update(reads, tab, rid, patch, edition)
        if no:
            return W.refuse(no["status"], no["message"], fresh=fresh)
        return _kept(answer_of(got["merged"]), [got["rec"]], rid, fresh, edition)
    if not rid:
        return W.refuse(400, 'Missing required "id" in payload.')
    hit = RR.find(reads, resource, rid)
    if hit is None:
        return W.refuse(404, f'No "{tab}" record with id "{rid}".')
    key, cells = hit
    row = RR.shown(RR.columns(reads, resource), cells) or {}
    changed = {**{k: v for k, v in patch.items() if k != "createdAt"}, "updatedAt": W.now_iso(reads)}
    RR.update(reads, resource, key, cells, {k: W.sheet_text(v) for k, v in changed.items()},
              s_((sess.user or {}).get("email")))
    return Decision(answer_of({**row, **changed}), edition=edition, subject=rid, own=True)


def error_resolve(sess: L.Session, payload: dict) -> Decision:
    """reconErrorResolve: a durable record — the error is resolved (or reopened), never deleted."""
    p = payload if isinstance(payload, dict) else {}
    refused, edition = _writer_gate(sess, "reconErrorResolve", p, R.EDITION["review"])
    if refused:
        return Decision(refused)
    user = sess.user or {}
    status = gsjs.str_(p.get("status"))
    if status not in R.ERROR_STATUSES:
        return W.refuse(400, "status must be one of " + ", ".join(R.ERROR_STATUSES))
    patch: dict[str, Any] = {"status": status}
    if status == "Open":
        patch.update(resolvedBy="", resolvedAt="")
    else:
        patch.update(resolvedBy="asa-hub:" + gsjs.str_(user.get("email")), resolvedAt=W.now_iso(sess.reads))
    note = p.get("note")
    if note is not None and gsjs.js_str(note) != "":
        patch["note"] = gsjs.js_str(note)
    return _changed(sess, R.ERRORS_TAB, gsjs.str_(p.get("errorId")), patch, edition,
                    lambda merged: {"status": 200, "data": {"error": merged}})


def run_close(sess: L.Session, payload: dict) -> Decision:
    """reconRunClose: a run marked reviewed, or back to review."""
    p = payload if isinstance(payload, dict) else {}
    refused, edition = _writer_gate(sess, "reconRunClose", p, R.EDITION["review"])
    if refused:
        return Decision(refused)
    status = gsjs.str_(p.get("status"))
    if status not in R.RUN_STATUSES:
        return W.refuse(400, "status must be one of " + ", ".join(R.RUN_STATUSES))
    return _changed(sess, R.RUNS_TAB, gsjs.str_(p.get("runId")), {"status": status}, edition,
                    lambda merged: {"status": 200, "data": {"run": merged}})


def _int_of(v: Any) -> Any:
    """A threshold as JSON.stringify writes it."""
    return int(v) if isinstance(v, float) and v == int(v) else v


def config_set(sess: L.Session, payload: dict) -> Decision:
    """reconConfigSet: the four thresholds checked here, never trusted from a form; the source never from the screen."""
    user = sess.user or {}
    service = user.get("is_service") is True
    # Settings › Time Reconciliation is the master's and the Platform Lead's; recon.settings adds its people
    admin = gsjs.js_str(user.get("role")) == "admin" and R.sc.settings_lead(user)
    by_edition = not service and not admin and R.edition_holds(sess, R.EDITION["settings"])
    if not service and not admin and not by_edition:
        return Decision({"status": 403, "message": ADMIN_ONLY})
    if service:
        return Decision(CW.denied())
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    cfg = R.config(reads)

    def num(name: str, lo: int, hi: int, cur: Any) -> Any:
        if name not in p:
            return cur
        v = js_parse_int(p[name])
        if math.isnan(v) or v < lo or v > hi:
            raise ValueError(f"{name} must be a whole number between {lo} and {hi}.")
        return int(v)
    try:
        nxt: dict[str, Any] = {"gapMin": num("gapMin", 1, 240, cfg["gapMin"]),
                               "overlapMin": num("overlapMin", 1, 480, cfg["overlapMin"]),
                               "missingCoveragePct": num("missingCoveragePct", 1, 100, cfg["missingCoveragePct"]),
                               "smartRunDays": num("smartRunDays", 1, 30, cfg["smartRunDays"])}
    except ValueError as exc:
        return W.refuse(400, str(exc))
    if "auto" in p:
        nxt["auto"] = "off" if gsjs.js_str(p.get("auto")).lower() == "off" else "on"
    elif cfg.get("auto"):
        nxt["auto"] = cfg["auto"]
    nxt["source"] = cfg["source"]
    nxt = {k: _int_of(v) for k, v in nxt.items()}
    value = json.dumps(nxt, separators=(",", ":"), ensure_ascii=False)
    edition = R.EDITION["settings"] if by_edition else ""
    answer = {"status": 200, "data": {"saved": True, "config": nxt, "message": SAVED}}
    held = [r for r in R.rows(reads, R.CONFIG_TAB) if gsjs.str_(r.get("key")) == R.CONFIG_KEY]
    resource = R.kept(reads, R.CONFIG_TAB)
    if held and resource:
        return _changed(sess, R.CONFIG_TAB, gsjs.str_(held[-1].get("id")), {"value": value}, edition,
                        lambda _row: answer)
    if resource:
        now = W.now_iso(reads)
        RR.create(reads, resource, {"key": R.CONFIG_KEY, "value": value, "id": W.mint(), "createdAt": now,
                                    "updatedAt": now}, gsjs.str_((sess.user or {}).get("email")))
        return Decision(answer, edition=edition, subject=R.CONFIG_KEY, own=True)
    if held:
        rid = gsjs.str_(held[-1].get("id"))
        no, got, fresh = _update(reads, R.CONFIG_TAB, rid, {"value": value}, edition)
        if no:
            return W.refuse(no["status"], no["message"], fresh=fresh)
        return _kept(answer, [got["rec"]], R.CONFIG_KEY, fresh, edition)
    fresh = R.books(reads, R.CONFIG_TAB)
    res = W.tab_of(reads, R.CONFIG_TAB)
    if res.ref is None:
        raise Defer("finance_config holds no tab in the copy")
    now = W.now_iso(reads)
    row = {"key": R.CONFIG_KEY, "value": value, "id": W.mint(), "createdAt": now, "updatedAt": now}
    if any(k not in res.ref.headers for k in row):
        raise Defer("a config row naming a column finance_config does not have")
    W.gate(reads)
    sid, name = W.where_of(res)
    rec = W.kept_record(sid, name, "append", "id", row["id"], R.CONFIG_KEY,
                        {h: row.get(h, "") for h in res.ref.headers if h}, edition=edition)
    return _kept(answer, [rec], R.CONFIG_KEY, fresh, edition)


# ---- the writes a prepare read made ready ---------------------------------------------------------------------------

def _prepared(sess: L.Session, door: str, p: dict, field: str = "") -> tuple[dict | None, Decision | None]:
    """What this write records: made by its prepare read just now, for this person; never asked for, the relay's to
    ask first."""
    if (field and p.get(field) != "kept") or p.get("prepared") is None:
        raise Defer(f"{door} is read by its prepare door first")
    got = R.unsealed(door, R.actor(sess.user), p.get("prepared"))
    return (got, None) if got is not None else (None, W.refuse(409, STALE))


def _punch_cells(rows: Any, by: str, now: str) -> list[dict[str, str]]:
    """reconStorePunches_'s rows, as createRow_ writes them: the fields, who brought them, the import's key, an id."""
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        cells = {k: W.sheet_text(r.get(k)) for k in PUNCH_FIELDS}
        cells["uploadedBy"] = by
        if s_(r.get("sourceKey")):
            cells["sourceKey"] = s_(r.get("sourceKey"))
        cells.update(id=W.mint(), createdAt=now, updatedAt=now)
        out.append(cells)
    return out


def _store_punches(reads: L.Reads, rows: Any, by: str, email: str) -> int:
    cells = _punch_cells(rows, by, W.now_iso(reads))
    return len(RR.create_many(reads, R.RESOURCE_OF[R.PUNCHES_TAB], cells, email))


def _store_import(reads: L.Reads, prep: dict, by: str, email: str) -> dict[str, Any]:
    """The import's punches stored, the source's idempotency asked again of the rows as they stand now."""
    held = R.rows(reads, R.PUNCHES_TAB)
    rows = [r for r in prep.get("rows") or [] if isinstance(r, dict)]
    fid = s_(prep.get("fileId"))
    if prep.get("mode") == "master":
        sf = s_(prep.get("sourceFile"))
        keys = {s_(r.get("sourceKey")) for r in held if s_(r.get("sourceFile")) == sf and s_(r.get("sourceKey"))}
        rows = [r for r in rows if not (s_(r.get("sourceKey")) and s_(r.get("sourceKey")) in keys)]
        prior = REP.find_import(held, sf)
        if not rows:
            return R._already(prep.get("source") or {}, prior["period"], fid)["answer"]
    else:
        prior = REP.find_import(held, fid)
        if prior["found"]:
            return R._already(prep.get("source") or {}, prior["period"], fid)["answer"]
    n = _store_punches(reads, rows, by, email)
    return {"alreadyImported": False, "source": prep.get("source") or {}, "entries": n,
            "locations": prep.get("locations") or [], "unmapped": prep.get("unmapped") or [],
            "period": prep.get("period") or {"from": "", "to": ""}, "fileId": fid}


def _count(v: Any) -> int:
    n = R._js_number(v)
    return int(n) if n == n and math.isfinite(n) else 0


def _live_in(reads: L.Reads, resource: str, field_from: str, field_to: str, day_from: str, day_to: str
             ) -> list[tuple[str, dict]]:
    """(row_key, cells) of a resource's live rows whose [field_from, field_to] days lie inside [day_from, day_to], read
    through the write's own cursor (a stamp keeps its day in its first ten characters)."""
    got = RR._q(reads, f"select row_key, cells from {RR.rows_of(resource)} where resource = %s and removed_at is null"
                       " and coalesce(cells->>%s, '') <> '' and coalesce(cells->>%s, '') <> ''"
                       " and left(cells->>%s, 10) >= %s and left(cells->>%s, 10) <= %s",
                (resource, field_from, field_to, field_from, day_from, field_to, day_to))
    return [(k, c if isinstance(c, dict) else json.loads(c or "{}")) for k, c in got]


def _carried_from(old: list[tuple[str, dict]]) -> tuple[dict[str, dict], dict[str, dict], dict[str, str]]:
    """The superseded rows by anomaly key (computed from their fields when they carry none): the latest resolution
    (a status other than Open), the latest reminder queued, and the id the anomaly goes on by — the reminded row's
    (Smart Comms keys a punch reminder by the error's id and its queued stamp: a new id would text the person again
    after every run), else the resolved one's, else the newest."""
    resolved: dict[str, dict] = {}
    reminded: dict[str, dict] = {}
    newest: dict[str, dict] = {}
    for _k, c in sorted(old, key=lambda kc: s_(kc[1].get("createdAt"))):
        key = s_(c.get("key")) or R.anomaly_key(c)
        newest[key] = c
        if s_(c.get("status")) and s_(c.get("status")) != "Open":
            resolved[key] = c
        if s_(c.get("reminderQueuedAt")):
            reminded[key] = c
    ids = {key: s_((reminded.get(key) or resolved.get(key) or c).get("id")) for key, c in newest.items()}
    return resolved, reminded, {k: v for k, v in ids.items() if v}


def _store_run(reads: L.Reads, prep: dict, by: str, email: str) -> dict[str, Any]:
    """reconRun's writes, in one transaction: the days the run covers made its own. Every live error of those days
    (from any earlier run) is superseded — soft-removed, "superseded by run <id>", logged so a void brings it back — as
    is every earlier run lying wholly inside them; then the run, then each error it found: Open, unless the same
    anomaly (recon.anomaly_key) was resolved before, whose status, note and resolver it carries; a reminder queued for
    it is carried whatever its status, and an anomaly still there keeps its id. Rows outside the run's days are never
    touched, so nothing is found twice and no resolution is lost to a re-run."""
    run = prep.get("run") if isinstance(prep.get("run"), dict) else {}
    now = W.now_iso(reads)
    rid = W.mint()
    day_from, day_to = s_(run.get("dateFrom")), s_(run.get("dateTo"))
    err_res, run_res = R.RESOURCE_OF[R.ERRORS_TAB], R.RESOURCE_OF[R.RUNS_TAB]
    why = f"superseded by run {rid}"
    old_errors = _live_in(reads, err_res, "date", "date", day_from, day_to) if day_from and day_to else []
    old_runs = _live_in(reads, run_res, "dateFrom", "dateTo", day_from, day_to) if day_from and day_to else []
    resolved, reminded, ids = _carried_from(old_errors)
    RR.remove_many(reads, err_res, old_errors, email, why)
    RR.remove_many(reads, run_res, old_runs, email, why)
    counts = {k: _count(run.get(k)) for k in R.TYPES}
    suppressed = _count(run.get("suppressed"))
    errors, carried = [], 0
    for e in prep.get("errors") or []:
        if not isinstance(e, dict):
            continue
        key = R.anomaly_key(e)
        # an anomaly still there goes on under its id (one new row per old id), so a card, a link or a reminder held
        # on it still finds it; the superseded row keeps the id only in history
        rec = {"runId": rid, **{f: e.get(f) for f in R.ERROR_FIELDS}, "key": key, "status": "Open", "note": "",
               "resolvedBy": "", "resolvedAt": "", "id": ids.pop(key, "") or W.mint(), "createdAt": now,
               "updatedAt": now}
        was = resolved.get(key)
        if was is not None:
            rec.update({f: s_(was.get(f)) for f in ("status", "note", "resolvedBy", "resolvedAt")})
            carried += 1
        sent = reminded.get(key)
        if sent is not None:
            rec.update({f: s_(sent.get(f)) for f in ("reminderQueuedAt", "reminderQueuedBy", "reminderPhone")})
        errors.append({k: W.sheet_text(v) for k, v in rec.items()})
    cells = {"dateFrom": day_from, "dateTo": day_to, **counts, "total": sum(counts.values()),
             "suppressed": suppressed, "carried": carried, "source": s_(run.get("source")) or R.SOURCE,
             "status": "Review", "createdBy": by, "id": rid, "createdAt": now, "updatedAt": now}
    RR.create(reads, run_res, {k: W.sheet_text(v) for k, v in cells.items()}, email)
    RR.create_many(reads, err_res, errors, email)
    return {"runId": rid, "counts": counts, "suppressed": suppressed, "carried": carried,
            "period": s_(run.get("period")), "superseded": {"errors": len(old_errors), "runs": len(old_runs)}}


def upload_report(sess: L.Session, payload: dict) -> Decision:
    """reconUploadReport: the punches reconUploadPrepare read off the report kept on the server, each a time_punches
    row."""
    p = payload if isinstance(payload, dict) else {}
    refused = R.admin_gate(sess, "reconUploadReport", p)
    if refused:
        return Decision(refused)
    prep, stale = _prepared(sess, "reconUploadReport", p, "contentBase64")
    if stale:
        return stale
    email = s_((sess.user or {}).get("email"))
    n = _store_punches(sess.reads, prep.get("rows"), "asa-hub:" + email, email)
    log.info("recon_upload: %s punches, %s unmapped, file %s", n, len(prep.get("unmapped") or []), prep.get("fileId"))
    return Decision({"status": 200, "data": {"entries": n, "locations": prep.get("locations") or [],
                                             "unmapped": prep.get("unmapped") or [],
                                             "period": prep.get("period") or {"from": "", "to": ""},
                                             "fileId": s_(prep.get("fileId"))}}, subject="", own=True)


def import_latest(sess: L.Session, payload: dict) -> Decision:
    """reconImportLatest: what reconImportPrepare read (the master workbook's new rows, or the legacy folder's newest
    report not stored before) kept as punches; a source already stored is the answer, not a re-write."""
    p = payload if isinstance(payload, dict) else {}
    refused = R.admin_gate(sess, "reconImportLatest", p)
    if refused:
        return Decision(refused)
    prep, stale = _prepared(sess, "reconImportLatest", p)
    if stale:
        return stale
    if isinstance(prep.get("answer"), dict):
        return Decision({"status": 200, "data": prep["answer"]}, subject="", own=True)
    email = s_((sess.user or {}).get("email"))
    data = _store_import(sess.reads, prep, "asa-hub:import-latest:" + email, email)
    log.info("recon_import: %s punches (%s already on file), %s unmapped", data["entries"], prep.get("skipped", 0),
             len(data["unmapped"]))
    return Decision({"status": 200, "data": data}, subject="", own=True)


def run(sess: L.Session, payload: dict) -> Decision:
    """reconRun: the run reconRunPrepare found over one pay period of PsiAnywhere's record, superseding what earlier
    runs found on those days (_store_run); the Smart Comms event lane reads the run (recon_errors_found) from here —
    nothing is sent by this door."""
    p = payload if isinstance(payload, dict) else {}
    refused = R.admin_gate(sess, "reconRun", p)
    if refused:
        return Decision(refused)
    prep, stale = _prepared(sess, "reconRun", p)
    if stale:
        return stale
    email = s_((sess.user or {}).get("email"))
    data = _store_run(sess.reads, prep, "asa-hub:" + email, email)
    log.info("recon_run: %s: %s errors (%s suppressed, %s resolutions carried, %s errors superseded)", data["runId"],
             sum(data["counts"].values()), data["suppressed"], data["carried"], data["superseded"]["errors"])
    return Decision({"status": 200, "data": data}, subject="", own=True)


def mask_phone(phone: Any) -> str:
    """reconMaskPhone_: the last four digits and nothing else."""
    digits = re.sub(r"\D", "", gsjs.or_blank(phone))
    return "(***) ***-****" if len(digits) < 4 else "(***) ***-" + digits[-4:]


def reminder_refusal(row: dict | None, phone: str) -> str:
    """reconReminderRefusal_."""
    if not row:
        return "not found"
    if s_(row.get("type")) not in ("missing", "noEnd"):
        return "type"
    if not s_(row.get("employeeId")) or not phone:
        return "no phone"
    return ""


def reminder_on(reads: L.Reads) -> bool:
    """reconReminderSituationOn_: the situation the binding names (recon_punch_reminder by default) switched on."""
    try:
        sits = SC.read_situations(reads.db)
        sid = MD.situation_id(reads, sits, *REMIND_SITUATION)
        sit = next((s for s in sits if gsjs.or_blank(s.get("id")) == sid), None)
        return sit is not None and SC.smart_on(sit.get("enabled"))
    except Exception:  # noqa: BLE001 - unread is off
        return False


def error_remind(sess: L.Session, payload: dict) -> Decision:
    """reconErrorRemind: a missing or no-clock-out error queued for its person — reminderQueuedAt stamped with the
    phone the people tab holds; the Smart Comms event lane (recon_punch_reminder) texts from that row."""
    p = payload if isinstance(payload, dict) else {}
    refused = R.admin_gate(sess, "reconErrorRemind", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    rid = s_(p.get("errorId"))
    resource = R.kept(reads, R.ERRORS_TAB)
    if resource:
        hit = RR.find(reads, resource, rid) if rid else None
        row = RR.shown(RR.columns(reads, resource), hit[1]) if hit else None
    else:
        row = next((r for r in R.rows(reads, R.ERRORS_TAB) if gsjs.or_blank(r.get("id")) == rid), None)
    if row is None:
        return W.refuse(404, "No recon error with that id")
    phone = ""
    who = s_(row.get("employeeId"))
    if who:
        person = next((x for x in reads.hub_rows("people") if s_(x.get("id")) == who), None)
        phone = s_(person.get("phone")) if person else ""
    why = reminder_refusal(row, phone)
    if why == "type":
        return W.refuse(422, "Only missing and noEnd errors go to the person — managers fix overlaps, people fix "
                             "punches")
    if why == "no phone":
        return W.refuse(422, "No phone on file — resolve the identity first")
    if not reminder_on(reads):
        return Decision({"status": 200, "data": {"reminded": False, "reason": "situation disabled"}})
    patch = {"reminderQueuedAt": W.now_iso(reads),
             "reminderQueuedBy": "asa-hub:" + s_((sess.user or {}).get("email")), "reminderPhone": phone}
    return _changed(sess, R.ERRORS_TAB, s_(row.get("id")), patch, "",
                    lambda _m: {"status": 200, "data": {"reminded": True, "to": mask_phone(phone)}})


def auto_record(sess: L.Session, payload: dict) -> Decision:
    """reconAutoSweep_'s writes, after reconAutoSweep prepared them on the relay's clock: each pay period's run that was
    found (the previous, then the current) stored as a run is (_store_run: superseding that period's earlier rows,
    carrying its resolutions), and the mark that holds the next pass for 20 hours — stamped whatever the runs said,
    with what each said ("P2026-10-11: 210 error(s); P2026-10-25: 95 error(s)")."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("reconAutoRecord is read by reconAutoSweep first")
    prep = R.unsealed("reconAutoSweep", "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    if prep.get("due") is not True:
        return Decision({"status": 200, "data": {"due": False}}, subject="", own=True)
    reads = sess.reads
    cur = RR._cur()
    cur.execute(f"select extract(epoch from ran_at) from {R.AUTO_TABLE} where id = 1 for update")
    got = cur.fetchone()
    if got and got[0] is not None and time.time() - float(got[0]) < R.AUTO_EVERY_S:
        return Decision({"status": 200, "data": {"due": False, "why": "ran already"}}, subject="", own=True)
    out: dict[str, Any] = {"runs": []}
    told = []
    for ran in prep.get("runs") or []:
        if not isinstance(ran, dict):
            continue
        pid = s_(ran.get("period"))
        if ran.get("status") == 200 and isinstance(ran.get("data"), dict):
            got = _store_run(reads, ran["data"], "asa-hub:" + R.AUTO_ACTOR, R.AUTO_ACTOR)
            out["runs"].append({"period": pid, **got})
            told.append(f"{pid}: {sum(got['counts'].values())} error(s)")
        else:
            told.append(f"{pid}: refused: {s_(ran.get('message') or ran.get('status'))}")
    said = "; ".join(told) or "no pay period was prepared"
    cur.execute(f"insert into {R.AUTO_TABLE} (id, ran_at, said) values (1, now(), %s) on conflict (id) do update"
                " set ran_at = excluded.ran_at, said = excluded.said", (said[:400],))
    log.info("auto-recon: %s", said)
    out["said"] = said
    return Decision({"status": 200, "data": out}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "reconErrorResolve": error_resolve, "reconRunClose": run_close, "reconConfigSet": config_set,
    "reconUploadReport": upload_report, "reconImportLatest": import_latest, "reconRun": run,
    "reconErrorRemind": error_remind, "reconAutoRecord": auto_record,
    "reconUpload": RR.upload_door({r: {"tab": t} for r, t in R.RESOURCES.items()}),
}
# the roles and params are each door's own gate (an edition lets its people in beside the roles)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


def ddl() -> tuple[str, ...]:
    """The auto run's mark (db/recon.sql), made here too so the store never waits on it."""
    return (f"create table if not exists {R.AUTO_TABLE} (id smallint primary key default 1 check (id = 1),"
            " ran_at timestamptz not null default now(), said text not null default '')",
            f"grant select on {R.AUTO_TABLE} to asa_hub_app_ro")


class Store(RR.Store):
    """app.recon_writes and app.recon_receipts beside the other apps' own, the auto run's mark; rows
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="recon", label="Time Reconciliation")
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                for stmt in ddl():
                    c.execute(stmt)
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the doors defer meanwhile
                self._drop()
                self._ready = False
                self.why = f"the auto run's mark is not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why
