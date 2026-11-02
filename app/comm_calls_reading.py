"""The reading of the company's phone calls, turned into facts and sealed words: the old platform's
app/analytics/comm_calls.py translated into the Hub. The calls are read off asa-hub-db's copy of the inbox's
Transcripts tab (comm_calls_feed.pile); this module reads and shapes only. It writes nothing, seals nothing and sends
nothing: comm_calls_feed seals the words, keeps the ledger and hands the facts on.

IN THE CLEAR — THE FACTS: the kind of matter, its category from a closed list, its urgency, who the NUMBER
established, when, which line, how long, and a pointer back to the call. SEALED — THE WORDS: `full_transcript`,
`speaker_transcript` and every summary the model writes, sealed by comm_seal and openable by nobody on this machine.
`CALL_FIELDS`, `ITEM_FIELDS` and `CLOSED_*` are the whole of what may travel in the clear, and `refused()` fails the
import if an edit widens them.

The `processed` cell is never touched, and no book somebody else fills is written. The caller is named by the number
alone (`commCallsWho`), never by the transcript: `name` only on `sole`, and an unanswered resolver leaves it empty with
`who_state='unresolved'`. A call that could not be read is `read_state='unreadable'` with no item count, never a row of
zeros.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

# the inbox's book and tab, as asa-hub-db's catalog names them
MIRROR_SHEET_ID = (os.getenv("COMM_CALLS_MIRROR_SHEET")
                   or "1nkYZ24EtG4woyIShMKouj1kWdQD2IGpjUkWEamZHMno")
MIRROR_TAB = "Transcripts"

# this lane's name → the sheet's own header, mapped by hand: two headers that fold to one word never merge
_MIRROR_COLS = {
    "call_id": "Call ID",
    "event_timestamp": "Event Timestamp",
    "duration_sec": "Duration (sec)",
    "participant_s": "Participant(s)",
    "team_member_s": "Team Member(s)",
    "direction": "Direction",
    "turns": "# Turns",
    "full_transcript": "Full Transcript",
    "speaker_transcript": "Speaker Transcript",
    "processed": "Processed",
    "processedbyagent": "ProcessedByAgent",
    "processingerror": "ProcessingError",
    "transcript_created": "Transcript Created",
}

# The agency's clock. The inbox writes 'M/D/YYYY H:MM:SS' with no offset, and
# an hour that shifts by one is a work item filed on the wrong day.
ZONE = ZoneInfo("America/New_York")

# ---------------------------------------------------------------------------
# THE CLOSED VOCABULARIES
# ---------------------------------------------------------------------------
# A category is a FACT about a call. Free text is the words. These lists are
# the difference, and they are the platform's own: the DailyNote and Request
# vocabularies are `HOTLINE_DEFAULT_PROMPT`'s verbatim, and the incident
# vocabulary is the ten `broad` rows of the platform's own incident-category
# entity table.
CLOSED_DAILY = ("daily_update", "medical", "behavior", "meals", "activities",
                "sleep", "hygiene", "other")

CLOSED_REQUEST = ("Schedule - Call Off", "Schedule - Change", "Payroll", "Supplies",
                  "Maintenance", "HR", "IT", "Other")

# THE TEN BROAD ONES, AND ONLY THOSE. The same entity table also carries ten
# `specific_minor` labels ("Client found with self-scratching marks or skin
# irritation", "Client refused meal or fluids"). Those are not categories, they
# are one-line narratives about a client's body and behaviour — a summary
# wearing a vocabulary's clothes. A matter that fits one of them files under
# its broad parent here and the detail goes under seal, which is the only place
# it belongs.
CLOSED_INCIDENT = ("minor_issue_schedule_late_verbal_tension",
                   "medication_error_missed_dose",
                   "client_behavior_aggression",
                   "injury_accident_staff_or_client",
                   "hospitalization_er_visit",
                   "abuse_neglect_allegation",
                   "missing_client_wandering",
                   "vehicle_transportation_issue",
                   "environmental_facility_issue",
                   "post_incident_check")

CLOSED_URGENCY = ("Low", "Medium", "High")

# THE SIX OUTCOMES A SCREENING CLOSES WITH. The list is the 4040 line's own
# analysis prompt — the FinalResult vocabulary of `ai_phone_screen_analysis`
# in the words book — normalised to this house's spelling. A screening call is
# a CANDIDATE talking to the hiring assistant, so no client rule bites here,
# and the caller is still named by the number or by nobody.
CLOSED_SCREENING = ("advance", "advance_pending", "declined_pay",
                    "declined_schedule", "incomplete", "no_show")

# THE FOUR TYPES THE CONTRACT HAS. The screening lines' calls (5558 and 4040)
# get a home in Smart Comms, and the home is one Screening item per call — the
# outcome — never one per question.
WORK_TYPES = ("DailyNote", "Incident", "Request", "Screening")

FALLBACK = {"DailyNote": "other", "Request": "Other", "Screening": "incomplete",
            "Incident": "minor_issue_schedule_late_verbal_tension"}

# ---------------------------------------------------------------------------
# THE LINE
# ---------------------------------------------------------------------------
# THE WORDS, BY EVERY NAME THEY TRAVEL UNDER. Each one is a real column on one
# of the books this material already lives in, which is why the list is long
# and why it is checked rather than assumed.
REFUSED_WORDS = (
    "full_transcript", "speaker_transcript", "transcript",
    "summary", "quote", "description", "description_of_request",
    "response", "summary_of_incident", "immediate_action_taken",
    "cause_and_contributing_factors", "prevention_plan",
    "notes", "note", "reason", "comments", "raw", "text", "preview", "excerpt",
)

# A RECORD ABOUT A WORKER NEVER PUBLISHES A CLIENT. The seventeen house codes
# in the Calendar Archive stand 1:1 with seventeen street addresses, so the
# code IS the address wearing a shorter name — which is why `location_code`,
# `house` and `shift_code` sit on this list beside the address itself.
REFUSED_CLIENT = (
    "client_name", "client", "consumers", "num_consumers",
    "house", "location_code", "incident_location", "location",
    "shift_code", "address", "latitude", "longitude",
)

# THE PEOPLE HOUSE IS THE CONTACT LIST. A second one is a number an inbound
# reply can never be attributed to — the mistake `comm_routes` had to retire.
# The caller's number resolves AT THE DOOR and does not land.
REFUSED_CONTACT = ("phone", "caller_phone", "requestor_phone", "email")

REFUSED = REFUSED_WORDS + REFUSED_CLIENT + REFUSED_CONTACT

# ---------------------------------------------------------------------------
# WHAT MAY TRAVEL IN THE CLEAR — the whole of it, named one field at a time
# ---------------------------------------------------------------------------
# `line` is the company number the call touched, in E.164, and it is CARRIED AS
# DIGITS on purpose. THE LINES ARE UNNAMED: nothing in this repository says
# which of the fourteen is the hotline, the busiest is not known to be it, and
# a column captioned 'hotline' would be an assertion nobody measured. 217 rows
# name two lines in one cell; both travel, comma-joined, because collapsing
# them would invent a call that touched one.
CALL_FIELDS = [
    "call_id", "call_at", "line", "direction", "duration_sec", "turns",
    "person_key", "name", "name_from", "name_why", "who_state",
    "read_state", "read_at", "model_via", "items", "prior_lane", "seal_id",
]

ITEM_FIELDS = [
    "call_id", "item_no", "work_type", "category", "urgency", "occurred_on",
    "concerns_person_key", "concerns_name", "name_from",
    "confidence", "state", "seal_id", "source_call_at",
]


def refused(fields: Iterable[str]) -> list[str]:
    """Which refused names are in this list. The import-time lock below is the
    reason this is a function and not a comment."""
    return sorted(set(REFUSED) & set(fields))


_CROSSED = refused(CALL_FIELDS) + refused(ITEM_FIELDS)
if _CROSSED:
    # A BROKEN MODULE IS FIXED IN AN HOUR. A person's words quietly filed in a
    # clear-text house are not noticed for months, and by then they are in a
    # sheet, a cache, a bundle and a backup.
    raise RuntimeError("comm_calls: the clear side may never carry " + ", ".join(_CROSSED))


# ---------------------------------------------------------------------------
# THE ASK — the Hotline contract, narrowed by the seal
# ---------------------------------------------------------------------------
PROMPT = (
    "You process voicemail and call transcripts from the employee support phone lines of a "
    "company running group homes for adults with developmental disabilities in Ohio. Direct "
    "support professionals call these lines to leave daily notes about clients, report "
    "incidents, ask for help, and call off shifts.\n\n"
    "You receive a JSON payload: {transcript, call_id, call_timestamp, reporting_date}.\n\n"
    "Read the transcript and emit ONE work item PER DISTINCT MATTER as NDJSON — one JSON "
    "object per line, nothing else. No markdown, no commentary, no array, no wrapper object.\n\n"
    "RULES THAT OUTRANK EVERYTHING:\n"
    "- Use ONLY what the transcript says. Never invent a name, a date, a client or an event.\n"
    "- NEVER write a person's name into any field. Not the caller's, not a colleague's, not a "
    "client's. The platform establishes who called from the phone number, not from the words.\n"
    "- Dates: resolve relative words (\"today\", \"tomorrow\") against reporting_date. "
    "Format yyyy-MM-dd.\n"
    "- One call often carries several matters — a daily note AND a call off is two lines.\n"
    "- A matter that fits nothing is a Request with category \"Other\".\n"
    "- If the transcript carries no work matter at all, emit nothing. A greeting, a beep, "
    "a wrong number, a machine message and a hang-up are not work matters.\n"
    "- NEVER write a summary longer than the transcript you were given. If you cannot say "
    "what the matter is in fewer characters than the caller used, you are inventing it.\n\n"
    "Every object carries exactly these keys:\n"
    "  work_type   one of: DailyNote | Incident | Request | Screening\n"
    "  category    for DailyNote, one of: " + ", ".join(CLOSED_DAILY) + "\n"
    "              for Request, one of: " + ", ".join(CLOSED_REQUEST) + "\n"
    "              for Incident, one of: " + ", ".join(CLOSED_INCIDENT) + "\n"
    "              for Screening, one of: " + ", ".join(CLOSED_SCREENING) + "\n"
    "  urgency     Low | Medium | High. A call off is always High.\n"
    "  occurred_on yyyy-MM-dd, the day the matter is about\n"
    "  confidence  0.0 to 1.0, your own\n"
    "  summary     what the matter is, in the caller's meaning, complete\n\n"
    "A shift call off is ALWAYS work_type \"Request\", category \"Schedule - Call Off\", "
    "urgency \"High\", and the summary names the shift date and the reason given.\n"
    "A hiring phone-screening call — the agency's screening assistant interviewing a "
    "candidate — is ONE Screening item for the whole call, never one per question. Its "
    "category is the outcome: advance when an in-person interview was agreed, "
    "advance_pending when the candidate qualified with items left to verify, "
    "declined_pay or declined_schedule when the candidate stepped back over pay or "
    "schedule, no_show when the candidate never engaged, incomplete when the call ended "
    "before any decision. The summary says what was decided, and the interview slot "
    "exactly as spoken when one was agreed.\n"
    "Use the category words EXACTLY as spelled above. A category not on the list is refused."
)

# THE SUMMARY IS THE ONLY PROSE ASKED FOR, and it exists to be SEALED — it is
# what the keyholder reads back per work item without opening a whole call.
# It is never stored in the clear and never logged.
SEALED_ITEM_FIELD = "summary"

# WHAT IS SEALED FROM THE CALL ITSELF. `full_transcript` is read first because
# it is the same speech as `speaker_transcript` 35% shorter — 7.9 MB against
# 12.0 MB across this corpus — and the model is paid by the character. Both are
# sealed; only one is read.
READ_FIELD = "full_transcript"
SEAL_FIELDS = ("full_transcript", "speaker_transcript")


# ---------------------------------------------------------------------------
# SHAPING
# ---------------------------------------------------------------------------
def key(v: Any) -> str:
    """`clientNameKey_` — the platform's own flattened name, so a person keyed
    here is the same person keyed in every other comm house."""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def text(v: Any, cap: int = 0) -> str:
    if v is None or v is False:
        return ""
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def e164(v: Any) -> str:
    """One phone cell → the E.164 numbers it holds, comma-joined.

    THE CELL CAN HOLD A LIST. 217 rows in this corpus name two company lines in
    one cell, and reading it as a single number is precisely the bug that made
    a third of the live processor's own calls invisible to it.
    """
    out = []
    for part in re.split(r"[,;|/]+", str(v or "")):
        digits = re.sub(r"\D+", "", part)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            out.append("+1" + digits)
    return ",".join(out)


def caller_digits(v: Any) -> str:
    """The ten digits of the caller's own number, for the resolver to be asked
    with. It is used to ASK and is never stored: the People house is the
    contact list, and a second one is a number nobody can attribute a reply to.
    """
    for part in re.split(r"[,;|/]+", str(v or "")):
        digits = re.sub(r"\D+", "", part)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            return digits
    return ""


def caller_from_turns(speaker: Any, team: Any) -> str:
    """The caller's ten digits, recovered from the speaker labels.

    THE PARTICIPANT CELL IS EMPTY FOR WHOLE CLASSES OF CALLS (measured:
    OpenPhone's own integration leaves it blank on the support line), while
    every speaker label in the same row IS an E.164 number — '[0:00]
    +13309195558: …'. The company lines are already named in this row's own
    `team_member_s`, so the caller is the ten-digit number that is NOT one of
    them. The first such number answers; a turn with no number at all answers
    nobody, which is the same law the resolver keeps — unknown, never a guess.
    """
    own = set()
    for piece in re.findall(r"\d{10,11}", re.sub(r"\D", " ", str(team or ""))):
        own.add(piece[-10:])
    for label in re.findall(r"\+?1?\d{10}(?=:)", str(speaker or "")):
        digits = re.sub(r"\D+", "", label)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10 and digits not in own:
            return digits
    return ""


def instant(v: Any) -> str:
    """'M/D/YYYY H:MM:SS' as the inbox writes it → ISO with the agency's offset.

    UNREADABLE IS EMPTY, NEVER A GUESS. A call whose moment cannot be read
    still gets a row — it happened — and its `call_at` says plainly that the
    platform does not know when.
    """
    s = text(v, 40)
    if not s:
        return ""
    for shape in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S",
                  "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, shape).replace(tzinfo=ZONE).isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).isoformat()
    except ValueError:
        return ""


def day(iso: str) -> str:
    """The reporting date the contract resolves relative words against."""
    return iso[:10] if len(iso) >= 10 else ""


def number(v: Any) -> str:
    """A count as text, or '' — MISSING IS NOT ZERO, and '' is how a house
    says so in a cell that holds numbers."""
    s = re.sub(r"[^\d]", "", str(v or ""))
    return s or ""


def prior_lane(row: dict) -> str:
    """Which lane already handled this call, read off the inbox's own cells alone.

    So a reader can see the overlap WITHOUT this lane ever opening the Employee
    Support Queue, the incident book or the daily-notes book — none of which is
    this lane's to read, and all of which would be a second reader of somebody
    else's record.
    """
    agent = text(row.get("processedbyagent")).lower()
    if "phonescreen" in agent:
        return "phonescreen"
    if agent:
        return "hotline"
    if text(row.get("processed")):
        # Marked, with no agent named: the legacy processor stamps exactly this
        # shape, and it is 156 of the 159 marks in this corpus.
        return "legacy"
    return ""


# ---------------------------------------------------------------------------
# THE MODEL DOOR — a ladder of two rungs, and the first one is on this machine
# ---------------------------------------------------------------------------
# THE LOCAL MODEL IS TRIED FIRST: every other rung posts people's speech to
# somebody else's server, while a transcript read on this machine never leaves
# it, and costs nothing.
#
# EACH RUNG DECLARES HOW MUCH IT CAN READ. That is not decoration — the local
# server's context is finite, the corpus has calls of 84,913 characters, and a
# lane that quietly truncated them would file confident facts about the first
# half of somebody's call. A call no configured rung can take is NOT claimed,
# NOT marked, and counted by name, so it waits for a wider door instead of
# being silently lost. That is the difference between this lane and the filter
# it replaces.
LOCAL_URL = os.getenv("COMM_CALLS_LOCAL_URL") or "http://local-cortex:8080/v1/chat/completions"
LOCAL_MODEL = os.getenv("COMM_CALLS_LOCAL_MODEL") or "qwen2.5-7b-instruct"
# The server reports n_ctx 8192 per slot. The ask itself is about 900 tokens
# and the answer needs room, so roughly 6,000 tokens are left for speech — at
# four characters a token, 24,000 characters. Deliberately under the ceiling:
# a call that overruns produces a truncated answer, not an error.
LOCAL_WINDOW = int(os.getenv("COMM_CALLS_LOCAL_WINDOW", "24000"))

# The model gate, named here only as a door: it is a separate project from
# Smart Comms and its backlog does not belong in this one.
GATE_URL = os.getenv("COMM_CALLS_LLM_URL") or os.getenv("HUB_ANALYZE_URL") \
    or "http://litellm:4000/v1/chat/completions"
GATE_MODEL = os.getenv("COMM_CALLS_LLM_MODEL") or os.getenv("HUB_ANALYZE_MODEL") or "ai-all"
GATE_KEYS = [k for k in (os.getenv("LLM_API_KEY", ""), os.getenv("OPENAI_API_KEY", "")) if k]
# The hosted models in that group carry 128k contexts; the largest transcript
# in this corpus is 84,913 characters, which fits with room to spare.
GATE_WINDOW = int(os.getenv("COMM_CALLS_GATE_WINDOW", "400000"))

DOOR_TIMEOUT = float(os.getenv("COMM_CALLS_LLM_TIMEOUT", "300"))


def doors() -> list[dict]:
    """The ladder, in the order it is walked. Local first, always."""
    out = [{"name": "local", "url": LOCAL_URL, "model": LOCAL_MODEL,
            "keys": [""], "window": LOCAL_WINDOW}]
    if GATE_KEYS:
        out.append({"name": "gate", "url": GATE_URL, "model": GATE_MODEL,
                    "keys": GATE_KEYS, "window": GATE_WINDOW})
    return out


def window() -> int:
    """The most speech any configured rung can read in one go."""
    return max(d["window"] for d in doors())


def fits(chars: int) -> bool:
    """Can ANY rung read a transcript this long.

    Asked BEFORE the call is claimed, so a call too long for today's doors
    stays exactly as it was and a later run with a wider one still finds it.
    A lane that claimed it and filed it unreadable would have destroyed the
    only thing that made it re-readable.
    """
    return chars <= window()


class Refused(RuntimeError):
    """No model answered. The call stays unread — never marked, never emptied."""


def ask(transcript: str, call_id: str, call_at: str, http: Any = None) -> dict:
    """One transcript in, the model's raw answer out. `{content, via}`.

    NO `response_format`. See the module docstring: JSON mode caps this
    contract at one item per call, and one call routinely carries several
    matters. The prompt does the constraining and the parser tolerates three
    shapes.

    A REFUSAL IS RAISED, NOT SWALLOWED, and it carries every rung's own reason.
    The single most expensive silence in this estate's history was a lane that
    read `if (!res.ok) continue;` and then reported the same zero a quiet inbox
    reports — the account of which providers said what was computed, returned,
    and thrown away, every ten minutes, for as long as the door stayed shut.
    """
    if http is None:
        import httpx
        http = httpx
    body = json.dumps({
        "transcript": transcript,
        "call_id": call_id or None,
        "call_timestamp": call_at or None,
        "reporting_date": day(call_at) or None,
    }, ensure_ascii=False)
    tried = []
    for door in doors():
        if len(transcript) > door["window"]:
            tried.append(f"{door['name']}_too_long")
            continue
        payload = {"model": door["model"], "temperature": 0.1,
                   "messages": [{"role": "system", "content": PROMPT},
                                {"role": "user", "content": body}]}
        for k in door["keys"]:
            headers = {"Authorization": "Bearer " + k} if k else {}
            try:
                with http.Client(timeout=DOOR_TIMEOUT) as client:
                    r = client.post(door["url"], json=payload, headers=headers)
                if r.status_code >= 400:
                    tried.append(f"{door['name']}_{r.status_code}")
                    continue
                data = r.json()
                content = (((data.get("choices") or [{}])[0].get("message") or {})
                           .get("content"))
                if not content:
                    # A 200 CARRYING NO COMPLETION IS NOT AN ANSWER. Only the
                    # payload proves anything.
                    tried.append(f"{door['name']}_empty")
                    continue
                return {"content": content,
                        "via": door["name"] + ":" + (text(data.get("model")) or door["model"])}
            except Exception as exc:  # noqa: BLE001 — every rung's failure is a reason
                tried.append(f"{door['name']}_{type(exc).__name__}")
                continue
    raise Refused("+".join(tried) or "no door is configured")


def parse(raw: str) -> list[dict]:
    """NDJSON, a bare object, or an array — all three, because a provider that
    is asked for lines and returns an array has still answered.

    `hotlineParseNdjson_` drops an unparseable line rather than a whole call,
    and that choice is kept: one malformed line is one lost matter, not a lost
    call.
    """
    body = str(raw or "").strip()
    body = re.sub(r"^```(?:json|ndjson)?\s*", "", body, flags=re.I)
    body = re.sub(r"\s*```$", "", body)
    body = body.strip()
    if not body:
        return []
    if body[0] == "[":
        try:
            got = json.loads(body)
            return [o for o in got if isinstance(o, dict)]
        except ValueError:
            pass
    items: list[dict] = []
    for line in body.split("\n"):
        line = line.strip().rstrip(",")
        if not line or line in ("[", "]"):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            items.append(obj)
    if not items:
        try:
            obj = json.loads(body)
        except ValueError:
            return []
        if isinstance(obj, dict):
            # A pretty-printed single object: one matter, correctly read.
            items = [obj]
        elif isinstance(obj, list):
            items = [o for o in obj if isinstance(o, dict)]
    return items


def category(work_type: str, raw: Any) -> tuple[str, bool]:
    """A category from the closed list, and whether it had to be coerced.

    COERCED, NEVER PASSED THROUGH. A category this platform does not know would
    be free text out of a transcript sitting in a clear-text column — which is
    the leak, not a formatting problem. Matching is on the flattened spelling
    so 'Schedule-Call Off' and 'schedule - call off' are the same word.
    """
    want = {"DailyNote": CLOSED_DAILY, "Request": CLOSED_REQUEST,
            "Incident": CLOSED_INCIDENT, "Screening": CLOSED_SCREENING}.get(work_type, ())
    got = key(raw)
    for allowed in want:
        if key(allowed) == got:
            return allowed, False
    return FALLBACK.get(work_type, "Other"), bool(got)


def confidence(v: Any) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    if f != f or f < 0 or f > 1:
        return ""
    return f"{f:.2f}"


def project(row: dict, items: list[dict], who: dict, via: str, at: str) -> dict:
    """One call and its matters → the clear rows and the words to be sealed.

    THE ONLY PLACE THE TWO SIDES ARE DECIDED, so the refusal is checkable by
    reading one function. Every clear field is named individually; nothing is
    copied wholesale, which is what stops a new column upstream from riding
    along into a house.

    `who` is `contactPhoneWho_`'s answer, carried across from the door:
    {state, name, why}. On anything but 'sole' the name is EMPTY — a shared
    line names nobody, and an unresolved one names nobody either.
    """
    call_id = text(row.get("call_id"), 60)
    call_at = instant(row.get("event_timestamp"))
    state = text(who.get("state")) or "unresolved"
    named = state == "sole"
    name = text(who.get("name"), 120) if named else ""

    call = {
        "call_id": call_id,
        "call_at": call_at,
        "line": e164(row.get("team_member_s")),
        "direction": text(row.get("direction"), 12).lower() or "unknown",
        "duration_sec": number(row.get("duration_sec")),
        "turns": number(row.get("turns")),
        "person_key": key(name) if named else "",
        "name": name,
        # NEVER 'person'. The words are sealed, so no name a transcriber heard
        # can reach this house by any route.
        "name_from": "phone" if named else "",
        "name_why": text(who.get("why"), 300),
        "who_state": state,
        "read_state": "read",
        "read_at": at,
        "model_via": text(via, 60),
        "items": str(len(items)),
        "prior_lane": prior_lane(row),
        "seal_id": call_id,
    }

    # THE SOURCE THIS CALL'S MATTERS MUST FIT INSIDE. Measured, not assumed:
    # the corpus holds 102 calls whose whole transcript is under 60 characters
    # and 128 with two turns or fewer — a greeting and a hang-up, a machine
    # line, a beep. Asked to read one of those, a small model does not answer
    # "nothing": it produces a confident, complete, entirely invented work
    # item. Measured on this very sample, a six-character transcript came back
    # as a call-off with a shift date and confidence 1.00.
    source_len = len(str(row.get(READ_FIELD) or ""))

    clear_items = []
    sealed_items = []
    coerced = 0
    invented = 0
    for n, item in enumerate(items, start=1):
        work_type = text(item.get("work_type"), 20)
        if work_type not in WORK_TYPES:
            continue
        # A SUMMARY LONGER THAN THE CALL IT SUMMARISES IS NOT A SUMMARY.
        #
        # This is the one check that catches invention WITHOUT judging meaning,
        # and it needs no threshold anybody has to defend: if the model wrote
        # more words than were said, the extra words came from the model. A
        # long call with a short summary is untouched; a six-character call
        # that yields ninety characters of confident detail is refused.
        #
        # AND AN ITEM WITH NO WORDS AT ALL IS REFUSED TOO. The sealed summary
        # is this item's only evidence; a bare classification with nothing
        # behind it is an assertion nobody can ever check, and it would sit in
        # the clear house looking exactly like a fact.
        words = text(item.get(SEALED_ITEM_FIELD))
        if not words or len(words) > source_len:
            invented += 1
            continue
        cat, was_coerced = category(work_type, item.get("category"))
        coerced += 1 if was_coerced else 0
        urgency = text(item.get("urgency"), 10).title()
        if urgency not in CLOSED_URGENCY:
            urgency = "High" if cat == "Schedule - Call Off" else "Low"
        occurred = text(item.get("occurred_on"), 10)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", occurred):
            # RESOLVED AGAINST THE CALL'S OWN DATE, never against today: this
            # lane reads calls seven months old and "today" would file every
            # one of them on the day of the catch-up.
            occurred = day(call_at)
        # THE ONE LINE THAT TRAVELS: the
        # summary stays sealed as it always was — and its FIRST line, capped,
        # is the description the table shows, exactly like the Support
        # Queue's. The headline travels; the conversation stays under the key.
        description = text(item.get(SEALED_ITEM_FIELD), 240).split("\n")[0]
        clear_items.append({
            "call_id": call_id,
            "item_no": str(n),
            "work_type": work_type,
            "category": cat,
            "urgency": urgency,
            "occurred_on": occurred,
            "description": description,
            # THE SAME LAW AS THE CALL ROW. The matter concerns whoever the
            # NUMBER established, or nobody.
            "concerns_person_key": call["person_key"],
            "concerns_name": call["name"],
            "name_from": call["name_from"],
            "confidence": confidence(item.get("confidence")),
            "state": "open",
            "seal_id": f"{call_id}:{n}",
            "source_call_at": call_at,
        })
        sealed_items.append({"scope": "item", "item_no": str(n),
                             "field": SEALED_ITEM_FIELD, "text": words})

    # THE COUNT IS WHAT SURVIVED THE CHECKS, never what the model emitted: a
    # call whose every matter was invented read as a call that carried none,
    # which is the honest fact — the platform read it and filed nothing.
    call["items"] = str(len(clear_items))
    # THE WORDS, ON THEIR WAY TO THE SEAL AND NOWHERE ELSE.
    return {"call": call, "items": clear_items,
            "sealed": words_of(row) + sealed_items,
            "coerced": coerced, "invented": invented}


def words_of(row: dict) -> list[dict]:
    """The call's own speech, VERBATIM, for the seal.

    Not `text()`. Every other value in this module is whitespace-normalised
    and capped, because a house cell is not a document — but a transcript is
    evidence, and a seal whose plaintext is a tidied-up version of what was
    said is a seal over something nobody actually said. The inner sha256 is
    taken over exactly these bytes, so a later reader can prove it.
    """
    out = []
    for field in SEAL_FIELDS:
        value = row.get(field)
        if value is None or value == "":
            continue
        out.append({"scope": "transcript", "item_no": "",
                    "field": field, "text": str(value)})
    return out


def unreadable(row: dict, why: str, at: str, who: dict | None = None) -> dict:
    """A call this lane opened and could not read.

    MISSING IS NOT ZERO. `items` is EMPTY, never '0': a clear-side row saying
    "this call contained nothing" is a false fact, and Calendar Builder ranks
    on these rows. No work items are emitted, and the words are still sealed —
    a call the model refused is a call whose transcript exists and must not sit
    in the clear waiting for a retry.
    """
    who = who or {}
    call_id = text(row.get("call_id"), 60)
    state = text(who.get("state")) or "unresolved"
    named = state == "sole"
    return {
        "call": {
            "call_id": call_id,
            "call_at": instant(row.get("event_timestamp")),
            "line": e164(row.get("team_member_s")),
            "direction": text(row.get("direction"), 12).lower() or "unknown",
            "duration_sec": number(row.get("duration_sec")),
            "turns": number(row.get("turns")),
            "person_key": key(text(who.get("name"))) if named else "",
            "name": text(who.get("name"), 120) if named else "",
            "name_from": "phone" if named else "",
            "name_why": text(who.get("why"), 300),
            "who_state": state,
            "read_state": "unreadable",
            "read_at": at,
            "model_via": text(why, 60),
            "items": "",
            "prior_lane": prior_lane(row),
            "seal_id": call_id,
        },
        "items": [],
        "sealed": words_of(row),
        "coerced": 0,
        "invented": 0,
    }


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
