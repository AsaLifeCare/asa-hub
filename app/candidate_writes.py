"""Staff Candidates' writes (apps-script/CandidateProfiles.gs) decided off asa-hub-db: kept in app.edits as facts on the
depot's Facts tab (every Hiring record is dissolved there), each Hiring door a press opens decided by its own Python
port, its letters through Smart Comms; a paper is read and filed by the relay and its records kept here
(candidate_papers). What this side cannot read is its own 503, never Apps Script's."""
from __future__ import annotations

import re
import secrets
import uuid
from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import photos as P
import scope as sc
import resource_rows as RR
import writes as W
from scope import Defer
from writes import Decision

APP_ID = "staff-candidates"
APP_NAME = "Staff Candidates"
# Settings › Editions: who else makes each change beside the master (app/editions.py)
EDITION = {"information": "candidates.information", "pipeline": "candidates.pipeline", "notes": "candidates.notes",
           "interviews": "candidates.interviews", "documents": "candidates.documents"}
EDITIONS = tuple(EDITION.values())
UNKNOWN = "Unknown action."
_KEY = re.compile(r"^CAN_[A-Za-z0-9]{6,80}$")
# Talent.gs TALENT_EXCLUDE_IDS
EXCLUDE_IDS = ("CAN_7DF46D98345D8F032F02", "CAN_24A360F6398D5015B3CD")
STAGE_ORDER = ("new", "phone-screen", "interview", "onboarding", "hired", "ready")
STAGE_LABELS = {"new": "New", "phone-screen": "Phone Screen", "interview": "Interview", "onboarding": "Onboarding",
                "hired": "Hired", "ready": "Ready to start"}
# HubCore.gs HUB_STAGE_TO_STATUS: the status word a move writes
STAGE_TO_STATUS = {"new": "New", "phone-screen": "Phone Screen", "interview": "In Person", "onboarding": "Onboarding",
                   "hired": "Hired", "ready": "Ready to Start"}
# Talent.gs talentStage_
_STATUS_STAGE = {"new": "new", "phone screen": "phone-screen", "phone-screen": "phone-screen", "in person": "interview",
                 "interview": "interview", "onboarding": "onboarding", "ready": "ready", "ready to start": "ready",
                 "hired": "hired", "becoming staff": "hired", "becoming-staff": "hired",
                 "minimal internal documentation ready": "hired", "internal-docs": "hired"}
NOTE_MAX = 900
SCREEN_NOTES_MAX = 2000
PRESS_STEP = "staff_candidates"
PRESS_TITLES = {"complete": "Mark complete", "stage": "Update stage", "upload": "Document filed",
                "document": "Document filed"}
DOOR_TITLES = {"setDecision": "Advance", "screenManualComplete": "Manual phone screen",
               "hiringScheduleCreate": "Schedule the interview", "interviewSave": "Interview scorecard",
               "packetWaive": "New Hire packet on file", "onboardingManualComplete": "Manual onboarding",
               "tableDocUpload": "Upload the file", "moveStage": "Move the stage", "hiringDiscard": "Not hiring",
               "docUpload": "Onboarding Documents"}
# CND_DOOR_FIELDS: the doors a press opens, and the form fields each takes under the name the door reads them by
DOOR_FIELDS = {"setDecision": {}, "moveStage": {}, "screenManualComplete": {"notes": "notes"},
               "hiringScheduleCreate": {"date": "date", "time": "time", "location": "location",
                                        "with_name": "with_name", "notes": "notes"},
               "interviewSave": {"interviewer_name": "interviewer_name", "score": "score",
                                 "recommendation": "recommendation", "notes": "comments"},
               "packetWaive": {"notes": "note"}, "onboardingManualComplete": {"notes": "notes"},
               "hiringDiscard": {"notes": "reason"},
               "tableDocUpload": {"filename": "filename", "mime_type": "mime_type", "base64": "base64"}}

# the dissolved Hiring tabs (HiringMatrix.gs HIRING_DISSOLVABLE_TABS) and each one's row key (HIRING_TAB_KEY)
CANDIDATES = "entity_candidates"
RESUME = "entity_resume_analyses"
PHONE = "entity_phone_screens"
JOURNEY = "hiring_journey"
DOCS = "candidate_documents"
INTERVIEWS = "entity_in_person_interviews"
TAB_KEY = {JOURNEY: "journeyid", DOCS: "docrowid"}
# HubCore.gs HUB_DECISION_CHECKPOINTS
DECISIONS = ("resume-decision", "advance-decision")
STATUS_TAB = "log_status_history"
EVENTS_TAB = "Events"
REGISTRY_TAB = "Registry"
# the fact a write lands as (hiringLegacyWrite_), keyed in app.edits by its subject, source and the write's evidence
FACT_HEADS = ("Fact Key", "Subject ID", "Value", "Source", "Evidence", "Recorded At", "Recorded By")
FACT_MATCH = "cols:Subject ID|Source|Evidence"
EVIDENCE = "asa-hub-app "
JOURNEY_HEADER = ("journey_id", "candidate_id", "candidate_name", "step", "title", "channel", "to", "ok", "detail", "ref",
                  "rehearsal", "at", "by")
STATUS_HEADER = ("timestamp", "candidate_id", "candidate_name", "from_status", "to_status", "actor")
STATUS_MATCH = "cols:timestamp|candidate_id"
EVENTS_MATCH = "cols:Event ID"
COPY_MARKER = "[withheld"

CACHES = "Staff Candidates reads it from Postgres at once; the relay read this candidate again."
INFO_WORDS = "The candidate's details on the Hiring record, kept in the Hub's database."
PREFS_WORDS = "The phone screen's record of the candidate, kept in the Hub's database."
NOTE_WORDS = "The note on the hiring journey, kept in the Hub's database."
DOC_WORDS = "The document's review on the Hiring record, kept in the Hub's database."

# Information: what each field writes (tab, column), its label, kind and longest value; the Hiring card's own edit
# (Talent.gs candidateEdit) writes the first eight, and a new first or last name recomposes the full name
INFO_FIELDS: dict[str, tuple[str, str, str, str, int]] = {
    "first_name": (CANDIDATES, "first_name", "First name", "text", 60),
    "last_name": (CANDIDATES, "last_name", "Last name", "text", 60),
    "phone": (CANDIDATES, "phone", "Phone", "phone", 40),
    "email": (CANDIDATES, "email", "E-mail", "email", 200),
    "source": (CANDIDATES, "source", "Source", "text", 120),
    "applied_at": (CANDIDATES, "created_at", "Applied", "date", 30),
    "city": (CANDIDATES, "city", "City", "text", 60),
    "state": (CANDIDATES, "state", "State", "text", 2),
    "street": (CANDIDATES, "street", "Street address", "text", 120),
    "zip": (CANDIDATES, "zip", "Zip", "text", 10),
    "assigned_to": (CANDIDATES, "assigned_to", "Recruiter", "text", 200),
    "schedule_availability": (RESUME, "schedule_availability", "Availability", "textarea", 1000),
    "total_years_caregiving": (RESUME, "total_years_caregiving", "Years caregiving", "text", 5),
    "care_experience": (RESUME, "care_experience", "Experience", "textarea", 1000),
}
NAME_FIELDS = ("first_name", "last_name")
# ContactGuard.gs: while the staff guard enforces, a phone or e-mail edit is held against the staff records there
GUARD_KEY = "staff_guard_mode"
# the lines Information shows that no edition writes, and why
INFO_LOCKED = {
    "position": ("Position", "Every candidate is hired as a Direct Support Professional."),
    "candidate_name": ("Full name", "The full name is the first and last name together; edit those."),
    "preferred_location": ("Preferred location", "The house is the Onboarding record's, kept by the Onboarding app."),
    "earliest_start": ("Earliest start", "The start date is the Onboarding record's, kept by the Onboarding app."),
    "stage": ("Stage", "The stage moves through Update stage, on the Hiring board's own gate."),
    "cjis_status": ("Background check", "The background result is filed with its paper (Add document), never typed."),
}
EMAIL_SIGNIN = ("From Onboarding the e-mail is the new hire's sign-in, already sent to them; it changes in Settings › "
                "Users.")
