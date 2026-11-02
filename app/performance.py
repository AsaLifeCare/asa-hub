"""Staff Performance off asa-hub-db: StaffPerformance.gs, PerfWrites.gs and Performance.gs translated.

Every read is the copy of the perf_* tabs with the kept edits laid over it; every write is a kept edit (app.edits),
final in Postgres, so the next read of any perf_* tab carries it. The board is built at each read from the copy, so
nothing is stored and no clock rebuilds it. The AI paragraph is asked of the local model outside the write lock and
kept by its own short write (staffPerfAiKeep), which only the relay chains after the read that asked it."""
from __future__ import annotations

import json
import math
import os
import re
import secrets
import types
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

import gsjs
import locations as L
import staff_perf as SPF
import writes as W
from gsjs import NY
from writes import Decision

PERF_METRICS_TAB = "perf_metrics"
PERF_ENTRIES_TAB = "perf_entries"
ABSENCE_KINDS = ("absence", "late", "no-show", "left-early", "excused")
INCIDENT_SEVERITIES = ("low", "medium", "high", "critical")
# a row of these tabs is told apart by these cells (none has an id column)
APPEND_MATCH = W.COLS + "src|migrated_at|emp_id"
METRIC_MATCH = W.COLS + "metric_id"
ENTRY_MATCH = W.COLS + "person_id|metric_id|period"
AI_MATCH = W.COLS + "emp_id"
AI_URL = os.getenv("HUB_PERF_AI_URL") or os.getenv("HUB_ANALYZE_LOCAL_URL",
                                                   "http://local-cortex:8080/v1/chat/completions")
AI_MODEL = os.getenv("HUB_PERF_AI_MODEL") or os.getenv("HUB_ANALYZE_LOCAL_MODEL", "qwen2.5-7b-instruct")
AI_TIMEOUT_S = float(os.getenv("HUB_PERF_AI_TIMEOUT_S") or 90)
_NUMBER = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")
ROLES = ("admin", "manager")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}


def _s(v: Any) -> str:
    return gsjs.str_(v)


def _num(v: Any) -> float:
    """Number(v)."""
    if v is None:
        return math.nan
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return 0.0
    return float(s) if _NUMBER.fullmatch(s) else math.nan


def _out(n: float) -> Any:
    """A number as JSON.stringify writes it: NaN null, a whole number without its point."""
    if n is None or math.isnan(n) or math.isinf(n):
        return None
    return int(n) if float(n).is_integer() else n


def _writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and _s((user or {}).get("role")) in ROLES


def _now(reads: L.Reads) -> str:
    return gsjs.iso(reads.now)


def _by(user: dict | None) -> str:
    return _s((user or {}).get("email"))


# ---- Performance.gs: the metrics and their entries ------------------------------------------------------------------

def perf_metrics(reads: L.Reads) -> list[dict]:
    """perfMetrics_: the active metric rows."""
    out = []
    for r in SPF._perf_rows(reads, PERF_METRICS_TAB):
        mid = _s(r.get("metricid"))
        if not mid or _s(r.get("active")).lower() == "no":
            continue
        out.append({"metric_id": mid, "label": _s(r.get("label")) or mid,
                    "category": _s(r.get("category")) or "General", "unit": _s(r.get("unit")) or "",
                    "direction": "lower" if _s(r.get("direction")).lower() == "lower" else "higher",
                    "target": _num(r.get("target")), "weight": _num(r.get("weight")) or 1,
                    "period": _s(r.get("period")) or "monthly", "source": _s(r.get("source")) or "manual",
                    "notes": _s(r.get("notes"))})
    for m in out:
        if math.isnan(m["weight"]):
            m["weight"] = 1.0
    return out


def perf_attainment(metric: dict, value: Any) -> float | None:
    """perfAttainment_."""
    t, v = _num(metric.get("target")), _num(value)
    if math.isnan(v):
        return None
    if math.isnan(t) or t == 0:
        if metric.get("direction") == "lower":
            return 100.0 if v <= 0 else max(0.0, 100 - v * 20)
        return 100.0 if v > 0 else 0.0
    if metric.get("direction") == "lower":
        return 100.0 if v <= t else max(0.0, gsjs.js_round(100 * (t / v)))
    return max(0.0, min(150.0, gsjs.js_round((v / t) * 100)))


