"""The Employee Support Hotline's reading of one call (Hotline.gs hotlineSweep, its call mode): the call kept in
app.hotline_calls, the orders in hotline_config, the names and lists the model is offered, the model's NDJSON read
into work items, and the rows each lane would take — Daily Notes, UI Reports, the Employee Support Queue and Call
Offs. Here it is a plan beside Apps Script's filing (hotlineShadowAsk / hotlineShadowPlan); nothing is filed."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import requests

import clients as C
import client_sources as CS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import names as N
from gsjs import NY

APP_ID = "hotline"
CALLS = "app.hotline_calls"
CALL_ID = re.compile(r"AC[0-9A-Za-z]{32}")
CONFIG_TAB = "hotline_config"
CALENDAR_TAB = "Calendar Archive"
REQUEST_TYPES_TAB = "CommRequestTypes"
FIELD_RULES_TAB = "FieldRules"
NOTE_ROWS_MAX = 20
# Screening.gs SCREEN_GROQ_MODEL: gpt-oss-20b runs NDJSON objects together on one line
GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_TIMEOUT_S = 50
CALL_OFF_TYPE = "Schedule - Call Off"
REQUEST_TYPE_MAX = 60
REQUEST_AREAS = ("Admin", "ADP", "Finances", "Operations", "PSI", "Safety", "Schedule", "Training", "Other")
REQUEST_TYPES_FLOOR = (
    "Admin - Employee Termination Letters", "Admin - Employee Verification Letters", "Admin - Employee Details",
    "Training - DODD Annual", "Training - Med Del", "Training - CPR", "Training - Other", "ADP - Pay Stubs",
    "ADP - Request Access to ADP", "ADP - Update Information", "Schedule - Time Off Request", "Schedule - Call Off",
    "Schedule - Shift Changes", "Finances - Request for Client Funds", "Finances - Request for New Client Card",
    "Finances - Request for Company Spending", "Finances - Request for New Company Card", "PSI - Time Entries",
    "PSI - Reset Password", "PSI - Troubleshooting", "Other - General Requests")
NOTE_CATEGORIES_FLOOR = ("incidents", "sleep_quality", "activities_and_interactions", "food_liquids", "bms",
                         "admin_tasks", "mental_health_rating", "mental_health", "mobility", "other", "urination",
                         "hygiene", "housekeeping", "physical_health", "eating_habits")
DEFAULT_PROMPT = (
    "You process voicemail/call transcripts from the Employee Support Hotline of a company "
    "running group homes for adults with developmental disabilities in Ohio. Direct support "
    "professionals (DSPs) call this line to leave daily notes about clients, report incidents, "
    "ask for help, and call off shifts.\n\n"
    "You receive a JSON payload: {transcript, client_names, staff_names, call_id, caller_phone, "
    "call_timestamp, reporting_date, location_names, request_types, daily_note_categories}.\n\n"
    "Read the transcript and emit ONE work item PER DISTINCT MATTER as NDJSON — one JSON object "
    "per line, nothing else. Every object carries \"work_type\": \"DailyNote\" | \"Incident\" | \"Request\".\n\n"
    "RULES THAT OUTRANK EVERYTHING:\n"
    "- Use ONLY what the transcript says. Never invent a name, a date, a client or an event.\n"
    "- Match names against client_names and staff_names; use the list spelling when the caller "
    "clearly means that person. A name you cannot match stays exactly as spoken.\n"
    "- Dates: resolve relative words (\"today\", \"tomorrow\") against reporting_date. Format yyyy-MM-dd.\n"
    "- One call often carries several matters — a daily note AND a call off is two lines.\n"
    "- A matter that fits nothing else is a Request, its \"Type of Request\" taken from request_types.\n\n"
    "DailyNote: ONE object PER CATEGORY the caller reported — a note about a client's sleep and "
    "meals is two DailyNote lines, never one line holding both. Every DailyNote of the call "
    "carries the same call_id and timestamp.\n"
    "DailyNote fields: {\"work_type\":\"DailyNote\",\"timestamp\":call_timestamp,\"call_id\":...,"
    "\"reporting_date\":...,\"dsp_name\":\"<the caller, matched>\",\"caller_phone\":...,"
    "\"client_name\":\"<matched client or empty>\","
    "\"category\":\"<one value copied exactly from daily_note_categories; other when none fits>\","
    "\"response\":\"<what was reported for that category only, in the caller's meaning>\"}\n\n"
    "Incident fields: {\"work_type\":\"Incident\",\"Timestamp\":call_timestamp,\"Your Name\":\"<caller>\","
    "\"Client Name\":...,\"Incident Category\":...,\"Incident Location\":...,\"Incident Date\":...,"
    "\"Incident Time\":...,\"Incident Reported Date\":reporting_date,\"Incident Reported Time\":...,"
    "\"Employees Involved\":...,\"Summary of Incident\":...,\"Immediate Action Taken\":...,"
    "\"Cause and Contributing Factors\":...,\"Prevention Plan\":...}\n\n"
    "Request fields: {\"work_type\":\"Request\",\"Status\":\"New\",\"Urgency\":\"Low|Medium|High\","
    "\"Date Received\":reporting_date,\"Requestor\":\"<caller, matched>\",\"Requestor Phone\":caller_phone,"
    "\"Type of Request\":\"<one value copied exactly from request_types>\","
    "\"Description of Request\":\"<what they need, complete>\"}\n"
    "A call off is ALWAYS \"Type of Request\":\"Schedule - Call Off\", Urgency \"High\", and the "
    "description names the shift date and the reason the caller gave.")
RETIRED_PROMPT_SHA256 = ("a2ac966ba3d89b08804d29079a4f00204c0452ca1f807392d27c3c2d88aca12b",)
_PLACEHOLDER = re.compile(
    r"^(?:(?:undetermined|unknown|unclear|unspecified|not (?:specified|stated|mentioned|provided|given|clear|sure|"
    r"determined|applicable))\b.*|n/?a|none|null|undefined|other|others|misc|miscellaneous|general|tbd|"
    r"to be determined|\?+|-+)$", re.I)
CALL_OFF_WORDS = ("calloff", "calledoff", "callingoff", "callsoff", "callout", "calledout", "callingout", "callsout")
NO_NAME_WORDS = ("undetermined", "unknown", "unclear", "anonymous", "caller", "notspecified",
                 "notspecifiedintranscript", "nonamegiven", "namenotgiven", "nonameprovided", "notgiven", "na",
                 "none", "nobody")
SHARED_LINE_DIGITS = ("3307544040", "3309195558", "3309195559")
PSI_MATTER_WORDS = ("psi", "psy", "psi anywhere", "psy anywhere", "psianywhere", "psyanywhere", "psi any where",
                    "time entry", "time entries", "time entry system")
PSI_OUTAGE_WORDS = (
    "not working", "isnt working", "is not working", "stopped working", "quit working", "is down", "went down",
    "down right now", "system is down", "site is down", "app is down", "server is down", "is offline", "outage",
    "wont load", "will not load", "not loading", "wont open", "will not open", "wont come up", "will not come up",
    "cant get in", "cannot get in", "cant log in", "cannot log in", "cant login", "cannot login", "cant sign in",
    "cannot sign in", "unable to log in", "unable to login", "unable to sign in", "wont let me log in",
    "will not let me log in", "not letting me log in", "wont let me in", "will not let me in", "not letting me in",
    "kicked out", "kicks me out", "kicking me out", "error message", "getting an error", "gives an error",
    "throws an error", "crashed", "froze", "frozen", "not responding", "keeps spinning", "nobody can log in",
    "no one can log in", "nobody can get in", "no one can get in", "nobody can sign in", "none of us can log in",
    "wont accept my password", "will not accept my password", "not accepting my password")
PSI_SITE_WORDS = (
    "is down", "went down", "down right now", "system is down", "site is down", "app is down", "server is down",
    "is offline", "outage", "wont load", "will not load", "not loading", "wont open", "will not open",
    "wont come up", "will not come up", "crashed", "froze", "frozen", "not responding", "keeps spinning",
    "everyone", "everybody", "nobody can", "no one can", "for anyone", "whole office")
PSI_RESET_WORDS = (
    "reset", "resets", "resetting", "forgot my password", "forgot password", "forgot her password",
    "forgot his password", "new password", "change my password", "change her password", "temporary password",
    "password expired", "expired password", "never received", "never got", "dont have a login", "do not have a login",
    "dont have an account", "do not have an account", "need access", "needs access", "request access",
    "requesting access", "requests access", "set up an account", "create an account", "new account",
    "unlock my account", "unlock her account", "locked out after")


def s_(v: Any) -> str:
    return gsjs.trim(gsjs.or_text(v))


# ---- the request types (hotlineRequestType*_) ----------------------------------------------------------------------

def type_norm(raw: Any) -> str:
    s = re.sub(r"[ \t   ]+", " ", "" if raw is None else str(raw)).strip()
    s = re.sub(r" *[‒–—―−] *", " - ", s)
    s = re.sub(r" +- *| *- +", " - ", s)
    s = re.sub(r"[ .;,]+$", "", s)
    if not s:
        return ""
    m = re.match(r"^([A-Za-z]+) *[-:]+ *(\S.*)$", s)
    if m:
        for area in REQUEST_AREAS:
            if area.lower() == m.group(1).lower():
                return area + " - " + m.group(2)
    return s


def _type_word(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not re.search(r"(?:ss|us|is)$", w):
        return w[:-1]
    return w


def _type_half(s: str) -> str:
    return "".join(_type_word(w) for w in re.split(r"[^a-z0-9]+", s or "") if w)


def type_key(raw: Any) -> str:
    t = type_norm(raw).lower()
    cut = t.find(" - ")
    if cut == -1:
        return _type_half(t)
    return _type_half(t[:cut]) + " - " + _type_half(t[cut + 3:])


def _call_off_words(raw: Any) -> bool:
    words = [w for w in re.split(r"[^a-z]+", ("" if raw is None else str(raw)).lower().replace("0", "o")) if w]
    grams = []
    for i, w in enumerate(words):
        grams.append(w)
        if i + 1 < len(words):
            grams.append(w + words[i + 1])
    for g in grams:
        s = re.sub(r"s$", "", g)
        if s in CALL_OFF_WORDS:
            return True
        if not s.startswith("c") or len(s) < 6 or len(s) > 8:
            continue
        if N.lev(s, "calloff") <= 1 or N.lev(s, "callout") <= 1:
            return True
    return False


def call_offish(raw: Any) -> bool:
    t = type_norm(raw)
    if re.search(r"\bcall(?:ed|ing|s)?[\s-]*(?:off|out)s?\b|\bcall(?:off|out)s?\b", t, re.I):
        return True
    return _call_off_words(t)


def call_off_twin(raw: Any) -> bool:
    return bool(re.match(r"^(?:schedul(?:e|es|ing)\s*[-:]*\s*)?call[\s-]*offs?$", type_norm(raw), re.I))


def _book_on(row: dict) -> bool:
    """hubBookOn_: a row is on unless its active (or enabled) cell says off."""
    a = row.get("active") if row.get("active") is not None else row.get("enabled")
    a = s_(a if a is not None and a != "" else "on").lower()
    return a not in ("off", "false", "no", "0")


def _types_book(reads: L.Reads) -> list[dict]:
    """hubBookRows_('CommRequestTypes'): the generic config book's tab, its headers snake_cased; none, the floor."""
    try:
        sid = reads.db.prop("HUB_GENERIC_CONFIG_ID")
        ref = HT.tab_of(reads, sid, REQUEST_TYPES_TAB, "the CommRequestTypes book") if sid else None
        if ref is None:
            return []
        heads = [re.sub(r"[^a-z0-9]+", "_", s_(h).lower()) for h in ref.headers]
        out = []
        for _rn, raw in reads.db.rows(ref):
            row = {k: hubdb.typed(raw.get(h), "raw") for k, h in zip(heads, ref.headers) if k}
            if any(s_(v) for v in row.values()):
                out.append({k: ("" if v is None else v) for k, v in row.items()})
        return out
    except Exception:  # noqa: BLE001 - the floor answers, as hubBookRows_'s caller has it
        return []