NO_ANALYSIS = "No resume analysis is on file; the availability and experience come with the resume."
YES_NO = ("Yes", "No")
# Interviews › Candidate preferences: the phone screen's own lines
PREF_FIELDS: dict[str, str] = {
    "shift_day": "Day shift", "shift_afternoon": "Afternoon shift", "shift_night": "Night shift",
    "hours_ft": "Full time", "hours_pt": "Part time", "hours_prn": "PRN", "every_other_weekend": "Every other weekend",
    "male_care": "Male care", "behavioral_care": "Behavioral care", "has_dl": "Driver's license",
    "has_vehicle": "Vehicle", "has_insurance": "Insurance", "cert_dodd": "DODD certificate",
    "cert_cpr_first_aid": "CPR / First Aid", "cert_med_del": "Med delegation",
}
PREF_TEXT = {"best_in_person_day_time": ("Best day and time in person", "text", 16),
             "notes": ("Phone screen notes", "textarea", 4000)}
PREF_LOCKED = {
    "final_result": ("Advance decision", "The advance decision is recorded with Mark complete, on the board's gate."),
    "scorecard": ("Interview scorecard", "The score and recommendation are signed on the interviewer's scorecard."),
    "booked": ("The booked interview", "The slot, place and interviewer were e-mailed to the candidate; Schedule the "
                                       "interview in Hiring changes them."),
}
NO_SCREEN = "No phone screen is on file — the preferences come with the screen."
_DAY_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DOC_FIELDS = {"review_status": ("Review", "select", 20), "issued_on": ("Issued on", "date", 10),
              "expires_on": ("Expires on", "date", 10), "notes": ("Notes", "textarea", 1000)}
REVIEWS = ("verified", "returned")
DOC_LOCKED = "The background check's result is filed with its paper (Add document), never reviewed here."


# ---- the read module's parts a press rests on ---------------------------------------------------------------------

def _reads_part(*names: str) -> Callable[..., Any]:
    try:
        import candidates as CND  # noqa: PLC0415 - the read module loads beside this one
    except ImportError as exc:
        raise Defer("the Staff Candidates reads are not loaded") from exc
    for n in names:
        fn = getattr(CND, n, None)
        if callable(fn):
            return fn
    raise Defer("the Staff Candidates reads carry no " + " / ".join(names))


def reads_candidate(sess: L.Session, key: str) -> dict[str, Any]:
    """cndCandidate_ as the read module answers it: the context, or its refusal."""
    return _reads_part("candidate")(sess, key) or {}


def reads_actions(sess: L.Session, ctx: dict) -> dict[str, Any]:
    """cndActionsBuild_: the checklist with each open step's door, where the card may move, and the gate."""
    return _reads_part("actions_build")(sess, ctx) or {}


# ---- small pure helpers -------------------------------------------------------------------------------------------

def s_(v: Any) -> str:
    return gsjs.str_(v)


def norm(col: str) -> str:
    """normKey_; the tombstone keeps its raw name."""
    return col if col == "__deleted" else hubdb.norm_key(col)


def stage_of(status: Any) -> str:
    return _STATUS_STAGE.get(s_(status).lower(), "")


def stage_label(stage: str) -> str:
    return STAGE_LABELS.get(stage, stage)


def who_email(user: dict | None) -> str:
    return s_((user or {}).get("email"))


def marked(*vals: Any) -> None:
    if any(isinstance(v, str) and v.startswith(COPY_MARKER) for v in vals):
        raise Defer("the copy withholds a cell this decision rests on")


def js_slice(s: str, n: int) -> str:
    return CW.js_cut(s, n)


def render(tpl: str, said: dict[str, str]) -> str:
    """hiringRenderMail_."""
    return re.sub(r"\{(\w+)\}", lambda m: said.get(m.group(1), m.group(0)), tpl)


def refused(env: dict[str, Any]) -> Decision:
    """A lookup's refusal: one this side could not read is its 503."""
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the hiring records could not be read")[:160])
    return Decision(env)


# ---- who may write ------------------------------------------------------------------------------------------------

def viewer(sess: L.Session) -> dict[str, Any] | None:
    """cndViewer_: the scope App Control opens the app with (the real master always); None when it is closed."""
    user = sess.user
    if sc.is_real_master(user):
        return sc.scope_of("master")
    try:
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut, as the .gs catch
        return None
    scope = got.get("scope") if got and got.get("open") is True else None
    return scope if scope and scope.get("kind") != "none" else None


def wide(scope: dict | None) -> bool:
    """cndWide_."""
    return bool(scope) and scope.get("kind") in ("master", "all")


def edit_door(sess: L.Session, edition: str) -> dict[str, Any] | None:
    """The master (candidateProfilesGate_); else a listed holder of the edition who reads the app whole. FAIL-CLOSED."""
    if sc.is_real_master(sess.user):
        return None
    if not sc.edition_allows(edition, sess.user or {}, sess.reads.config()):
        return {"status": 404, "message": UNKNOWN}
    return None if wide(viewer(sess)) else {"status": 404, "message": UNKNOWN}


def edition_of(sess: L.Session, edition: str) -> str:
    """The edition a person's write came in by; the master's names none."""
    return "" if sc.is_real_master(sess.user) else edition


# ---- the dissolved Hiring records, with Python's own facts laid -----------------------------------------------------

def facts_where(reads: L.Reads) -> tuple[str, hubdb.TabRef]:
    """Where a dissolved tab's facts are read and land: the runtime book's Facts, Python's own copy of it."""
    sid = reads.db.prop("HUB_APPS_RUNTIME_ID") or hubdb.ESSENCIAL_ID
    if sid != hubdb.ESSENCIAL_ID:
        raise Defer("the runtime book is not the book Python reads the Hiring records from")
    ref = reads.tab_of(sid, hubdb.FACTS_TAB, "the depot's Facts")
    if ref is None:
        raise hubdb.Unreadable("the depot's Facts are not in asa-hub-db")
    have = {gsjs.trim(gsjs.js_str(h)) for h in ref.headers}
    missing = [h for h in FACT_HEADS if h not in have]
    if missing:
        raise hubdb.Unreadable("the depot's Facts have no " + ", ".join(missing) + " column")
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the depot's Facts")
    return sid, ref


def _pending(sid: str, prefix: str, subjects: set[str] | None) -> list[tuple[str, str, str, str]]:
    """(subject, source, value, evidence) of each fact app.edits keeps for this tab, oldest first."""
    groups = (getattr(hubdb.OWN.get(), "edits", None) or {}).get((sid, hubdb.FACTS_TAB)) or ()
    out: list[tuple[str, str, str, str]] = []
    for g in groups:
        if not g.get("appended") or g.get("match") != FACT_MATCH:
            continue
        cells = {f: v for f, (_id, v, _born) in g["cells"].items()}
        src = gsjs.or_blank(cells.get("Source"))
        sub = gsjs.trim(gsjs.or_blank(cells.get("Subject ID")))
        if not src.startswith(prefix) or not sub or (subjects is not None and sub not in subjects):
            continue
        out.append((sub, src, gsjs.or_blank(cells.get("Value")), gsjs.or_blank(cells.get("Evidence"))))
    return out


