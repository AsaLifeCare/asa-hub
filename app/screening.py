"""The phone screen (Screening.gs, and Comms.gs commsSync and screenWatch) off asa-hub-db: the screen's own read
(screenGet), the drawer's watch tick (screenWatch), and the heavy halves the relay asks before a write — the model's
reading of a call and its report filed in Drive as the platform's account (screenAnalyze), the forced second reading
(screenForceError), the Comms mirror's window, its call summaries and the screening line's calls attached and read
(commsSync), and the same attachment on the relay's clock in place of the Quo sheet's push (screenCollectDue). Each
answer it prepares is sealed by this service for its write; the phone screens are dissolved, so the writes keep facts."""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CDW
import candidates as CND
import client_care_sweeps as CCS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import staff_comms as SCM
import team_alerts as TA
from gsjs import NY
from scope import Defer

APP_ID = "hiring"
CID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$", re.A)
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own read."}
# Screening.gs
WEEKDAYS = ("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
DAY_WORDS = {"monday": "monday", "mon": "monday", "tuesday": "tuesday", "tues": "tuesday", "tue": "tuesday",
             "wednesday": "wednesday", "wed": "wednesday", "thursday": "thursday", "thurs": "thursday",
             "thu": "thursday", "friday": "friday", "fri": "friday", "saturday": "saturday", "sat": "saturday",
             "sunday": "sunday", "sun": "sunday"}
SCREEN_FIELDS = ("screen_date", "screen_status", "notes", "shift_day", "shift_afternoon", "shift_night", "hours_prn",
                 "hours_pt", "hours_ft", "current_rate", "cert_dodd", "cert_cpr_first_aid", "cert_med_del", "has_dl",
                 "has_vehicle", "has_insurance", "behavioral_care", "every_other_weekend", "male_care",
                 "background_disclosure", "best_in_person_day_time")
QUALIFICATIONS = ("Qualified", "Borderline", "Not Qualified")
TRANSCRIPT_CAP = 11000
REPORT_SIT = "hiring_screen_report"
REPORT_GATE, GRANT_GATE = "gate_screening_report_share", "gate_drive_grant_reader"
# Comms.gs
COMMS_PROP, QUO_PROP = "HUB_COMMS_ID", "QUO_SYNC_SHEET_ID"
WINDOW_DAYS = 7
SCREEN_BOT_LINE = "3307544040"
SCREEN_LINES = (SCREEN_BOT_LINE,)
ANALYZE_CAP = 3
CELL_CAP = 45000
TAIL_ROWS = 300
SUMMARIES_PER_RUN = 12
T_COLS = ("Call ID", "Transcript Created", "Duration (sec)", "Quo Number", "Participant(s)", "Team Member(s)",
          "Direction", "# Turns", "Full Transcript", "Speaker Transcript", "Status")
M_COLS = ("Message ID", "Message Created", "Status", "Quo Number", "External Participant(s)", "Team Member",
          "Direction", "Message Type", "Body", "Attachment URLs", "Conversation ID")
S_COLS = ("call_id", "created", "quo_number", "participants", "direction", "duration_sec", "summary", "model",
          "summarized_at")
STAGE_GRACE_MS = 300000
MIN_SCREEN_SEC = 60
READY_TTL_S = 120
WATCH_TAIL, CLOCK_TAIL = 25, 25
# the heavy halves stop starting new model calls past these, inside the relay's prepare wait (110 s)
PREPARE_BUDGET_S = 95.0
ANALYZE_BUDGET_S = 80.0
PREPARED_MAX_S = 900
_SEAL_KEY = os.getenv("HUB_APP_TOKEN", "").encode() or os.urandom(32)
_SPEAKER = re.compile(r"\]\s*([^:\n]{3,40}):")
_DAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri|sat"
                     r"|sun)\b", re.A)
_PLAYBACK = re.compile(r"\[\s*\d{1,2}\s*:\s*\d{2}\s*\]", re.A)
_CLOCK_FULL = re.compile(r"\b(\d{1,2})\s*[:h]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)", re.A)
_CLOCK_HOUR = re.compile(r"\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)", re.A)
_HHMM = re.compile(r"^\d{1,2}:\d{2}$", re.A)
_DAY_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$", re.A)
_ISO_DAY_ONLY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$", re.A)

s_ = gsjs.str_


# ---- small helpers --------------------------------------------------------------------------------------------------

def strings(reads: L.Reads, key: str, var: dict | None = None) -> str:
    """bookText_('Strings', key) rendered as hiringRenderMail_ does."""
    return CND.render(CND.book_text(reads, "Strings", key, ""), var or {})


def prompt_text(reads: L.Reads, key: str) -> str:
    """bookText_('Prompts', key, '')."""
    return CND.book_text(reads, "Prompts", key, "")


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return s_((user or {}).get("role")) in ("admin", "manager")


def service(user: dict | None) -> bool:
    return (user or {}).get("is_service") is True


def actor(user: dict | None) -> str:
    return "service" if service(user) else s_((user or {}).get("email"))


def norm(col: str) -> str:
    return hubdb.norm_key(col)


def pad2(n: int) -> str:
    return ("0" if n < 10 else "") + str(n)


def js_slice(v: Any, n: int) -> str:
    return CDW.js_slice(gsjs.or_blank(v), n)


def laid(row: dict | None, fields: dict[str, Any]) -> dict:
    """A record's row with fields written over it, keyed as its facts read back."""
    out = dict(row or {})
    for k, v in fields.items():
        out[norm(k)] = gsjs.or_blank(v)
    return out


def iso_now(reads: L.Reads) -> str:
    return gsjs.iso(reads.now)


