"""The phone-call transcript lane on Python (CommCalls.gs): what the phone lines carried, in facts only.

The two houses (comm_calls, comm_work_items) are kept in Postgres (app/resource_rows.py: commCalls, commWorkItems),
uploaded from their copies as the lane is given to Python and read and written there alone. commCallsWho answers
whose line each number is, from the platform's one resolver (contactPhoneWho_). commCallsIngest (comm_calls_writes) is
the hand-over the relay's live half delivers the calls it read to: cleaned by the door's own cleaners and upserted by
id. The GAS-native sweep (commCallsSweep_ with commCallsClassifyNow_) is split as every network pass is:
commCallsSweepFetch reads the transcripts inbox's newest calls off asa-hub-db, asks the model about each one the calls
house does not hold (screenAiChat_ under comm_calls_live) and resolves its caller, for as long as a pass may run;
commCallsSweepKeep files what it read through the same ingest under the write lock. The screen's doors are here too:
commCallsCandidates (who might have called) and commCallsAttribute (an admin names the caller), and the two slices the
relay serves (commCallsList, commWorkItemsList). The feed's stamp (COMM_CALLS_FEED_AT, COMM_CALLS_FEED_ROWS) is kept in
app.comm_calls_state (db/comm_calls.sql)."""
from __future__ import annotations

import functools
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import client_care_sweeps as CCS
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff_comms as CM
import staff_views
import support_desk_writes as SDW
from gsjs import SheetDate
from scope import Defer

APP_ID = "comm-calls"
CALLS_TAB = "comm_calls"
ITEMS_TAB = "comm_work_items"
CALLS_RES = "commCalls"
ITEMS_RES = "commWorkItems"
# COMM_CALLS_HEADER
CALLS_HEADER = ("id", "createdAt", "updatedAt",
                "call_id", "call_at", "line", "direction", "duration_sec", "turns",
                "person_key", "name", "name_from", "name_why", "who_state",
                "read_state", "read_at", "model_via", "items", "prior_lane", "seal_id",
                "source_at")
# COMM_WORK_ITEMS_HEADER
ITEMS_HEADER = ("id", "createdAt", "updatedAt",
                "call_id", "item_no", "work_type", "category", "urgency", "occurred_on",
                "description",
                "concerns_person_key", "concerns_name", "name_from",
                "confidence", "state", "seal_id", "source_call_at",
                "source_at")
# COMM_CALLS_REFUSED: refused on arrival, named in the log
REFUSED = ("full_transcript", "speaker_transcript", "transcript",
           "summary", "quote", "description_of_request",
           "response", "summary_of_incident", "immediate_action_taken",
           "cause_and_contributing_factors", "prevention_plan",
           "notes", "note", "reason", "comments", "raw", "text", "preview", "excerpt",
           "client_name", "client", "consumers", "num_consumers",
           "house", "location_code", "incident_location", "location",
           "shift_code", "address", "latitude", "longitude",
           "phone", "caller_phone", "requestor_phone", "email")
DESCRIPTION_CAP = 240
WORK_TYPES = ("DailyNote", "Incident", "Request", "Screening")
CAT_DAILY = ("daily_update", "medical", "behavior", "meals", "activities", "sleep", "hygiene", "other")
CAT_REQUEST = ("Schedule - Call Off", "Schedule - Change", "Payroll", "Supplies", "Maintenance", "HR", "IT", "Other")
CAT_INCIDENT = ("minor_issue_schedule_late_verbal_tension", "medication_error_missed_dose",
                "client_behavior_aggression", "injury_accident_staff_or_client", "hospitalization_er_visit",
                "abuse_neglect_allegation", "missing_client_wandering", "vehicle_transportation_issue",
                "environmental_facility_issue", "post_incident_check")
URGENCY = ("Low", "Medium", "High")
CAT_SCREENING = ("advance", "advance_pending", "declined_pay", "declined_schedule", "incomplete", "no_show")
READ_STATES = ("read", "unread", "unreadable")
WHO_STATES = ("sole", "shared", "unknown", "unresolved")
CALLS_INGEST_CAP = 500
ITEMS_INGEST_CAP = 2000
FEED_STAMP = "COMM_CALLS_FEED_AT"
FEED_ROWS = "COMM_CALLS_FEED_ROWS"
STATE = "app.comm_calls_state"
# COMM_SWEEP_NEWEST_ROWS
SWEEP_NEWEST_ROWS = 40
INBOX_PROP = "HOTLINE_TRANSCRIPTS_ID"
INBOX_TAB = "Transcripts"
INBOX_SPEC = {"id": (("Call ID",), None), "event": (("Event Timestamp",), None),
              "created": (("Transcript Created",), None), "received": (("Received At",), None),
              "secs": (("Duration (sec)",), None), "dir": (("Direction",), None), "turns": (("# Turns",), None),
              "full": (("Full Transcript",), None), "spoken": (("Speaker Transcript",), None),
              "team": (("Team Member(s)",), None), "who": (("Participant(s)",), None)}
