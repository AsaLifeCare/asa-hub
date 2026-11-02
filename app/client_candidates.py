"""Client Candidates (apps-script/ClientCandidates.gs) answered off asa-hub-db, read from the Potential Clients rows."""
from __future__ import annotations

import base64
import functools
import json
import logging
import os
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import candidates as CND
import clients as CP
import comm_logs
import gsjs
import hubdb
import locations as L
import photos as P
import scope as sc
import ssa as SSA
import staff as SP
import staff_comms as SC
from gsjs import NY, SheetDate
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "client-candidates"
UNKNOWN = "Unknown action."
# ClientCandidates.gs
CC_PACK_PARTS = ("overview", "actions", "intake", "documents", "activity", "texts", "transcripts")
CC_LEADS = "potentialClients"
CC_ACTIVITY_CAP = 400
CC_RECENT = 5
CC_CLOSING_DAYS = 14
CC_ALERTS_CAP = 20
LOG_FIELD = "candidate_log"
DOCS_FIELD = "candidate_docs"
PREFS_FIELD = "contact_preferences"
LOG_CAP = 300
LOG_CHARS = 45000
NOTE_MAX = 900
# read whole, up to what their edition may save
SERVICE_MAX = 4000
DIAGNOSIS_MAX = 1000
FILE_MAX_B64 = 21000000
STAGES = (
    {"id": "referral", "label": "Referral", "description": "Received — nobody has worked it yet"},
    {"id": "discovery", "label": "Discovery", "description": "First call with the family or SSA"},
    {"id": "assessment", "label": "Assessment", "description": "Needs assessment & house fit"},
    {"id": "placement-review", "label": "Placement Review", "description": "Paperwork, funding and waiver checks"},
    {"id": "ready-for-intake", "label": "Ready for Intake", "description": "Cleared — admission can begin"},
    {"id": "closed", "label": "Closed", "description": "Chose another provider, deferred or on hold"})
STAGE_HELD = {"": "referral", "new": "referral", "scraped": "referral", "read": "referral", "contacted": "discovery",
              "isp-drafting": "placement-review", "intake": "placement-review", "converted": "ready-for-intake",
              "on-hold": "closed", "lost": "closed"}
ORDER = ("referral", "discovery", "assessment", "placement-review", "ready-for-intake")
PHASES = (
    {"id": "referral_review", "title": "Referral review", "label": "First call with the family or SSA",
     "at": ("referral",), "done": "discovery"},
    {"id": "assessment", "title": "Discovery & assessment", "label": "Needs assessment & house fit",
     "at": ("discovery", "assessment"), "done": "placement-review"},
    {"id": "placement", "title": "Service fit & placement", "label": "Paperwork, funding and waiver checks",
     "at": ("placement-review",), "done": "ready-for-intake"})
WRITE_KINDS = ("stage", "complete", "reopen", "note")
FILED = {"assessment": "Support assessment", "consent": "Consent & contact preferences"}
ASSESSMENT_FIELDS = (("personal_care", "Personal care"), ("mobility", "Mobility"),
                     ("diet_nutrition", "Diet & nutrition"), ("communication", "Communication"),
                     ("medical_summary", "Medical summary"), ("safety_risks", "Safety & risks"),
                     ("behaviors", "Behavior support"), ("supervision_level", "Supervision"),
                     ("important_to", "Important to"), ("important_for", "Important for"))
SCRUB_KEYS = frozenset({"id", "key", "candidate", "file_id", "call_id", "with", "line", "client_key", "referral_id",
                        "ids", "candidate_id"})
ALERT_TITLES = {"sent": "The team was texted about this referral",
                "rehearsed": "An alert about this referral went to the testers",
                "held": "An alert about this referral was held", "held_quiet": "An alert about this referral was held",
                "refused": "An alert about this referral was not sent",
                "failed": "An alert about this referral did not go out"}
EVENT_TITLES = {"potentialClients.update": "Referral record updated", "potentialClients.create": "Referral added",
                "potentialClients.delete": "Referral removed"}
LOG_KINDS = {"stage": "stage", "step": "step", "note": "note", "document": "document"}
CC_WRITE_ACTIONS = ("clientCandidateWrite", "clientCandidateFile")
SHARED_LINE_DIGITS = SC.SHARED_LINE_DIGITS
# the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for a whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_CLIENT_CANDIDATE_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"

_A = re.A
_WS = "[" + L._JS_WS + "]"
_SEP = "[/.\\-" + L._JS_WS + "]"
_DOB_RE = re.compile(
    r"\b(DOB|D\.O\.B\.?|date of birth|birth ?date|birthday|born(?: on)?)(?:" + _WS + r"+(?:is|was))?"
    + _WS + r"*[:#-]?" + _WS + r"*(\d{1,2}" + _WS + "*" + _SEP + _WS + r"*\d{1,2}" + _WS + "*" + _SEP + _WS
    + r"*\d{2,4}|\d{4}" + _WS + r"*[/.\-]" + _WS + r"*\d{1,2}" + _WS + r"*[/.\-]" + _WS + r"*\d{1,2}"
    + r"|[A-Z][a-z]{2,8}\.?" + _WS + r"+\d{1,2}(?:st|nd|rd|th)?,?" + _WS + r"+\d{4}"
    + r"|\d{1,2}(?:st|nd|rd|th)?" + _WS + r"+[A-Z][a-z]{2,8}\.?,?" + _WS + r"+\d{4})", re.I | _A)
_MEDICAID_RE = re.compile(r"\b(Medicaid|MMIS)(" + _WS + r"*(?:no\.?|number|id|#))?" + _WS + r"*[:#-]?" + _WS
                          + r"*#?" + _WS + r"*\d[\d -]{6,}\d", re.I | _A)
_TWELVE_RE = re.compile(r"(^|\D)\d{12}(?=\D|\Z)", _A)
_SSN_RE = re.compile(r"(^|\D)\d{3}" + _WS + r"*[" + L._JS_WS + r".-]" + _WS + r"*\d{2}" + _WS + r"*["
                     + L._JS_WS + r".-]" + _WS + r"*\d{4}(?=\D|\Z)", _A)
_CARD_RE = re.compile(r"(^|\D)\d(?:[" + L._JS_WS + r".-]{0,2}\d){12,18}(?=\D|\Z)", _A)
_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{3,80}\Z", _A)
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z", _A)
_STAGE_CUT = re.compile("[" + L._JS_WS + "_-]+")
_US_DAY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\Z", _A)
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}\Z", _A)
_SERIAL = re.compile(r"^\d{5}(?:\.\d+)?\Z", _A)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# the referral row's Date columns: a day serial the copy keeps there is the Date Apps Script reads
DATE_COLUMNS = frozenset({"expiration_date", "scraped_at", "createdAt", "updatedAt"})


# ---- small values ----------------------------------------------------------------------------------------------------

s_ = gsjs.str_


def text(v: Any, max_len: int = 0) -> str:
    """ccText_ (locationsText_)."""
    return gsjs.text(v, max_len)


def _why(e: BaseException) -> str:
    return str(e)[:120]


def soft(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of the code being ported: its own failures become words; the database's are never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return None, _why(e)


def why_of(what: str, why: str) -> str:
    """ccWhy_."""
    return f"{what} could not be read ({why})."


def unknown() -> dict[str, Any]:
    """clientCandidatesUnknown_."""
    return {"status": 404, "message": UNKNOWN}


def _newest(a: dict, b: dict) -> int:
    """ssaNewest_."""
    return 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)


def stage_id(v: Any) -> str:
    """ccStageId_: 'Placement Review' → placement-review, 'On hold' → on-hold."""
    return _STAGE_CUT.sub("-", gsjs.trim(gsjs.or_blank(v)).lower())


def stage_meta(sid: Any) -> dict | None:
    """ccStageMeta_."""
    return next((s for s in STAGES if s["id"] == sid), None)


def stage_of(stage: Any) -> str:
    """ccStageOf_: the intake stage a folded stage shows as; '' for a word neither vocabulary knows."""
    if stage_meta(stage):
        return stage
    return STAGE_HELD.get(stage, "") if isinstance(stage, str) else ""


def stage_label(stage: str) -> str:
    """ccStageLabel_."""
    meta = stage_meta(stage_of(stage))
    if meta:
        return meta["label"]
    if not stage:
        return "No stage"
    return re.sub(r"^\w", lambda m: m.group(0).upper(), stage.replace("-", " "), count=1, flags=_A)