def hex_id(prefix: str, n: int) -> str:
    """randomHex_(n).toUpperCase() under its prefix."""
    return prefix + secrets.token_hex((n + 1) // 2)[:n].upper()


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


# ---- the candidate and the screen ----------------------------------------------------------------------------------

def evidence(reads: L.Reads, cid: str) -> tuple[dict | None, dict | None]:
    """hubEvidence_'s candidate and phone screen (None when there is none)."""
    ev = CND.evidence(reads, cid)
    return ev.get("cand"), ev.get("screen")


def dissolved_or_defer(reads: L.Reads) -> None:
    """The phone screens and the candidates are written as facts only while their tabs are dissolved."""
    for tab in (CDW.CANDIDATES, CDW.PHONE):
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


def test_card(reads: L.Reads, c: dict | None) -> bool:
    """commsIsTestCandidate_."""
    return bool(c) and TA.test_card(reads, c)


# ---- the calendar (Screening.gs) -----------------------------------------------------------------------------------

def hiring_zone(reads: L.Reads) -> Any:
    """hiringTimeZone_."""
    got, _why = CND.soft(lambda: s_(reads.config().get("hiring_timezone")))
    return gsjs.zone(got or "America/New_York")


def when_safe(reads: L.Reads, raw: Any) -> datetime:
    """commsWhenSafe_: the instant a cell names, else now."""
    t = None
    if s_(raw):
        try:
            t = CND.js_date_ms(raw)
        except Defer:
            t = None
    return datetime.fromtimestamp(t / 1000.0, timezone.utc) if t is not None else reads.now


def call_raw(s: dict | None) -> Any:
    """screenRow.transcriptcreated || screenRow.screendate."""
    s = s or {}
    return s.get("transcriptcreated") if not gsjs.falsy(s.get("transcriptcreated")) else s.get("screendate")


def slot_from_text(transcript: Any) -> dict[str, str]:
    """screenSlotFromText_: no model, the last weekday spoken and the clock and period near it."""
    out = {"interview_weekday": "", "interview_period": "", "interview_time": "", "interview_date": ""}
    t = gsjs.or_text(transcript)
    if not t:
        return out
    low = _PLAYBACK.sub(" ", t.lower())
    last_at, last_day = -1, ""
    for m in _DAY_RE.finditer(low):
        last_at, last_day = m.start(), DAY_WORDS.get(m.group(1), "")
    if not last_day:
        return out
    out["interview_weekday"] = last_day[:1].upper() + last_day[1:]
    near = low[max(0, last_at - 120):last_at + 120]
    clock = _CLOCK_FULL.search(near)
    if clock:
        hh, mins, ampm = int(clock.group(1)), int(clock.group(2)), clock.group(3)
    else:
        clock = _CLOCK_HOUR.search(near)
        if clock:
            hh, mins, ampm = int(clock.group(1)), 0, clock.group(2)
    if clock:
        ampm = ampm.replace(".", "").lower()
        if ampm.startswith("p") and hh < 12:
            hh += 12
        if ampm.startswith("a") and hh == 12:
            hh = 0
        if 0 <= hh <= 23:
            out["interview_time"] = pad2(hh) + ":" + pad2(mins)
    if re.search(r"\bmorning\b", near, re.A):
        out["interview_period"] = "morning"
    elif re.search(r"\bafternoon\b", near, re.A):
        out["interview_period"] = "afternoon"
    elif re.search(r"\bevening\b|\bnight\b", near, re.A):
        out["interview_period"] = "evening"
    return out


def _local_label(at: datetime) -> str:
    local = at.astimezone(NY)
    return f"{local.year:04d}-{pad2(local.month)}-{pad2(local.day)} {pad2(local.hour)}:{pad2(local.minute)}"


def _js_local(raw: str) -> datetime | None:
    """new Date(raw) for the shapes a reading writes: a bare day is UTC, a day and clock the script's own (New York)."""
    m = _ISO_DAY_ONLY.match(raw)
    try:
        if m:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
        m = _DAY_TIME.match(raw)
        if m:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)),
                            int(m.group(6) or 0), tzinfo=NY)
    except ValueError:
        return None
    t = gsjs.date_parse(raw)
    if t is None:
        try:
            t = CND.js_date_ms(raw)
        except Defer:
            t = None
    return datetime.fromtimestamp(t / 1000.0, timezone.utc) if t is not None else None


def business_day(when: Any) -> str:
    """hubBusinessDay_: a Saturday or a Sunday rolls to Monday at the same clock; anything else as it came."""
    raw = s_(when)
    if not raw:
        return ""
    d = _js_local(raw.replace(" ", "T", 1))
    if d is None:
        return raw
    local = d.astimezone(NY)
    dow = (local.weekday() + 1) % 7
    if dow == 6:
        shift = 2
    elif dow == 0:
        shift = 1
    else:
        return raw
    moved = datetime(local.year, local.month, local.day, local.hour, local.minute, tzinfo=NY) + timedelta(days=shift)
    return _local_label(moved)


def resolve_interview_date(reads: L.Reads, analysis: dict, s: dict | None) -> str:
    """hubResolveInterviewDate_: the weekday counted from the call's own day (said on that weekday = next week), at
    the clock said or the period's hour, rolled off a weekend; an explicit date as it came."""
    a = analysis if isinstance(analysis, dict) else {}
    period = s_(a.get("interview_period")).lower()
    clock = s_(a.get("interview_time"))
    hh, mm = 14, 0
    if _HHMM.match(clock):
        hh, mm = int(clock.split(":")[0]), int(clock.split(":")[1])
    elif period in ("morning", "afternoon", "evening"):
        ph = CND.js_parse_int(CND.book_text(reads, "Strings", "hours." + period, ""))
        if ph == ph:
            hh = int(ph)
    explicit = s_(a.get("interview_date")) or s_(a.get("best_in_person_day_time"))
    weekday = s_(a.get("interview_weekday")).lower()
    target = WEEKDAYS.index(weekday) if weekday in WEEKDAYS else -1
    base = when_safe(reads, s_(call_raw(s)))
    if target == -1:
        if not explicit:
            return ""
        return business_day(explicit if ":" in explicit else explicit + " " + pad2(hh) + ":" + pad2(mm))
    today = (base.astimezone(hiring_zone(reads)).weekday() + 1) % 7
    delta = (target - today + 7) % 7 or 7
    local = base.astimezone(NY)
    day = datetime(local.year, local.month, local.day, tzinfo=NY) + timedelta(days=delta)
    try:
        at = datetime(day.year, day.month, day.day, hh, mm, tzinfo=NY)
    except ValueError:
        return ""
    return business_day(_local_label(at))


def call_date_label(reads: L.Reads, s: dict | None) -> str:
    """hubCallDateLabel_: the call's day and weekday on the hiring clock."""
    d = when_safe(reads, s_(call_raw(s))).astimezone(hiring_zone(reads))
    return d.strftime("%Y-%m-%d") + " (" + d.strftime("%A") + ")"


# ---- the model (screenAiChat_) -------------------------------------------------------------------------------------

def ai(reads: L.Reads, prompt: str, temperature: float, request_id: str, deadline: float) -> dict[str, Any]:
    """screenAiChat_: every provider in turn; a pass out of time is a provider that did not answer."""
    if not prompt:
        return {"ok": False, "content": "", "via": "", "error": "prompt_cell_empty"}
    if time.monotonic() > deadline - 3:
        return {"ok": False, "content": "", "via": "", "error": "out_of_time"}
    got = CCS.ai_chat(reads, prompt, temperature, request_id, deadline)
    if got.get("late"):
        got["ok"] = False
        got["error"] = (s_(got.get("error")) + "+" if s_(got.get("error")) else "") + "out_of_time"
    return got


def parsed(content: Any) -> Any:
    """JSON.parse; a throw is None."""
    try:
        return json.loads(gsjs.or_blank(content))
    except ValueError:
        return None


def force_date_accepted(reads: L.Reads, s: dict | None, transcript: str, deadline: float) -> str:
    """hubForceDateAccepted_: a single-purpose second reading for the accepted slot."""
    prompt = prompt_text(reads, "ai_date_accepted").replace("{call_date}", call_date_label(reads, s)) \
        .replace("{transcript}", js_slice(transcript, TRANSCRIPT_CAP))
    try:
        chat = ai(reads, prompt, 0, "ai_date_accepted", deadline) if prompt else {"ok": False}
        if not chat.get("ok"):
            return ""
        second = parsed(chat.get("content"))
        if not isinstance(second, dict):
            return ""
        return resolve_interview_date(reads, second, s)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: a reading that throws reads nothing
        return ""