AI_REQUEST = "comm_calls_live"
TRANSCRIPT_CAP = 24000
LOG_ACTOR = {"email": "asa-hub:comm", "display_name": "asa-hub:comm"}
# a fetch asks the model about no further call after this long, and cuts a call short of the relay's own wait
FETCH_BUDGET_S = 25.0
CALL_DEADLINE_S = 52.0
# COMM_LINE_ROLE_WORDS: who might have called, by the line's declared role
LINE_ROLE_WORDS = {"3307544040": "Manager", "3309195558": "Software Specialist", "3309195559": "Administration",
                   "3309197595": "HR-Administration", "3309197779": "Director", "9377166410": "Director"}
CANDIDATES_CAP = 8
CANDIDATES_AI_REQUEST = "comm_calls_candidates"
# the candidates' model rung is cut short of the relay's wait for a person's read
CANDIDATES_DEADLINE_S = 8.0
PEOPLE_TAB = "people"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own read."}
_WS = re.compile(r"[\s﻿]+")

s_ = gsjs.str_


# ---- the pure half ------------------------------------------------------------------------------------------------

def cut(s: str, n: int) -> str:
    """String.prototype.slice(0, n), counted in UTF-16 units."""
    if len(s) <= n // 2:
        return s
    units = s.encode("utf-16-le", "surrogatepass")
    return s if len(units) <= 2 * n else units[:2 * n].decode("utf-16-le", "surrogatepass")


def js_len(s: str) -> int:
    """String.prototype.length."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def text(v: Any) -> str:
    """commCallsText_: a value as the text these houses store; a Date is none."""
    if v is None or isinstance(v, SheetDate):
        return ""
    return gsjs.trim(_WS.sub(" ", gsjs.js_str(v)))


def key(v: Any) -> str:
    """commCallsKey_: clientNameKey_'s spelling."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def one_of(vocab: tuple, want: Any) -> str:
    """commCallsOneOf_: membership on the flattened spelling."""
    k = key(want)
    return next((w for w in vocab if key(w) == k), "")


def crossed(rows: Any) -> list[str]:
    """commCallsCrossed_: which refused names this hand-over is carrying."""
    found: list[str] = []
    refused = {key(r) for r in REFUSED}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        for k in row:
            if key(k) in refused and k not in found:
                found.append(k)
    return found


def instant(v: Any) -> str:
    """commCallsInstant_: an ISO instant, or '' — never a guess."""
    t = cut(text(v), 40)
    if not t:
        return ""
    return t if gsjs.date_parse(t) is not None or gsjs.parse_when(t, "UTC") is not None else ""


def count(v: Any) -> str:
    """commCallsCount_: a count as text, or '' — missing is not zero."""
    return re.sub(r"[^0-9]", "", text(v))


def clean_call(row: Any, at: Any) -> dict[str, str] | None:
    """commCallsClean_: one handed-over call → the line the house stores, or None."""
    if not isinstance(row, dict) or not row:
        return None
    call_id = cut(text(row.get("call_id")), 60)
    if not call_id:
        return None
    read_state = text(row.get("read_state")).lower()
    if read_state not in READ_STATES:
        return None
    who_state = text(row.get("who_state")).lower()
    if who_state not in WHO_STATES:
        who_state = "unresolved"
    named = who_state == "sole"
    name = cut(text(row.get("name")), 120) if named else ""
    return {
        "id": "CC_" + call_id, "call_id": call_id, "call_at": instant(row.get("call_at")),
        "line": cut(text(row.get("line")), 60),
        "direction": cut(text(row.get("direction")).lower(), 12) or "unknown",
        "duration_sec": count(row.get("duration_sec")), "turns": count(row.get("turns")),
        "person_key": key(name) if name else "", "name": name, "name_from": "phone" if named else "",
        "name_why": cut(text(row.get("name_why")), 300), "who_state": who_state, "read_state": read_state,
        "read_at": instant(row.get("read_at")), "model_via": cut(text(row.get("model_via")), 60),
        # an unreadable call's count is missing, never zero
        "items": "" if read_state == "unreadable" else count(row.get("items")),
        "prior_lane": cut(text(row.get("prior_lane")), 20), "seal_id": cut(text(row.get("seal_id")), 80),
        "source_at": cut(text(at), 40)}