def stage_index(stage: str) -> int:
    """ccStageIndex_: 0 Referral … 4 Ready for Intake; -2 Closed; -1 a word it does not know."""
    sid = stage_of(stage)
    if sid == "closed":
        return -2
    return ORDER.index(sid) if sid in ORDER else -1


def stage_wanted(v: Any) -> str:
    """ccStageWanted_: a stage a press names, by its id or its label; '' when it is none of the six."""
    s = stage_id(v)
    return s if stage_meta(s) else ""


def truthy(v: Any) -> bool:
    """ccTruthy_."""
    return v is True or bool(re.fullmatch(r"true|yes|y|1", gsjs.trim(gsjs.or_blank(v)), re.I | _A))


def js_date_parse(s: str) -> float | None:
    """Date.parse: the ISO forms, then V8's legacy reading; None for NaN."""
    t = gsjs.date_parse(s)
    return t if t is not None else SSA._v8_ms(s)


def iso_ms(ms: float) -> str:
    if not -62135596800000 <= ms <= 253402300799999:
        raise Defer("an instant toISOString writes in its extended year form")
    return gsjs.iso(_EPOCH + timedelta(milliseconds=ms))


def instant(v: Any) -> str:
    """ccInstant_: an instant as ISO text; a bare day stays a day; '' when the cell names neither."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return ""
    day = sp_day(s) if _US_DAY.match(s) else ""
    if day:
        return day
    if _ISO_DAY.match(s):
        return s
    t = js_date_parse(s)
    return "" if t is None else iso_ms(t)


def sp_day(v: Any) -> str:
    """spDay_."""
    return SC._day(v)


def due_state(due: str, today: str) -> str:
    """ccDueState_."""
    if not due:
        return ""
    if due < today:
        return "overdue"
    return "today" if due == today else "upcoming"


def source_of(row: dict) -> str:
    """ccSource_: the referral's own source, else the county portal when the scraper took it."""
    return text(row.get("source"), 120) or ("County referral portal" if text(row.get("scraped_at")) else "")


def place(zip_code: str) -> str:
    """ccPlace_."""
    return "ZIP " + zip_code if zip_code else ""


def _scrub_text(s: str) -> str:
    s = _MEDICAID_RE.sub(r"\1\2 [withheld]", _DOB_RE.sub(r"\1 [withheld]", s))
    return _CARD_RE.sub(r"\1[withheld]", _SSN_RE.sub(r"\1[withheld]", _TWELVE_RE.sub(r"\1[withheld]", s)))


def scrub(v: Any, key: str | None = None) -> Any:
    """ccScrub_: the SSA guard, and a date of birth, a Medicaid number, a twelve-digit run or a card never leaves."""
    if key and key in SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return SSA.scrub(_scrub_text(v))
    if isinstance(v, bool):
        return SSA.scrub(v)
    if isinstance(v, (int, float)):
        if isinstance(v, int) or (v == v and v not in (float("inf"), float("-inf")) and gsjs.js_round(v) == v):
            if len(gsjs.num_str(abs(v))) == 12:
                return None
        return SSA.scrub(v)
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(v[k], k) for k in SC._js_keys(v)}
    return SSA.scrub(v)


def shown(data: Any) -> Any:
    """An answer showing a cell the copy withholds is Apps Script's to give."""
    return SC._shown(data)


def serve(what: str, get: Callable[[], Any]) -> dict[str, Any]:
    """ccServe_: 503 names the source when the build throws."""
    try:
        return {"status": 200, "data": get()}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the door's own catch
        return {"status": 503, "message": f"{what} could not be read just now ({_why(e)})."}


def json_of(v: Any, fallback: Any) -> Any:
    """ccJsonOf_: a JSON cell as its value; `fallback` when it holds neither."""
    if isinstance(v, (dict, list)):
        return v
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return fallback
    try:
        got = json.loads(s)
    except ValueError:
        return fallback
    return got if isinstance(got, (dict, list)) else fallback


def log_of(v: Any) -> list[dict]:
    """ccLogOf_: the candidate's log, {at, by, kind, text} in the order written."""
    got = json_of(v, [])
    out = []
    for e in got if isinstance(got, list) else []:
        if not isinstance(e, dict) or not gsjs.or_text(e.get("at")) or not gsjs.or_text(e.get("text")):
            continue
        out.append({"at": gsjs.js_str(e["at"]), "by": gsjs.or_text(e.get("by")), "kind": gsjs.or_text(e.get("kind")),
                    "text": gsjs.js_str(e["text"])})
    return out


def _js_len(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def log_with(v: Any, entry: dict) -> list[dict]:
    """ccLogWith_: the log with one more entry, the oldest let go past its cap or past what a cell holds."""
    lst = log_of(v) + [entry]
    if len(lst) > LOG_CAP:
        lst = lst[len(lst) - LOG_CAP:]
    while len(lst) > 1 and _js_len(json.dumps(lst, ensure_ascii=False, separators=(",", ":"))) > LOG_CHARS:
        lst.pop(0)
    return lst


def docs_of(v: Any) -> dict:
    """ccDocsOf_: the papers filed from this app."""
    d = json_of(v, {})
    return d if isinstance(d, dict) else {}


def prefs_of(v: Any) -> dict[str, str]:
    """ccPrefsOf_: method, best time, who to contact."""
    p = json_of(v, {})
    p = p if isinstance(p, dict) else {}
    return {"method": text(p.get("method"), 60), "best_time": text(p.get("best_time"), 120),
            "who": text(p.get("who"), 200)}


def prefs_words(p: dict) -> str:
    """ccPrefsWords_."""
    return " · ".join(x for x in ("by " + p["method"] if p["method"] else "", p["best_time"] or "",
                                  "ask for " + p["who"] if p["who"] else "") if x)


def clock(at: datetime) -> str:
    """ccClock_: the Ohio wall clock to the second."""
    local = at.astimezone(NY)
    return local.strftime("%Y-%m-%d %H:%M") + f":{at.astimezone(timezone.utc).second:02d}"


def note_line(at: datetime, by: str, about: str, words: str) -> str:
    """ccNoteLine_: when, who, the step it is about, then the words."""
    return clock(at) + (" · " + by if by else "") + " — " + (about + ": " if about else "") + words


def notes_with(notes: Any, line: str) -> str:
    """ccNotesWith_."""
    s = gsjs.trim(gsjs.or_blank(notes))
    return s + "\n" + line if s else line


# ---- the referral rows and the lookup --------------------------------------------------------------------------------

def _serial_text(s: str) -> str:
    """cellText_ of the Date a day serial stands for in the copy (the book's Etc/GMT clock)."""
    ms = round((float(s) - 25569.0) * 86400000.0)
    if ms % 86400000 == 0:
        return (_EPOCH + timedelta(milliseconds=ms)).strftime("%Y-%m-%d")
    return iso_ms(ms)


def _cell(v: Any, direct: bool, col: str) -> Any:
    """The cell readAll_ hands back: the scraper writes text, so a date-looking text stays text; a serial is a Date."""
    if col in DATE_COLUMNS and isinstance(v, str) and _SERIAL.match(v.strip()):
        return _serial_text(v.strip())
    if direct:
        return SC._typed(v, True)
    t = hubdb.typed(v, "hub")
    return hubdb.typed(v, "raw") if isinstance(t, SheetDate) else t


def lead_rows(reads: L.Reads, ref: hubdb.TabRef | None) -> list[dict]:
    """readAll_ of the referral tab: header-keyed, rows of nothing but blanks dropped, JSON-looking text parsed."""
    if ref is None:
        return []
    direct = SC._direct(reads, ref.sheet_id)
    out = []
    for _rn, raw in reads.db.rows(ref):
        vals = [_cell(raw.get(h), direct, h) for h in ref.headers]
        if all(v == "" or v is None for v in vals):
            continue
        out.append({h: hubdb.cell_text(v) for h, v in zip(ref.headers, vals) if h != ""})
    return out


def leads(reads: L.Reads) -> dict[str, Any]:
    """ccLeads_: listRows_('potentialClients') once per request, and each id's first row — from Postgres once Potential
    Clients is Python's."""
    def read() -> dict[str, Any]:
        import sheet_resources  # noqa: PLC0415 — it imports this module's neighbours
        kept = sheet_resources.kept_rows(reads, CC_LEADS)
        if kept is not None:
            by: dict[str, dict] = {}
            for r in kept:
                rid = gsjs.trim(gsjs.or_text((r or {}).get("id")))
                if rid and rid not in by:
                    by[rid] = r
            return {"rows": kept, "byId": by, "book": "", "tab": CC_LEADS}
        res = reads.db.resolve(CC_LEADS)
        if res.runtime:
            raise Defer(f"{CC_LEADS} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {CC_LEADS}")
        rows = lead_rows(reads, res.ref)
        by_id: dict[str, dict] = {}
        for r in rows:
            rid = gsjs.trim(gsjs.or_text((r or {}).get("id")))
            if rid and rid not in by_id:
                by_id[rid] = r
        return {"rows": rows, "byId": by_id, "book": res.sheet_id, "tab": res.ref.tab if res.ref else CC_LEADS}
    return reads.once("cc_leads", read)


def ctx_of(key: str, row: dict, book: str = "", tab: str = CC_LEADS) -> dict[str, Any]:
    """ccCtxOf_, with where the row lives for the writes."""
    return {"key": key, "name": text(row.get("client_name"), 160) or key, "row": row,
            "stage": stage_id(row.get("stage")), "memo": {}, "book": book, "tab": tab}


def candidate_of(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """ccCandidate_: 400 when no row carries the id."""
    key = gsjs.trim("" if raw is None else gsjs.js_str(raw))
    none = {"refused": {"status": 400, "message": f'No candidate "{key[:120]}" is on file.'}}
    if not _KEY_RE.match(key):
        return none
    got, why = soft(lambda: leads(reads))
    if why:
        return {"refused": {"status": 503, "message": "The Potential Clients records could not be read just now ("
                            + why + ") — nothing is said about this candidate."}}
    row = got["byId"].get(key)
    if row is None:
        return none
    return ctx_of(key, row, got["book"], got["tab"])


def data_of(action: str, ctx: dict, build: Callable[[], Any]) -> Any:
    """ccData_: one part's scrubbed answer, built once per request and shared by every part that shows it."""
    slot = "a:" + action
    if slot not in ctx["memo"]:
        ctx["memo"][slot] = shown(scrub(build()))
    return ctx["memo"][slot]


# ---- the roster ------------------------------------------------------------------------------------------------------

def roster_row(row: dict) -> dict[str, Any]:
    """ccRosterRow_."""
    zc = text(row.get("postal_code"), 20)
    stage = stage_id(row.get("stage"))
    return {"key": gsjs.js_str(row.get("id")), "referral_id": text(row.get("referral_id"), 40),
            "name": text(row.get("client_name"), 160), "service": text(row.get("description"), 280), "stage": stage,
            "stage_label": stage_label(stage), "intake_stage": stage_of(stage), "zip": zc, "county": "",
            "location": place(zc), "next_step": text(row.get("next_step"), 200), "owner": text(row.get("owner"), 120),
            "source": source_of(row), "referred_at": text(row.get("scraped_at")) or text(row.get("createdAt")),
            "phone": text(row.get("phone"), 40), "email": text(row.get("email"), 120),
            "rating": text(row.get("ai_rating"), 10), "expires": text(row.get("expiration_date"), 40),
            "alerted": truthy(row.get("sms_sent")), "avatar": ""}


def roster_build(reads: L.Reads) -> dict[str, Any]:
    """ccRosterBuild_: every referral, its stage counted."""
    counts: dict[str, int] = {}
    other: dict[str, int] = {}
    seen: set[str] = set()
    out = []
    for r in leads(reads)["rows"]:
        rid = gsjs.trim(gsjs.or_text((r or {}).get("id")))
        if not rid or rid in seen or not text(r.get("client_name")):
            continue
        seen.add(rid)
        row = roster_row(r)
        row["avatar"] = P.of(reads, "client-candidates", row["key"])
        if row["intake_stage"]:
            counts[row["intake_stage"]] = counts.get(row["intake_stage"], 0) + 1
        else:
            other[row["stage"]] = other.get(row["stage"], 0) + 1
        out.append(row)
    out.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(a["name"], b["name"])))
    stages = [{"id": s["id"], "label": s["label"], "count": counts.get(s["id"], 0)} for s in STAGES]
    for s in sorted(other):
        stages.append({"id": s, "label": stage_label(s), "count": other[s]})
    return {"candidates": out, "stages": stages, "total": len(out), "why": [], "degraded": False}