def dissolved_rows(reads: L.Reads, tab: str, subjects: list[str] | None = None) -> dict[str, dict[str, str]]:
    """hiringLegacyRows_: each subject's row rebuilt from its facts in sheet order (the newest wins), Python's own kept
    facts laid after the copy's until the copy holds them; a tombstoned row is gone."""
    want = None if subjects is None else {s for s in subjects if s}

    def read() -> dict[str, dict[str, str]]:
        sid, ref = facts_where(reads)
        prefix = "dissolution:" + tab + "."
        sql = (f'select subject_id, value, source, evidence from {reads.db.from_sql(ref)}'  # noqa: S608
               " where source like %s")
        params: list[Any] = ["dissolution:" + tab.replace("_", "\\_") + ".%"]
        if want is not None:
            sql += " and subject_id = any(%s)"
            params.append(sorted(want))
        got = reads.db.query(sql + " order by row_number", tuple(params))
        held: set[tuple[str, str, str]] = set()
        rows: dict[str, dict[str, str]] = {}

        def put(sub: str, source: str, value: str) -> None:
            if sub and source.startswith(prefix):
                rows.setdefault(sub, {})[source[len(prefix):]] = value

        for sub, value, source, ev in got:
            sub, source = gsjs.trim(gsjs.or_blank(sub)), gsjs.or_blank(source)
            held.add((sub, source, gsjs.or_blank(ev)))
            put(sub, source, s_(value))
        for sub, source, value, ev in _pending(sid, prefix, want):
            if (sub, source, ev) not in held:
                put(sub, source, s_(value))
        key_col = TAB_KEY.get(tab, "candidateid")
        out: dict[str, dict[str, str]] = {}
        for sub, row in rows.items():
            if gsjs.or_blank(row.get("__deleted")).lower() == "true":
                continue
            if not row.get(key_col):
                row[key_col] = sub
            out[sub] = row
        return out
    return reads.once("cndw:facts:" + tab + ":" + ("*" if want is None else ",".join(sorted(want))), read)


def fact_record(sid: str, tab: str, subject: str, col: str, value: Any, by: str, at: str, evidence: str,
                pack: str, edition: str) -> dict[str, Any]:
    """One hiringLegacyWrite_ fact, appended to the Facts as app.edits keeps it."""
    k = norm(col)
    source = f"dissolution:{tab}.{k}"
    cells = {"Fact Key": f"legacy.{tab}.{k}", "Subject ID": subject, "Value": W.sheet_text(value), "Source": source,
             "Evidence": evidence, "Recorded At": at, "Recorded By": by}
    return W.kept_record(sid, hubdb.FACTS_TAB, "append", FACT_MATCH, "\x1f".join((subject, source, evidence)), pack,
                         cells, edition=edition)


def facts_of(reads: L.Reads, tab: str, subject: str, fields: dict[str, Any], by: str, pack: str, edition: str,
             at: str = "", evidence: str = "") -> list[dict[str, Any]]:
    """hiringLegacyWrite_(tab, subject, fields, by): one fact per field, under one evidence."""
    sid, _ref = facts_where(reads)
    at = at or W.now_iso(reads)
    evidence = evidence or EVIDENCE + str(uuid.uuid4())
    return [fact_record(sid, tab, subject, col, v, by, at, evidence, pack, edition) for col, v in fields.items()]


def events_on(reads: L.Reads) -> bool:
    """hiringBookMode_('events').status === 'on', off the runtime book's Registry (its first row per context)."""
    def read() -> bool:
        sid, _ref = facts_where(reads)
        ref = reads.tab_of(sid, REGISTRY_TAB, "the depot's Registry")
        if ref is None:
            raise hubdb.Unreadable("the depot's Registry is not in asa-hub-db")
        for r in reads.db.locations_rows(ref):
            ctx = gsjs.trim(gsjs.or_blank(r.get("Context"))).lower()
            if ctx == "events":
                return gsjs.trim(gsjs.or_blank(r.get("Status"))).lower() == "on"
        return False
    return reads.once("cndw:events_on", read)


def journey_records(reads: L.Reads, ctx: dict, line: dict[str, Any], edition: str) -> tuple[str, str, list[dict]]:
    """journeyLog_: the line's facts on the dissolved journey and, while the runtime's events book is on, its Events
    row under the same id. (journey id, at, the records)"""
    jid = "JRN_" + secrets.token_hex(4).upper()
    at = W.now_iso(reads)
    row = {"journey_id": jid, "candidate_id": ctx["key"], "candidate_name": ctx["name"], "step": s_(line.get("step")),
           "title": s_(line.get("title")) or s_(line.get("step")), "channel": s_(line.get("channel")),
           "to": s_(line.get("to")), "ok": "no" if line.get("ok") is False else "yes",
           "detail": js_slice(s_(line.get("detail")), NOTE_MAX), "ref": s_(line.get("ref")),
           "rehearsal": "yes" if line.get("rehearsal") else "", "at": at, "by": s_(line.get("by"))}
    recs = facts_of(reads, JOURNEY, jid, {h: row[h] for h in JOURNEY_HEADER}, "append", ctx["key"], edition, at=at)
    if events_on(reads):
        sid, _ref = facts_where(reads)
        ref = HT.tab_of(reads, sid, EVENTS_TAB, "the depot's Events")
        if ref is None:
            raise hubdb.Unreadable("the depot's Events are not in asa-hub-db")
        cells = {"Event ID": jid, "Subject ID": ctx["key"], "Kind": "journey", "Step": row["step"],
                 "Channel": row["channel"], "Title": row["title"],
                 "Detail": row["detail"] + (" ref=" + row["ref"] if row["ref"] else ""), "To": row["to"],
                 "OK": row["ok"], "At": at, "By": row["by"], "Rehearsal": row["rehearsal"],
                 "Source": "dual-write:journeyLog_"}
        recs.append(W.kept_record(sid, EVENTS_TAB, "append", EVENTS_MATCH, jid, ctx["key"], cells, edition=edition))
    return jid, at, recs