# ---- Drive: the report and who may read it --------------------------------------------------------------------------

DRIVE_API = "https://www.googleapis.com/drive/v3/files"
GRANT_TRIES, GRANT_PAUSE_S = 3, 0.8


def _send(drv: Any, req: urllib.request.Request) -> dict[str, Any]:
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b"{}")


def report_doc(drv: Any, name: str, body: str) -> str:
    """The report written as a Google Doc in the platform account's own Drive (a multipart upload converted); its id."""
    auth = drv._owner_write("a report is written in Drive")
    boundary = "hubrep" + secrets.token_hex(6)
    meta = json.dumps({"name": name, "mimeType": "application/vnd.google-apps.document"})
    data = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: text/plain; "
            f"charset=UTF-8\r\n\r\n{body}\r\n--{boundary}--").encode()
    req = urllib.request.Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
                                 "&supportsAllDrives=true&fields=id", data=data,
                                 headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                 method="POST")
    fid = s_(_send(drv, req).get("id"))
    if not fid:
        raise ValueError("Drive named no document for the report")
    return fid


def _refusal(code: int, body: str) -> str:
    """hubShareRefusalReason_."""
    msg = ""
    try:
        j = json.loads(body)
        err = (j or {}).get("error") or {}
        msg = s_(err.get("message") or ((err.get("errors") or [{}])[0] or {}).get("message"))
    except (ValueError, AttributeError, IndexError, TypeError):
        msg = ""
    if not msg:
        msg = re.sub(r"\s+", " ", body or "").strip()[:180]
    if code == 0:
        return "the call to Drive never landed — " + (msg or "no answer")
    if code == 400 and re.search(r"no Google account|invalidSharingRequest", body or "", re.I):
        return ("HTTP 400 — that address has no Google account, and Drive will only seat one of those by sending its "
                "own \"shared with you\" letter")
    return "HTTP " + str(code) + (" — " + msg if msg else "")


def _transient(code: int, body: str) -> bool:
    """hubShareRefusalIsTransient_."""
    if code == 0 or code == 429 or code >= 500:
        return True
    return code == 403 and bool(re.search(r"rateLimit|userRateLimit|sharingRateLimit|backendError|internalError",
                                          body or "", re.I))


def grant_reader(reads: L.Reads, drv: Any, fid: str, who: str) -> dict[str, Any]:
    """hubGrantReader_: a reader seat granted in silence (no Google letter), retried while Drive takes its refusal
    back; held while its gate holds."""
    out: dict[str, Any] = {"ok": False, "email": who, "code": 0, "reason": "", "held": False, "file_id": fid}
    why = CP.gate_holds(reads, GRANT_GATE)
    if why:
        out.update(reason=why, held=True)
        return out
    auth = drv._owner_write("reader access is granted in Drive")
    url = f"{DRIVE_API}/{urllib.parse.quote(fid)}/permissions?sendNotificationEmail=false&supportsAllDrives=true"
    for attempt in range(1, GRANT_TRIES + 1):
        code, body = 0, ""
        req = urllib.request.Request(url, data=json.dumps({"role": "reader", "type": "user",
                                                           "emailAddress": who}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                code = res.status
        except urllib.error.HTTPError as e:
            code, body = e.code, e.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - a call that never landed is the most retriable refusal
            code, body = 0, str(e)
        out["code"] = code
        if 200 <= code < 300:
            out["ok"] = True
            return out
        out["reason"] = _refusal(code, body)
        if attempt >= GRANT_TRIES or not _transient(code, body):
            break
        time.sleep(GRANT_PAUSE_S * attempt)
    return out


def admin_emails(reads: L.Reads) -> list[str]:
    """hubAdminEmails_: every admin's address on the users tab, once each."""
    out: list[str] = []
    got, _why = CND.soft(reads.users)
    for u in got or []:
        if s_(u.get("role")).lower() != "admin":
            continue
        mail = s_(u.get("email"))
        if mail and "@" in mail and mail not in out:
            out.append(mail)
    return out


def share_with_admins(reads: L.Reads, drv: Any, fid: str) -> dict[str, Any]:
    """hubShareWithAdmins_: every admin a reader; how many were let in, and who was not."""
    admins = admin_emails(reads)
    shared, failed, held_why = 0, [], ""
    for who in admins:
        said = grant_reader(reads, drv, fid, who)
        if said["ok"]:
            shared += 1
        else:
            failed.append(who)
            if said.get("held"):
                held_why = s_(said.get("reason")) or "held by its gate"
    return {"shared": shared, "total": len(admins), "failed": failed, "held_why": held_why}


# ---- the analysis (screenAnalyze's heavy half) ----------------------------------------------------------------------

def facts_block(s: dict) -> str:
    return "\n".join(f + ": " + s_(s.get(norm(f))) for f in SCREEN_FIELDS)


def analyze(reads: L.Reads, cid: str, cand: dict, s: dict, deadline: float) -> dict[str, Any]:
    """screenAnalyze: the model's reading of the call (the questionnaire beside it), its report written in Drive and
    handed to the administrators, and the accepted in-person slot — the analysis first, then a single-purpose second
    reading, then the words themselves. No model still costs nothing but the score: the slot read from the words.
    {status, kind, fields, data} for its write; a refusal otherwise."""
    facts = facts_block(s)
    transcript = s_(s.get("transcripttext"))
    block = prompt_text(reads, "ai_phone_screen_transcript_block").replace(
        "{transcript}", js_slice(transcript, TRANSCRIPT_CAP)) if transcript else ""
    prompt = prompt_text(reads, "ai_phone_screen") \
        .replace("{evidence}", prompt_text(reads, "ai_phone_screen_evidence_call" if transcript
                                           else "ai_phone_screen_evidence_form")) \
        .replace("{call_date}", call_date_label(reads, s)) \
        .replace("{name}", s_(cand.get("candidatename"))) \
        .replace("{facts}", facts) \
        .replace("{transcript_block}", block)
    chat = ai(reads, prompt, 0.2, "ai_phone_screen", deadline)
    if not chat.get("ok"):
        only = slot_from_text(transcript)
        slot = resolve_interview_date(reads, only, s) if only["interview_weekday"] else ""
        if slot and not s_(s.get("bestinpersondaytime")):
            return {"status": 200, "kind": "slot", "fields": {"best_in_person_day_time": slot},
                    "data": {"score": "", "qualification": "", "summary": "", "concerns": [], "report_url": "",
                             "analysis_missing": s_(chat.get("error")), "best_in_person_day_time": slot,
                             "note": strings(reads, "screen.note.no_model")}}
        return {"status": 502, "message": strings(reads, "refuse.model_silent", {"error": s_(chat.get("error"))})}
    analysis = parsed(chat.get("content"))
    if analysis is None:
        return {"status": 502, "message": strings(reads, "refuse.bad_shape")}
    if not isinstance(analysis, dict):
        analysis = {}
    n = CND.js_parse_int(analysis.get("score"))
    score = max(0, min(10, int(n) if n == n and n else 0))
    qual = s_(analysis.get("qualification")) if s_(analysis.get("qualification")) in QUALIFICATIONS else "Borderline"
    concerns = analysis.get("concerns")
    concern_list = [s_(c) for c in concerns] if isinstance(concerns, list) else []
    report_url, report_share = "", None
    try:
        if not isinstance(concerns, (list, type(None))) and not gsjs.falsy(concerns):
            raise TypeError("the concerns are not a list")
        drv = reads.need_drive()
        evidence_line = ("\n" + strings(reads, "report.doc.evidence", {"chars": str(len(transcript))})
                         if transcript else "")
        body = strings(reads, "report.doc.body", {
            "name": s_(cand.get("candidatename")), "date": iso_now(reads)[:10], "score": str(score),
            "qualification": qual, "evidence": evidence_line, "summary": s_(analysis.get("summary")),
            "concerns": "\n- ".join(concern_list), "facts": facts})
        fid = report_doc(drv, strings(reads, "report.doc.title", {"name": s_(cand.get("candidatename"))}), body)
        held = CP.gate_holds(reads, REPORT_GATE)
        if not held:
            admins = admin_emails(reads)
            granted, last_why = 0, ""
            for who in admins:
                said = grant_reader(reads, drv, fid, who)
                if said["ok"]:
                    granted += 1
                elif said.get("reason"):
                    last_why = s_(said["reason"])
            report_share = {"shared": granted > 0 and granted == len(admins), "granted": granted, "of": len(admins),
                            "why": "" if granted == len(admins) else last_why}
        else:
            report_share = {"shared": False, "granted": 0, "of": 0, "why": held}
        report_url = "https://docs.google.com/document/d/" + fid + "/edit"
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - as the .gs: no report (Drive out of reach included) costs only the link
        report_url = ""
    fields: dict[str, str] = {"qualification": qual, "screen_score": str(score)}
    if report_url:
        fields["phone_screen_report_url"] = report_url
    when = resolve_interview_date(reads, analysis, s)
    best = s_(s.get("bestinpersondaytime"))
    if not when and transcript and not best:
        when = force_date_accepted(reads, s, transcript, deadline)
    if not when and transcript and not best:
        guess = slot_from_text(transcript)
        if guess["interview_weekday"]:
            when = resolve_interview_date(reads, guess, s)
    if when and not best:
        fields["best_in_person_day_time"] = when
    return {"status": 200, "kind": "full", "fields": fields, "score": score, "qualification": qual,
            "report_url": report_url,
            "data": {"score": score, "qualification": qual, "summary": s_(analysis.get("summary")),
                     "concerns": concern_list, "report_url": report_url, "report_share": report_share,
                     "date_accepted_alerted": False, "date_accepted_alert": None}}


# ---- the Comms mirror (Comms.gs) ------------------------------------------------------------------------------------

def digits(v: Any) -> str:
    """commsDigits_."""
    return re.sub(r"\D+", "", gsjs.or_blank(v))


def cap(v: Any) -> str:
    """commsCap_: cut to the cell cap, marked when cut."""
    t = gsjs.or_blank(v)
    return CDW.js_slice(t, CELL_CAP) + "\n[truncated]" if len(t.encode("utf-16-le")) // 2 > CELL_CAP else t


def _number(v: Any) -> float:
    """Number(v) || 0."""
    n = CND.js_number(v)
    return 0.0 if n != n else n


def usable(duration: Any, text: str) -> dict[str, Any]:
    """commsScreenUsable_: a real screening — long enough, and both sides speaking when the transcript names them."""
    n = len({m.group(1).strip() for m in _SPEAKER.finditer(text or "")})
    secs = _number(duration)
    return {"ok": secs >= MIN_SCREEN_SEC and (n == 0 or n >= 2), "secs": secs, "speakers": n}


def screen_line(d: str) -> bool:
    """commsIsScreenLine_."""
    return d in SCREEN_LINES


def _book(reads: L.Reads, prop: str) -> str:
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop(prop)))
    if not sid:
        raise hubdb.Unreadable(f"{prop} names no book")
    return sid