def clean_item(row: Any, at: Any) -> dict[str, str] | None:
    """commWorkItemClean_: one handed-over work item → the line the house stores, or None."""
    if not isinstance(row, dict) or not row:
        return None
    call_id = cut(text(row.get("call_id")), 60)
    item_no = re.sub(r"[^0-9]", "", text(row.get("item_no")))
    if not call_id or not item_no:
        return None
    work_type = one_of(WORK_TYPES, row.get("work_type"))
    if not work_type:
        return None
    vocab, fallback = {"DailyNote": (CAT_DAILY, "other"), "Request": (CAT_REQUEST, "Other"),
                       "Screening": (CAT_SCREENING, "incomplete")}.get(
        work_type, (CAT_INCIDENT, "minor_issue_schedule_late_verbal_tension"))
    # the category is coerced, never passed through
    category = one_of(vocab, row.get("category")) or fallback
    urgency = one_of(URGENCY, row.get("urgency")) or ("High" if category == "Schedule - Call Off" else "Low")
    occurred = cut(text(row.get("occurred_on")), 10)
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", occurred):
        occurred = ""
    named = text(row.get("name_from")) == "phone"
    name = cut(text(row.get("concerns_name")), 120) if named else ""
    confidence = cut(text(row.get("confidence")), 8)
    if confidence and not re.fullmatch(r"0(\.[0-9]+)?|1(\.0+)?", confidence):
        confidence = ""
    return {
        "id": "CW_" + call_id + "_" + item_no, "call_id": call_id, "item_no": item_no, "work_type": work_type,
        "category": category, "urgency": urgency, "occurred_on": occurred,
        "description": cut(gsjs.trim(_WS.sub(" ", text(row.get("description")))), DESCRIPTION_CAP),
        "concerns_person_key": key(name) if name else "", "concerns_name": name,
        "name_from": "phone" if named else "", "confidence": confidence,
        "state": "closed" if text(row.get("state")).lower() == "closed" else "open",
        "seal_id": cut(text(row.get("seal_id")), 80), "source_call_at": instant(row.get("source_call_at")),
        "source_at": cut(text(at), 40)}


def owned(reads: L.Reads) -> None:
    """The houses are Postgres' once uploaded; until then the lane is Apps Script's and nothing here reads or writes."""
    if not (RR.uploaded(reads.db, CALLS_RES) and RR.uploaded(reads.db, ITEMS_RES)):
        raise Defer("the calls houses are not uploaded to Postgres yet")


def declared(reads: L.Reads, tab: str) -> bool:
    """commCallsDeclared_: the house's pointer, asked before anything is opened."""
    try:
        return bool(reads.db.house_id(tab))
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable pointer is not declared
        return False


def now_iso() -> str:
    return gsjs.iso(datetime.now(timezone.utc))


def log_line(action: str, target: str) -> None:
    """hubSysLog_('asa-hub:comm', ...)."""
    staff_views.record(LOG_ACTOR, action, target)


# ---- whose line is this --------------------------------------------------------------------------------------------

def who_text(who: dict | None) -> str:
    """contactWhoText_."""
    if not who:
        return ""
    if who.get("state") == "sole":
        return "Named from the caller ID: " + s_(who.get("name")) + " — one person on the staff roster holds this line."
    if who.get("state") == "shared":
        names = [s_(p.get("name")) for p in who.get("people") or []]
        return ("Not named from the caller ID: " + str(len(names)) + " people on the staff roster hold this line ("
                + ", ".join(names[:3]) + (" and others" if len(names) > 3 else "") + "). A shared line names nobody.")
    why = gsjs.or_text(who.get("why")) or "the number is not on the staff roster"
    return "Not named from the caller ID — " + why + "."