def request_types(reads: L.Reads) -> tuple[list[str], str]:
    """hotlineRequestTypes_: the book's own types (each on), then the floor; a call-off spelling only as itself."""
    rows = _types_book(reads)
    out: list[str] = []
    seen: set[str] = set()
    off: set[str] = set()
    call_off = type_key(CALL_OFF_TYPE)
    for r in rows:
        if not _book_on(r):
            k = type_key(r.get("type"))
            if k and k != call_off:
                off.add(k)
    from_book = 0

    def add(value: Any) -> bool:
        t = type_norm(value)
        k = type_key(t)
        if not t or not k or k in seen or k in off:
            return False
        if k != call_off and call_offish(t):
            return False
        seen.add(k)
        out.append(t)
        return True

    for r in rows:
        if _book_on(r) and add(r.get("type")):
            from_book += 1
    for f in REQUEST_TYPES_FLOOR:
        add(f)
    return out, "book" if from_book else "floor"


def type_canon(raw: Any, known: list[str]) -> str:
    t = type_norm(raw)
    k = type_key(t)
    if not t:
        return ""
    if k == type_key(CALL_OFF_TYPE) or call_off_twin(t):
        return CALL_OFF_TYPE
    for item in known:
        if type_key(item) == k:
            return type_norm(item)
    return t