def perf_entries(reads: L.Reads, period: str) -> list[dict]:
    """perfEntries_: one period's filed numbers (a tab no sheet holds reads as the entries kept here)."""
    out = []
    for r in SPF._perf_rows(reads, PERF_ENTRIES_TAB):
        if not _s(r.get("personid")) or not _s(r.get("metricid")):
            continue
        if period and _s(r.get("period")) != period:
            continue
        raw = r.get("value")
        out.append({"person_id": _s(r.get("personid")), "person_name": _s(r.get("personname")),
                    "metric_id": _s(r.get("metricid")), "period": _s(r.get("period")),
                    "value": None if raw == "" or raw is None else _num(raw), "note": _s(r.get("note")),
                    "source": _s(r.get("source")), "recorded_at": _s(r.get("recordedat")),
                    "recorded_by": _s(r.get("recordedby"))})
    return out


def current_period(reads: L.Reads) -> str:
    """perfCurrentPeriod_: this month on Ohio's clock."""
    return reads.now.astimezone(NY).strftime("%Y-%m")


def _js_keys(d: dict) -> list:
    """Object.keys order: integer-like keys ascending, then the rest as inserted."""
    ints = sorted((k for k in d if re.fullmatch(r"0|[1-9]\d{0,9}", k) and int(k) < 4294967295), key=int)
    return ints + [k for k in d if k not in ints]


def perf_board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """perfBoard: one card per person with a weighted score; coverage says how many metrics it rests on."""
    if not _writer(sess.user):
        return DENIED
    reads = sess.reads
    period = _s((payload or {}).get("period")) or current_period(reads)
    metrics = perf_metrics(reads)
    by_person: dict[str, dict] = {}
    for e in perf_entries(reads, period):
        p = by_person.setdefault(e["person_id"], {"person_id": e["person_id"], "person_name": e["person_name"],
                                                  "values": {}})
        if not p["person_name"] and e["person_name"]:
            p["person_name"] = e["person_name"]
        p["values"][e["metric_id"]] = e
    people = []
    for pid in _js_keys(by_person):
        p = by_person[pid]
        scored = weight = 0.0
        present = 0
        cells = []
        for m in metrics:
            e = p["values"].get(m["metric_id"])
            att = perf_attainment(m, e["value"]) if e and e["value"] is not None else None
            if att is not None:
                scored += att * m["weight"]
                weight += m["weight"]
                present += 1
            status = "missing" if att is None else ("on-target" if att >= 100 else "near" if att >= 85 else "below")
            cells.append({"metric_id": m["metric_id"], "label": m["label"], "category": m["category"],
                          "unit": m["unit"], "target": _out(m["target"]), "direction": m["direction"],
                          "weight": _out(m["weight"]), "value": _out(e["value"]) if e and e["value"] is not None
                          else None, "note": e["note"] if e else "", "attainment": _out(att), "status": status})
        people.append({"person_id": p["person_id"], "person_name": p["person_name"] or p["person_id"],
                       "score": _out(gsjs.js_round(scored / weight)) if weight else None,
                       "coverage": _out(gsjs.js_round((present / len(metrics)) * 100)) if metrics else 0,
                       "measured": present, "metric_count": len(metrics), "cells": cells})
    people.sort(key=lambda x: -(x["score"] if x["score"] is not None else -1))
    shown = [{**m, "target": _out(m["target"]), "weight": _out(m["weight"])} for m in metrics]
    return {"status": 200, "data": {"period": period, "metrics": shown, "people": people}}


# ---- StaffPerformance.gs: the board, the person, the AI paragraph ---------------------------------------------------

def perf_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfList: the board built now from the copy, the kept edits laid in."""
    if not SPF.perf_is_manager(sess.user):
        return SPF.hub_denied()
    rows = SPF.perf_board_build(sess.reads)
    if rows is None:
        return {"status": 200, "data": {"rows": [], "migrated": False}}
    return {"status": 200,
            "data": {"rows": rows, "migrated": True, "computed_at": gsjs.iso(datetime.now(timezone.utc))}}


def perf_recompute(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfRecompute: the board is built at every read, so a press only says what it holds now."""
    if not SPF.perf_is_manager(sess.user):
        return SPF.hub_denied()
    rows = SPF.perf_board_build(sess.reads)
    return {"status": 200, "data": {"rows": len(rows or []), "computed_at": gsjs.iso(datetime.now(timezone.utc)),
                                    "stored": True, "migrated": rows is not None}}