# ---- the opt-out list ------------------------------------------------------------------------------------------------

def opt_out(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccOptOut_: {none} with neither a phone nor an e-mail, {hit} or {hit: None}; an unreadable list throws."""
    if "optOut" in ctx["memo"]:
        return ctx["memo"]["optOut"]
    row = ctx["row"]
    email = gsjs.or_text(row.get("email"))
    targets = SC._numbers(row.get("phone")) + ([gsjs.trim(gsjs.js_str(row.get("email")))] if "@" in email else [])
    if not targets:
        out = {"none": True, "hit": None}
    else:
        idx = CND.opt_out_index(reads)
        if idx["error"]:
            raise RuntimeError(idx["error"])
        hit = None
        for t in targets:
            k = CND._opt_out_key(t)
            if not hit and k and idx["by"].get(k):
                hit = idx["by"][k]
        out = {"none": False, "hit": hit}
    ctx["memo"]["optOut"] = out
    return out


def opt_out_words(hit: dict) -> str:
    """ccOptOutWords_."""
    day = sp_day(hit.get("at"))
    return ("The referral's phone or e-mail is on the opt-out list — they asked us to stop"
            + (" on " + day if day else "") + (" (" + text(hit.get("scope"), 40) + ")" if hit.get("scope") else "")
            + ".")


# ---- the intake: actions and the plan --------------------------------------------------------------------------------

def step(ctx: dict, kind: str, p: dict | None, stage: str) -> dict[str, Any]:
    """ccStep_: a press on this row, what it writes and which door takes it."""
    return {"action": "clientCandidateWrite", "candidate_id": ctx["key"], "kind": kind, "item": p["id"] if p else "",
            "fields": {"stage": stage_meta(stage)["label"]}}


def phase_rows(ctx: dict) -> list[dict[str, Any]]:
    """ccPhaseRows_: each phase for the referral's stage, the next one, and the presses that complete or reopen it."""
    at = stage_index(ctx["stage"])
    here = ORDER[at] if at >= 0 else ""
    states = []
    for p in PHASES:
        if at >= ORDER.index(p["done"]):
            states.append("completed")
        else:
            states.append("awaiting_confirmation" if here and here in p["at"] else "pending")
    head = -1
    if at >= 0:
        head = next((i for i, st in enumerate(states) if st != "completed"), -1)
    out = []
    for i, p in enumerate(PHASES):
        st, nxt = states[i], i == head
        why = ""
        if st != "completed" and not nxt:
            if at == -2:
                why = "Closed — Update stage moves it back into the intake first."
            elif at == -1:
                why = "Its stage is not an intake stage — Update stage sets one first."
            else:
                why = "Comes after " + PHASES[i - 1]["title"] + "."
        out.append({"phase": p, "state": st, "next": nxt, "open": st != "completed" and at != -2, "why": why,
                    "complete": step(ctx, "complete", p, p["done"]) if nxt else None,
                    "reopen": step(ctx, "reopen", p, p["at"][0]) if st == "completed" and at >= 0 else None})
    return out


def phase_states(ctx: dict) -> list[str]:
    return [r["state"] for r in phase_rows(ctx)]


def attention(reads: L.Reads, ctx: dict) -> list[str]:
    """ccAttention_: what needs a person now, from the referral's own row."""
    row, out = ctx["row"], []
    intake = stage_of(ctx["stage"])
    closed = intake in ("ready-for-intake", "closed")
    today = reads.today()
    ends = sp_day(row.get("expiration_date"))
    if not closed and ends:
        if ends < today:
            out.append("The referral window closed on " + ends + ".")
        elif gsjs.day_shift(today, CC_CLOSING_DAYS) >= ends:
            out.append("The referral window closes on " + ends + ".")
    if truthy(row.get("sms_sent")) and ctx["stage"] == "new":
        out.append("The team was texted about this referral and nobody has opened it yet.")
    if not text(row.get("phone")) and not text(row.get("email")):
        out.append("No phone or e-mail is on the referral.")
    if not closed and not text(row.get("owner")):
        out.append("No intake coordinator is set.")
    opt, _w = soft(lambda: opt_out(reads, ctx))
    if opt and opt.get("hit"):
        out.append(opt_out_words(opt["hit"]))
    return out


def stage_choices(ctx: dict) -> list[dict[str, Any]]:
    """ccStageChoices_: the six intake stages, each written to the row's own stage."""
    cur = stage_of(ctx["stage"])
    return [{"id": s["id"], "label": s["label"], "description": s["description"], "current": s["id"] == cur,
             "write": None if s["id"] == cur else step(ctx, "stage", None, s["id"])} for s in STAGES]


def reads_of(x: L.Reads | L.Session) -> L.Reads:
    """A session's reads, or the reads themselves."""
    return x.reads if isinstance(x, L.Session) else x


def actions_build(reads: L.Reads | L.Session, ctx: dict) -> dict[str, Any]:
    """ccActionsBuild_: each phase from the referral's stage, the presses, the stage choices and the note."""
    reads = reads_of(reads)
    row, why = ctx["row"], []
    at = stage_index(ctx["stage"])
    today = reads.today()
    due = sp_day(row.get("expiration_date"))
    owner = text(row.get("owner"), 120)
    if at == -2:
        why.append("The referral is Closed; the stage alone does not say how far its intake got.")
    if at == -1:
        why.append('The stage "' + text(row.get("stage"), 60) + '" is not an intake stage.')
    items = []
    for r in phase_rows(ctx):
        p, st = r["phase"], r["state"]
        item_due = due if r["open"] and at >= 0 else ""
        items.append({"id": p["id"], "label": p["label"], "title": p["title"], "stage": p["at"][0],
                      "status": "done" if st == "completed" else ("in_progress" if st == "awaiting_confirmation"
                                                                  else "pending"),
                      "open": r["open"], "is_next": r["next"], "owner": owner, "due": item_due,
                      "due_state": due_state(item_due, today),
                      "next_step": text(row.get("next_step"), 300) if r["next"] else "", "complete": r["complete"],
                      "reopen": r["reopen"], "complete_why": r["why"]})
    return {"stage": ctx["stage"], "stage_label": stage_label(ctx["stage"]),
            "closed": at == -2 or at == len(ORDER) - 1, "items": items,
            "next": next((x for x in items if x["is_next"]), None), "open": sum(1 for x in items if x["open"]),
            "attention": attention(reads, ctx), "stages": stage_choices(ctx),
            "note": {"action": "clientCandidateWrite", "candidate_id": ctx["key"], "kind": "note",
                     "current": gsjs.or_blank(row.get("notes"))},
            "why": why, "degraded": False}


def actions_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of("clientCandidateActions", ctx, lambda: actions_build(reads, ctx))


def intake_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccIntakeBuild_: the three phases and what the referral says they need."""
    row, why = ctx["row"], []
    states = phase_states(ctx)
    at = stage_index(ctx["stage"])
    owner = text(row.get("owner"), 120)
    lg = log_of(row.get(LOG_FIELD))
    plan = []
    for i, p in enumerate(PHASES):
        current = states[i] == "awaiting_confirmation"
        moved = ""
        for e in lg:
            if e["text"] == "Completed action: " + p["label"]:
                moved = e["at"]
        plan.append({"id": p["id"], "title": p["title"], "detail": p["label"],
                     "date": moved if states[i] == "completed" else "", "owner": owner, "status": states[i],
                     "result": "Reached " + stage_meta(p["done"])["label"] if states[i] == "completed" else "",
                     "comments": text(row.get("next_step"), 300) if current else ""})
    why.append("A phase carries a date only when it was completed here; the stage alone does not say when it moved.")
    if at == -2:
        why.append("The referral is Closed; the stage alone does not say how far its intake got.")
    if at == -1:
        why.append('The stage "' + text(row.get("stage"), 60) + '" is not an intake stage.')
    zc = text(row.get("postal_code"), 20)
    prefs = prefs_of(row.get(PREFS_FIELD))
    preferences = [{"label": "Service requested", "value": text(row.get("description"), SERVICE_MAX)},
                   {"label": "Frequency", "value": text(row.get("frequency"), 200)},
                   {"label": "Funding source", "value": text(row.get("funding_source"), 80)},
                   {"label": "Location", "value": place(zc)},
                   {"label": "Preferred start", "value": ""},
                   {"label": "Important to them", "value": ""}]
    support = [{"label": "Family / guardian", "value": ""},
               {"label": "Phone", "value": text(row.get("phone"), 40)},
               {"label": "E-mail", "value": text(row.get("email"), 120)},
               {"label": "Referred by", "value": source_of(row)},
               {"label": "Contact method", "value": prefs["method"]},
               {"label": "Best time", "value": prefs["best_time"]},
               {"label": "Who to contact", "value": prefs["who"]}]
    why.append("Not on the referral: family or guardian, a preferred start and what is important to them — the "
               "Potential Clients row does not carry them.")
    return {"plan": plan, "preferences": preferences, "support": support, "closed": at == -2, "why": why,
            "degraded": False}


def intake_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of("clientCandidateIntake", ctx, lambda: intake_build(reads, ctx))


# ---- the client a referral became, and the plan that names them ------------------------------------------------------

def client_of(reads: L.Reads, ctx: dict, sink: dict) -> dict | None:
    """ccClientOf_: the one client record carrying the name of a referral ready for intake; None otherwise."""
    if stage_of(ctx["stage"]) != "ready-for-intake":
        return None
    if "client" in ctx["memo"]:
        return ctx["memo"]["client"]
    want = gsjs.name_key(ctx["name"])
    rows, why = soft(lambda: reads.clients_derived() or [])
    if why:
        sink["why"].append(why_of("The client records", why))
        sink["degraded"] = True
        return None
    hits = []
    for c in rows or []:
        name = text((c or {}).get("name"))
        if want and gsjs.name_key(name) == want:
            hits.append({"key": gsjs.trim(gsjs.or_text(c.get("client_key"))) or gsjs.name_key(name), "name": name})
    out = None
    if len(hits) == 1:
        out = hits[0]
    elif len(hits) > 1:
        sink["why"].append("Two client records carry this name, so the client it became is not named.")
    else:
        sink["why"].append("No client record carries this name yet, so the client it became is not named.")
    ctx["memo"]["client"] = out
    return out


def plan_of(reads: L.Reads, ctx: dict, sink: dict) -> dict[str, Any]:
    """ccPlanOf_: the one plan in the plans folder carrying the referral's name, and the sections read from it."""
    if "plan" in ctx["memo"]:
        return ctx["memo"]["plan"]
    out: dict[str, Any] = {"file": None, "sections": [], "year": "", "readable": True}
    try:
        CP.isp_files(reads)
    except Defer:
        out["readable"] = False
        sink["why"].append("The plans folder could not be read, so no plan file is listed.")
        sink["degraded"] = True
    else:
        hit, _w = soft(lambda: CP.isp_doc(reads, ctx["name"]))
        if hit and hit.get("id"):
            out["file"] = {"id": gsjs.js_str(hit["id"]), "name": text(hit.get("name"), 160)}
    if out["file"]:
        want = gsjs.name_key(ctx["name"])

        def isps() -> list[dict]:
            return [r for r in reads.hub_rows("isps") or []
                    if want and (gsjs.trim(gsjs.or_text(r.get("client_key"))) == want
                                 or gsjs.name_key(r.get("client_name") or r.get("name")) == want)]
        rows, why = soft(isps)
        if why:
            sink["why"].append(why_of("The plans read into sections", why))
            sink["degraded"] = True
        rows = sorted(rows or [], key=functools.cmp_to_key(
            lambda a, b: gsjs.locale_cmp(gsjs.or_text(b.get("isp_year")), gsjs.or_text(a.get("isp_year")))))
        if rows:
            isp = rows[0]
            out["year"] = text(isp.get("isp_year"), 10)
            for k, label in ASSESSMENT_FIELDS:
                t = text(isp.get(k), 4000)
                if t:
                    out["sections"].append({"key": k, "label": label, "text": t})
    ctx["memo"]["plan"] = out
    return out


# ---- documents -------------------------------------------------------------------------------------------------------

def documents_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccDocumentsBuild_: the referral summary, the support assessment, the consent and the plan."""
    row, sink, docs = ctx["row"], {"why": [], "degraded": False}, []
    intake = stage_of(ctx["stage"])
    filed = docs_of(row.get(DOCS_FIELD))
    referred = sp_day(row.get("scraped_at")) or sp_day(row.get("createdAt"))
    ends = sp_day(row.get("expiration_date"))
    told = bool(text(row.get("description")) or text(row.get("frequency")) or text(row.get("diagnosis")))
    rid = text(row.get("referral_id"))
    docs.append({"id": "referral", "title": "Referral summary", "group": "referral", "group_label": "Referral",
                 "status": "on_file", "date": referred, "file_id": "", "render": "referral", "mime": "application/pdf",
                 "source": source_of(row), "can_file": False,
                 "detail": " · ".join(x for x in ("Referral " + text(row.get("referral_id"), 40) if rid else "",
                                                  "window until " + ends if ends else "") if x)
                 if told else "The referral names no service, frequency or diagnosis."})

    plan = plan_of(reads, ctx, sink)
    a = filed.get("assessment") or None
    assessment: dict[str, Any] = {"id": "assessment", "title": "Support assessment", "group": "assessment",
                                  "group_label": "Assessment", "status": "pending", "date": "", "file_id": "",
                                  "render": "", "mime": "", "source": "", "detail": "", "can_file": False}
    if isinstance(a, dict) and not gsjs.falsy(a.get("file_id")):
        assessment["status"] = "on_file"
        assessment["file_id"] = gsjs.js_str(a["file_id"])
        assessment["mime"] = gsjs.or_text(a.get("mime"))
        assessment["date"] = sp_day(a.get("at"))
        assessment["source"] = "Filed" + (" by " + text(a.get("by"), 80) if not gsjs.falsy(a.get("by")) else "")
        assessment["detail"] = text(a.get("name"), 160)
    elif plan["sections"]:
        assessment["status"] = "on_file"
        assessment["render"] = "assessment"
        assessment["mime"] = "application/pdf"
        assessment["source"] = "The plan on file" + (" · ISP " + plan["year"] if plan["year"] else "")
        assessment["detail"] = "From the plan: " + ", ".join(s["label"] for s in plan["sections"])
    elif plan["file"]:
        assessment["status"] = "on_file"
        assessment["file_id"] = plan["file"]["id"]
        assessment["mime"] = SSA.mime_of(plan["file"]["name"])
        assessment["source"] = "The plan on file"
        assessment["detail"] = plan["file"]["name"] + " — not read into sections yet."
    else:
        assessment["can_file"] = intake == "assessment"
        where = (" — file the assessment here." if assessment["can_file"]
                 else "; it is filed here at the Assessment stage.")
        assessment["detail"] = ("No plan on file carries this name" + where if plan["readable"]
                                else "The plans folder could not be read.")
    docs.append(assessment)

    c = filed.get("consent") or None
    prefs = prefs_of(row.get(PREFS_FIELD))
    consent: dict[str, Any] = {"id": "consent", "title": "Consent & contact preferences", "group": "consent",
                               "group_label": "Consent", "status": "pending", "date": "", "file_id": "", "render": "",
                               "mime": "", "source": "", "detail": "", "can_file": True, "preferences": prefs}
    if isinstance(c, dict) and not gsjs.falsy(c.get("file_id")):
        confirmed = not gsjs.falsy(c.get("confirmed_at"))
        consent["status"] = "on_file" if confirmed else "in_review"
        consent["file_id"] = gsjs.js_str(c["file_id"])
        consent["mime"] = gsjs.or_text(c.get("mime"))
        consent["date"] = sp_day(c.get("at"))
        consent["source"] = "Filed" + (" by " + text(c.get("by"), 80) if not gsjs.falsy(c.get("by")) else "")
        consent["detail"] = " · ".join(x for x in (prefs_words(prefs), "confirmed " + sp_day(c.get("confirmed_at"))
                                                   if confirmed else "awaiting confirmation") if x)
    else:
        consent["detail"] = "No signed consent is filed yet."
    opt, why_o = soft(lambda: opt_out(reads, ctx))
    if why_o:
        sink["why"].append(why_of("The opt-out list", why_o))
        sink["degraded"] = True
    if opt and opt.get("hit"):
        consent["opt_out"] = {"at": sp_day(opt["hit"].get("at")), "scope": text(opt["hit"].get("scope"), 40)}
        consent["detail"] += " " + opt_out_words(opt["hit"])
    docs.append(consent)

    if plan["file"] or intake == "ready-for-intake":
        pf = plan["file"]
        docs.append({"id": "isp", "title": "Individual Service Plan", "group": "admission", "group_label": "Admission",
                     "status": "on_file" if pf else "pending", "date": "", "file_id": pf["id"] if pf else "",
                     "render": "", "mime": SSA.mime_of(pf["name"]) if pf else "", "source": "Plans folder",
                     "can_file": False,
                     "detail": pf["name"] if pf else "The plans folder holds no single plan for this name."})
    on_file = sum(1 for d in docs if d["status"] == "on_file")
    return {"docs": docs,
            "counts": {"total": len(docs), "on_file": on_file,
                       "with_file": sum(1 for d in docs if d.get("file_id") or d.get("render"))},
            "why": sink["why"], "degraded": sink["degraded"]}


def documents_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of("clientCandidateDocuments", ctx, lambda: documents_build(reads, ctx))


def esc(v: Any) -> str:
    """ccEsc_."""
    return (gsjs.or_blank(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def render_html(reads: L.Reads, ctx: dict, doc: str) -> str:
    """ccRenderHtml_: the referral as the portal sent it, or the assessment read from the plan's sections."""
    row, parts = ctx["row"], []

    def pair(label: str, value: Any) -> None:
        v = scrub(text(value, 4000))
        if v:
            parts.append("<tr><th>" + esc(label) + "</th><td>" + esc(v).replace("\n", "<br>") + "</td></tr>")
    title = "Referral summary" if doc == "referral" else "Support assessment"
    if doc == "referral":
        pair("Referral", row.get("referral_id"))
        pair("Referred", sp_day(row.get("scraped_at")) or sp_day(row.get("createdAt")))
        pair("Referral window", sp_day(row.get("expiration_date")))
        pair("Source", source_of(row))
        pair("Service requested", row.get("description"))
        pair("Diagnosis", row.get("diagnosis"))
        pair("Frequency", row.get("frequency"))
        pair("Funding source", row.get("funding_source"))
        pair("Age", row.get("client_age"))
        pair("Gender", row.get("client_gender"))
        pair("ZIP", row.get("postal_code"))
        pair("AI rating", text(row.get("ai_rating"), 10) + " of 10" if text(row.get("ai_rating")) else "")
        pair("AI notes", row.get("ai_notes"))
    else:
        plan = plan_of(reads, ctx, {"why": [], "degraded": False})
        pair("From the plan", plan["file"]["name"] if plan["file"] else "")
        for s in plan["sections"]:
            pair(s["label"], s["text"])
    return ("<html><head><meta charset=\"utf-8\"><style>body{font-family:Arial,sans-serif;font-size:11pt;"
            "color:#1d2939}h1{font-size:16pt;margin:0 0 4pt}p{color:#667085;margin:0 0 12pt}"
            "table{border-collapse:collapse;width:100%}th{text-align:left;vertical-align:top;width:30%;padding:6pt;"
            "border-bottom:1px solid #e4e7ec;color:#475467}td{padding:6pt;border-bottom:1px solid #e4e7ec}"
            "</style></head><body><h1>" + esc(title) + "</h1><p>" + esc(ctx["name"]) + " · Client Candidates</p><table>"
            + "".join(parts) + "</table></body></html>")


def pdf_of(html: str) -> bytes:
    """ccPdf_: the HTML as PDF bytes, rendered here as the ISP Library renders its plans."""
    import isp  # noqa: PLC0415 - loaded only when a paper is opened
    return isp._render(html)


# ---- the team alerts -------------------------------------------------------------------------------------------------

def alert_key(lead_id: Any, to: Any) -> str:
    """scraperAlertKey_."""
    return ("scraper_lead:" + re.sub(r"[^A-Za-z0-9_.:-]", "", gsjs.trim(gsjs.or_text(lead_id))) + ":"
            + re.sub(r"\D", "", gsjs.or_text(to), flags=_A)[-10:])


def alerts(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccAlerts_: the lead alerts the outbox holds for this referral, one row per number, newest first."""
    if "alerts" in ctx["memo"]:
        return ctx["memo"]["alerts"]
    out: dict[str, Any] = {"items": [], "why": "", "degraded": False}
    prefix = alert_key(ctx["key"], "")
    # the mock outbox's own table (comm_logs), the rows whose ledger key names this referral
    rows, _w = soft(lambda: comm_logs.rows(reads.db, comm_logs.MOCK, "starts_with(cells ->> 'ledger_key', %s)",
                                           (prefix,)))
    if rows is None:
        if truthy(ctx["row"].get("sms_sent")):
            out["why"] = "The team was texted about this referral; the outbox could not be opened to say when."
            out["degraded"] = True
    else:
        for c in rows:
            if not gsjs.or_text(SC._typed(c.get("ledger_key"))).startswith(prefix):
                continue
            out["items"].append({
                "id": gsjs.or_text(SC._typed(c.get("id"))) or f"row{c['_seq']}",
                "at": instant(SC._dated(c.get("at"))),
                "result": gsjs.trim(gsjs.or_text(SC._typed(c.get("result")))).lower(),
                "to": text(SC._typed(c.get("to_masked")), 40), "body": text(SC._typed(c.get("body")), 1200),
                "held_by": text(SC._typed(c.get("held_by")), 200),
                "pass": gsjs.or_text(SC._typed(c.get("pass_id")))})
        out["items"].sort(key=functools.cmp_to_key(_newest))
        if not out["items"] and truthy(ctx["row"].get("sms_sent")):
            out["why"] = "The team was texted about this referral; the outbox no longer keeps when."
    ctx["memo"]["alerts"] = out
    return out


def alert_items(got: dict) -> list[dict[str, Any]]:
    """ccAlertItems_: one Activity line per alert pass."""
    passes: dict[str, dict] = {}
    order: list[str] = []
    for a in got["items"]:
        k = (a["pass"] or a["at"][:16]) + "|" + a["result"]
        if k not in passes:
            passes[k] = {"at": a["at"], "result": a["result"], "held": a["held_by"], "n": 0}
            order.append(k)
        passes[k]["n"] += 1
        if a["at"] > passes[k]["at"]:
            passes[k]["at"] = a["at"]
    out = []
    for i, k in enumerate(order):
        p = passes[k]
        out.append({"id": f"alert_{i + 1}", "at": p["at"], "kind": "alert",
                    "title": ALERT_TITLES.get(p["result"]) or "Alert about this referral",
                    "body": "To " + str(p["n"]) + " number" + ("" if p["n"] == 1 else "s")
                    + (" — " + p["held"] if p["result"] != "sent" and p["held"] else ""),
                    "by": "Lead Scraper", "channel": "SMS",
                    "ok": p["result"] in ("sent", "rehearsed", "held", "held_quiet"),
                    "rehearsal": p["result"] == "rehearsed"})
    return out


# ---- activity --------------------------------------------------------------------------------------------------------

def activity_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccActivityBuild_: the arrival, every press logged here, every change on the row, its opening, the alerts."""
    row, sink, items = ctx["row"], {"why": [], "degraded": False}, []

    def add(iid: str, at: str, kind: str, title: str, body: Any, by: str, ok: bool = True, channel: str = "",
            rehearsal: bool = False) -> None:
        if not at:
            return
        items.append({"id": iid, "at": at, "kind": kind, "title": title, "body": text(body, 900), "by": by or "",
                      "channel": channel or "", "ok": ok is not False, "rehearsal": rehearsal is True})

    scraped = instant(row.get("scraped_at"))
    if scraped:
        add("referral", scraped, "referral", "Referral received from the county referral portal",
            "Referral " + text(row.get("referral_id"), 40) if text(row.get("referral_id")) else "", "", True)
    else:
        add("referral", instant(row.get("createdAt")), "referral", "Referral added", source_of(row), "", True)
    for i, e in enumerate(log_of(row.get(LOG_FIELD))):
        add(f"log_{i + 1}", instant(e["at"]), LOG_KINDS.get(e["kind"]) or "record", text(e["text"], 300), "",
            text(e["by"], 120), True)
    records = 0

    def events() -> None:
        nonlocal records
        for i, e in enumerate(SP.events_for(reads, ctx["key"])):
            if e["type"] == "leadOpened" or e["type"] in CC_WRITE_ACTIONS:
                continue
            title = EVENT_TITLES.get(e["type"])
            if title and re.search(r"\.update\Z", e["type"]):
                records += 1
            p = e.get("payload") or {}
            add(f"evt_{i + 1}", instant(e["at"]), "record", title or text(p.get("summary"), 200) or e["type"],
                text(p.get("detail"), 300) if p.get("ok") is False else "",
                gsjs.or_text(e.get("actor")).split(" (visiting")[0], p.get("ok") is not False)
        # Scraper.gs leadOpened logs the opening under the row's name and the move, as it writes them
        for i, e in enumerate(SP.events_for(reads, gsjs.or_text(row.get("client_name") or ctx["key"]) + " new → read")):
            if e["type"] != "lead_read":
                continue
            add(f"read_{i + 1}", instant(e["at"]), "stage", "Opened after the team alert — New → Read", "",
                gsjs.or_text(e.get("actor")).split(" (visiting")[0], True)
    _ok, why_e = soft(events)
    if why_e:
        sink["why"].append(why_of("The platform's event log", why_e))
        sink["degraded"] = True
    if records:
        sink["why"].append("A change made in Potential Clients is logged as the referral record changing and who "
                           "changed it, not which field.")
    got = alerts(reads, ctx)
    if got["why"]:
        sink["why"].append(got["why"])
    if got["degraded"]:
        sink["degraded"] = True
    for x in alert_items(got):
        add(x["id"], x["at"], x["kind"], x["title"], x["body"], x["by"], x["ok"], x["channel"], x["rehearsal"])
    ends = sp_day(row.get("expiration_date"))
    if ends and ends < reads.today():
        add("window", ends, "referral", "Referral window closed", "", "", True)
    items.sort(key=functools.cmp_to_key(_newest))
    return {"items": items[:CC_ACTIVITY_CAP], "total": len(items), "why": sink["why"], "degraded": sink["degraded"]}


def activity_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of("clientCandidateActivity", ctx, lambda: activity_build(reads, ctx))


# ---- overview --------------------------------------------------------------------------------------------------------

def overview_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ccOverviewBuild_: at a glance, contact and information, the counts, the next step and recent activity."""
    row, sink = ctx["row"], {"why": [], "degraded": False}

    def part(what: str, get: Callable[[], Any]) -> Any:
        d, why = soft(get)
        if why:
            sink["why"].append(why_of(what, why))
            sink["degraded"] = True
            return None
        for w in d.get("why") or []:
            if w not in sink["why"]:
                sink["why"].append(w)
        if d.get("degraded"):
            sink["degraded"] = True
        return d

    actions = part("The intake actions", lambda: actions_part(reads, ctx))
    docs = part("The documents", lambda: documents_part(reads, ctx))
    activity = part("The activity", lambda: activity_part(reads, ctx))
    client = client_of(reads, ctx, sink)
    zc = text(row.get("postal_code"), 20)
    src = source_of(row)
    referred = text(row.get("scraped_at")) or text(row.get("createdAt"))
    candidate = {
        "key": ctx["key"], "name": ctx["name"], "referral_id": text(row.get("referral_id"), 40),
        "service": text(row.get("description"), SERVICE_MAX), "stage": ctx["stage"], "stage_label": stage_label(ctx["stage"]),
        "status_label": stage_label(ctx["stage"]), "intake_stage": stage_of(ctx["stage"]), "location": place(zc),
        "county": "", "zip": zc, "owner": text(row.get("owner"), 120), "source": src, "referred_at": referred,
        "phone": text(row.get("phone"), 40), "email": text(row.get("email"), 120),
        "avatar": P.of(reads, "client-candidates", ctx["key"]), "rating": text(row.get("ai_rating"), 10), "expires": text(row.get("expiration_date"), 40),
        "alerted": truthy(row.get("sms_sent")), "client_key": client["key"] if client else ""}
    nxt = actions.get("next") if actions else None
    return {
        "candidate": candidate,
        "information": {
            "full_name": ctx["name"], "stage_label": candidate["stage_label"], "phone": candidate["phone"],
            "email": candidate["email"], "source": src, "referred_at": referred,
            "service_requested": candidate["service"], "frequency": text(row.get("frequency"), 200), "county": "",
            "zip": zc, "family": "", "important_to_me": "", "preferred_start": "",
            "intake_coordinator": candidate["owner"], "referral_id": candidate["referral_id"],
            "age": text(row.get("client_age"), 10), "gender": text(row.get("client_gender"), 20),
            "diagnosis": text(row.get("diagnosis"), DIAGNOSIS_MAX), "funding_source": text(row.get("funding_source"), 80),
            "expires": candidate["expires"], "rating": candidate["rating"], "notes": gsjs.or_blank(row.get("notes"))},
        "client": {"key": client["key"], "name": client["name"],
                   "href": "/app/client-profiles/profile?client=" + urllib.parse.quote(client["key"], safe="-_.!~*'()")}
        if client else None,
        "summary": text(row.get("ai_notes"), 900) or text(row.get("description"), SERVICE_MAX),
        "rating": {"value": candidate["rating"], "notes": text(row.get("ai_notes"), 900)},
        "tiles": {"stage_label": candidate["stage_label"], "open_actions": actions["open"] if actions else None,
                  "docs_on_file": docs["counts"]["on_file"] if docs else None,
                  "docs_total": docs["counts"]["total"] if docs else None},
        "next": {"id": nxt["id"], "label": nxt["label"], "owner": nxt["owner"], "status": nxt["status"],
                 "due": nxt["due"], "due_state": nxt["due_state"], "next_step": nxt["next_step"]} if nxt else None,
        "attention": actions["attention"] if actions else [],
        "recent": activity["items"][:CC_RECENT] if activity else [],
        "opened": {"action": "leadOpened", "payload": {"ids": [ctx["key"]]}}
        if truthy(row.get("sms_sent")) and ctx["stage"] == "new" else None,
        "why": sink["why"], "degraded": sink["degraded"]}


def overview_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of("clientCandidateOverview", ctx, lambda: overview_build(reads, ctx))


# ---- texts and calls -------------------------------------------------------------------------------------------------

def phone_index(reads: L.Reads) -> dict[str, dict[str, bool]]:
    """ccPhoneIndex_: every phone the referral rows carry, last-ten digits → the referrals carrying it."""
    def read() -> dict[str, dict[str, bool]]:
        index: dict[str, dict[str, bool]] = {}
        for r in leads(reads)["rows"]:
            rid = gsjs.trim(gsjs.or_text((r or {}).get("id")))
            if not rid:
                continue
            for d in SC._numbers(r.get("phone")):
                index.setdefault(d, {})["cc:" + rid] = True
        return index
    return reads.once("cc_phones", read)


def staff_ctx(ctx: dict) -> dict[str, Any]:
    """ccStaffCtx_: the referral in the shape the Staff app's text and call readers take."""
    prefs = prefs_of(ctx["row"].get(PREFS_FIELD))
    return {"key": "cc:" + ctx["key"], "name": ctx["name"], "account": None, "master": None,
            "people": {"phone": text(ctx["row"].get("phone"), 60), "phones": SC._numbers(prefs["who"]),
                       "email": text(ctx["row"].get("email"), 120), "emails": []},
            "phones_shared": {d: {"company": True} for d in SHARED_LINE_DIGITS}}


def no_phone_why(reads: L.Reads, sctx: dict) -> str:
    """ccNoPhoneWhy_."""
    if not SC._numbers(sctx["people"]["phone"]) and not sctx["people"]["phones"]:
        return "no phone number is on the referral"
    if SC._own_phones(reads, sctx)["mine"]:
        return ""
    return "the phone number(s) on the referral are the company's own lines, so nothing on them is attributed"


def shared_why(reads: L.Reads, sctx: dict) -> str:
    """ccSharedWhy_: the other referrals that carry the same number; '' when none does."""
    index, why = soft(lambda: phone_index(reads))
    if why:
        return ""
    others: dict[str, bool] = {}
    for d in SC._js_keys(SC._own_phones(reads, sctx)["mine"]):
        for k in SC._js_keys(index.get(d) or {}):
            if k != sctx["key"]:
                others[k] = True
    n = len(others)
    return ("the phone number is also on " + str(n) + " other referral" + ("" if n == 1 else "s")
            + ", whose conversations on it are listed here too") if n else ""


def join_why(a: str, b: str) -> str:
    """ccJoinWhy_."""
    return "; ".join(x for x in (a, b) if x)


def texts_facts(reads: L.Reads, ctx: dict) -> Any:
    """ccTextsFacts_."""
    def build() -> dict[str, Any]:
        sctx = staff_ctx(ctx)
        none = no_phone_why(reads, sctx)
        if none:
            facts = {"counterparts": [], "messages": [], "coverage": {"from": "", "to": "", "gaps": []},
                     "phones_matched": 0, "why": none, "degraded": False}
        else:
            facts = SC.texts_facts(reads, sctx)
            facts["why"] = join_why(facts["why"], shared_why(reads, sctx))
        got = alerts(reads, ctx)
        facts["alerts"] = [{"id": a["id"], "at": a["at"], "result": a["result"], "to": a["to"], "body": a["body"],
                            "held_by": a["held_by"]} for a in got["items"][:CC_ALERTS_CAP]]
        facts["alerts_why"] = got["why"]
        if got["degraded"]:
            facts["degraded"] = True
        return facts
    return data_of("clientCandidateTexts", ctx, build)


def texts_door(reads: L.Reads, ctx: dict, payload: dict) -> dict[str, Any]:
    """ccTextsDoor_: one page of one conversation, as the Staff app pages it, and the team's alerts."""
    f, why = soft(lambda: texts_facts(reads, ctx))
    if why:
        return {"status": 503, "message": f"The texts could not be read just now ({why})."}
    # each company line is named by the directory the Staff app reads (the webhook rows asa-hub-db holds)
    want = text(payload.get("with"), 60)
    ids = [x["id"] for x in f["counterparts"]]
    with_id = want if want in ids else (ids[0] if ids else "")
    before = text(payload.get("before"), 40)
    thread = [m for m in f["messages"] if m["line"] == with_id and (not before or m["at"] < before)]
    page = [{"id": m["id"], "at": m["at"], "dir": m["dir"], "body": m["body"], "by": m["by"]}
            for m in thread[:SC.SP_TEXT_PAGE]]
    return {"status": 200, "data": {"counterparts": f["counterparts"], "with": with_id, "messages": page,
                                    "more": len(thread) > SC.SP_TEXT_PAGE, "coverage": f["coverage"],
                                    "phones_matched": f["phones_matched"], "alerts": f.get("alerts") or [],
                                    "alerts_why": f.get("alerts_why") or "", "why": f["why"],
                                    "degraded": bool(f.get("degraded"))}}


def transcripts_part(reads: L.Reads, ctx: dict) -> Any:
    """ccTranscripts_: every call with the referral's numbers, metadata only."""
    def build() -> dict[str, Any]:
        sctx = staff_ctx(ctx)
        none = no_phone_why(reads, sctx)
        if none:
            return {"calls": [], "categories": [], "gaps": [], "why": none, "degraded": False}
        got = SC.transcripts_build(reads, sctx)
        got["why"] = join_why(got["why"], shared_why(reads, sctx))
        return got
    return data_of("clientCandidateTranscripts", ctx, build)


# ---- the writes' helpers ---------------------------------------------------------------------------------------------

def write_key(payload: dict) -> str:
    """ccWriteKey_: the referral a press names, by its row id; '' when the shape is not one."""
    raw = (payload or {}).get("candidate_id")
    key = gsjs.trim("" if raw is None else gsjs.js_str(raw))
    return key if _KEY_RE.match(key) else ""


def write_plan(ctx: dict, kind: str, payload: dict) -> dict[str, Any]:
    """ccWritePlan_: what one press writes on the row as it stands, the log's line and the step a note is about."""
    payload = payload or {}
    if kind == "note":
        about = text(payload.get("item"), 40)
        ph = next((p for p in PHASES if p["id"] == about), None)
        return {"fields": {}, "text": "Note added", "log": "note", "about": ph["label"] if ph else ""}
    if kind == "stage":
        to = stage_wanted(payload.get("stage"))
        if not to:
            return {"refused": {"status": 400, "message": "stage: one of " + ", ".join(s["label"] for s in STAGES)
                                + "."}}
        if to == stage_of(ctx["stage"]):
            return {"refused": {"status": 409, "message": ctx["name"] + " is already at " + stage_meta(to)["label"]
                                + "."}}
        return {"fields": {"stage": stage_meta(to)["label"]},
                "text": "Stage: " + stage_label(ctx["stage"]) + " → " + stage_meta(to)["label"], "log": "stage",
                "about": ""}
    item = text(payload.get("item"), 40)
    hit = next((r for r in phase_rows(ctx) if r["phase"]["id"] == item), None)
    if not hit:
        return {"refused": {"status": 400, "message": "item: a step of the intake."}}
    st = hit["complete"] if kind == "complete" else hit["reopen"]
    if not st:
        if kind == "complete":
            why = hit["phase"]["label"] + " is already complete." if hit["state"] == "completed" \
                else (hit["why"] or "This step is not next.")
        else:
            why = hit["phase"]["label"] + " is not complete, so there is nothing to reopen."
        return {"refused": {"status": 409, "message": why}}
    return {"fields": {"stage": st["fields"]["stage"]}, "log": "step", "about": hit["phase"]["label"],
            "text": ("Completed action: " if kind == "complete" else "Reopened action: ") + hit["phase"]["label"]}


# ---- the gate --------------------------------------------------------------------------------------------------------

def viewer(sess: L.Session) -> dict | None:
    """clientCandidatesGate_ (FAIL-CLOSED): the reader's scope when App Control opens the whole app to them."""
    got = sc.profile_app_gate(APP_ID, sess.user, sess.reads.scope_sources())
    s = got.get("scope") if got.get("open") is True else None
    return s if s and s.get("kind") in ("master", "all") else None


def gate(sess: L.Session) -> dict[str, Any]:
    """The session as the writes take it: who it is, whether the app opens to it, and the real master."""
    user = sess.user or {}
    scope = viewer(sess)
    why = "" if scope is not None else "App Control does not open Client Candidates to this account."
    return {"open": scope is not None, "is_master": sc.is_real_master(user), "wide": scope is not None,
            "scope": scope, "viewer": (scope or {}).get("kind") or "", "uid": gsjs.trim(gsjs.or_text(user.get("id"))),
            "name": s_(user.get("display_name")), "email": s_(user.get("email")).lower(),
            "visiting": bool(user.get("visiting_member")), "service": user.get("is_service") is True, "why": why}


def candidate(sess_or_reads: L.Reads | L.Session, key: Any) -> dict[str, Any]:
    """ccCandidate_ for a session or a request's reads: the referral's context (key, row, book, tab), or refused."""
    return candidate_of(reads_of(sess_or_reads), key)


# ---- the doors -------------------------------------------------------------------------------------------------------

def _gated(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The read gate, then the referral the request names."""
    if viewer(sess) is None:
        return {"refused": unknown()}
    return candidate_of(sess.reads, payload.get("candidate"))


def client_candidate_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateRoster: every referral on the Potential Clients file, with its stage, next step and owner."""
    if viewer(sess) is None:
        return unknown()
    reads = sess.reads
    return serve("The Potential Clients records", lambda: shown(scrub(roster_build(reads))))


def client_candidate_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateOverview."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The candidate", lambda: overview_part(sess.reads, ctx))


def client_candidate_actions(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateActions."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The intake actions", lambda: actions_part(sess.reads, ctx))


def client_candidate_intake(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateIntake."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The intake plan", lambda: intake_part(sess.reads, ctx))


def client_candidate_documents(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateDocuments."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The documents", lambda: documents_part(sess.reads, ctx))


def client_candidate_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateDocFile: a file the Documents list names as bytes, or a paper rendered from the referral."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    render = text(payload.get("doc"), 40)
    fid = text(payload.get("file_id"), 120)
    if not render and not _FILE_ID.match(fid):
        return {"status": 400, "message": "file_id: a Drive file id."}
    try:
        docs = documents_part(sess.reads, ctx).get("docs") or []
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - the port's own words
        log.info("clientCandidateDocFile: the documents were not read (%s)", _why(e))
        return {"status": 503, "message": "The documents could not be read just now — try again in a minute."}
    if render:
        paper = next((d for d in docs if d.get("render") == render), None)
        if paper is None:
            return {"status": 404, "message": "This candidate names no such document."}
        try:
            data = pdf_of(render_html(sess.reads, ctx, render))
        except hubdb.Unreadable:
            raise
        except Exception as e:  # noqa: BLE001 - the port's own words
            log.warning("clientCandidateDocFile: a %s paper was not made (%s)", render, type(e).__name__)
            return {"status": 503, "message": "The document could not be made just now — try again in a minute."}
        return {"status": 200, "data": {"id": render, "name": paper["title"] + ".pdf", "mime": "application/pdf",
                                        "size": len(data), "exported": True,
                                        "b64": base64.b64encode(data).decode("ascii")}}
    if not any(d.get("file_id") == fid for d in docs):
        return {"status": 404, "message": "This candidate names no such document."}
    try:
        got = L.doc_file(sess.reads, fid)
    except Defer as e:
        log.info("clientCandidateDocFile: Drive did not hand the file over (%s)", _why(e))
        return {"status": 503, "message": "The document could not be opened just now — try again in a minute."}
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": fid, "name": got["name"], "mime": got["mime"], "size": got["size"],
                                    "exported": got["exported"], "b64": got["b64"]}}