def own_ctx(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """cndCandidate_ off the candidate's own facts: 400 when no hiring record carries the id."""
    key = gsjs.trim(gsjs.or_blank(raw))
    none = {"refused": {"status": 400, "message": f'No candidate "{key[:120]}" is on file.'}}
    if not _KEY.fullmatch(key) or key in EXCLUDE_IDS:
        return none
    cand = dissolved_rows(reads, CANDIDATES, [key]).get(key)
    if cand is None:
        return none
    name = s_(cand.get("candidatename")) or gsjs.trim(f"{s_(cand.get('firstname'))} {s_(cand.get('lastname'))}") or key
    return {"key": key, "name": name, "cand": cand, "stage": stage_of(cand.get("status")),
            "archived": s_(cand.get("archived")).lower() == "true"}


def book_text(reads: L.Reads, key: str) -> str:
    """bookText_('Strings', key): the words book's own line; a line the copy lacks is Apps Script's to say."""
    def read() -> dict[str, str]:
        sid = reads.db.prop("HUB_WORDS_BOOK_ID") or reads.db.prop("HUB_GENERIC_CONFIG_ID")
        if not sid:
            raise Defer("no words book is declared in the depot")
        ref = HT.tab_of(reads, sid, "Strings", "the words book")
        if ref is None:
            raise Defer("the words book holds no Strings tab in the copy")
        out: dict[str, str] = {}
        for r in reads.db.locations_rows(ref):
            k = gsjs.trim(gsjs.or_blank(r.get("key")))
            if k and not k.startswith("#"):
                out[k] = gsjs.or_blank(r.get("value"))
        return out
    got = reads.once("cndw:strings", read).get(key, "")
    if not got:
        raise Defer(f"the words book's {key} is not in the copy")
    return got


# ---- the note (candidateProfileNoteAdd) -----------------------------------------------------------------------------

def note_add(sess: L.Session, payload: dict) -> Decision:
    """candidateProfileNoteAdd: refused here, or the note (its id and time minted here) kept in app.edits."""
    shut = edit_door(sess, EDITION["notes"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = own_ctx(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    body = gsjs.trim(gsjs.or_text(payload.get("body")))
    if not body:
        return W.refuse(400, "body: what the note says.")
    if CW.utf16_len(body) > NOTE_MAX:
        return W.refuse(400, f"body: up to {NOTE_MAX} characters.")
    W.gate(reads)
    by = who_email(sess.user)
    jid, at, recs = journey_records(reads, ctx, {"step": "note", "title": "Note", "channel": "note", "ok": True,
                                                 "detail": body, "by": by}, edition_of(sess, EDITION["notes"]))
    answer = {"status": 200, "data": {"note": {"id": "jrn_" + jid, "at": at, "by": by, "body": body},
                                      "candidate": ctx["key"]}}
    return W.final(answer, recs, ctx["key"])


# ---- a press on a Hiring door (candidateProfileDoor) -------------------------------------------------------------

def press_find(ctx: dict, a: dict, press: str, item: str) -> dict[str, Any]:
    """cndPressFind_ for a step or a stage, on the read module's own Actions answer."""
    def refuse(status: int, message: str) -> dict[str, Any]:
        return {"refused": {"status": status, "message": message}}
    if press == "complete":
        hit = next((i for i in a.get("items") or [] if s_(i.get("id")) == item), None)
        if hit is None:
            return refuse(400, f"This step is not on {ctx['name']}'s hiring record.")
        if not hit.get("open"):
            return refuse(409, f"{s_(hit.get('label'))} is already complete on the hiring record. Nothing was written.")
        door = hit.get("complete")
        if not isinstance(door, dict) or not door.get("action"):
            why = s_(hit.get("complete_why")) or "No press here closes this step."
            return refuse(409, f"{why} Nothing was written.")
        return {"door": door, "ref": "complete:" + s_(hit.get("id")),
                "detail": s_(hit.get("label")) + " — " + DOOR_TITLES.get(s_(door.get("action")), s_(door.get("action")))}
    to = next((s for s in a.get("stages") or [] if s_(s.get("id")) == item), None)
    if to is None or to.get("current"):
        return refuse(400, "item: a stage the card may move to.")
    door = to.get("door")
    if not to.get("reachable") or not isinstance(door, dict) or not door.get("action"):
        return refuse(409, (s_(to.get("why")) or "The card may not move there from here.") + " Nothing was written.")
    here = s_(a.get("stage")) or ctx.get("stage", "")
    return {"door": door, "ref": "stage:" + s_(to.get("id")),
            "detail": stage_label(here) + " → " + (s_(to.get("label")) or stage_label(s_(to.get("id"))))}


def press_payload(ctx: dict, door: dict, fields: Any) -> dict[str, str] | None:
    """cndPressPayload_: the door's own payload, the form fields it takes and nothing else; None for a door not opened."""
    takes = DOOR_FIELDS.get(s_(door.get("action")))
    if takes is None:
        return None
    p = {k: gsjs.or_blank(v) for k, v in (door.get("payload") or {}).items()}
    p["candidate_id"] = ctx["key"]
    f = fields if isinstance(fields, dict) else {}
    for k, name in takes.items():
        v = f.get(k)
        if v is None or v == "" or isinstance(v, (dict, list)):
            continue
        p[name] = gsjs.js_str(v)
    return p


def press_outcome(press: str, data: dict) -> str:
    """cndPressOutcome_."""
    if data.get("moved") is False and data.get("stage"):
        return "; the card stays at " + stage_label(s_(data["stage"]))
    if press == "stage":
        return ""
    if data.get("moved_to"):
        return "; moved to " + stage_label(s_(data["moved_to"]))
    if data.get("moved") is True and data.get("stage"):
        return "; moved to " + stage_label(s_(data["stage"]))
    return ""


def gate_after(sess: L.Session, key: str, changes: dict[str, dict[str, str]]) -> dict[str, Any]:
    """hubGate_(hubEvidence_(cid)) once these fields are written, the board's book riding it (the read module's)."""
    got = _reads_part("gate_after")(sess, key, changes) or {}
    return {"from": s_(got.get("from")) or None, "to": s_(got.get("to")) or None, "ok": bool(got.get("ok")),
            "reasons": [s_(r) for r in got.get("reasons") or []]}


def attest_fields(reads: L.Reads, s: dict, by: str, now: str) -> dict[str, str]:
    """screenManualAttestFields_: only the blanks are filled, so what the line captured stays as evidence."""
    fields: dict[str, str] = {"manual_screen": "true", "screen_status": "Completed",
                              "screened_by": "asa-hub:manual-screen:" + by}
    if not s_(s.get("screendate")):
        fields["screen_date"] = now
    if not s_(s.get("transcripttext")) and not s_(s.get("transcripturl")):
        fields["transcript_text"] = render(book_text(reads, "manual_screen.attestation"), {"who": by, "when": now})
    return fields


def status_move(sess: L.Session, key: str, cand: dict, to: str, edition: str, now: str) -> list[dict]:
    """hubSetStatus_ to a stage that mints no login: the status as the runtime sheet writes it, and its history row."""
    reads = sess.reads
    by = who_email(sess.user)
    word = STAGE_TO_STATUS.get(to, to)
    was = s_(cand.get("status"))
    recs: list[dict] = []
    for col, v in (("status", word), ("updated_at", now), ("updated_by", "asa-hub:" + by)):
        recs += facts_of(reads, CANDIDATES, key, {col: v}, "runtime-sheet", key, edition, at=now)
    if was != word:
        recs += status_record(reads, key, {"timestamp": now, "candidate_id": key,
                                           "candidate_name": s_(cand.get("candidatename")), "from_status": was,
                                           "to_status": word, "actor": by}, edition)
    return recs


def status_record(reads: L.Reads, key: str, cells: dict[str, str], edition: str = "") -> list[dict]:
    """hubLogStatus_'s row: made in the history's own table once kept there (nothing to keep in app.edits), else an
    append kept for the tab's book."""
    row = {h: s_(cells.get(h)) for h in STATUS_HEADER}
    if HT.tabled(STATUS_TAB):
        RR.create(reads, HT.resource_of(STATUS_TAB) or "", row, key)
        return []
    res = W.tab_of(reads, STATUS_TAB)
    if res.ref is None:
        raise Defer("the stage history tab holds no copy: Apps Script makes it on its first move")
    sid, tab = W.where_of(res)
    return [W.kept_record(sid, tab, "append", STATUS_MATCH, "\x1f".join((row["timestamp"], key)), key, row,
                          edition=edition)]


def sheet_instant(v: str) -> str:
    """str_() of a 'YYYY-MM-DD HH:MM' cell once the Etc/GMT runtime sheet made it a Date: its ISO instant."""
    m = _DAY_TIME.fullmatch(v)
    if not m:
        return v
    from datetime import datetime, timezone  # noqa: PLC0415 - one conversion
    try:
        return gsjs.iso(datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)),
                                 tzinfo=timezone.utc))
    except ValueError:
        return v


def decision(sess: L.Session, ctx: dict, inner: dict[str, str], edition: str) -> tuple[dict[str, Any], list[dict]]:
    """hubSetDecisionHeld_ for an Advance: the resume's decision, or the screen's (attested by the press when nothing
    recorded it) and, when the gate opens, the move to Interview with its visit booked."""
    reads = sess.reads
    key = ctx["key"]
    cand = dissolved_rows(reads, CANDIDATES, [key]).get(key)
    if cand is None:
        return {"status": 404, "message": f'No candidate "{key}".'}, []
    marked(cand.get("status"), cand.get("candidatename"))
    who = s_(cand.get("candidatename")) or key
    if s_(cand.get("status")).lower() == "not hiring":
        return {"status": 409, "message": who + " has already left the process (Not Hiring) — reload to see it. "
                                                "Nothing was written."}, []
    by = who_email(sess.user)
    now = W.now_iso(reads)
    if inner.get("checkpoint") == "resume-decision":
        fields = {"decision_status": "Advance"}
        recs = facts_of(reads, RESUME, key, fields, by, key, edition, at=now)
        g = gate_after(sess, key, {RESUME: fields})
        return {"status": 200, "data": {"value": "Advance", "declined": False, "gate_passed": g["ok"], "to_stage": g["to"],
                                        "missing": g["reasons"], "moved_to": None}}, recs
    at = stage_of(cand.get("status"))
    if at != "phone-screen":
        later = at in STAGE_ORDER and STAGE_ORDER.index(at) > STAGE_ORDER.index("phone-screen")
        here = STAGE_TO_STATUS.get(at) or s_(cand.get("status")) or "another stage"
        return {"status": 409, "already_at": at or None,
                "message": f"{who} is {'already' if later else 'still'} at {here} — "
                           f"{'the phone screen was decided' if later else 'the phone screen is not open yet'}. "
                           "Reload to see it. Nothing was written."}, []
    s = dissolved_rows(reads, PHONE, [key]).get(key) or {}
    marked(s.get("screenstatus"), s.get("bestinpersondaytime"))
    fields = {"final_result": "Advance"}
    if s_(s.get("screenstatus")).lower() != "completed":
        fields.update(attest_fields(reads, s, by, now))
    recs = facts_of(reads, PHONE, key, fields, by, key, edition, at=now)
    g = gate_after(sess, key, {PHONE: fields})
    moved = None
    if g["ok"] and g["to"] == "interview":
        recs += status_move(sess, key, cand, "interview", edition, now)
        if dissolved_rows(reads, INTERVIEWS, [key]).get(key) is None:
            when = sheet_instant(s_(s.get("bestinpersondaytime")))
            row = {"interview_id": "INT_" + secrets.token_hex(5).upper(), "candidate_id": key, "candidate_name": who
                   if s_(cand.get("candidatename")) else "", "scheduled_for": when, "source": "phone-screen",
                   "status": "Scheduled" if when else "To Schedule", "created_at": now, "created_by": "asa-hub:" + by}
            recs += facts_of(reads, INTERVIEWS, key, row, "runtime-sheet:append", key, edition, at=now)
        moved = "interview"
    return {"status": 200, "data": {"value": "Advance", "declined": False, "gate_passed": g["ok"], "to_stage": g["to"],
                                    "missing": g["reasons"], "moved_to": moved}}, recs


def screen_manual(sess: L.Session, ctx: dict, inner: dict[str, str], edition: str) -> tuple[dict[str, Any], list[dict]]:
    """screenManualComplete: the call attested on the phone screen's record, never decided."""
    reads = sess.reads
    key = ctx["key"]
    cand = dissolved_rows(reads, CANDIDATES, [key]).get(key)
    if cand is None:
        return {"status": 404, "message": render(book_text(reads, "refuse.no_candidate"), {"id": key})}, []
    marked(cand.get("status"))
    if stage_of(cand.get("status")) != "phone-screen":
        return {"status": 409, "message": book_text(reads, "refuse.manual_screen.stage")}, []
    s = dissolved_rows(reads, PHONE, [key]).get(key) or {}
    by = who_email(sess.user)
    now = W.now_iso(reads)
    fields = attest_fields(reads, s, by, now)
    notes = js_slice(s_(inner.get("notes")), SCREEN_NOTES_MAX)
    if notes:
        marked(s.get("notes"))
        existing = s_(s.get("notes"))
        prefix = book_text(reads, "manual_screen.notes_prefix")
        fields["notes"] = (existing + "\n" if existing else "") + (prefix + " " if prefix else "") + notes
    recs = facts_of(reads, PHONE, key, fields, by, key, edition, at=now)
    return {"status": 200, "data": {"completed": True, "moved": False, "stage": "phone-screen",
                                    "awaiting": "advance-decision"}}, recs


def move_stage(sess: L.Session, ctx: dict, a: dict, inner: dict[str, str],
               edition: str) -> tuple[dict[str, Any], list[dict]]:
    """moveStage through hubSetStatus_: the status (runtime-sheet facts) and its log_status_history row."""
    reads = sess.reads
    key = ctx["key"]
    cand = dissolved_rows(reads, CANDIDATES, [key]).get(key)
    if cand is None:
        return {"status": 404, "message": f'No candidate "{key}".'}, []
    marked(cand.get("status"), cand.get("candidatename"))
    gate = a.get("gate") if isinstance(a.get("gate"), dict) else {}
    to = s_(inner.get("to_stage"))
    if not s_(gate.get("to")):
        return {"status": 400, "message": "Already at the final stage."}, []
    if to != s_(gate.get("to")):
        here = s_(gate.get("from"))
        return {"status": 400, "already_at": here,
                "message": f"{s_(cand.get('candidatename'))} is already at {STAGE_TO_STATUS.get(here, here)} — reload to "
                           f"see it. From here the next step is {STAGE_TO_STATUS.get(s_(gate['to']), s_(gate['to']))}."}, []
    if not gate.get("ok"):
        return {"status": 409, "message": "Stage gate not passed — missing: " +
                                          ", ".join(s_(r) for r in gate.get("reasons") or []) + "."}, []
    recs = status_move(sess, key, cand, to, edition, W.now_iso(reads))
    return {"status": 200, "data": {"candidate_id": key, "stage": to}}, recs


def door(sess: L.Session, payload: dict) -> Decision:
    """candidateProfileDoor: refused here, or the Hiring door's own write kept in app.edits with the press's line on the
    journey, each letter through Smart Comms in the same write; a login a move into Onboarding owes is minted by the
    hiring sweep, as for every way in."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    master = sc.is_real_master(sess.user)
    press, item = s_(p.get("press")), gsjs.text(p.get("item"), 120)
    # filing a paper is the documents edition's; every other press the pipeline's
    paper = press in ("document", "upload")
    shut = None if master else edit_door(sess, EDITION["documents" if paper else "pipeline"])
    if shut:
        return Decision(shut)
    ctx = own_ctx(reads, p.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    if paper:
        # the relay reads and files a paper itself (candidate_papers); a press without one files nothing
        return W.refuse(400, "The file is required. Nothing was written.")
    if press not in ("complete", "stage"):
        return W.refuse(400, "press: complete, stage, upload or document.")
    rctx = reads_candidate(sess, ctx["key"])
    if rctx.get("refused"):
        return refused(rctx["refused"])
    a = reads_actions(sess, rctx)
    found = press_find(ctx, a, press, item)
    if found.get("refused"):
        return Decision(found["refused"])
    action = s_(found["door"].get("action"))
    inner = press_payload(ctx, found["door"], p.get("fields"))
    if inner is None:
        return W.refuse(409, "This screen does not open that door; the Hiring card does.")
    if action == "tableDocUpload":
        # a step's upload is read and filed by the relay with its file (candidate_papers)
        return W.refuse(400, "The file is required. Nothing was written.")
    W.gate(reads)
    edition = edition_of(sess, EDITION["pipeline"])
    import hiring_board_writes as HBW  # noqa: PLC0415 - the hiring app builds on this module
    if action == "setDecision":
        env, recs = HBW.decide(sess, ctx["key"], inner.get("checkpoint", ""), inner.get("value", ""), edition)
    elif action == "screenManualComplete":
        env, recs = screen_manual(sess, ctx, inner, edition)
    elif action == "packetWaive":
        import candidate_papers as CP  # noqa: PLC0415 - it builds on this module
        env, recs = CP.packet_waive(sess, ctx["key"], inner.get("note", ""), inner.get("file_id", ""), edition)
    elif action in ("hiringDiscard", "hiringScheduleCreate", "interviewSave"):
        import hiring_flow_writes as HFW  # noqa: PLC0415 - the hiring app builds on this module
        import hiring_outreach_writes as HOW  # noqa: PLC0415
        import interviews_writes as IW  # noqa: PLC0415
        run = {"hiringDiscard": HOW.discard, "hiringScheduleCreate": HFW.schedule_create, "interviewSave": IW.save}
        got = run[action](sess, {**inner, "candidate_id": ctx["key"]})
        if got.engine or got.lay:
            raise Defer(f"{action} answered a write this press does not carry")
        env, recs = dict(got.answer or {}), list(got.edits or [])
    elif action == "onboardingManualComplete":
        env, recs = HBW.manual(sess, ctx["key"], inner.get("notes", ""), edition)
    elif action == "moveStage":
        env, recs = HBW.move(sess, ctx, a, inner, edition)
    else:
        return W.refuse(409, "This screen does not open that door; the Hiring card does.")
    if env.get("status") != 200:
        return Decision(env)
    data = env.get("data") or {}
    by = who_email(sess.user)
    detail = found["detail"] + press_outcome(press, data)
    title = PRESS_TITLES[press]
    jid, at, line = journey_records(reads, ctx, {"step": PRESS_STEP, "title": title, "ok": True, "detail": detail,
                                                 "ref": found["ref"], "by": by}, edition)
    answer = {"status": 200, "data": {"candidate": ctx["key"], "door": action, "answer": data, "logged": True,
                                      "entry": {"id": "jrn_" + jid, "at": at, "by": by, "title": title, "body": detail},
                                      "why": ""}}
    return W.final(answer, recs + line, ctx["key"])


# ---- Information and the screen's preferences (candidateProfileEdit) -------------------------------------------------

def info_values(reads: L.Reads, ctx: dict) -> tuple[dict[str, str], dict[str, dict[str, str]], bool]:
    """Each Information field's raw value, the locks, and whether a resume analysis is on file."""
    cand = ctx["cand"]
    analysis = dissolved_rows(reads, RESUME, [ctx["key"]]).get(ctx["key"])
    raw = {}
    for f, (tab, col, _label, _kind, _max) in INFO_FIELDS.items():
        row = cand if tab == CANDIDATES else (analysis or {})
        raw[f] = s_(row.get(norm(col)))
    locks: dict[str, dict[str, str]] = {}
    if analysis is None:
        for f in ("schedule_availability", "total_years_caregiving", "care_experience"):
            locks[f] = {"why": NO_ANALYSIS}
    if ctx["stage"] in ("onboarding", "hired", "ready"):
        locks["email"] = {"why": EMAIL_SIGNIN, "door": "Settings › Users"}
    return raw, locks, analysis is not None


def info_check(field: str, value: str) -> tuple[str, str]:
    """(the value as kept, why it is refused or '')."""
    max_len = INFO_FIELDS[field][4]
    if field in NAME_FIELDS and not value:
        return value, "A name is never blank."
    if field == "applied_at" and not _DAY.fullmatch(value):
        return value, "A day as YYYY-MM-DD."
    if field == "phone":
        if len(re.sub(r"\D", "", value)) < 7:
            return value, "The phone needs at least 7 digits."
    if field == "email":
        value = value.lower()
        if value and not re.fullmatch(r"\S+@\S+\.\S+", value):
            return value, "The e-mail does not look like an address."
    if field == "state":
        value = value.upper()
        if value and not re.fullmatch(r"[A-Z]{2}", value):
            return value, "A two-letter US state, such as OH."
    if field == "zip" and value and not re.fullmatch(r"\d{5}(-\d{4})?", value):
        return value, "A 5-digit zip, or ZIP+4 (12345-6789)."
    if field == "total_years_caregiving" and value:
        if not re.fullmatch(r"\d{1,2}(\.\d)?", value) or float(value) > 80:
            return value, "Years as a number, such as 3 or 2.5."
    if CW.utf16_len(value) > max_len:
        return value, f"Up to {max_len} characters."
    return value, ""


def yes_no(v: Any) -> str:
    """spYesNo_, as the panel shows it."""
    s = s_(v).lower()
    if re.fullmatch(r"y|yes|true|x|1", s):
        return "Yes"
    if re.fullmatch(r"n|no|false|0", s):
        return "No"
    return ""


def pref_values(reads: L.Reads, ctx: dict) -> tuple[dict[str, str], dict[str, str] | None]:
    """Each preference's value as the panel shows it, and the screen's row (None when there is none)."""
    s = dissolved_rows(reads, PHONE, [ctx["key"]]).get(ctx["key"])
    raw: dict[str, str] = {}
    for f in PREF_FIELDS:
        raw[f] = yes_no((s or {}).get(norm(f)))
    for f in PREF_TEXT:
        raw[f] = s_((s or {}).get(norm(f)))
    return raw, s


def real_day_time(v: str) -> bool:
    m = _DAY_TIME.fullmatch(v)
    if not m:
        return False
    try:
        from datetime import datetime  # noqa: PLC0415 - one check
        datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))
        return True
    except ValueError:
        return False