def type_rule(types: list[str]) -> str:
    areas: list[str] = []
    seen: set[str] = set()

    def add_area(a: Any) -> None:
        name = s_(a)
        if not name or name.lower() in seen:
            return
        if not re.match(r"^[A-Za-z][A-Za-z0-9&/]*(?: [A-Za-z0-9&/]+){0,2}$", name):
            return
        seen.add(name.lower())
        areas.append(name)

    for a in REQUEST_AREAS:
        add_area(a)
    for t in types:
        parts = str(t).split(" - ")
        if len(parts) == 2:
            add_area(parts[0])
    return ("\n\nTYPE OF REQUEST — THIS RULE REPLACES ANY LIST OF REQUEST TYPES WRITTEN ABOVE:\n"
            "- \"Type of Request\" is ONE value copied exactly, character for character, from request_types in the "
            "INPUT.\n"
            "- Only when none of them fits, coin a new one shaped \"<Area> - <Label>\", at most "
            f"{REQUEST_TYPE_MAX} characters, using an existing area when one fits ({', '.join(areas)}).\n"
            f"- A call off is ALWAYS \"{CALL_OFF_TYPE}\".\n"
            "- Never a placeholder such as \"Other\", \"Undetermined\" or \"Not specified\" as the type.")


# ---- the daily notes' categories ----------------------------------------------------------------------------------