def perf_migrate(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfMigrate: the old Master Data workbook is Google's, and the record already lives in asa-hub-db."""
    user = sess.user or {}
    if user.get("is_service") or _s(user.get("role")) != "admin":
        return SPF.hub_denied()
    return {"status": 200, "data": {"added": {}, "note": "The performance record is already in the Hub's database; "
                                                          "the old Master Data workbook is not read again."}}


def _model(ask: str) -> dict[str, Any]:
    """screenAiChat_'s answer from the local model: {ok, content, via}."""
    body = json.dumps({"model": AI_MODEL, "temperature": 0.2, "messages": [{"role": "user", "content": ask}]}).encode()
    req = urllib.request.Request(AI_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=AI_TIMEOUT_S) as res:
            got = json.loads(res.read())
        content = _s((((got.get("choices") or [{}])[0]).get("message") or {}).get("content"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, AttributeError):
        return {"ok": False, "content": "", "via": ""}
    return {"ok": bool(content), "content": content, "via": "local:" + AI_MODEL}


def _json_of(text: str) -> Any:
    """The model's JSON, a fence around it allowed."""
    s = gsjs.trim(text)
    m = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", s, re.S)
    try:
        return json.loads(m.group(1) if m else s)
    except ValueError:
        return None


def _ask(rec: dict) -> str:
    """staffPerfEvaluate's prompt, word for word."""
    staff, graded = rec["staff"], rec["graded"]
    att, inc, notes, certs = rec["att"], rec["inc"], rec["notes"], rec["certs"]
    facts = ("STAFF: " + rec["name"] + " — status " + _s(staff.get("status"))
             + (", hired " + _s(staff.get("hiredate")) if _s(staff.get("hiredate")) else "") + "\n"
             + "CALL-OFFS/ATTENDANCE (" + str(len(att)) + " on file, newest first): "
             + "; ".join(_s(r.get("date")) + " " + _s(r.get("kind")) for r in att[:12]) + "\n"
             + "INCIDENTS (" + str(len(inc)) + "): "
             + " | ".join(_s(r.get("date")) + " [" + _s(r.get("type")) + "/" + _s(r.get("severity")) + "] "
                          + _s(r.get("summary"))[:90] for r in inc[:8]) + "\n"
             + "CERTIFICATIONS: " + ", ".join(c["cert"] + " (" + c["status"] + ")" for c in certs) + "\n"
             + "DAILY NOTES (" + str(len(notes)) + "): " + " | ".join(_s(r.get("text"))[:80] for r in notes[:6]))
    rubric = ("COMPUTED GRADE: " + gsjs.num_str(graded["grade"]) + "/10, by this arithmetic: start at 10; "
              + "; ".join(gsjs.num_str(x["cut"]) + " for " + str(x["count"]) + " " + x["label"]
                          for x in graded["parts"])
              + ("." if graded["parts"] else " nothing subtracted."))
    return ("You EVALUATE a direct support professional for a manager at a company running "
            "group homes for adults with developmental disabilities. Using ONLY the facts "
            "below — never inventing an event, a date or a trait — return JSON:\n"
            "1. \"summary\": 4-6 sentences that ACTUALLY EVALUATE: weigh the attendance pattern "
            "against tenure, say whether the incidents are a pattern or noise, name the "
            "certification risk, and end with a one-sentence verdict a manager can act on. "
            "Never a neutral restatement of the list.\n"
            "2. \"grade\": your own 0-10, starting from the computed grade — you may move it "
            "up to 1 point either way ONLY with a reason stated in the summary; otherwise "
            "repeat the computed number.\n"
            "3. \"tags\": 3-6 short chips (5-9 words each) — the standout facts, good and bad.\n\n"
            + rubric + "\n\nFACTS:\n" + facts
            + "\n\nReply with JSON only: {\"summary\":\"...\",\"grade\":7.5,\"tags\":[\"...\"]}")


def perf_evaluate(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfEvaluate: the kept paragraph while the record has not moved, else the model's, handed back with what
    to keep (_keep), which the relay files through staffPerfAiKeep; the model never runs under the write lock."""
    if not SPF.perf_is_manager(sess.user):
        return SPF.hub_denied()
    emp_id = _s((payload or {}).get("emp_id"))
    if not emp_id:
        return {"status": 400, "message": "emp_id is required."}
    rec = SPF.staff_perf_record(sess.reads, emp_id)
    if rec.get("error"):
        return rec["error"]
    kept = rec["kept"]

    def kept_out(note: str) -> dict[str, Any]:
        grade = _s(kept.get("grade")) if kept else ""
        return {"status": 200, "data": {
            "summary": _s(kept.get("summary")) if kept else "",
            "tags": [t for t in _s(kept.get("tags")).split("|") if t] if kept else [],
            "grade": _out(_num(grade)) if grade != "" else None, "made_at": _s(kept.get("madeat")) if kept else "",
            "fresh": False, "note": note}}

    if kept and _s(kept.get("hash")) == rec["hash"] and not (payload or {}).get("refresh"):
        return kept_out("the record has not moved since this paragraph")
    if not (rec["att"] or rec["inc"] or rec["notes"] or rec["certs"]):
        return kept_out("not enough on file")
    res = _model(_ask(rec))
    if not res["ok"]:
        return kept_out("the model did not answer — the last paragraph stands")
    parsed = _json_of(res["content"])
    if not isinstance(parsed, dict) or not _s(parsed.get("summary")):
        return kept_out("the model answered noise — the last paragraph stands")
    summary = _s(parsed.get("summary"))[:1400]
    tags = [t for t in (_s(t)[:80] for t in (parsed.get("tags") or []) if t is not None) if t][:6]
    computed = rec["graded"]["grade"]
    g = _num(parsed.get("grade"))
    ai_grade = gsjs.num_str(max(0.0, min(10.0, gsjs.js_round(g * 10) / 10))) \
        if not math.isnan(g) and abs(g - computed) <= 1 else gsjs.num_str(computed)
    made_at = gsjs.iso(datetime.now(timezone.utc))
    return {"status": 200, "data": {"summary": summary, "tags": tags, "grade": _out(_num(ai_grade)),
                                    "made_at": made_at, "fresh": True},
            "_keep": {"emp_id": emp_id, "hash": rec["hash"], "summary": summary, "tags": "|".join(tags),
                      "grade": ai_grade, "via": res["via"], "made_at": made_at}}


# ---- the writes, each a kept edit ---------------------------------------------------------------------------------

def _staff_row(reads: L.Reads, emp_id: str) -> dict | None:
    return next((s for s in SPF._perf_rows(reads, SPF.PERF["staff"]) if _s(s.get("empid")) == emp_id), None)


def _append(reads: L.Reads, tab: str, cells: dict, subject: str) -> dict:
    sid, name = W.where_of(W.tab_of(reads, tab))
    key = W.cols_key(cells, [h for h in APPEND_MATCH[len(W.COLS):].split(W.COLS_SEP)])
    return W.kept_record(sid, name, "append", APPEND_MATCH, key, subject, cells)


def note_add(sess: L.Session, payload: dict) -> Decision:
    """staffPerfNoteAdd: a manager's note on one staff member's record."""
    if not SPF.perf_is_manager(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    emp_id = _s(payload.get("emp_id"))
    text = _s(payload.get("text"))[:500]
    if not emp_id or not text:
        return W.refuse(400, "emp_id and text are required.")
    staff = _staff_row(reads, emp_id)
    if not staff:
        return W.refuse(404, f'No staff row "{emp_id}".')
    now = _now(reads)
    cells = {"emp_id": emp_id, "name": _s(staff.get("name")), "category": "Manager note", "text": text,
             "src": "hub:" + _by(sess.user), "created_at": now, "migrated_at": now}
    return W.final({"status": 200, "data": {"ok": True}}, [_append(reads, SPF.PERF["notes"], cells, emp_id)], emp_id)


def absence_add(sess: L.Session, payload: dict) -> Decision:
    """staffPerfAbsenceAdd."""
    if not SPF.perf_is_manager(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    emp_id = _s(payload.get("emp_id"))
    date = _s(payload.get("date"))[:10]
    kind = _s(payload.get("kind")).lower() or "absence"
    notes = _s(payload.get("notes"))[:500]
    if not emp_id or not date:
        return W.refuse(400, "emp_id and date are required.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return W.refuse(400, "date: YYYY-MM-DD.")
    if kind not in ABSENCE_KINDS:
        return W.refuse(400, "kind: one of " + ", ".join(ABSENCE_KINDS))
    staff = _staff_row(reads, emp_id)
    if not staff:
        return W.refuse(404, f'No staff row "{emp_id}".')
    by = _by(sess.user)
    cells = {"emp_id": emp_id, "name": _s(staff.get("name")), "date": date, "kind": kind, "notes": notes,
             "logged_by": by, "src": "hub:" + by, "migrated_at": _now(reads)}
    return W.final({"status": 200, "data": {"ok": True, "emp_id": emp_id, "date": date, "kind": kind}},
                   [_append(reads, SPF.PERF["attendance"], cells, emp_id)], emp_id)


def incident_add(sess: L.Session, payload: dict) -> Decision:
    """staffPerfIncidentAdd."""
    if not SPF.perf_is_manager(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    emp_id = _s(payload.get("emp_id"))
    summary = _s(payload.get("summary"))[:800]
    if not emp_id or not summary:
        return W.refuse(400, "emp_id and summary are required.")
    severity = _s(payload.get("severity")).lower() or "low"
    if severity not in INCIDENT_SEVERITIES:
        return W.refuse(400, "severity: one of " + ", ".join(INCIDENT_SEVERITIES))
    date = _s(payload.get("date"))[:10] or gsjs.iso(datetime.now(timezone.utc))[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return W.refuse(400, "date: YYYY-MM-DD.")
    staff = _staff_row(reads, emp_id)
    if not staff:
        return W.refuse(404, f'No staff row "{emp_id}".')
    by = _by(sess.user)
    cells = {"emp_id": emp_id, "name": _s(staff.get("name")), "type": _s(payload.get("type"))[:60] or "incident",
             "severity": severity, "date": date, "category": _s(payload.get("category"))[:60], "summary": summary,
             "action_taken": _s(payload.get("action_taken"))[:500], "reported_by": by, "status": "open",
             "src": "hub:" + by, "migrated_at": _now(reads)}
    return W.final({"status": 200, "data": {"ok": True, "emp_id": emp_id, "severity": severity, "date": date}},
                   [_append(reads, SPF.PERF["incidents"], cells, emp_id)], emp_id)


def metric_upsert(sess: L.Session, payload: dict) -> Decision:
    """perfMetricUpsert: a metric made or edited, by its id."""
    if not _writer(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    label = _s(payload.get("label"))
    mid = _s(payload.get("metric_id")) or re.sub(r"^_|_$", "", re.sub(r"[^a-z0-9]+", "_", label.lower()))
    if not mid or not label:
        return W.refuse(400, "A metric needs an id and a label")
    now = _now(reads)
    weight = _num(payload.get("weight"))
    fields: dict[str, Any] = {
        "metric_id": mid, "label": label, "category": _s(payload.get("category")) or "General",
        "unit": _s(payload.get("unit")), "direction": "lower" if _s(payload.get("direction")) == "lower" else "higher",
        # Number(null) is 0; only a target never sent is left blank
        "target": "" if "target" not in payload else 0.0 if payload["target"] is None else _num(payload["target"]),
        "weight": weight if weight and not math.isnan(weight) else 1,
        "period": _s(payload.get("period")) or "monthly", "source": _s(payload.get("source")) or "manual",
        "active": _s(payload.get("active")) or "yes", "notes": _s(payload.get("notes")),
        "updated_at": now, "updated_by": "asa-hub:" + _by(sess.user)}
    if isinstance(fields["target"], float) and math.isnan(fields["target"]):
        fields["target"] = "NaN"
    held = any(_s(r.get("metricid")) == mid for r in SPF._perf_rows(reads, PERF_METRICS_TAB))
    if not held:
        fields["created_at"] = now
    sid, name = W.where_of(W.tab_of(reads, PERF_METRICS_TAB))
    rec = W.kept_record(sid, name, "edit" if held else "append", METRIC_MATCH, mid, mid, fields)
    data = {"metric_id": mid, "updated": True} if held else {"metric_id": mid, "created": True}
    return W.final({"status": 200, "data": data}, [rec], mid)


def entry_save(sess: L.Session, payload: dict) -> Decision:
    """perfEntrySave: one number for one person in one period, one row per triple."""
    if not _writer(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    pid, mid = _s(payload.get("person_id")), _s(payload.get("metric_id"))
    period = _s(payload.get("period")) or current_period(reads)
    if not pid or not mid:
        return W.refuse(400, "person_id and metric_id are required")
    value = payload.get("value")
    if value is None or value == "":
        return W.refuse(400, "A value is required — leave the metric unfiled instead of writing a zero.")
    now = _now(reads)
    num = _num(value)
    fields: dict[str, Any] = {"person_id": pid, "person_name": _s(payload.get("person_name")), "metric_id": mid,
                              "period": period, "value": "NaN" if math.isnan(num) else num,
                              "note": _s(payload.get("note")), "source": _s(payload.get("source")) or "manual",
                              "recorded_at": now, "recorded_by": "asa-hub:" + _by(sess.user)}
    held = any(_s(r.get("personid")) == pid and _s(r.get("metricid")) == mid and _s(r.get("period")) == period
               for r in SPF._perf_rows(reads, PERF_ENTRIES_TAB))
    if not held:
        fields["entry_id"] = "PFE_" + secrets.token_hex(7).upper()
    sid, name = W.where_of(W.tab_of(reads, PERF_ENTRIES_TAB))
    key = W.cols_key(fields, ["person_id", "metric_id", "period"])
    rec = W.kept_record(sid, name, "edit" if held else "append", ENTRY_MATCH, key, pid, fields)
    return W.final({"status": 200, "data": {"updated": True} if held else {"created": True}}, [rec], pid)


def ai_keep(sess: L.Session, payload: dict) -> Decision:
    """staffPerfAiKeep: the paragraph staffPerfEvaluate's read got from the model, kept as the staff member's one
    perf_ai row (the relay alone calls it, straight after that read)."""
    if not SPF.perf_is_manager(sess.user):
        return W.refuse(403, DENIED["message"])
    reads = sess.reads
    emp_id = _s(payload.get("emp_id"))
    summary = _s(payload.get("summary"))[:1400]
    if not emp_id or not summary or not _s(payload.get("hash")):
        return W.refuse(400, "emp_id, hash and summary are required.")
    if not _staff_row(reads, emp_id):
        return W.refuse(404, f'No migrated staff row "{emp_id}".')
    cells = {"emp_id": emp_id, "hash": _s(payload.get("hash")), "summary": summary,
             "tags": _s(payload.get("tags"))[:600], "grade": _s(payload.get("grade"))[:8],
             "via": _s(payload.get("via"))[:80], "made_at": _s(payload.get("made_at")) or _now(reads)}
    held = any(_s(r.get("empid")) == emp_id for r in SPF._perf_rows(reads, SPF.PERF["ai"]))
    sid, name = W.where_of(W.tab_of(reads, SPF.PERF["ai"]))
    rec = W.kept_record(sid, name, "edit" if held else "append", AI_MATCH, emp_id, emp_id, cells)
    return W.final({"status": 200, "data": {"kept": True}}, [rec], emp_id)


# ---- the doors -----------------------------------------------------------------------------------------------------

READ_POLICY = {"roles": ROLES, "params": {}}
ACTIONS: dict[str, Any] = {
    "staffPerfList": perf_list, "staffPerfProfile": SPF.staff_perf_profile, "perfBoard": perf_board,
    "staffPerfRecompute": perf_recompute, "staffPerfEvaluate": perf_evaluate, "staffPerfMigrate": perf_migrate}
POLICY = {"staffPerfList": READ_POLICY, "staffPerfProfile": {"roles": ROLES, "params": {"emp_id": "string"}},
          "perfBoard": {"roles": ROLES, "params": {"period": "string"}}, "staffPerfRecompute": READ_POLICY,
          "staffPerfEvaluate": {"roles": ROLES, "params": {"emp_id": "string", "refresh": "boolean"}},
          "staffPerfMigrate": {"roles": ("admin",), "params": {}}}
WRITE = types.SimpleNamespace(
    ACTIONS={"staffPerfNoteAdd": note_add, "staffPerfAbsenceAdd": absence_add, "staffPerfIncidentAdd": incident_add,
             "perfMetricUpsert": metric_upsert, "perfEntrySave": entry_save, "staffPerfAiKeep": ai_keep},
    POLICY={"staffPerfNoteAdd": {"roles": ROLES, "params": {"emp_id": "string", "text": "string"}},
            "staffPerfAbsenceAdd": {"roles": ROLES, "params": {"emp_id": "string", "date": "string", "kind": "string",
                                                               "notes": "string"}},
            "staffPerfIncidentAdd": {"roles": ROLES, "params": {"emp_id": "string", "summary": "string"}},
            "perfMetricUpsert": {"roles": ROLES, "params": {}},
            "perfEntrySave": {"roles": ROLES, "params": {}},
            "staffPerfAiKeep": {"roles": ROLES, "params": {"emp_id": "string", "hash": "string", "summary": "string"}}})