def client_candidate_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateActivity."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The activity", lambda: activity_part(sess.reads, ctx))


def client_candidate_texts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateTexts: one conversation per company line, newest first, a page at a time, and the alerts."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return texts_door(sess.reads, ctx, payload)


def client_candidate_transcripts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateTranscripts."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The calls", lambda: transcripts_part(sess.reads, ctx))


def client_candidate_transcript(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateTranscript: the words of one listed call, through the transcript read (its best copy, its log)."""
    ctx = _gated(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    cid = text(payload.get("id") or payload.get("call_id"), 60)
    if not cid:
        return {"status": 400, "message": "id: which call."}
    calls, why = soft(lambda: transcripts_part(sess.reads, ctx).get("calls") or [])
    if why:
        return {"status": 503, "message": "The calls could not be read just now — try again in a minute."}
    if not any(c.get("call_id") == cid for c in calls):
        return {"status": 404, "message": "This candidate has no such call."}
    got = SC.transcript_read(sess.reads, cid, sess.user)
    if got.get("status") != 200:
        return got
    return {"status": 200, "data": scrub(got["data"])}


def _pack_doors(reads: L.Reads, ctx: dict) -> dict[str, Callable[[], dict[str, Any]]]:
    """ccPackDoors_: each part's door, past its gate, for one referral."""
    return {"overview": lambda: serve("The candidate", lambda: overview_part(reads, ctx)),
            "actions": lambda: serve("The intake actions", lambda: actions_part(reads, ctx)),
            "intake": lambda: serve("The intake plan", lambda: intake_part(reads, ctx)),
            "documents": lambda: serve("The documents", lambda: documents_part(reads, ctx)),
            "activity": lambda: serve("The activity", lambda: activity_part(reads, ctx)),
            "texts": lambda: texts_door(reads, ctx, {}),
            "transcripts": lambda: serve("The calls", lambda: transcripts_part(reads, ctx))}


def client_candidate_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidatePack: every section of one referral, each its own door's answer; the relay or the master."""
    user = sess.user
    if not user or not (user.get("is_service") is True or sc.is_real_master(user)):
        return unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = candidate_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return ctx["refused"]
    doors = _pack_doors(reads, ctx)
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    left: list[str] = []
    for name in CC_PACK_PARTS:
        if time.monotonic() - started > PACK_BUDGET_S:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({PAST_BUDGET})")
            continue
        try:
            got = doors[name]()
        except (Defer, hubdb.Unreadable) as e:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({str(e)[:120]})")
            continue
        except Exception as e:  # noqa: BLE001 - the pack's own catch
            status[name] = {"status": 503, "message": f"This part could not be read just now ({_why(e)})."}
            continue
        if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
            parts[name] = got["data"]
            status[name] = {"status": 200}
        else:
            said = got.get("status") if isinstance(got, dict) else None
            number = isinstance(said, (int, float)) and not isinstance(said, bool) and bool(said)
            status[name] = {"status": int(said) if number else 503,
                            "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("clientCandidatePack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"candidate": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "clientCandidateRoster": client_candidate_roster, "clientCandidateOverview": client_candidate_overview,
    "clientCandidateActions": client_candidate_actions, "clientCandidateIntake": client_candidate_intake,
    "clientCandidateDocuments": client_candidate_documents, "clientCandidateDocFile": client_candidate_doc_file,
    "clientCandidateActivity": client_candidate_activity, "clientCandidateTexts": client_candidate_texts,
    "clientCandidateTranscripts": client_candidate_transcripts,
    "clientCandidateTranscript": client_candidate_transcript, "clientCandidatePack": client_candidate_pack}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "clientCandidateRoster": {"roles": POLICY_ROLES, "params": {}},
    "clientCandidateOverview": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateActions": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateIntake": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateDocuments": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateDocFile": {"roles": POLICY_ROLES, "params": {"candidate": "string", "file_id": "string",
                                                                 "doc": "string"}},
    "clientCandidateActivity": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateTexts": {"roles": POLICY_ROLES, "params": {"candidate": "string", "with": "string",
                                                               "before": "string"}},
    "clientCandidateTranscripts": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "clientCandidateTranscript": {"roles": POLICY_ROLES, "params": {"candidate": "string", "id": "string"}},
    "clientCandidatePack": {"roles": ("admin",), "params": {"candidate": "string"}}}
# the reads each press on a referral retires: every section's own action
PART_ACTIONS = ("clientCandidateRoster", "clientCandidateOverview", "clientCandidateActions", "clientCandidateIntake",
                "clientCandidateDocuments", "clientCandidateActivity", "clientCandidateTexts",
                "clientCandidateTranscripts")