def comms_ref(reads: L.Reads, tab: str) -> tuple[str, hubdb.TabRef | None]:
    sid = _book(reads, COMMS_PROP)
    return sid, HT.tab_of(reads, sid, tab, f"{COMMS_PROP} {tab}")


def comms_rows(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), tab), off asa-hub-db's copy with Python's edits laid."""
    def read() -> list[dict]:
        _sid, ref = comms_ref(reads, tab)
        if ref is None:
            raise RuntimeError("Comms tab missing: " + tab)
        return SCM._normalized(reads, ref, False)
    return [dict(r) for r in reads.once("screening:comms:" + tab, read)]


def ignored_calls(reads: L.Reads) -> set[str]:
    """commsIgnoredCalls_: the calls retired by hand; none while the tab is not there."""
    try:
        return {s_(r.get("callid")) for r in comms_rows(reads, "ignored_calls") if s_(r.get("callid"))}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - the tab not created yet
        return set()


def history_rows(reads: L.Reads) -> list[dict]:
    """commsHistoryRows_: log_status_history, empty while the tab does not exist."""
    def read() -> list[dict]:
        if HT.tabled(CDW.STATUS_TAB):
            return hubdb.normalize(*HT.raw(reads, CDW.STATUS_TAB))
        res = reads.db.resolve(CDW.STATUS_TAB)
        return reads.db.normalized_rows(res.ref) if res.ref is not None else []
    got, _why = CND.soft(lambda: reads.once("screening:history", read))
    return got or []


def call_floor_ms(cid: str, history: list[dict]) -> float:
    """commsCallFloorMs_: the last entry into the Phone Screen stage, less the grace; 0 for none."""
    when = None
    for h in history:
        if s_(h.get("candidateid")) != cid or s_(h.get("tostatus")).lower() != "phone screen":
            continue
        try:
            t = CND.js_date_ms(s_(h.get("timestamp")))
        except Defer:
            t = None
        if t is not None:
            when = t
    return when - STAGE_GRACE_MS if when is not None else 0.0


def card_floor_ms(c: dict) -> float:
    """commsTestCardFloorMs_ (commsCardWhenMs_)."""
    try:
        t = CND.js_date_ms(s_(c.get("createdat")) or s_(c.get("updatedat")))
    except Defer:
        t = None
    return t or 0.0


def when_ms(v: Any) -> float | None:
    """commsWhen_ for a cell the mirror wrote as text."""
    if not s_(v):
        return None
    try:
        return CND.js_date_ms(v)
    except Defer:
        return None


def screened_by(reads: L.Reads, quo_d: str, team: Any) -> str:
    """commsScreenedBy_."""
    if quo_d == SCREEN_BOT_LINE:
        return "asa-hub:auto-collect"
    parts = [p.strip() for p in re.split(r"[,;]", s_(team)) if p.strip()]
    if not parts:
        return "recruiter call"
    if len(parts) > 1:
        return "recruiter call — " + " + ".join(parts)
    d = digits(parts[0])[-10:]
    name = ""
    if d and d not in CND.SHARED_LINE_DIGITS:
        for u in CND.soft(reads.users)[0] or []:
            if s_(u.get("displayname")) and d in [digits(x)[-10:] for x in
                                                  [s_(u.get("phone"))] + re.split(r"[,;|]", s_(u.get("phones")))]:
                name = s_(u.get("displayname"))
                break
    return "recruiter call — " + (name or parts[0])


def screen_index(reads: L.Reads) -> dict[str, Any]:
    """What every phone screen says to the collection: the calls done, the unscored ones, who has a screen, when its
    call was, the Use The Last floor, the held cards."""
    out: dict[str, Any] = {"done": set(), "unscored": {}, "has": set(), "when": {}, "reset": {}, "hold": set()}
    for sr in CND.read_tab(reads, CND.TALENT_PHONE_TAB):
        c0 = s_(sr.get("candidateid"))
        call = s_(sr.get("transcriptcallid"))
        if call:
            out["done"].add(call)
        if c0 and call:
            if s_(sr.get("screenscore")):
                out["unscored"].pop(call, None)
            else:
                out["unscored"][call] = c0
        if c0 and (s_(sr.get("transcripttext")) or call or s_(sr.get("screenstatus")).lower() == "completed"):
            out["has"].add(c0)
        w0 = when_ms(s_(sr.get("transcriptcreated")) or s_(sr.get("screendate")))
        if c0 and w0 is not None:
            out["when"][c0] = max(out["when"].get(c0, 0.0), w0)
        rf = when_ms(sr.get("uselastresetat"))
        if c0 and rf is not None:
            out["reset"][c0] = max(out["reset"].get(c0, 0.0), rf)
        if c0 and s_(sr.get("errorhold")).lower() == "true":
            out["hold"].add(c0)
    return out


def phone_screen_cards(reads: L.Reads, only: str = "") -> tuple[dict[str, dict], dict | None]:
    """The candidates at the Phone Screen stage by their ten digits, and the newest test card."""
    by_phone: dict[str, dict] = {}
    test = None
    for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
        if CND.stage_of(c.get("status")) != "phone-screen":
            continue
        if only and s_(c.get("candidateid")) != only:
            continue
        if test_card(reads, c):
            if test is None or card_floor_ms(c) >= card_floor_ms(test):
                test = c
            continue
        p = digits(c.get("phone"))[-10:]
        if not p or p in CND.SHARED_LINE_DIGITS:
            continue
        by_phone[p] = c
    return by_phone, test


def quo_zone(reads: L.Reads) -> str:
    return gsjs.book_zone(reads.db.prop(QUO_PROP), reads.db.prop) or "America/Sao_Paulo"


def quo_tail(reads: L.Reads, n: int) -> list[dict]:
    """The last n rows of the Quo Transcripts tab, each cell as String() of what getValues hands back; None when the
    tab is not there."""
    sid = _book(reads, QUO_PROP)
    ref = reads.tab_of(sid, "Transcripts", "the Quo Transcripts tab")
    if ref is None:
        return None  # type: ignore[return-value]
    rows = reads.db.rows(ref)
    zone = quo_zone(reads)
    out = []
    for _rn, raw in rows[-n:]:
        row = {h: gsjs.or_blank(v) for h, v in raw.items()}
        at = gsjs.parse_when(raw.get("Transcript Created"), zone)
        row["_when"] = at.timestamp() * 1000.0 if at is not None else None
        row["_created_text"] = gsjs.js_str(gsjs.SheetDate(at)) if at is not None else row.get("Transcript Created", "")
        row["_created_iso"] = gsjs.iso(at) if at is not None else s_(row.get("Transcript Created"))
        out.append(row)
    return out


# ---- the collection of one screening call (commsCollectFromQuoTail_ / commsAutoCollectScreens_) ---------------------

def attach_fields(reads: L.Reads, call: dict, created: str, text: str, by: str, overwriting: bool) -> dict[str, str]:
    fields = {"screen_date": created, "screen_status": "Completed", "transcript_text": cap(text),
              "transcript_call_id": call["callid"], "transcript_created": created, "transcript_pulled_at":
              iso_now(reads), "screened_by": by, "phone_screen_id": hex_id("PS_", 16)}
    if overwriting:
        fields.update(screen_score="", qualification="", phone_screen_report_url="", final_result="",
                      best_in_person_day_time="")
    return fields


def collect(reads: L.Reads, calls: list[dict], only: str = "", window: bool = False,
            summaries: dict[str, str] | None = None) -> dict[str, Any]:
    """Every screening-line call, newest first, attached to the candidate at the Phone Screen stage it belongs to: a
    real candidate's screen is never overwritten, a test card only moves forward to a newer call; never a call from
    before their arrival at the stage (nor, for a test card, before the card or its last reset), never a hung-up
    one. `calls` are {callid, quo, part, team, when, created, text, secs}; `window` is the 15-minute lane's (its debt
    of attached calls never judged comes back too)."""
    idx = screen_index(reads)
    ignored = ignored_calls(reads)
    history = history_rows(reads)
    by_phone, test = phone_screen_cards(reads, only)
    floors: dict[str, float] = {}
    run: set[str] = set()
    attaches: list[dict] = []
    debt: list[str] = []
    for call in calls:
        if not screen_line(call["quo"]):
            continue
        cid0 = call["callid"]
        if not cid0 or cid0 in ignored:
            continue
        if cid0 in idx["done"]:
            owed = idx["unscored"].get(cid0)
            if window and owed and owed not in idx["hold"] and owed not in debt:
                debt.append(owed)
            continue
        part = call["part"]
        cand = (by_phone.get(part) if part and part not in CND.SHARED_LINE_DIGITS else test)
        if cand is None:
            continue
        cid = s_(cand.get("candidateid"))
        is_test = test_card(reads, cand)
        if cid in run or cid in idx["hold"]:
            continue
        if cid in idx["has"] and not is_test:
            continue
        if is_test and idx["when"].get(cid):
            if call["when"] is None or call["when"] <= idx["when"][cid]:
                continue
        if cid not in floors:
            floors[cid] = call_floor_ms(cid, history)
            if is_test:
                floors[cid] = max(floors[cid] or 0.0, card_floor_ms(cand), idx["reset"].get(cid, 0.0))
        if floors[cid] and (call["when"] is None or call["when"] < floors[cid]):
            continue
        if not call["text"]:
            continue
        if not usable(call["secs"], call["text"])["ok"]:
            continue
        overwriting = is_test and cid in idx["has"]
        fields = attach_fields(reads, call, call["created"], call["text"], call["by"], overwriting)
        if window:
            summary = (summaries or {}).get(cid0)
            if summary is None:
                rows, _why = CND.soft(lambda: comms_rows(reads, "summaries"))
                got = next((r for r in reversed(rows or []) if s_(r.get("callid")) == cid0), None)
                summary = s_(got.get("summary")) if got else ""
            existing = s_((CND.evidence(reads, cid).get("screen") or {}).get("notes"))
            if summary and (overwriting or not existing):
                fields["notes"] = "Summary: " + summary
            elif overwriting:
                fields["notes"] = ""
        elif overwriting:
            fields["notes"] = ""
        idx["has"].add(cid)
        idx["done"].add(cid0)
        run.add(cid)
        attaches.append({"cid": cid, "name": s_(cand.get("candidatename")), "call_id": cid0,
                         "created": call["created"], "chars": len(call["text"]), "fields": fields})
    return {"attaches": attaches, "debt": debt}


def tail_calls(reads: L.Reads, n: int) -> list[dict] | None:
    """The Quo tail as calls, newest first (commsCollectFromQuoTail_'s reading of the live sheet)."""
    rows = quo_tail(reads, n)
    if rows is None:
        return None
    out = []
    for r in reversed(rows):
        out.append({"callid": s_(r.get("Call ID")), "quo": digits(r.get("Quo Number"))[-10:],
                    "part": digits(r.get("Participant(s)"))[-10:], "team": r.get("Team Member(s)"),
                    "when": r["_when"], "created": r["_created_iso"],
                    "text": s_(r.get("Speaker Transcript")) or s_(r.get("Full Transcript")),
                    "secs": r.get("Duration (sec)") if "Duration (sec)" in r else 0, "by": "asa-hub:auto-collect"})
    return out


def analyses_for(reads: L.Reads, attaches: list[dict], extra: list[str], cap_n: int, deadline: float) -> dict[str, Any]:
    """screenAnalyze for each attached card (its call laid over its screen), then the debt, up to the cap and the
    clock: {cid: plan}, how many were started, how many of the debt were examined."""
    plans: dict[str, dict] = {}
    done = examined = 0
    order = [a["cid"] for a in attaches] + [c for c in extra if c not in {a["cid"] for a in attaches}]
    fresh = {a["cid"]: a["fields"] for a in attaches}
    for cid in order:
        if done >= cap_n or time.monotonic() > deadline:
            break
        if cid not in fresh:
            examined += 1
        done += 1
        cand, s = evidence(reads, cid)
        if cand is None:
            plans[cid] = {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
            continue
        s = laid(s, fresh.get(cid, {}))
        try:
            plans[cid] = analyze(reads, cid, cand, s, deadline)
        except (Defer, hubdb.Unreadable):
            raise
        except Exception as e:  # noqa: BLE001 - one card's analysis that throws is that card's, said
            plans[cid] = {"status": 500, "message": str(e)[:200]}
    return {"plans": plans, "done": done, "examined": examined}


# ---- the drawer's parked result (screenReadyPut_) ------------------------------------------------------------------

_PARKED: dict[str, tuple[float, dict]] = {}
_PARKED_LOCK = threading.Lock()


def park(cid: str, data: dict) -> None:
    with _PARKED_LOCK:
        _PARKED[cid] = (time.time() + READY_TTL_S, dict(data))


def parked(cid: str) -> dict | None:
    with _PARKED_LOCK:
        got = _PARKED.get(cid)
        if got is None:
            return None
        if got[0] < time.time():
            _PARKED.pop(cid, None)
            return None
        return dict(got[1])


def unpark(cid: str) -> None:
    with _PARKED_LOCK:
        _PARKED.pop(cid, None)


def ready_of(attach: dict, plan: dict | None, after: dict) -> dict[str, Any]:
    """The parked result of a call just collected: the analysis when it answered, else the screen as it stands."""
    data = (plan or {}).get("data") if (plan or {}).get("status") == 200 else None
    return {"state": "ready", "call_id": attach["call_id"], "created": attach["created"], "chars": attach["chars"],
            "analyzed": bool(data or s_(after.get("phonescreenreporturl"))),
            "qualification": data.get("qualification") if data else s_(after.get("qualification")),
            "score": data.get("score") if data else s_(after.get("screenscore")),
            "summary": s_(data.get("summary")) if data else "",
            "report_url": data.get("report_url") if data else s_(after.get("phonescreenreporturl")),
            "best_in_person_day_time": s_(after.get("bestinpersondaytime"))}


# ---- the doors ------------------------------------------------------------------------------------------------------

def _cid_of(reads: L.Reads, payload: dict) -> tuple[str, dict | None]:
    cid = s_((payload or {}).get("candidate_id"))
    if not CID.match(cid):
        return cid, {"status": 400, "message": strings(reads, "refuse.candidate_id")}
    return cid, None


def screen_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """screenGet: the screen's questionnaire, its verdict and whether a call is on it."""
    reads, user = sess.reads, sess.user or {}
    if not writer(user):
        return dict(DENIED)
    cid, bad = _cid_of(reads, payload)
    if bad:
        return bad
    cand, s = evidence(reads, cid)
    if not cand:
        return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
    out: dict[str, Any] = {}
    if s:
        for f in SCREEN_FIELDS:
            out[f] = s_(s.get(norm(f)))
        out.update(final_result=s_(s.get("finalresult")), qualification=s_(s.get("qualification")),
                   screen_score=s_(s.get("screenscore")), phone_screen_report_url=s_(s.get("phonescreenreporturl")),
                   has_transcript=bool(s_(s.get("transcripttext")) or s_(s.get("transcripturl"))))
    return {"status": 200, "data": {"exists": bool(s), "screen": out}}


def ready_already(s: dict) -> dict[str, Any]:
    return {"state": "ready", "already": True, "qualification": s_(s.get("qualification")),
            "score": s_(s.get("screenscore")), "summary": "", "report_url": s_(s.get("phonescreenreporturl")),
            "analyzed": bool(s_(s.get("phonescreenreporturl"))),
            "best_in_person_day_time": s_(s.get("bestinpersondaytime"))}


def screen_watch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """screenWatch: the cheap tick the parked result; the deep tick the screen itself — a call already on it is ready,
    a test card keeps showing its current one, and a call still to come is attached by the relay's clock
    (screenCollectDue), whose result is parked here."""
    reads, user = sess.reads, sess.user or {}
    if not writer(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid, bad = _cid_of(reads, p)
    if bad:
        return bad
    if gsjs.falsy(p.get("deep")):
        return {"status": 200, "data": parked(cid) or {"state": "waiting"}}
    cand, s = evidence(reads, cid)
    if not cand:
        return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
    if CND.stage_of(cand.get("status")) != "phone-screen":
        return {"status": 200, "data": {"state": "not-screening"}}
    s = s or {}
    is_test = test_card(reads, cand)
    if (s_(s.get("transcripttext")) or s_(s.get("transcripturl"))) and not is_test:
        ready = ready_already(s)
        park(cid, ready)
        return {"status": 200, "data": ready}
    got = parked(cid)
    if got:
        return {"status": 200, "data": got}
    if is_test and (s_(s.get("transcripttext")) or s_(s.get("transcripturl"))):
        keep = ready_already(s)
        park(cid, keep)
        return {"status": 200, "data": keep}
    unpark(cid)
    return {"status": 200, "data": {"state": "waiting"}}


def analyze_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """screenAnalyze's reading, read first by the relay: the model, the report in Drive, the accepted slot."""
    reads, user = sess.reads, sess.user or {}
    if not writer(user):
        return dict(DENIED)
    cid, bad = _cid_of(reads, payload)
    if bad:
        return bad
    cand, s = evidence(reads, cid)
    if not cand:
        return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
    if not s:
        return {"status": 409, "message": strings(reads, "refuse.no_screening_saved")}
    plan = analyze(reads, cid, cand, s, time.monotonic() + PREPARE_BUDGET_S)
    if plan.get("status") != 200:
        return {k: v for k, v in plan.items() if k in ("status", "message")}
    return {"status": 200, "data": seal("screenAnalyze", actor(user), {"cid": cid, "plan": plan})}


def force_error_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """screenForceError's second reading (a real one, on the rehearsal's own words, that honestly fails)."""
    reads, user = sess.reads, sess.user or {}
    if service(user) or s_(user.get("role")) != "admin":
        return dict(DENIED)
    cid, bad = _cid_of(reads, payload)
    if bad:
        return bad
    cand, _s = evidence(reads, cid)
    if not cand:
        return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
    if CND.stage_of(cand.get("status")) != "phone-screen":
        return {"status": 409, "message": strings(reads, "refuse.force_error.stage")}
    if not test_card(reads, cand):
        return {"status": 409, "message": strings(reads, "refuse.force_error.test_only")}
    now = iso_now(reads)
    mock = strings(reads, "force_error.transcript").replace("{name}", s_(cand.get("candidatename")))
    when = force_date_accepted(reads, {"transcriptcreated": now}, mock, time.monotonic() + 60)
    return {"status": 200, "data": seal("screenForceError", actor(user), {"cid": cid, "now": now, "mock": mock,
                                                                          "when": when})}


def window_calls(reads: L.Reads) -> dict[str, Any]:
    """commsSync's window: the Quo tail's calls of the last seven days as the mirror's rows, their participants
    recovered from the webhook dialogue, the messages the webhook log carries, and whether the tail covered it."""
    cutoff = (reads.now.timestamp() - WINDOW_DAYS * 86400) * 1000.0
    tail = quo_tail(reads, TAIL_ROWS)
    if tail is None:
        return {"refused": {"status": 502, "message": strings(reads, "refuse.comms.no_transcripts_tab")}}
    t_rows: list[dict[str, str]] = []
    for r in tail:
        if r["_when"] is None or r["_when"] < cutoff:
            continue
        row = {c: cap(r.get(c, "")) for c in T_COLS}
        row["Transcript Created"] = cap(r["_created_text"])
        t_rows.append(row)
    truncated = len(tail) == TAIL_ROWS and tail[0]["_when"] is not None and tail[0]["_when"] >= cutoff
    sid = _book(reads, QUO_PROP)
    lref = reads.tab_of(sid, "Webhook Log", "the Quo Webhook Log")
    log_rows = [raw for _rn, raw in reads.db.rows(lref)] if lref is not None else []
    need = {r["Call ID"] for r in t_rows if not gsjs.trim(r["Participant(s)"])}
    for raw in reversed(log_rows):
        bid = gsjs.or_blank(raw.get("Call ID"))
        if bid not in need or gsjs.or_blank(raw.get("Event Type")) != "call.transcript.completed":
            continue
        try:
            obj = json.loads(gsjs.or_blank(raw.get("Raw Payload")))["data"]["object"]
            ext = list(dict.fromkeys(gsjs.js_str(d["identifier"]) for d in obj.get("dialogue") or []
                                     if isinstance(d, dict) and d.get("identifier") and not d.get("userId")))
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
        if ext:
            for r in t_rows:
                if r["Call ID"] == bid and not gsjs.trim(r["Participant(s)"]):
                    r["Participant(s)"] = ", ".join(ext)
        need.discard(bid)
    m_by: dict[str, list[str]] = {}
    for raw in log_rows:
        kind = gsjs.or_blank(raw.get("Event Type"))
        if kind not in ("message.received", "message.delivered"):
            continue
        try:
            o = json.loads(gsjs.or_blank(raw.get("Raw Payload")))["data"]["object"]
        except (ValueError, KeyError, TypeError):
            continue
        if not isinstance(o, dict):
            continue
        mw = when_ms(o.get("createdAt"))
        if mw is None or mw < cutoff:
            continue
        out = gsjs.or_blank(o.get("direction")) == "outgoing"
        media = o.get("media") if isinstance(o.get("media"), list) else []

        def t(k: str) -> str:
            return gsjs.or_text(o.get(k))
        m_by[t("id")] = [t("id"), t("createdAt"), t("status"), t("from") if out else t("to"),
                         t("to") if out else t("from"), t("userId"), t("direction"), "mms" if media else "sms",
                         cap(o.get("body") or ""), " | ".join(m.get("url") if isinstance(m, dict) and m.get("url")
                                                               else gsjs.js_str(m) for m in media),
                         t("conversationId")]
    m_rows = sorted(m_by.values(), key=lambda m: m[1])
    return {"t_rows": t_rows, "m_rows": m_rows, "truncated": truncated}


def mirror_edits(reads: L.Reads, t_rows: list[dict]) -> dict[str, Any]:
    """The window against the mirror's transcripts as the copy and Python's edits hold them: each call missing
    appended, each one whose cells moved changed (the rows the window left stay: only Apps Script's rewrite cleared
    them)."""
    have: dict[str, dict] = {}
    _sid, ref = comms_ref(reads, "transcripts")
    if ref is not None:
        for _rn, raw in reads.db.rows(ref):
            k = gsjs.trim(gsjs.or_blank(raw.get("Call ID")))
            if k:
                have[k] = raw
    appends: list[dict] = []
    edits: list[dict] = []
    for r in t_rows:
        k = gsjs.trim(r["Call ID"])
        if not k:
            continue
        cur = have.get(k)
        if cur is None:
            appends.append(r)
            continue
        # a call's creation never moves: the copies keep it to the second, rounded, where a Date's text cuts it
        changed = {c: r[c] for c in T_COLS if c != "Transcript Created" and gsjs.or_blank(cur.get(c)) != r[c]}
        if changed:
            edits.append({"key": k, "cells": changed})
    return {"appends": appends, "edits": edits, "copy": ref is not None}


_CURSOR: dict[str, int] = {"at": 0}


def comms_plan(reads: L.Reads, by: str, deadline: float) -> dict[str, Any]:
    """commsSync's heavy half: the window, its summaries (twelve at most, newest first, the model asked once per
    call), the screening calls attached, and up to three analyses — those just attached, then the debt in turn."""
    win = window_calls(reads)
    if win.get("refused"):
        return win
    t_rows, m_rows = win["t_rows"], win["m_rows"]
    mirror = mirror_edits(reads, t_rows)
    have = {s_(r.get("callid")) for r in comms_rows(reads, "summaries")}
    summarized = pending = blocked = 0
    blocked_why = ""
    made: dict[str, str] = {}
    s_rows: list[dict[str, str]] = []
    tpl = prompt_text(reads, "ai_message_rewrite")
    for r in reversed(t_rows):
        call_id, text = r["Call ID"], r["Speaker Transcript"] or r["Full Transcript"]
        if not call_id or call_id in have or not text:
            continue
        if summarized >= SUMMARIES_PER_RUN or time.monotonic() > deadline - 30:
            pending += 1
            continue
        if blocked and "refused" in blocked_why:
            blocked += 1
            continue
        chat = ai(reads, tpl.replace("{text}", js_slice(text, TRANSCRIPT_CAP)), 0.2, "ai_message_rewrite", deadline) \
            if tpl else {"ok": False, "error": "prompt_cell_empty"}
        if not chat.get("ok"):
            blocked += 1
            blocked_why = blocked_why or "no model answered: " + s_(chat.get("error"))[:160]
            continue
        got = parsed(chat.get("content"))
        summary = s_(got.get("summary")) if isinstance(got, dict) else ""
        summary = summary or js_slice(s_(chat.get("content")), 900)
        if not summary:
            blocked += 1
            blocked_why = blocked_why or "the model answered nothing"
            continue
        s_rows.append({"call_id": call_id, "created": r["Transcript Created"], "quo_number": r["Quo Number"],
                       "participants": r["Participant(s)"], "direction": r["Direction"],
                       "duration_sec": r["Duration (sec)"], "summary": summary,
                       "model": s_(chat.get("via")) or "model", "summarized_at": iso_now(reads)})
        have.add(call_id)
        made[call_id] = summary
        summarized += 1
    calls = [{"callid": s_(r["Call ID"]), "quo": digits(r["Quo Number"])[-10:],
              "part": digits(r["Participant(s)"])[-10:], "team": r["Team Member(s)"],
              "when": when_ms(r["Transcript Created"]), "created": s_(r["Transcript Created"]),
              "text": s_(r["Speaker Transcript"]) or s_(r["Full Transcript"]), "secs": r["Duration (sec)"],
              "by": ""} for r in reversed(t_rows)]
    for c in calls:
        c["by"] = screened_by(reads, c["quo"], c["team"])
    got = collect(reads, calls, window=True, summaries=made)
    attaches = got["attaches"]
    fresh = {a["cid"] for a in attaches}
    order = sorted(c for c in got["debt"] if c not in fresh)
    cursor = _CURSOR["at"] if _CURSOR["at"] < len(order) else 0
    rotated = order[cursor:] + order[:cursor] if order else []
    ran = analyses_for(reads, attaches, rotated, ANALYZE_CAP, min(deadline, time.monotonic() + ANALYZE_BUDGET_S))
    if order:
        _CURSOR["at"] = (cursor + ran["examined"]) % len(order)
    analyzed = sum(1 for p in ran["plans"].values() if p.get("status") == 200)
    return {"mirror": mirror, "m_rows": m_rows, "s_rows": s_rows, "attaches": attaches, "plans": ran["plans"],
            "counts": {"transcripts": len(t_rows), "messages": len(m_rows), "summarized": summarized,
                       "summaries_pending": pending, "summaries_blocked": blocked,
                       "summaries_blocked_why": blocked_why, "screens_collected": len(attaches),
                       "screens_analyzed": analyzed,
                       "screens_pending": max(0, len(attaches) + len(order) - ran["done"]),
                       "window_days": WINDOW_DAYS},
            "truncated": win["truncated"], "by": by}


def comms_note(reads: L.Reads, c: dict, truncated: bool) -> str:
    """Each clause is a book row; the code only decides which ones are true."""
    return ((strings(reads, "comms.note.blocked", {"n": str(c["summaries_blocked"]),
                                                   "why": c["summaries_blocked_why"]}) + " "
             if c["summaries_blocked"] else "") +
            (strings(reads, "comms.note.collected", {"n": str(c["screens_collected"])}) + " "
             if c["screens_collected"] else "") +
            (strings(reads, "comms.note.truncated") + " " if truncated else "") +
            (strings(reads, "comms.note.no_messages") if c["messages"] == 0 else ""))


def comms_sync_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commsSync's reading, read first by the relay for the person who pressed Sync."""
    user = sess.user or {}
    if not writer(user) and not service(user):
        return dict(DENIED)
    plan = comms_plan(sess.reads, "trigger" if service(user) else s_(user.get("email")),
                      time.monotonic() + PREPARE_BUDGET_S)
    if plan.get("refused"):
        return plan["refused"]
    return {"status": 200, "data": seal("commsSync", actor(user), plan)}


def comms_sync_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commsAutoSync (the fifteen-minute trigger), on the relay's clock: the window read and prepared for
    commsSyncSweep."""
    if not service(sess.user):
        return dict(SERVICE_ONLY)
    plan = comms_plan(sess.reads, "trigger", time.monotonic() + PREPARE_BUDGET_S)
    if plan.get("refused"):
        return plan["refused"]
    return {"status": 200, "data": seal("commsSyncSweep", "service", plan)}


def collect_plan(reads: L.Reads, only: str, deadline: float) -> dict[str, Any]:
    """commsCollectFromQuoTail_: the Quo tail's screening calls attached (one candidate, or every one), each read by
    the model at once."""
    calls = tail_calls(reads, WATCH_TAIL if only else CLOCK_TAIL)
    if calls is None:
        return {"attaches": [], "plans": {}}
    got = collect(reads, calls, only=only)
    ran = analyses_for(reads, got["attaches"], [], len(got["attaches"]), deadline)
    return {"attaches": got["attaches"], "plans": ran["plans"]}


def collect_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commsOnQuoChange (the Quo sheet's push), on the relay's clock: what the tail holds for a candidate at the
    Phone Screen stage, attached and read, prepared for screenCollectSweep; `due` false when nothing waits."""
    if not service(sess.user):
        return dict(SERVICE_ONLY)
    plan = collect_plan(sess.reads, "", time.monotonic() + PREPARE_BUDGET_S)
    if not plan["attaches"]:
        return {"status": 200, "data": {"due": False}}
    return {"status": 200, "data": seal("screenCollectSweep", "service", {"due": True, **plan})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "screenGet": screen_get, "screenWatch": screen_watch, "screenAnalyzePrepare": analyze_prepare,
    "screenForceErrorPrepare": force_error_prepare, "commsSyncPrepare": comms_sync_prepare,
    "commsSyncDue": comms_sync_due, "screenCollectDue": collect_due}
# the roles are each door's own gate (the service reads beside the writers)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