def edit(sess: L.Session, payload: dict) -> Decision:
    """candidateProfileEdit (Python's own): Information's fields or the screen's preferences, per field refused, stale
    or kept as facts on the candidate's own Hiring records."""
    section = s_(payload.get("section")) or "information"
    if section not in ("information", "preferences"):
        return W.refuse(400, "section: information or preferences.")
    eid = EDITION["information"] if section == "information" else EDITION["interviews"]
    shut = edit_door(sess, eid)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = own_ctx(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    by = who_email(sess.user)
    edition = edition_of(sess, eid)
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    by_tab: dict[str, dict[str, str]] = {}
    if section == "information":
        raw, locks, _has = info_values(reads, ctx)
        for c in changes:
            f = c["field"]
            if f in INFO_LOCKED:
                out.append({"field": f, "why": INFO_LOCKED[f][1]})
                continue
            if f not in INFO_FIELDS:
                out.append({"field": f, "why": "Not a field this panel edits."})
                continue
            if f in locks:
                out.append({"field": f, "why": locks[f]["why"]})
                continue
            marked(raw[f])
            now = CW.witness(c["expected"], raw[f])
            if now is not None:
                stale[f] = now
                continue
            value, why = info_check(f, CW.fold_ws(c["value"]).strip())
            if why:
                out.append({"field": f, "why": why})
                continue
            tab, col = INFO_FIELDS[f][0], INFO_FIELDS[f][1]
            by_tab.setdefault(tab, {})[col] = value
            written.append({"field": f, "before": raw[f], "after": value})
        words = INFO_WORDS
    else:
        raw, screen = pref_values(reads, ctx)
        for c in changes:
            f = c["field"]
            if f in PREF_LOCKED:
                out.append({"field": f, "why": PREF_LOCKED[f][1]})
                continue
            if f not in PREF_FIELDS and f not in PREF_TEXT:
                out.append({"field": f, "why": "Not a field this panel edits."})
                continue
            if screen is None:
                out.append({"field": f, "why": NO_SCREEN})
                continue
            marked(raw[f])
            folded = f in PREF_FIELDS
            exp = yes_no(c["expected"]) if folded and c["expected"].strip() else c["expected"]
            now = CW.witness(exp, raw[f])
            if now is not None:
                stale[f] = now
                continue
            value = CW.fold_ws(c["value"]).strip() if f != "notes" else c["value"].strip()
            if folded:
                value = yes_no(value) if value else ""
                if c["value"].strip() and not value:
                    out.append({"field": f, "why": "Yes, No, or blank when it was not said."})
                    continue
            elif f == "best_in_person_day_time":
                if not real_day_time(value):
                    out.append({"field": f, "why": "A day and time as YYYY-MM-DD HH:MM, on the calendar."})
                    continue
            elif CW.utf16_len(value) > PREF_TEXT[f][2]:
                out.append({"field": f, "why": f"Up to {PREF_TEXT[f][2]} characters."})
                continue
            cells = by_tab.setdefault(PHONE, {})
            cells[f] = value
            if f == "best_in_person_day_time":
                cells["date_accepted_manual_by"] = "asa-hub:manual:" + by
            written.append({"field": f, "before": raw[f], "after": value})
        words = PREFS_WORDS
    answer = W.edit_answer(written, out, stale, W.pg_steps(words, CACHES, APP_ID))
    if not written:
        return Decision(answer)
    W.gate(reads)
    at, ev = W.now_iso(reads), EVIDENCE + str(uuid.uuid4())
    cand_cells = by_tab.get(CANDIDATES)
    if cand_cells:
        if ("phone" in cand_cells or "email" in cand_cells) and \
                gsjs.trim(gsjs.or_blank(reads.config().get(GUARD_KEY))).lower() == "enforce":
            raise Defer("the staff contact guard enforces: Apps Script holds the contact against the staff records")
        if any(f in cand_cells for f in NAME_FIELDS):
            cand = ctx["cand"]
            first = cand_cells.get("first_name", s_(cand.get("firstname")))
            last = cand_cells.get("last_name", s_(cand.get("lastname")))
            full = " ".join(f"{first} {last}".split())
            if full:
                cand_cells["candidate_name"] = js_slice(full, 200)
        cand_cells.update({"updated_at": at, "updated_by": "candidate-edit:" + by})
    recs: list[dict] = []
    for tab, cells in by_tab.items():
        # the Hiring card's edit lands through the runtime sheet; the other records as the field is written
        recorded = "runtime-sheet" if tab == CANDIDATES else by
        recs += facts_of(reads, tab, ctx["key"], cells, recorded, ctx["key"], edition, at=at, evidence=ev)
    return W.final(answer, recs, ctx["key"])


# ---- a note on the journey edited or removed (candidateProfileNoteEdit) --------------------------------------------

def note_edit(sess: L.Session, payload: dict) -> Decision:
    """candidateProfileNoteEdit (Python's own): a note's text, or the note removed (its row tombstoned); a step the
    platform logged is never edited."""
    shut = edit_door(sess, EDITION["notes"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = own_ctx(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    jid = re.sub(r"^jrn_", "", gsjs.text(payload.get("id"), 90))
    if not re.fullmatch(r"[A-Za-z0-9_\-]{4,80}", jid):
        return W.refuse(400, "id: which note.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    row = dissolved_rows(reads, JOURNEY, [jid]).get(jid)
    if row is None:
        return W.refuse(404, f"No note \"jrn_{jid}\" is on {ctx['name']}'s hiring journey.")
    marked(row.get("candidateid"), row.get("step"))
    if s_(row.get("candidateid")) != ctx["key"]:
        return W.refuse(409, "That note belongs to another candidate — reload the profile.")
    if s_(row.get("step")) != "note":
        return W.refuse(409, "Only a note is edited here; a step the platform logged stays as it was.")
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f == "body":
            marked(row.get("detail"))
            now = CW.witness(c["expected"], s_(row.get("detail")))
            if now is not None:
                stale[f] = now
                continue
            value = c["value"].strip()
            if not value:
                out.append({"field": f, "why": "A note says something; remove it instead."})
                continue
            if CW.utf16_len(value) > NOTE_MAX:
                out.append({"field": f, "why": f"Up to {NOTE_MAX} characters."})
                continue
            cells["detail"] = value
            written.append({"field": f, "before": s_(row.get("detail")), "after": value})
        elif f == "state":
            if c["value"].strip().lower() != "removed":
                out.append({"field": f, "why": "A note on file is only removed here."})
                continue
            cells["__deleted"] = "true"
            written.append({"field": f, "before": "open", "after": "removed"})
        else:
            out.append({"field": f, "why": "Not a field of a note."})
    answer = W.edit_answer(written, out, stale, W.pg_steps(NOTE_WORDS, CACHES, APP_ID))
    if not cells:
        return Decision(answer)
    if "__deleted" in cells:
        cells = {"__deleted": "true"}
    W.gate(reads)
    recs = facts_of(reads, JOURNEY, jid, cells, who_email(sess.user), ctx["key"], edition_of(sess, EDITION["notes"]))
    return W.final(answer, recs, ctx["key"])


# ---- a filed document reviewed (candidateProfileDocReview) --------------------------------------------------------

def doc_id_of(raw: Any) -> str:
    """A catalog id, from the Documents section's own id ('doc_<id>') or the id itself."""
    d = re.sub(r"^doc_", "", gsjs.text(raw, 80))
    return "background_check" if d == "cjis" else d


def doc_row(reads: L.Reads, key: str, doc_id: str) -> dict[str, str] | None:
    """filesDocRows_ → docReview's hit: the candidate's latest row for the paper that nothing superseded."""
    hit = None
    for r in dissolved_rows(reads, DOCS).values():
        if s_(r.get("candidateid")) == key and s_(r.get("docid")) == doc_id and not s_(r.get("supersededby")):
            hit = r
    return hit


def doc_review(sess: L.Session, payload: dict) -> Decision:
    """candidateProfileDocReview (docReview's own fields): Verified or Returned, its issued and expiry days and notes,
    per field refused, stale or kept as facts on the document's row."""
    shut = edit_door(sess, EDITION["documents"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = own_ctx(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    doc_id = doc_id_of(payload.get("doc"))
    if not re.fullmatch(r"[a-z0-9_]{2,60}", doc_id):
        return W.refuse(400, "doc: which document.")
    if doc_id == "background_check":
        return W.refuse(409, DOC_LOCKED)
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    row = doc_row(reads, ctx["key"], doc_id)
    if row is None:
        return W.refuse(404, f"No document on file for {doc_id}")
    by = who_email(sess.user)
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in DOC_FIELDS:
            out.append({"field": f, "why": "Not a field of a document's review."})
            continue
        current = s_(row.get(norm(f)))
        marked(current)
        now = CW.witness(c["expected"], current)
        if now is not None:
            stale[f] = now
            continue
        value = c["value"].strip()
        if f == "review_status":
            value = value.lower()
            if value not in REVIEWS:
                out.append({"field": f, "why": "Verified or Returned."})
                continue
            cells.update({"status": value, "review_status": value, "verified_by": "asa-hub:" + by,
                          "verified_at": W.now_iso(reads)})
        elif f in ("issued_on", "expires_on"):
            if not _DAY.fullmatch(value):
                out.append({"field": f, "why": "A day as YYYY-MM-DD; a blank day is not saved here."})
                continue
            cells[f] = value
        else:
            if not value:
                out.append({"field": f, "why": "A blank note is not saved here."})
                continue
            if CW.utf16_len(value) > DOC_FIELDS[f][2]:
                out.append({"field": f, "why": f"Up to {DOC_FIELDS[f][2]} characters."})
                continue
            cells[f] = value
        written.append({"field": f, "before": current, "after": value})
    answer = W.edit_answer(written, out, stale, W.pg_steps(DOC_WORDS, CACHES, APP_ID))
    if not cells:
        return Decision(answer)
    W.gate(reads)
    sub = s_(row.get("docrowid"))
    if not sub:
        raise Defer("the document's row names no id")
    at, ev = W.now_iso(reads), EVIDENCE + str(uuid.uuid4())
    recs: list[dict] = []
    for col, v in cells.items():
        recs += facts_of(reads, DOCS, sub, {col: v}, "runtime-sheet", ctx["key"], edition_of(sess, EDITION["documents"]),
                         at=at, evidence=ev)
    return W.final(answer, recs, ctx["key"])


# ---- the edit panels' read (candidateProfileEditRead): a READ, laid into the read module's ACTIONS --------------------

OPTION_WORDS = {"": "Not said", "pending": "Pending", "uploaded": "Uploaded", "verified": "Verified",
                "returned": "Returned"}


def _field(key: str, label: str, kind: str, raw: str, max_len: int, lock: dict | None = None,
           options: tuple | None = None, hint: str = "") -> dict[str, Any]:
    f: dict[str, Any] = {"key": key, "label": label, "kind": kind, "raw": raw, "max": max_len}
    if options is not None:
        f["options"] = list(options)
        f["optionLabels"] = {o: OPTION_WORDS.get(o, o[:1].upper() + o[1:]) for o in options}
    if hint:
        f["hint"] = hint
    if lock:
        f["lockedBy"] = lock
    return f


def edit_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The raw values a section's edit panel opens on, each lock with its reason; 404 to whom the edition does not open."""
    section = s_(payload.get("section")) or "information"
    eid = {"information": EDITION["information"], "preferences": EDITION["interviews"],
           "document": EDITION["documents"], "note": EDITION["notes"]}.get(section)
    if eid is None:
        return {"status": 400, "message": "section: information, preferences, document or note."}
    shut = edit_door(sess, eid)
    if shut:
        return shut
    reads = sess.reads
    ctx = own_ctx(reads, payload.get("candidate"))
    if ctx.get("refused"):
        env = ctx["refused"]
        if env.get("status") == 503:
            raise Defer(str(env.get("message"))[:160])
        return env
    fields: list[dict] = []
    elsewhere: list[dict[str, str]] = []
    if section == "information":
        raw, locks, _has = info_values(reads, ctx)
        for f, (_tab, _col, label, kind, max_len) in INFO_FIELDS.items():
            fields.append(_field(f, label, kind, raw[f], max_len, locks.get(f)))
        elsewhere = [{"field": f, "label": label, "why": why} for f, (label, why) in INFO_LOCKED.items()]
    elif section == "preferences":
        raw, screen = pref_values(reads, ctx)
        lock = None if screen is not None else {"why": NO_SCREEN}
        for f, label in PREF_FIELDS.items():
            fields.append(_field(f, label, "select", raw[f], 3, lock, ("", *YES_NO)))
        for f, (label, kind, max_len) in PREF_TEXT.items():
            hint = "YYYY-MM-DD HH:MM — the day agreed on the call" if f == "best_in_person_day_time" else ""
            fields.append(_field(f, label, kind, raw[f], max_len, lock, hint=hint))
        elsewhere = [{"field": f, "label": label, "why": why} for f, (label, why) in PREF_LOCKED.items()]
    elif section == "note":
        jid = re.sub(r"^jrn_", "", gsjs.text(payload.get("id"), 90))
        row = dissolved_rows(reads, JOURNEY, [jid]).get(jid) if re.fullmatch(r"[A-Za-z0-9_\-]{4,80}", jid) else None
        if row is None or s_(row.get("candidateid")) != ctx["key"]:
            return {"status": 404, "message": f"No note \"jrn_{jid}\" is on {ctx['name']}'s hiring journey."}
        if s_(row.get("step")) != "note":
            return {"status": 409, "message": "Only a note is edited here; a step the platform logged stays as it was."}
        fields.append(_field("body", "Note", "textarea", s_(row.get("detail")), NOTE_MAX))
        return {"status": 200, "data": {"section": section, "candidate": ctx["key"], "name": ctx["name"],
                                        "id": "jrn_" + jid, "by": s_(row.get("by")), "at": s_(row.get("at")),
                                        "fields": fields, "elsewhere": []}}
    else:
        doc_id = doc_id_of(payload.get("doc"))
        if doc_id == "background_check":
            return {"status": 409, "message": DOC_LOCKED}
        row = doc_row(reads, ctx["key"], doc_id) if re.fullmatch(r"[a-z0-9_]{2,60}", doc_id) else None
        if row is None:
            return {"status": 404, "message": f"No document on file for {doc_id}"}
        for f, (label, kind, max_len) in DOC_FIELDS.items():
            raw_v = s_(row.get(norm(f)))
            opts = None
            if f == "review_status":
                opts = REVIEWS if raw_v in REVIEWS else (raw_v, *REVIEWS)
            fields.append(_field(f, label, kind, raw_v, max_len, options=opts))
        return {"status": 200, "data": {"section": section, "candidate": ctx["key"], "name": ctx["name"],
                                        "doc": doc_id, "label": s_(row.get("doclabel")) or doc_id,
                                        "file": s_(row.get("filename")), "fields": fields, "elsewhere": []}}
    return {"status": 200, "data": {"section": section, "candidate": ctx["key"], "name": ctx["name"],
                                    "stage": ctx["stage"], "fields": fields, "elsewhere": elsewhere}}


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "candidateProfilePhoto": P.door("candidates"), "candidateProfileNoteAdd": note_add, "candidateProfileDoor": door,
    "candidateProfileEdit": edit, "candidateProfileNoteEdit": note_edit, "candidateProfileDocReview": doc_review,
}
_EDITORS = sc.EDITION_ROLES
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "candidateProfilePhoto": P.policy("candidates"),
    "candidateProfileNoteAdd": {"roles": _EDITORS, "params": {"candidate": "string", "body": "string"}},
    "candidateProfileDoor": {"roles": _EDITORS, "params": {"candidate": "string", "press": "string", "item": "string",
                                                           "fields": "object"}},
    "candidateProfileEdit": {"roles": _EDITORS, "params": {"candidate": "string", "section": "string",
                                                           "changes": "array"}},
    "candidateProfileNoteEdit": {"roles": _EDITORS, "params": {"candidate": "string", "id": "string",
                                                               "changes": "array"}},
    "candidateProfileDocReview": {"roles": _EDITORS, "params": {"candidate": "string", "doc": "string",
                                                                "changes": "array"}},
}
# the edit panels' read: answered by the read module's door (main.APPS), never under the write lock
READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"candidateProfileEditRead": edit_read}
READ_POLICY: dict[str, dict[str, Any]] = {
    "candidateProfileEditRead": {"roles": ("admin", "director", "manager", "staff", "client", "onboarding",
                                           "interviewer"),
                                 "params": {"candidate": "string", "section": "string", "doc": "string",
                                            "id": "string"}}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off a holder could not take
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.candidates_writes and app.candidates_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="candidates", label=APP_NAME)