def _category_key(raw: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", ("" if raw is None else str(raw)).lower()).strip("_")


def _categories_parse(text: Any) -> list[str]:
    s = "" if text is None else str(text)
    m = re.search(r"list\s*:?\s*\(([^)]*)\)", s, re.I) or re.search(r"\(([^)]*)\)", s)
    if not m:
        return []
    out: list[str] = []
    for part in re.split(r"[,;\n]+", m.group(1)):
        k = _category_key(part)
        if k and k not in out and re.fullmatch(r"[a-z][a-z0-9_]*", k):
            out.append(k)
    return out


def note_categories(reads: L.Reads) -> tuple[list[str], str]:
    """hotlineNoteCategories_: the FieldRules book's daily_notes category list, else the floor; always 'other'."""
    found: list[str] = []
    try:
        sid = reads.db.prop("EMP360_WORK_QUEUE_ID")
        rows = CS._other_book_rows(reads, sid, FIELD_RULES_TAB) if sid else []
    except Exception:  # noqa: BLE001 - the floor answers
        rows = []
    for r in rows:
        table = _category_key(r.get("output_table") or r.get("outputtable"))
        field = _category_key(r.get("field_name") or r.get("fieldname"))
        if table != "daily_notes" or field != "category":
            continue
        found = _categories_parse(r.get("allowed_values_format") or r.get("allowedvaluesformat"))
        if found:
            break
    src = "book" if found else "floor"
    out = found or list(NOTE_CATEGORIES_FLOOR)
    if "other" not in out:
        out.append("other")
    return out, src


def note_category(raw: Any, categories: list[str]) -> str:
    k = _category_key(raw)
    if k:
        for c in categories:
            if _category_key(c) == k:
                return c
    return "other"


NOTE_RULE = ("\n\nDAILY NOTES — THIS RULE REPLACES ANY DAILY NOTE CATEGORY LIST OR NOTE SHAPE WRITTEN ABOVE:\n"
             "- Emit ONE \"DailyNote\" object PER CATEGORY the caller reported. A note about a client's sleep "
             "and meals is two DailyNote lines, never one line holding both.\n"
             "- \"category\" is ONE value copied exactly, character for character, from daily_note_categories in the "
             "INPUT.\n"
             "- \"response\" holds only what was reported for that category, in the caller's meaning.\n"
             "- Every DailyNote of the call carries the same \"call_id\" and \"timestamp\".\n"
             "- What fits no listed category is \"other\".")
CLIENT_RULE = ("\n\nCLIENT NAMES — ONE CLIENT PER OBJECT:\n"
               "- \"client_name\" on a DailyNote and \"Client Name\" on an Incident hold exactly ONE client.\n"
               "- A note or an incident about two clients is one object per client, each naming its own client.")


# ---- names ---------------------------------------------------------------------------------------------------------

def _many_names(said: str) -> bool:
    parts = [p for p in re.split(r"\s*(?:[,;&/+]|\band\b)\s*", said, flags=re.I) if N.tokens(p)["all"]]
    if len(parts) < 2:
        return False
    surname_first = (len(parts) == 2 and bool(re.match(r"^[^,;&/+]*,[^,;&/+]*$", said))
                     and not re.search(r"\band\b", said, re.I) and len(N.tokens(said.split(",")[0])["all"]) == 1)
    return not surname_first


def client_name(spoken: Any, client_names: list[str]) -> str:
    """hotlineClientName_: the list's spelling when the spoken name is one client beyond doubt; else as spoken."""
    said = s_(spoken)
    if not said or not client_names:
        return said
    try:
        if _many_names(said):
            return said
        said_key = " ".join(N.tokens(said)["all"])
        for e in client_names:
            if said_key and " ".join(N.tokens(e)["all"]) == said_key:
                return s_(e)
        best = N.best(said, client_names)
        if not best.get("ok") or not s_(best.get("matched_name")):
            return said
        for other in client_names:
            if " ".join(N.tokens(other)["core"]) == best["key"]:
                continue
            sc = N.score(said, other)
            if sc >= N.NAME_MATCH_MIN and best["score"] - sc < N.NAME_MATCH_GAP:
                return said
        said_core, got_core = N.tokens(said)["core"], N.tokens(best["matched_name"])["core"]
        for a in said_core:
            if not any(N.sim(a, b) >= 0.7 for b in got_core):
                return said
        return s_(best["matched_name"])
    except Exception:  # noqa: BLE001 - as spoken, as the port has it
        return said


def _phone_key(v: Any) -> str:
    d = re.sub(r"[^0-9]", "", "" if v is None else str(v))
    d = d[1:] if len(d) == 11 and d.startswith("1") else d
    return d if len(d) == 10 else ""


def caller_name(reads: L.Reads, stated: Any, phone: Any) -> dict[str, Any]:
    """contactNameFill_: the stated name; else the one person on the staff roster who holds the caller's line."""
    name = s_(stated)
    if re.sub(r"[^a-z]", "", name.lower()) not in ("",) + NO_NAME_WORDS:
        return {"name": name, "from": "person", "note": "Requestor as stated on the call."}
    key = _phone_key(phone)
    if not key or key in SHARED_LINE_DIGITS:
        return {"name": name, "from": "", "note": "Not named from the caller ID — no ten-digit number to ask with."}
    people: dict[str, str] = {}
    for p in reads.hub_rows("people"):
        nm = s_(p.get("name"))
        phones = [p.get("phone")] + (p.get("phones") if isinstance(p.get("phones"), list) else [])
        if nm and any(_phone_key(x) == key for x in phones):
            people.setdefault(re.sub(r"[^a-z0-9]", "", nm.lower()), nm)
    if len(people) == 1:
        who = next(iter(people.values()))
        return {"name": who, "from": "phone",
                "note": f"Named from the caller ID: {who} — one person on the staff roster holds this line."}
    if people:
        return {"name": name, "from": "", "note": f"Not named from the caller ID: {len(people)} people on the staff "
                                                  "roster hold this line. A shared line names nobody."}
    return {"name": name, "from": "", "note": "Not named from the caller ID — the number is not on the staff roster."}


# ---- PSI (PsiProbe.gs psiRead_) -----------------------------------------------------------------------------------

def _psi_fold(raw: Any) -> str:
    s = re.sub(r"[‘’ʼ']", "", ("" if raw is None else str(raw)).lower()).replace("0", "o")
    return " " + re.sub(r"[^a-z0-9]+", " ", s).strip() + " "


def _psi_any(folded: str, words: tuple[str, ...]) -> str:
    return next((w for w in words if " " + w + " " in folded), "")


def psi_read(kind: Any, text: Any) -> str:
    """'outage', 'reset', 'unknown', or '' when nothing names PSI Anywhere."""
    key = type_key(kind) or ("" if kind is None else str(kind)).lower()
    if not (re.match(r"^psi\b|^psi ", key) or _psi_any(_psi_fold(text), PSI_MATTER_WORDS)):
        return ""
    folded = _psi_fold(text)
    outage, reset, site = (_psi_any(folded, PSI_OUTAGE_WORDS), _psi_any(folded, PSI_RESET_WORDS),
                           _psi_any(folded, PSI_SITE_WORDS))
    if not outage:
        return "reset" if reset else "unknown"
    if reset and not site:
        return "reset"
    return "outage"


def _psi_line(raw: Any) -> str:
    return re.sub(r"\s+", " ", "" if raw is None else str(raw)).strip()[:240]


def psi_verdict(raw: Any) -> dict[str, Any] | None:
    """psiVerdictFrom_: the relay's PSI Anywhere check as the call carries it; anything else is no verdict."""
    if not isinstance(raw, dict):
        return None
    state = s_(raw.get("state")).lower()
    if state not in ("up", "down", "unknown"):
        return None
    ms = raw.get("ms")
    return {"state": state, "at": s_(raw.get("checked_at") or raw.get("at")),
            "ms": ms if isinstance(ms, (int, float)) and not isinstance(ms, bool) else 0,
            "note": _psi_line(raw.get("note")), "why": _psi_line(raw.get("why") or raw.get("sentence")),
            "decided_by": s_(raw.get("decided_by")), "held": bool(raw.get("held")), "from": "the call"}


def psi_note(v: dict[str, Any] | None) -> str:
    """psiProofNote_: what the check proved, said on the request's row."""
    if not v or not v.get("state"):
        return ""
    if v.get("note"):
        return _psi_line(v["note"] + " Nothing was claimed to the caller." if v["state"] == "unknown" else v["note"])
    at = s_(v.get("at"))
    when = at[11:16] + "Z" if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", at) else "just now"
    why = f" ({v['why']})" if v.get("why") else ""
    if v["state"] == "up":
        return _psi_line(f"PSI Anywhere checked {when}: working normally{why}.")
    if v["state"] == "down":
        return _psi_line(f"PSI Anywhere checked {when}: NOT answering{why}.")
    return _psi_line(f"PSI Anywhere could not be checked {when}{why}"
                     " — the check did not decide, and nothing was claimed to the caller.")


# ---- the call, the orders and what the model is offered -----------------------------------------------------------

def config(reads: L.Reads) -> dict[str, str]:
    """hotlineConfig_: the shipped orders, each key hotline_config fills laid over; a retired stored prompt goes."""
    out = {"enabled": "on", "team_phone": "+13309195558", "prompt": DEFAULT_PROMPT, "max_per_sweep": "6",
           "max_age_days": "14", "config_from": "default", "prompt_from": "shipped"}
    try:
        if HT.tabled(CONFIG_TAB):
            rows, out["config_from"] = HT.rows(reads, CONFIG_TAB), "table"
        else:
            res = reads.db.resolve(CONFIG_TAB)
            rows = reads.db.normalized_rows(res.ref) if res.ref is not None else []
            out["config_from"] = "sheet" if res.ref is not None else "default"
    except Exception:  # noqa: BLE001 - shipped defaults, said
        rows, out["config_from"] = [], "unreadable"
    for r in rows:
        k, v = s_(r.get("key")), r.get("value")
        if k and v is not None and s_(v) != "":
            out[k] = s_(v)
            if k == "prompt":
                out["prompt_from"] = "stored"
    if out["prompt_from"] == "stored" and \
            hashlib.sha256(out["prompt"].encode("utf-8")).hexdigest() in RETIRED_PROMPT_SHA256:
        out["prompt"], out["prompt_from"] = DEFAULT_PROMPT, "superseded"
    return out


def _locations(reads: L.Reads) -> list[str]:
    try:
        sid = reads.db.prop("HOTLINE_CALENDAR_ID")
        ref = reads.tab_of(sid, CALENDAR_TAB, "the Calendar Archive") if sid else None
        if ref is None or not ref.headers:
            return []
        first = ref.headers[0]
        return sorted({s_(hubdb.typed(raw.get(first), "raw")) for _rn, raw in reads.db.rows(ref)} - {""})
    except Exception:  # noqa: BLE001 - none offered, as the port has it
        return []


def context(reads: L.Reads) -> dict[str, Any]:
    """hotlineContext_: every client, every person on the staff roster who is not a client, the locations, the
    request types and the daily notes' categories."""
    try:
        clients = [s_(c.get("name")) for c in C.derived(reads) if s_(c.get("name"))]
    except Exception:  # noqa: BLE001
        clients = []
    client_keys = {gsjs.name_key(n) for n in clients}
    staff: list[str] = []
    try:
        seen: set[str] = set()
        for p in reads.hub_rows("people"):
            nm = s_(p.get("name"))
            k = gsjs.name_key(nm)
            if nm and k and k not in seen and k not in client_keys:
                seen.add(k)
                staff.append(nm)
    except Exception:  # noqa: BLE001
        staff = []
    types, types_from = request_types(reads)
    cats, cats_from = note_categories(reads)
    return {"client_names": clients, "staff_names": staff, "location_names": _locations(reads),
            "request_types": types, "note_categories": cats, "types_from": types_from, "categories_from": cats_from}


def call_of(reads: L.Reads, call_id: str) -> dict[str, Any] | None:
    rows = reads.db.query(f"select call_id, event_at, created, duration, caller_phones, team, dialogue from {CALLS}"
                          " where call_id = %s", (call_id,))
    if not rows:
        return None
    cid, event_at, created, duration, callers, team, dialogue = rows[0]
    turns = dialogue if isinstance(dialogue, list) else json.loads(dialogue or "[]")
    return {"call_id": cid, "event_at": event_at, "created": created, "duration": duration,
            "caller_phones": list(callers or []), "team": list(team or []), "dialogue": turns}


# the words a call may hold and still have nothing to file: a greeting, a filler, a goodbye
GREETING_WORDS = frozenset({"hello", "hi", "hey", "hola", "alo", "allo", "yes", "yeah", "yep", "ok", "okay", "um",
                            "umm", "uh", "uhh", "hmm", "mm", "bye", "goodbye", "is", "anyone", "anybody", "there"})


def no_words(call: dict[str, Any]) -> bool:
    """No word in the whole dialogue past a greeting, a filler or a goodbye: nothing a model could file."""
    said = " ".join(s_(t.get("content") or t.get("text")) for t in call.get("dialogue") or [] if isinstance(t, dict))
    return all(w in GREETING_WORDS for w in re.findall(r"[a-z']+", said.lower()))


def transcript(turns: list[dict]) -> str:
    """hotlineDialogueText_: '[m:ss] speaker: words', a team member named by the phone they spoke from."""
    phones: dict[str, Any] = {}
    for t in turns:
        if t.get("userId") and t.get("identifier") and t["userId"] not in phones:
            phones[t["userId"]] = t["identifier"]
    lines = []
    for t in turns:
        if "text" in t:
            # a call the inbox holds: its Speaker Transcript cell, read as the sweep reads it
            lines.append(s_(t.get("text")))
            continue
        try:
            sec = int(round(float(t.get("start")))) if t.get("start") else 0
        except (TypeError, ValueError):
            sec = 0
        speaker = t.get("identifier") or ""
        if not speaker and t.get("userId"):
            speaker = phones.get(t["userId"]) or t["userId"]
        lines.append(f"[{sec // 60}:{sec % 60:02d}] {speaker}: {t.get('content') or ''}")
    return "\n".join(lines)


def _instant(v: Any) -> str:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    except (TypeError, ValueError):
        return ""


def reporting_day(call_ts: str) -> str:
    """The call's day on Ohio's clock, the day its rows report."""
    return datetime.fromisoformat(call_ts.replace("Z", "+00:00")).astimezone(NY).strftime("%Y-%m-%d") if call_ts else ""


def ask(reads: L.Reads, call: dict[str, Any], cfg: dict[str, str] | None = None,
        ctx: dict[str, Any] | None = None) -> dict[str, Any]:
    """What the sweep sends the model for one call, and the facts the reading of its answer needs."""
    cfg = cfg or config(reads)
    ctx = ctx or context(reads)
    call_ts = _instant(call.get("event_at"))
    reporting = reporting_day(call_ts)
    caller = ", ".join(call.get("caller_phones") or [])
    payload = {"transcript": transcript(call["dialogue"]), "client_names": ctx["client_names"],
               "staff_names": ctx["staff_names"], "call_id": call["call_id"] or None, "caller_phone": caller or None,
               "call_timestamp": call_ts or None, "reporting_date": reporting or None,
               "location_names": ctx["location_names"], "request_types": ctx["request_types"],
               "daily_note_categories": ctx["note_categories"]}
    text = (cfg["prompt"] + type_rule(ctx["request_types"]) + NOTE_RULE + CLIENT_RULE +
            "\n\nRespond ONLY with valid NDJSON. One JSON object per line. No markdown, no commentary."
            "\n\nINPUT:\n" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return {"ask": text, "call_ts": call_ts, "reporting_date": reporting, "caller_phone": caller,
            "enabled": cfg["enabled"].lower() == "on", "config_from": cfg["config_from"],
            "prompt_from": cfg["prompt_from"], "types_from": ctx["types_from"],
            "categories_from": ctx["categories_from"]}


def parse(raw: Any) -> list[dict]:
    """hotlineParseNdjson_: one object per line, a fenced answer unwrapped, a bad line skipped."""
    cleaned = re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", gsjs.trim(gsjs.or_text(raw)), flags=re.I),
                     flags=re.I)
    items = []
    for line in cleaned.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            got = json.loads(line)
        except ValueError:
            continue
        items.append(got if isinstance(got, dict) else {})
    return items


def note_rows(notes: list[dict], cap_max: int = NOTE_ROWS_MAX) -> dict[str, Any]:
    """hotlineNoteRows_: one row per client, category, day and caller; past the cap, the rest folded into the last."""
    cap = max(2, cap_max)
    rows: list[dict] = []
    at: dict[str, int] = {}
    merged = 0

    def low(v: Any) -> str:
        return s_(v).lower()

    for n in notes:
        key = "|".join([low(n.get("client_name")), low(n.get("category")), low(n.get("reporting_date")),
                        low(n.get("dsp_name"))])
        if key in at:
            row = rows[at[key]]
            merged += 1
        else:
            row = {"note": n, "parts": []}
            at[key] = len(rows)
            rows.append(row)
        said = s_(n.get("response"))
        if said and low(said) not in [low(p) for p in row["parts"]]:
            row["parts"].append(said)
    capped = max(0, len(rows) - cap)
    if capped:
        rest = rows[cap - 1:]

        def distinct(field: str) -> list[str]:
            seen: set[str] = set()
            out = []
            for r in rest:
                v = s_(r["note"].get(field))
                if v and v.lower() not in seen:
                    seen.add(v.lower())
                    out.append(v)
            return out

        clients_, days, callers, cats = (distinct("client_name"), distinct("reporting_date"), distinct("dsp_name"),
                                         distinct("category"))
        pieces = []
        for r in rest:
            nn, label = r["note"], []
            if len(clients_) > 1 and s_(nn.get("client_name")):
                label.append(s_(nn.get("client_name")))
            if len(days) > 1 and s_(nn.get("reporting_date")):
                label.append(s_(nn.get("reporting_date")))
            if len(callers) > 1 and s_(nn.get("dsp_name")):
                label.append(s_(nn.get("dsp_name")))
            if len(cats) > 1:
                label.append(s_(nn.get("category")))
            text = "; ".join(r["parts"])
            pieces.append(", ".join(label) + (": " + text if text else "") if label else text)
        fold = dict(rest[0]["note"])
        fold["client_name"] = ", ".join(clients_)
        fold["category"] = cats[0] if len(cats) == 1 else "other"
        rows = rows[:cap - 1] + [{"note": fold, "parts": [p for p in pieces if p]}]
    return {"rows": [{**r["note"], "response": "; ".join(r["parts"])} for r in rows], "merged": merged,
            "capped": capped}


def location_of(item: dict, locations: list[str]) -> str:
    """hotlineLocation_: the first location whose name after its code is said in the request."""
    desc = s_(item.get("Description of Request")).lower()
    for loc in locations:
        for seg in loc.split(" - ")[1:]:
            seg = seg.strip().lower()
            if seg and seg in desc:
                return loc
    return ""


def stamp(text: Any, call_id: str) -> str:
    """hotlineCallStamp_: the words, then the call's id."""
    line = "" if text is None else str(text)
    if call_id:
        line = line + " Call ID: " + call_id
    return re.sub(r"\s+", " ", line).strip()


def plan(reads: L.Reads, call: dict[str, Any], items: list[dict], facts: dict[str, Any],
         ctx: dict[str, Any] | None = None) -> dict[str, Any]:
    """The rows the sweep would file for the call's items, lane by lane, and what each call-off sets off."""
    ctx = ctx or context(reads)
    call_id = s_(call.get("call_id"))
    at = facts.get("call_ts") or ""
    for it in items:
        if not call_id:
            call_id = s_(it.get("call_id"))
        if not at:
            at = s_(it.get("timestamp")) or s_(it.get("Timestamp"))
    reporting = facts.get("reporting_date") or ""
    caller = facts.get("caller_phone") or ""
    notes, incidents, requests, call_offs, kinds = [], [], [], [], []
    for item in items:
        wt = s_(item.get("work_type"))
        if wt == "DailyNote":
            notes.append({"timestamp": at, "call_id": call_id,
                          "reporting_date": s_(item.get("reporting_date")) or reporting,
                          "dsp_name": s_(item.get("dsp_name")),
                          "caller_phone": s_(item.get("caller_phone")) or caller,
                          "client_name": client_name(item.get("client_name"), ctx["client_names"]),
                          "category": note_category(item.get("category"), ctx["note_categories"]),
                          "response": s_(item.get("response"))})
        elif wt == "Incident":
            incidents.append({
                "timestamp": at, "your_name": s_(item.get("Your Name")),
                "client_name": client_name(item.get("Client Name"), ctx["client_names"]),
                "incident_category": s_(item.get("Incident Category")),
                "incident_location": s_(item.get("Incident Location")),
                "incident_date": s_(item.get("Incident Date")), "incident_time": s_(item.get("Incident Time")),
                "incident_reported_date": s_(item.get("Incident Reported Date")) or reporting,
                "incident_reported_time": s_(item.get("Incident Reported Time")),
                "employees_involved": s_(item.get("Employees Involved")),
                "summary_of_incident": s_(item.get("Summary of Incident")),
                "immediate_action_taken": s_(item.get("Immediate Action Taken")),
                "cause_and_contributing_factors": s_(item.get("Cause and Contributing Factors")),
                "prevention_plan": s_(item.get("Prevention Plan"))})
            kinds.append("Incident")
        elif wt == "Request":
            phone = s_(item.get("Requestor Phone")) or caller
            who = caller_name(reads, item.get("Requestor"), phone)
            kind = type_canon(item.get("Type of Request"), ctx["request_types"])
            is_call_off = type_key(kind) == type_key(CALL_OFF_TYPE)
            if is_call_off:
                kind = CALL_OFF_TYPE
            psi = psi_read(kind, item.get("Description of Request"))
            # only a caller reporting an outage is checked; a proven outage is the one urgency raised here
            verdict = facts.get("psi") if psi == "outage" else None
            proof = psi_note(verdict)
            received = s_(item.get("Date Received")) or reporting
            requests.append({
                "status": s_(item.get("Status")) or "New",
                "urgency": "High" if verdict and verdict.get("state") == "down" else (s_(item.get("Urgency")) or "Low"),
                "date_received": received, "requestor": who["name"], "requestor_phone": phone,
                "type_of_request": kind, "description_of_request": s_(item.get("Description of Request")),
                "notes": stamp(who["note"] + " " + proof if proof else who["note"], call_id), "_psi": psi,
                "_psi_verdict": verdict, "_name_from": who["from"]})
            kinds.append("Request")
            if is_call_off:
                call_offs.append({
                    "row": {"employee_name": who["name"], "date": received, "type": "Call Off",
                            "notes": s_(item.get("Description of Request")), "your_name": "Auto-processed (Hub)",
                            "call_id": call_id, "name_from": who["from"]},
                    "location": location_of(item, ctx["location_names"]),
                    "instance": (call_id or "call") + ":calloff:" + str(len(call_offs))})
        else:
            kinds.append(wt or "?")
    folded = note_rows(notes)
    kinds += ["DailyNote"] * len(folded["rows"])
    return {"items": len(items), "kinds": kinds, "daily_notes": folded["rows"], "notes_merged": folded["merged"],
            "notes_capped": folded["capped"], "incidents": incidents, "requests": requests, "call_offs": call_offs}


# ---- the doors (the relay's own identity alone) --------------------------------------------------------------------

DENIED = {"status": 403, "message": "The hotline's reading is the relay's alone."}


def _service(sess: L.Session) -> bool:
    return (sess.user or {}).get("is_service") is True


def shadow_ask(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineShadowAsk: the model's orders for a kept call, as the sweep would send them."""
    if not _service(sess):
        return DENIED
    call_id = s_((payload or {}).get("call_id"))
    if not CALL_ID.fullmatch(call_id):
        return {"status": 400, "message": "call_id: an AC call id."}
    call = call_of(sess.reads, call_id)
    if call is None:
        return {"status": 404, "message": f"No call {call_id} is kept."}
    return {"status": 200, "data": {**ask(sess.reads, call), "no_words": no_words(call)}}


def shadow_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineShadowPlan: the model's answer for a kept call read into the rows each lane would take."""
    if not _service(sess):
        return DENIED
    p = payload or {}
    call_id = s_(p.get("call_id"))
    call = call_of(sess.reads, call_id) if CALL_ID.fullmatch(call_id) else None
    if call is None:
        return {"status": 404, "message": f"No call {call_id} is kept."}
    import hotline_file  # noqa: PLC0415 - it builds on this module
    f = hotline_file.filing(sess.reads, call, p.get("content"), p.get("via"), p.get("psi"))
    return {"status": 200, "data": {"call_id": call_id, "via": s_(p.get("via")), "plan": f.get("plan"),
                                    "filing": hotline_file.preview(f)}}


INBOX_TAB = "Transcripts"
INBOX_HEADS = {"call_id": "Call ID", "event": "Event Timestamp", "created": "Transcript Created",
               "duration": "Duration (sec)", "callers": "Participant(s)", "team": "Team Member(s)",
               "text": "Speaker Transcript", "done": "Processed"}


def _inbox_instant(v: Any) -> str:
    """A Transcripts cell's instant: an ISO stamp as it is, 'M/D/YYYY H:MM:SS' on the book's Ohio clock."""
    s = s_(v)
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", s)
    if m:
        try:
            d = datetime(int(m[3]), int(m[1]), int(m[2]), int(m[4] or 0), int(m[5] or 0), int(m[6] or 0), tzinfo=NY)
        except ValueError:
            return ""
        return _instant(d.isoformat())
    return _instant(s)


def inbox_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineInboxDue: the inbox pass of hotlineSweep — the hotline's own calls in the Transcripts inbox, unprocessed,
    with words, inside the reading floor, that neither Python nor Apps Script's audit has filed; at most
    max_per_sweep, each shaped as the webhook hands a call over."""
    if not _service(sess):
        return DENIED
    return {"status": 200, "data": due(sess.reads)}


def due(reads: L.Reads) -> dict[str, Any]:
    """The inbox pass's calls: {calls, held, state}."""
    cfg = config(reads)
    if s_(cfg.get("enabled")).lower() != "on":
        return {"calls": [], "state": "disabled"}
    sid = gsjs.trim(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    ref = reads.tab_of(sid, INBOX_TAB, "the hotline's transcripts") if sid else None
    if ref is None or any(h not in ref.headers for h in INBOX_HEADS.values()):
        return {"calls": [], "state": "inbox_unreadable"}
    try:
        cap = max(1, min(20, int(float(cfg.get("max_per_sweep") or 6))))
        days = max(1, int(float(cfg.get("max_age_days") or 14)))
    except ValueError:
        cap, days = 6, 14
    floor = (reads.now.astimezone(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    want = re.sub(r"\D", "", s_(cfg.get("team_phone")))
    filed = {r[0] for r in reads.db.query(f"select call_id from {CALLS} where filed_at is not null")}
    res = HT.where(reads, "hotline_log")
    for r in HT.normalized(reads, res.ref):
        if s_(r.get("status")).lower() == "processed":
            filed.add(s_(r.get("callid")))
    calls, held = [], 0
    for _rn, raw in reads.db.rows(ref):
        cell = {k: s_(hubdb.typed(raw.get(h), "raw")) for k, h in INBOX_HEADS.items()}
        team = [p for p in re.split(r"[,;|/]+", cell["team"]) if p.strip()]
        if not want or not any(re.sub(r"\D", "", p) == want for p in team):
            continue
        if cell["done"] or not cell["text"] or not CALL_ID.fullmatch(cell["call_id"]) or cell["call_id"] in filed:
            continue
        at = _inbox_instant(cell["event"])
        if at and at[:19] < floor:
            held += 1
            continue
        try:
            duration = float(cell["duration"]) if cell["duration"] else None
        except ValueError:
            duration = None
        calls.append({"call_id": cell["call_id"], "event_at": at, "created": _inbox_instant(cell["created"]),
                      "duration": duration, "caller_phones": [p.strip() for p in re.split(r"[,;|/]+", cell["callers"])
                                                              if p.strip()],
                      "team": [p.strip() for p in team], "dialogue": [{"text": cell["text"]}]})
        if len(calls) >= cap:
            break
    return {"calls": calls, "held": held, "state": "read"}


def answer(text: str) -> tuple[str, str]:
    """screenAiChat_ for the hotline: Groq at the sweep's temperature, each GROQ_API_KEY* in turn; (content, via) or
    ('', why). The orders ask for lines, so no json_object is demanded."""
    keys = [(k, v) for k, v in sorted(os.environ.items()) if re.fullmatch(r"GROQ_API_KEY\d*", k) and v.strip()]
    if not keys:
        return "", "no GROQ_API_KEY"
    model = os.getenv("GROQ_MODEL", "").strip() or GROQ_MODEL
    refusals = []
    for name, key in keys:
        try:
            r = requests.post(GROQ_URL, headers={"Authorization": f"Bearer {key.strip()}"}, timeout=GROQ_TIMEOUT_S,
                              json={"model": model, "temperature": 0.1, "messages": [{"role": "user", "content": text}]})
        except requests.RequestException as exc:
            refusals.append(f"{name} {type(exc).__name__}")
            continue
        if r.status_code >= 400:
            m = re.search(r'"code"\s*:\s*"([A-Za-z0-9_.-]{1,40})"', r.text or "")
            refusals.append(f"{name} {r.status_code}" + (f" ({m.group(1)})" if m else ""))
            continue
        try:
            content = s_(((r.json().get("choices") or [{}])[0].get("message") or {}).get("content"))
        except ValueError:
            content = ""
        if content:
            return content, f"groq/{model}"
        refusals.append(f"{name} empty")
    return "", " | ".join(refusals)


def shadow_model(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineShadowModel: one completion for the hotline's orders, with the keys this service holds."""
    if not _service(sess):
        return DENIED
    text = s_((payload or {}).get("text"))
    if not text:
        return {"status": 400, "message": "text: the orders."}
    content, via = answer(text)
    if not content:
        return {"status": 503, "message": via}
    return {"status": 200, "data": {"content": content, "via": via}}


# ---- the Settings › Hotline doors (a person's) ---------------------------------------------------------------------

HUB_DENIED = {"status": 403, "message": "Requires an admin or manager account"}
LOG_TAIL = 10


def _role(sess: L.Session) -> str:
    user = sess.user or {}
    return "" if user.get("is_service") else s_(user.get("role")).lower()


def log_strip(reads: L.Reads) -> dict[str, Any]:
    """hotlineLogStrip_: the audit's last ten lines, newest first, and its processed and blocked totals."""
    out: dict[str, Any] = {"tail": [], "processed_total": 0, "blocked_total": 0}
    try:
        res = HT.where(reads, "hotline_log")
        rows = HT.normalized(reads, res.ref)
    except Exception:  # noqa: BLE001 - an unreadable audit is an empty strip, never a dead screen
        return out
    out["blocked_total"] = sum(1 for r in rows if s_(r.get("status")) == "blocked")
    out["processed_total"] = len(rows) - out["blocked_total"]
    for r in reversed(rows[-LOG_TAIL:]):
        line = {"call_id": s_(r.get("callid")), "at": s_(r.get("at")), "caller": s_(r.get("caller")),
                "items": s_(r.get("items")), "kinds": s_(r.get("kinds")), "status": s_(r.get("status")) or "processed",
                "via": s_(r.get("via"))}
        if line["call_id"] or line["at"]:
            out["tail"].append(line)
    return out


def config_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineConfigGet: the orders the sweep reads, the shipped prompt beside them, and the desk's status strip."""
    if _role(sess) not in ("admin", "manager"):
        return HUB_DENIED
    cfg: dict[str, Any] = dict(config(sess.reads))
    cfg["default_prompt"] = DEFAULT_PROMPT
    strip = log_strip(sess.reads)
    cfg["processed_total"], cfg["blocked_total"], cfg["log_tail"] = (strip["processed_total"], strip["blocked_total"],
                                                                      strip["tail"])
    return {"status": 200, "data": cfg}


def sweep(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hotlineSweep by an admin's hand, the rehearsal (simulate): each call the inbox pass would open, read by the
    model and laid into the rows it would file — nothing kept, nobody told. The filing itself runs on the relay's
    clock (hotlineInboxDue, then hotlineFile)."""
    if _role(sess) != "admin":
        return HUB_DENIED
    if not (payload or {}).get("simulate"):
        return {"status": 400, "message": "The hotline's calls are filed on the relay's clock; by hand it rehearses "
                                          "(simulate) alone."}
    import hotline_file  # noqa: PLC0415 - it builds on this module
    reads = sess.reads
    got = due(reads)
    census: dict[str, Any] = {"mode": "sweep", "simulate": True, "calls": 0, "items": [], "held": got.get("held", 0),
                              "blocked": 0, "state": got["state"]}
    if got["state"] != "read":
        census["reason"] = got["state"]
        return {"status": 200, "data": census}
    cfg, ctx = config(reads), context(reads)
    first = ""
    for call in got["calls"]:
        orders = ask(reads, call, cfg, ctx)
        content, via = answer(orders["ask"])
        if not content:
            census["blocked"] += 1
            first = first or via
            continue
        f = hotline_file.filing(reads, call, content, via)
        census["items"].append({"call_id": call["call_id"], "via": via, **hotline_file.preview(f)})
    census["calls"] = len(census["items"])
    if not census["calls"] and census["blocked"]:
        return {"status": 502, "message": f"The rehearsal could not read {census['blocked']} waiting call(s): {first}",
                "data": census}
    census["reason"] = "rehearsed" if census["calls"] else "held_only" if census["held"] else "nothing_new"
    return {"status": 200, "data": census}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"hotlineShadowAsk": shadow_ask,
                                                                    "hotlineShadowPlan": shadow_plan,
                                                                    "hotlineShadowModel": shadow_model,
                                                                    "hotlineInboxDue": inbox_due,
                                                                    "hotlineConfigGet": config_get,
                                                                    "hotlineSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["hotlineConfigGet"] = {"roles": ["admin", "manager"]}
POLICY["hotlineSweep"] = {"roles": []}