def who(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commCallsWho: whose line each number is, asked of contactPhoneWho_; the name travels only on `sole`."""
    user = sess.user or {}
    phones = (payload or {}).get("phones")
    if phones is None or phones == "":
        return {"status": 400, "message": "Missing required parameter: phones."}
    if not user.get("is_service") and s_(user.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    phones = phones if isinstance(phones, list) else []
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for p in phones:
        if len(rows) >= 400:
            break
        raw = text(p)
        if not raw or raw in seen:
            continue
        seen.add(raw)
        got = SDW.phone_who(sess.reads, raw)
        rows.append({"phone": raw, "state": gsjs.or_text(got.get("state")) or "unknown",
                     "name": gsjs.or_text(got.get("name")), "why": who_text(got)})
    return {"status": 200, "data": {"rows": rows, "asked": len(phones)}}


# ---- the sweep's reading half (commCallsSweep_, commCallsClassifyNow_) --------------------------------------------

def _known(reads: L.Reads) -> set[str]:
    """The calls already read, keyed once for the whole pass; an unreadable house reads as nothing known."""
    try:
        return {c for c in (s_(r.get("call_id")) for r in reads.hub_rows(CALLS_TAB)) if c}
    except Exception:  # noqa: BLE001 - as Apps Script: the upsert dedups
        return set()


def _inbox(reads: L.Reads) -> hubdb.TabRef | None:
    sid = gsjs.trim(reads.db.prop(INBOX_PROP))
    if not sid:
        return None
    try:
        return reads.tab_of(sid, INBOX_TAB, "the hotline transcripts")
    except (Defer, hubdb.Unreadable):
        return None


def _value(v: Any, direct: bool, zone: str) -> Any:
    """A Transcripts cell as readAll_ hands it: a Date as cellText_, JSON-looking text parsed."""
    return hubdb.cell_text(CM._dated(v, direct, zone))


def _first(*vals: Any) -> Any:
    """a || b || c."""
    return next((v for v in vals if not gsjs.falsy(v)), vals[-1])


def _round_text(v: Any) -> str:
    """str_(Math.round(Number(v) || 0) || '')."""
    if isinstance(v, (bool, int, float)):
        n: float | None = float(v)
    elif v is None or not isinstance(v, str):
        n = 0.0
    else:
        t = gsjs.trim(v)
        n = CM._js_number(t) if t else 0.0
    if n is None or math.isnan(n) or n == 0:
        return ""
    if math.isinf(n):
        return "Infinity" if n > 0 else "-Infinity"
    r = math.floor(n + 0.5)
    return "" if r == 0 else gsjs.num_str(r)


def ask(day: str, words: str) -> str:
    """commCallsClassifyNow_'s orders."""
    return (
        "You process voicemail and call transcripts from the employee support phone lines of a "
        "company running group homes for adults with developmental disabilities in Ohio. Direct "
        "support professionals call these lines to leave daily notes about clients, report "
        "incidents, ask for help, and call off shifts.\n\n"
        "Read the transcript and emit ONE work item PER DISTINCT MATTER as NDJSON — one JSON "
        "object per line, nothing else. No markdown, no commentary, no array, no wrapper object.\n\n"
        "RULES THAT OUTRANK EVERYTHING:\n"
        "- Use ONLY what the transcript says. Never invent a name, a date, a client or an event.\n"
        "- NEVER write a person's name into any field. The platform establishes who called from "
        "the phone number, not from the words.\n"
        '- Dates: resolve relative words ("today", "tomorrow") against reporting date ' + day + ". "
        "Format yyyy-MM-dd.\n"
        "- One call often carries several matters — a daily note AND a call off is two lines.\n"
        '- A matter that fits nothing is a Request with category "Other".\n'
        "- If the transcript carries no work matter at all, emit nothing. A greeting, a beep, "
        "a wrong number, a machine message and a hang-up are not work matters.\n"
        "- NEVER write a summary longer than the transcript you were given.\n\n"
        "Every object carries exactly these keys:\n"
        "  work_type   one of: DailyNote | Incident | Request | Screening\n"
        "  category    for DailyNote, one of: " + ", ".join(CAT_DAILY) + "\n"
        "              for Request, one of: " + ", ".join(CAT_REQUEST) + "\n"
        "              for Incident, one of: " + ", ".join(CAT_INCIDENT) + "\n"
        "              for Screening, one of: " + ", ".join(CAT_SCREENING) + "\n"
        "  urgency     Low | Medium | High. A call off is always High.\n"
        "  occurred_on yyyy-MM-dd, the day the matter is about\n"
        "  confidence  0.0 to 1.0, your own\n"
        "  summary     what the matter is, in the caller's meaning, complete\n\n"
        'A shift call off is ALWAYS work_type "Request", category "Schedule - Call Off", '
        'urgency "High", and the summary names the shift date and the reason given.\n'
        "A hiring phone-screening call — the agency's screening assistant interviewing a "
        "candidate — is ONE Screening item for the whole call, never one per question.\n"
        "Use the category words EXACTLY as spelled above. A category not on the list is refused.\n\n"
        "Transcript:\n" + cut(words, TRANSCRIPT_CAP))


def matters(content: str, words: str) -> list[dict]:
    """NDJSON, one object per matter, parsed tolerantly; a summary longer than the call is invention, refused."""
    out = []
    room = js_len(words)
    for line in content.split("\n"):
        line = gsjs.trim(line)
        if not line or line[0] != "{":
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        summary = s_(obj.get("summary")) if isinstance(obj, dict) else ""
        if not summary or js_len(summary) > room:
            continue
        out.append(obj)
    return out


def classify(reads: L.Reads, record: dict[str, Any], deadline: float) -> dict[str, Any]:
    """commCallsClassifyNow_ up to the hand-over: the model's matters, the caller from the number, and the rows the
    ingest is handed; `late` when the pass's deadline came before the model answered."""
    call_id = cut(s_(record.get("call_id")), 60)
    words = s_(record.get("full_transcript"))
    if not call_id or not words:
        return {"ok": False, "why": "no call_id or no words"}
    at = now_iso()
    call_at = s_(_first(record.get("event_at"), at))
    try:
        answer = CCS.ai_chat(reads, ask(cut(call_at, 10), words), 0, AI_REQUEST, deadline)
    except Exception as exc:  # noqa: BLE001 - said as Apps Script says it
        return {"ok": False, "why": "model threw: " + cut(s_(str(exc)), 120)}
    if answer.get("late"):
        return {"ok": False, "late": True, "why": "model refused: the pass's deadline came first"}
    if not answer.get("ok"):
        return {"ok": False, "why": "model refused: " + cut(s_(answer.get("error")), 160)}
    items = matters(gsjs.trim(gsjs.or_text(answer.get("content"))), words)

    verdict = {"state": "unresolved", "name": "", "why": "no ten-digit caller number on the row"}
    try:
        digits = re.sub(r"[^0-9]", "", s_(record.get("participants")))[-10:]
        if digits:
            got = SDW.phone_who(reads, digits)
            if got and gsjs.or_text(got.get("state")):
                verdict = {"state": s_(got.get("state")), "name": s_(got.get("name")), "why": s_(got.get("why"))}
    except Exception:  # noqa: BLE001 - unresolved stands, never a guess
        pass
    named = verdict["state"] == "sole"
    via = "gas:" + s_(gsjs.or_text(answer.get("via")) or "ladder")
    call_row = {"call_id": call_id, "call_at": call_at, "line": s_(record.get("team_members")),
                "direction": s_(record.get("direction")).lower() or "unknown",
                "duration_sec": _round_text(record.get("duration_s")),
                "turns": re.sub(r"[^0-9]", "", s_(record.get("turns"))),
                "person_key": key(verdict["name"]) if named else "", "name": verdict["name"] if named else "",
                "name_from": "phone" if named else "", "name_why": verdict["why"], "who_state": verdict["state"],
                "read_state": "read", "read_at": at, "model_via": via, "items": str(len(items)), "prior_lane": "",
                "seal_id": call_id, "source_call_at": call_at}
    item_rows = [{"call_id": call_id, "item_no": str(n + 1), "work_type": s_(it.get("work_type")),
                  "category": s_(it.get("category")), "urgency": s_(it.get("urgency")),
                  "occurred_on": s_(it.get("occurred_on")),
                  "description": cut(gsjs.trim(_WS.sub(" ", s_(it.get("summary")))), DESCRIPTION_CAP),
                  "confidence": s_(it.get("confidence")), "state": "open", "seal_id": f"{call_id}:{n + 1}",
                  "source_call_at": call_at} for n, it in enumerate(items)]
    return {"ok": True, "via": via, "items": len(items), "who": verdict["state"],
            "ingest": {"calls": [call_row], "items": item_rows, "source_at": at}}


def participants(cell: str, team: str, spoken: str) -> str:
    """The caller's number when the row has none: each number speaking in the dialogue that is not a team line."""
    if re.sub(r"[^0-9]", "", cell):
        return cell
    own = {d[-10:] for d in re.sub(r"[^0-9]", " ", team).split(" ") if len(d) >= 10}
    seen: set[str] = set()
    for num in re.findall(r"\+?1?[0-9]{10}(?=:)", spoken):
        d = re.sub(r"[^0-9]", "", num)[-10:]
        if d not in own and d not in seen:
            seen.add(d)
            cell = (cell + ", " if cell else "") + "+1" + d
    return cell


def sweep_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commCallsSweep_'s reading half: the inbox's newest COMM_SWEEP_NEWEST_ROWS calls, each one the calls house does
    not hold read by the model with its caller resolved, while the pass has time. The hand-overs to keep (`plans`),
    the sweep's tally so far, and `more` when a call was left for the next pass; with nothing to keep the sweep's log
    line is said here."""
    user = sess.user or {}
    if not user.get("is_service") and s_(user.get("role")) != "admin":
        return dict(DENIED)
    reads = sess.reads
    if not declared(reads, CALLS_TAB) or not declared(reads, ITEMS_TAB):
        return {"status": 503, "message": "The comm_calls houses are not declared."}
    owned(reads)
    ref = _inbox(reads)
    if ref is None:
        return {"status": 503, "message": "the transcripts inbox is not reachable"}
    known = _known(reads)
    zone = gsjs.book_zone(ref.sheet_id, reads.db.prop)
    direct, ids = CM._read_columns(reads, ref, {"id": INBOX_SPEC["id"]})
    newest: list[tuple[int, str]] = []
    for rn, r in reversed(ids):
        if len(newest) >= SWEEP_NEWEST_ROWS:
            break
        cid = cut(s_(_value(r["id"], direct, zone)), 60)
        if cid:
            newest.append((rn, cid))
    want = [cid for _rn, cid in newest if cid not in known]
    full: dict[int, dict] = {}
    if want:
        direct, got = CM._read_columns(reads, ref, INBOX_SPEC, near=("contains", ("id",), want))
        full = {rn: {k: _value(v, direct, zone) for k, v in r.items()} for rn, r in got}
    tally: dict[str, Any] = {"looked_at": 0, "classified": 0, "items": 0, "already_read": 0, "failed": 0,
                             "failures": []}
    plans: list[dict] = []
    more, asked = False, 0
    started = time.monotonic()
    deadline = started + CALL_DEADLINE_S
    for rn, cid in newest:
        if cid in known:
            tally["looked_at"] += 1
            tally["already_read"] += 1
            continue
        row = full.get(rn)
        if row is None or cut(s_(row.get("id")), 60) != cid:
            continue
        if time.monotonic() - started > FETCH_BUDGET_S:
            more = True
            break
        try:
            got = classify(reads, {
                "call_id": cid, "event_at": s_(_first(row.get("event"), row.get("created"), row.get("received"))),
                "duration_s": row.get("secs"), "direction": row.get("dir"), "turns": row.get("turns"),
                "full_transcript": s_(row.get("full")), "speaker_transcript": s_(row.get("spoken")),
                "team_members": s_(row.get("team")),
                "participants": participants(s_(row.get("who")), s_(row.get("team")), s_(row.get("spoken")))},
                deadline)
        except Exception as exc:  # noqa: BLE001 - said as Apps Script says it
            got = {"ok": False, "why": "threw: " + cut(s_(str(exc)), 120)}
        # a call the deadline cut short is read by the next pass; one that alone outlasts a pass is a failure
        if got.get("late") and asked:
            more = True
            break
        asked += 1
        tally["looked_at"] += 1
        if got.get("ok"):
            plans.append({"call_id": cid, "ingest": got["ingest"], "items": got["items"], "via": got["via"],
                          "who": got["who"]})
        else:
            tally["failed"] += 1
            tally["failures"].append(cut(cid, 12) + ": " + cut(s_(got.get("why")), 80))
        if got.get("late"):
            more = True
            break
    if not plans:
        sweep_said(tally)
    return {"status": 200, "data": {**sweep_answer(tally), "plans": plans, "tally": tally, "more": more}}


def sweep_tally(v: Any) -> dict[str, Any]:
    """The sweep's tally as a later pass is handed it."""
    t = v if isinstance(v, dict) else {}
    out: dict[str, Any] = {}
    for k in ("looked_at", "classified", "items", "already_read", "failed"):
        try:
            out[k] = max(0, int(t.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    out["failures"] = [s_(f) for f in (t.get("failures") or []) if isinstance(f, str)][:40]
    return out


def sweep_answer(tally: dict[str, Any]) -> dict[str, Any]:
    """commCallsSweep_'s answer."""
    return {"looked_at": tally["looked_at"], "classified": tally["classified"], "items": tally["items"],
            "already_read": tally["already_read"], "failed": tally["failed"], "failures": tally["failures"][:5]}


def sweep_said(tally: dict[str, Any]) -> None:
    log_line("comm_calls_sweep", f"{tally['classified']} classified · {tally['failed']} failed · "
                                 f"{tally['already_read']} already read")


# ---- the screen's doors -------------------------------------------------------------------------------------------

def _heard(spoken: str, line: str) -> dict[str, bool]:
    """Rung 0's words: the capitalised words of the call's first turns, the agent's own turns left out."""
    company = {d[-10:] for d in re.sub(r"[^0-9]", " ", line).split(" ") if len(d) >= 10}
    heard: dict[str, bool] = {}
    for turn in spoken.split("\n")[:8]:
        tm = re.search(r"\+?1?([0-9]{10})", turn)
        if tm and tm.group(1) in company:
            continue
        for w in re.split(r"[^A-Za-z]+", re.sub(r"^\S+\s+[^:]*:\s*", "", turn, count=1)):
            if len(w) >= 4 and "A" <= w[0] <= "Z":
                heard[w.lower()] = True
    return heard


def _candidate_order(x: dict, y: dict, seen: dict[str, int]) -> int:
    if x["match"] != y["match"]:
        return -1 if x["match"] else 1
    if bool(x["heard"]) != bool(y["heard"]):
        return -1 if x["heard"] else 1
    return seen.get(key(y["name"]), 0) - seen.get(key(x["name"]), 0)


def _names_from(content: Any) -> list:
    """The model's {"names": [...]}, cut to its braces as Apps Script cuts it; none when it will not parse."""
    raw = re.sub(r"[^}\]]*\Z", "", re.sub(r"^[^{\[]*", "", str(content), count=1), count=1)
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    names = parsed.get("names") if isinstance(parsed, dict) else None
    return names if isinstance(names, list) else []


def candidates(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commCallsCandidates: who might have called — candidates, never the verdict. The number's holder, a name like
    theirs said on the call, the role the line answers to, who was named on this line before; still nobody, the
    model's reading of the words, bounded by the roster."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DENIED)
    reads = sess.reads
    owned(reads)
    started = time.monotonic()
    want = cut(text((payload or {}).get("call_id")), 60)
    try:
        calls: list[dict] = reads.hub_rows(CALLS_TAB)
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable house names nobody from it
        calls = []
    caller10 = line_digits = ""
    if want:
        for r in calls:
            if s_(r.get("call_id")) == want:
                caller10 = re.sub(r"[^0-9]", "", s_(gsjs.or_text(r.get("participant_s"))))[-10:]
                line_digits = re.sub(r"[^0-9]", "", s_(gsjs.or_text(r.get("line"))))
                break
    line_role = next((role for ld, role in LINE_ROLE_WORDS.items() if line_digits and ld in line_digits), "")
    try:
        people = reads.hub_rows(PEOPLE_TAB)
    except Exception:  # noqa: BLE001 - as Apps Script: no roster, no candidate
        people = []
    active = []
    for p in people:
        if s_(p.get("status")).lower() not in ("active", "admin"):
            continue
        name = s_(p.get("name")) if not gsjs.falsy(p.get("name")) else \
            gsjs.trim(s_(p.get("first_name")) + " " + s_(p.get("last_name")))
        if name:
            active.append({"name": name, "role": s_(p.get("role")),
                           "digits": re.sub(r"[^0-9]", "", s_(p.get("phone")))[-10:]})
    # rung 3, first, because it is cheap: who was named on this line before
    seen: dict[str, int] = {}
    if line_digits and want:
        for h in calls:
            if s_(h.get("call_id")) == want:
                continue
            hd = re.sub(r"[^0-9]", "", s_(gsjs.or_text(h.get("line"))))
            if not hd or hd[-10:] not in line_digits:
                continue
            hn = s_(h.get("name"))
            if hn:
                seen[key(hn)] = seen.get(key(hn), 0) + 1
    # rung 0: the name the caller said, matched against the roster
    heard: dict[str, bool] = {}
    if want:
        try:
            tw = CM.transcript_read(reads, want, user)
            data = tw.get("data") or {}
            spoken = s_(gsjs.or_text(data.get("speaker_transcript")) or data.get("full_transcript")) \
                if tw.get("status") == 200 else ""
            heard = _heard(spoken, s_(data.get("line")))
        except Exception:  # noqa: BLE001 - no words, no heard names: the other rungs still answer
            heard = {}
    out = []
    for c in active:
        match = bool(caller10 and c["digits"] and c["digits"] == caller10)
        role_hit = bool(line_role and line_role.lower() in s_(c["role"]).lower())
        before = seen.get(key(c["name"]), 0)
        parts = re.split(r"[^a-z]+", s_(c["name"]).lower())
        heard_hit = any(len(part) >= 4 and (part.startswith(hw) or hw.startswith(part)) for part in parts
                        for hw in heard)
        if not (match or role_hit or before or heard_hit):
            continue
        out.append({"name": c["name"], "role": c["role"], "phone4": c["digits"][-4:] if c["digits"] else "",
                    "person_key": key(c["name"]), "match": match, "heard": heard_hit,
                    "hint": "the number is theirs" if match else "a name like theirs was said on the call"
                    if heard_hit else "holds the role this line answers to" if role_hit
                    else f"named on {before} previous call(s) on this line"})
    out.sort(key=functools.cmp_to_key(lambda x, y: _candidate_order(x, y, seen)))
    # rung 4: still lost, ask the model, bounded by the roster
    suggested = []
    if not out and want:
        try:
            tw = CM.transcript_read(reads, want, user)
            words = cut(s_((tw.get("data") or {}).get("full_transcript")), 3000) if tw.get("status") == 200 else ""
        except Exception:  # noqa: BLE001 - no words, no question
            words = ""
        if words:
            ask_names = ("A phone call arrived at a company line. The active staff are: "
                         + ", ".join(c["name"] for c in active) + ".\n"
                         "From the transcript alone, name up to 5 people FROM THAT LIST who could plausibly be the "
                         'caller. Answer STRICT JSON only: {"names": ["..."]}. Use only names spelled exactly as in '
                         'the list. If the transcript gives no useful signal, answer {"names": []}.\n\nTranscript:\n'
                         + words)
            try:
                chat = CCS.ai_chat(reads, ask_names, 0, CANDIDATES_AI_REQUEST, started + CANDIDATES_DEADLINE_S)
                if chat.get("ok") and chat.get("content"):
                    for n in _names_from(chat["content"]):
                        for c in active:
                            if key(c["name"]) == key(n):
                                suggested.append({"name": c["name"], "role": c["role"],
                                                  "phone4": c["digits"][-4:] if c["digits"] else "",
                                                  "person_key": key(c["name"]), "match": False, "suggested": True,
                                                  "hint": "the model's reading of the words — a suggestion, never a "
                                                          "verdict"})
            except Exception:  # noqa: BLE001 - a model that will not answer leaves an empty ladder, never a guess
                pass
    return {"status": 200, "data": {"candidates": (out + suggested)[:CANDIDATES_CAP], "active": len(active),
                                    "line_role": line_role}}


# ---- the slices the relay serves ----------------------------------------------------------------------------------

def _slice_text(v: Any) -> str:
    return "" if v is None else v if isinstance(v, str) else gsjs.js_str(v)


def _slice(sess: L.Session, resource: str, order: str) -> dict[str, Any]:
    """comm_calls_slices' rows off Postgres: each header's text, rows of nothing but blanks left out, newest first."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(SERVICE_ONLY)
    reads = sess.reads
    owned(reads)
    cols = [c for c in RR.columns(reads, resource) if c]
    out = []
    for _k, cells in RR.table_rows(reads, resource):
        row = {h: _slice_text(cells.get(h)) for h in cols}
        if any(v.strip() for v in row.values()):
            out.append(row)
    out.sort(key=lambda r: r.get(order) or "", reverse=True)
    return {"status": 200, "data": out}


def calls_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The commCalls slice."""
    return _slice(sess, CALLS_RES, "call_at")


def items_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The commWorkItems slice."""
    return _slice(sess, ITEMS_RES, "source_call_at")


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "commCallsWho": who, "commCallsSweepFetch": sweep_fetch, "commCallsCandidates": candidates,
    "commCallsList": calls_list, "commWorkItemsList": items_list}
# HUB_POLICY.commCallsWho (admins, managers, the relay), commCallsSweep (admins, the relay) and commCallsCandidates
# (admins); the slices are the relay's
POLICY: dict[str, dict[str, Any]] = {"commCallsWho": {"roles": ("admin", "manager"), "params": {"phones": "array"}},
                                     "commCallsSweepFetch": {"roles": ("admin",)},
                                     "commCallsCandidates": {"roles": ("admin",), "params": {"call_id": "string"}},
                                     "commCallsList": {}, "commWorkItemsList": {}}
