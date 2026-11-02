"""The comms obligations sweep on Python (CommRecord.gs commRecordSweep_, with what it reads of CommIntent.gs, the
policy of CommPolicy.gs, the consent order of CommConsent.gs, the window of CommCortex.gs and the translation of
CommDispatch.gs): who owes what, read off the requirement states where they live, one thread per person, judged by the
policy's floors and the words book's settings. The look (commRecordPlan) is a read and plans each thread with what it
needs; app/comm_record_writes.py writes the threads down and asks through the one send door under the write lock. The
sweep's pace and resume point, Apps Script's Script Properties, live in app.comm_record_state (db/comm_record.sql)."""
from __future__ import annotations

import functools
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable

import compliance_engine as CE
import gsjs
import hubdb
import locations as L
import mail_designs as MD
import opt_outs as OO
import resource_rows as RR
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import staff as SP
from gsjs import NY, SheetDate, name_key
from scope import Defer

APP_ID = "comm-record"
DENIED = {"status": 403, "message": "This is the relay's own door."}
STATE = "app.comm_record_state"

# CommRecord.gs: the service sweep's pace, its resume point, the houses it writes
SWEEP_KEY = "comm_record_last_run"
SWEEP_GAP_S = 6 * 3600
CURSOR_KEY = "comm_record_cursor"
INTENTS_HOUSE = "comm_intents"
BINDINGS_HOUSE = "comm_bindings"
ATTEMPTS_HOUSE = "comm_attempts"
OBSERVATIONS_HOUSE = "comm_observations"
ATTEMPTS_HEADER = ("id", "createdAt", "intent_key", "person_key", "attempt", "channel", "to_masked", "receipt", "error",
                   "redirected", "doubt", "test_mode", "at", "words_sha", "situation", "sender_used", "words_known")
OBSERVATIONS_HEADER = SCO.OBSERVATION_HEADER
OBSERVATION_TYPES = ("sent", "redirected", "doubt", "held", "escalated", "unanswered", "replied", "unmatched",
                     "correlated", "contribution", "needs_human", "settled", "dismissed", "stopped", "consent_changed")
OBSERVATION_PAYLOAD_MAX = SCO.OBSERVATION_PAYLOAD_MAX
RETIRE_BATCH = 8
ROSTER_ACTIVE = ("yes", "admin")
WINDOW_WHY = "inside the six-hour window, or the dial is off"
DIAL_OFF = "the dial is off — nothing was planned and nothing was written"
MATRIX_EMPTY = "the obligations matrix answered nothing"
OPT_OUT_SCOPE = OO.scope_of_file("CommRecord.gs")

# CommIntent.gs
PURPOSE = "compliance.owed"
OPEN_STATES = ("missing", "expiring", "expired")
BINDINGS_PER_INTENT = 6
SAME_EVIDENCE = (("nurse_aide", "offender", "sex_offender"),)
KEPT_STATES = ("asking", "answered", "stopped")

# CommPolicy.gs COMM_POLICY_FLOOR, COMM_PRIORITY_ORDER, COMM_PRIORITIES, COMM_PRIORITY_FLOOR
POLICY_FLOOR: dict[str, Any] = {"quiet_from": 21, "quiet_to": 8, "min_gap_hours": 72, "max_attempts": 3,
                                "weekend_ok": False, "escalate_after": 2, "gap_overdue_hours": 36,
                                "gap_soon_hours": 72, "gap_open_hours": 168, "test_gap_hours": 24}
PRIORITY_ORDER = ("safety", "repair", "ask", "notice")
PRIORITIES: dict[str, dict[str, Any]] = {
    "safety": {"name": "safety", "skip_gap": True, "skip_quiet": True, "skip_weekend": True, "cap": "none",
               "droppable": False, "why": "somebody could be hurt"},
    "repair": {"name": "repair", "skip_gap": True, "skip_quiet": False, "skip_weekend": True, "cap": 1,
               "droppable": False, "why": "we owe them a word"},
    "ask": {"name": "ask", "skip_gap": False, "skip_quiet": False, "skip_weekend": False, "cap": "book",
            "droppable": False, "why": "they owe us something"},
    "notice": {"name": "notice", "skip_gap": False, "skip_quiet": False, "skip_weekend": False, "cap": "book",
               "droppable": True, "why": "worth knowing, never urgent"}}
PRIORITY_FLOOR = {"safety": "", "repair": "correction.owed,correction_notice", "notice": "call_off_acknowledged"}

# CommDispatch.gs COMM_SITUATION_FLOOR; CommConsent.gs; CommCortex.gs
SITUATION_FLOOR = {PURPOSE: "compliance_bundle"}
CONSENT_TAB = "entity_comm_consent"
EMPLOYMENT_PURPOSES = ("compliance.owed", "shift", "roster", "safety")
CONSENT_GRANTED = ("granted", "opt_in", "opted_in", "yes")
CONSENT_REFUSED = ("revoked", "withdrawn", "opt_out", "opted_out", "no")
REACH_TAB = "comm_reach"

# String(Date) in the Apps Script runtime names New York's zone in its own words (the bindings it wrote carry them)
RUNTIME_ZONE = {True: "Nordamerikanische Ostküsten-Sommerzeit", False: "Nordamerikanische Ostküsten-Normalzeit"}

s_ = gsjs.str_
_SPLIT_WS = re.compile(r"[" + L._JS_WS + r"]+")
_INDEX_KEY = re.compile(r"^(0|[1-9][0-9]{0,9})$")
_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$|^(\d{1,2})/(\d{1,2})/(\d{4})$")


# ---- JavaScript, where the sweep leans on it ---------------------------------------------------------------------

def num(v: Any) -> float:
    """Number(v) for what a cell or the wire hands over; NaN when it is not one."""
    if v is None:
        return 0.0
    if isinstance(v, SheetDate):
        return v.at.timestamp() * 1000.0
    return SCD.js_number(v)


def num_or0(v: Any) -> int | float:
    """Number(v) || 0, a whole number kept whole (JSON.stringify writes 2, never 2.0)."""
    n = num(v)
    if math.isnan(n) or n == 0:
        return 0
    return int(n) if math.isfinite(n) and n == int(n) else n


def text(v: Any) -> str:
    """String(v || '')."""
    return gsjs.or_text(v)


def ms(v: Any) -> float:
    """new Date(String(v)).getTime(): a Date cell's instant, the text's; 0 for NaN."""
    if isinstance(v, SheetDate):
        return v.at.timestamp() * 1000.0
    t = gsjs.date_parse(v)
    if t is None:
        got = gsjs.parse_when(gsjs.or_blank(v), None) if gsjs._JS_DATE_TEXT.match(gsjs.or_blank(v)) else None
        t = got.timestamp() * 1000.0 if got is not None else None
    return 0.0 if t is None else t


def js_keys(d: dict) -> list[str]:
    """Object.keys order: the array-index keys first, ascending, then the rest as they were added."""
    idx = sorted((k for k in d if _INDEX_KEY.match(k) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def js_max(a: float, b: float) -> float:
    return math.nan if math.isnan(a) or math.isnan(b) else max(a, b)


def js_min(a: float, b: float) -> float:
    return math.nan if math.isnan(a) or math.isnan(b) else min(a, b)


def wire(x: float) -> float | str:
    """A number as it crosses to the keep: NaN and the infinities as the text Number() reads back."""
    return x if math.isfinite(x) else gsjs.num_str(x)


def n_(v: Any) -> str:
    """String(number)."""
    return gsjs.num_str(v) if isinstance(v, (int, float)) else gsjs.or_blank(v)


def date_text(at: datetime) -> str:
    """String(Date) as the Apps Script runtime writes it: New York's clock, the zone in the runtime's words."""
    local = at.astimezone(NY)
    return local.strftime("%a %b %d %Y %H:%M:%S GMT%z") + " (" + RUNTIME_ZONE[bool(local.dst())] + ")"


def expiry_text(v: Any) -> str:
    """String(getValues()) of a requirement state's expiry: the states book holds a day as a Date at its own midnight
    (UTC), so a day reads as that instant on New York's clock; any other cell as its text."""
    if isinstance(v, SheetDate):
        w = v.at.astimezone(NY)
        parts = (w.year, w.month, w.day, w.hour, w.minute, w.second)
    else:
        t = gsjs.trim(gsjs.or_blank(v))
        m = _DAY.match(t)
        if not m:
            return t
        parts = ((int(m.group(1)), int(m.group(2)), int(m.group(3))) if m.group(1)
                 else (int(m.group(6)), int(m.group(4)), int(m.group(5))))
    try:
        return date_text(datetime(*parts, tzinfo=timezone.utc))
    except ValueError:
        return gsjs.trim(gsjs.or_blank(v))


def record_id(key: str) -> str:
    """commRecordId_."""
    return SCO.record_id(key)


def reply_token(intent_key: Any) -> str:
    """commReplyToken_: the proof a reply can quote."""
    return "CI-" + re.sub(r"[^A-Z0-9]", "", record_id(gsjs.or_text(intent_key)))[:6]


# ---- who owes what (CommIntent.gs) -------------------------------------------------------------------------------

def intent_key(person_key: Any, purpose: Any) -> str:
    """commIntentKey_: who and why only."""
    return gsjs.trim(text(person_key)).lower() + "|" + gsjs.trim(text(purpose)).lower()


def urgency(state: Any) -> int:
    """commUrgency_."""
    return {"expired": 0, "expiring": 1, "missing": 2}.get(text(state), 9)


def _binding_cmp(x: dict, y: dict) -> int:
    """commBindingSort_."""
    d = urgency(x.get("state")) - urgency(y.get("state"))
    if d:
        return d
    xd = 99999 if x.get("days_left") is None else x["days_left"]
    yd = 99999 if y.get("days_left") is None else y["days_left"]
    if xd != yd:
        return -1 if xd < yd else 1
    xr, yr = x.get("req_id") or "", y.get("req_id") or ""
    return -1 if xr < yr else (1 if xr > yr else 0)


BINDING_ORDER = functools.cmp_to_key(_binding_cmp)


def fold_evidence(bindings: list[dict]) -> list[dict]:
    """commFoldEvidence_: one check recorded in several columns travels as one binding while every date agrees."""
    out: list[dict] = []
    taken: set[str] = set()
    for group in SAME_EVIDENCE:
        members = [b for b in bindings if text(b.get("req_id")) in group]
        if len(members) < 2:
            continue
        first = text(members[0].get("expires"))
        if not all(text(b.get("expires")) == first for b in members):
            continue
        ordered = sorted(members, key=BINDING_ORDER)
        lead = dict(ordered[0])
        lead["also"] = [text(b.get("req_id")) for b in ordered[1:]]
        lead["settles"] = [text(b.get("demand_id")) for b in ordered]
        out.append(lead)
        taken.update(text(b.get("demand_id")) for b in members)
    out += [b for b in bindings if text(b.get("demand_id")) not in taken]
    return out


def bindings_for(rows: list[dict]) -> list[dict]:
    """commBindingsFor_: the open rows as bindings, folded, then the most urgent first."""
    got = []
    for r in rows or ():
        if text(r.get("state")) not in OPEN_STATES:
            continue
        got.append({"demand_id": text(r.get("person_key")) + "|" + text(r.get("req_id")),
                    "req_id": text(r.get("req_id")), "state": text(r.get("state")), "expires": text(r.get("expires")),
                    "days_left": SCD.js_parse_int(text(r.get("days_left"))), "binding_state": "open"})
    return sorted(fold_evidence(got), key=BINDING_ORDER)


def intent_for(person_key: Any, person_name: Any, rows: list[dict], roster: dict | None, now_iso: str) -> dict | None:
    """commIntentFor_: the roster asked first, at most COMM_BINDINGS_PER_INTENT carried, the rest deferred."""
    who = gsjs.trim(text(person_key)).lower()
    if not who or (roster is not None and not roster.get(who)):
        return None
    every = bindings_for(rows)
    if not every:
        return None
    carried = every[:BINDINGS_PER_INTENT]
    return {"intent_key": intent_key(who, PURPOSE), "person_key": who, "person_name": text(person_name),
            "purpose": PURPOSE, "state": "planned", "bindings": carried,
            "demand_ids": [b["demand_id"] for b in carried], "deferred": len(every) - len(carried),
            "worst": carried[0]["state"] if carried else "", "created_at": now_iso}


def intents_from(by_person: dict[str, dict], roster: dict | None, now_iso: str) -> dict[str, Any]:
    """commIntentsFrom_: one intent per person with something open; who was skipped, and why."""
    intents: list[dict] = []
    skipped = {"off_roster": 0, "nothing_open": 0}
    for key in js_keys(by_person):
        group = by_person.get(key) or {}
        who = gsjs.trim(key).lower()
        if roster is not None and not roster.get(who):
            skipped["off_roster"] += 1
            continue
        got = intent_for(who, group.get("name"), group.get("rows") or [], roster, now_iso)
        if got is None:
            skipped["nothing_open"] += 1
            continue
        intents.append(got)
    intents.sort(key=lambda i: (urgency(i["worst"]), -len(i["bindings"])))
    return {"intents": intents, "skipped": skipped}


# ---- the policy (CommPolicy.gs) ----------------------------------------------------------------------------------

def policy(reads: L.Reads, key: str) -> Any:
    """commPolicy_: the words book's comm_<key>, the floor behind it."""
    floor = POLICY_FLOOR[key]
    try:
        if isinstance(floor, bool):
            return gsjs.trim(SCD.digest_word(reads, "comm_" + key, "yes" if floor else "no")).lower() == "yes"
        return SCD.digest_setting(reads, "comm_" + key, floor, 0, 9999)
    except Exception:  # noqa: BLE001 - the floor is the answer
        return floor


def priority_ids(reads: L.Reads, priority: str) -> list[str]:
    """commPriorityIds_: the book's comm_priority_<priority> list, the floor behind it."""
    floor = PRIORITY_FLOOR.get(priority)
    if floor is None:
        return []
    try:
        raw = SCD.digest_word(reads, "comm_priority_" + priority, floor)
    except Exception:  # noqa: BLE001 - the floor is the answer
        raw = floor
    return [x for x in (gsjs.trim(p).lower() for p in re.split(r"[,;\n]", gsjs.or_text(raw))) if x]


def priority_for(reads: L.Reads, pid: Any) -> str:
    """commPriorityFor_: walked in ladder order, so an id listed twice gets the higher priority."""
    want = gsjs.trim(text(pid)).lower()
    if not want:
        return "ask"
    for p in PRIORITY_ORDER:
        if p != "ask" and want in priority_ids(reads, p):
            return p
    return "ask"


def priority_rule(priority: Any) -> dict[str, Any]:
    """commPriorityRule_."""
    return PRIORITIES.get(text(priority)) or PRIORITIES["ask"]


def priority_of(reads: L.Reads, intent: dict | None) -> dict[str, str]:
    """commPriorityOf_ for a plan that declares only its purpose."""
    ids = [intent["purpose"]] if intent and intent.get("purpose") else []
    for pid in ids:
        word = priority_for(reads, pid)
        if word != "ask":
            said = gsjs.trim(text(pid)).lower()
            return {"priority": word, "id": said,
                    "why": f"{word} ({priority_rule(word)['why']}) — declared for `{said}`"}
    first = gsjs.trim(text(ids[0])).lower() if ids else ""
    return {"priority": "ask", "id": first,
            "why": f"ask ({PRIORITIES['ask']['why']}) — nothing above it is declared for this"
                   + (f" (`{first}`)" if ids else "")}


def attempt_cap(reads: L.Reads, priority: str) -> float:
    """commAttemptCapFor_: 0 means no cap at all."""
    rule = priority_rule(priority)
    if rule["cap"] == "none":
        return 0
    if isinstance(rule["cap"], int):
        return rule["cap"]
    return num(policy(reads, "max_attempts"))


def window_verdict(reads: L.Reads, local_hour: Any, local_day: Any, quiet: dict | None,
                   priority: str) -> dict[str, Any]:
    """commWindowVerdict_: is this a moment we may speak?"""
    rule = priority_rule(priority)
    if local_hour in ("", None):
        return {"ok": True, "why": "no local clock for this person — the platform default stands"}
    h = num(local_hour)
    if math.isnan(h):
        return {"ok": True, "why": "no local clock for this person — the platform default stands"}
    frm = num(quiet["from"] if quiet and "from" in quiet else policy(reads, "quiet_from"))
    to = num(quiet["to"] if quiet and "to" in quiet else policy(reads, "quiet_to"))
    in_quiet = (h >= frm or h < to) if frm > to else (frm <= h < to)
    if in_quiet:
        if rule["skip_quiet"]:
            return {"ok": True, "skipped": "quiet hours",
                    "why": f"{n_(h)}:00 local and sent anyway — priority {rule['name']} is the only one that may "
                           "wake somebody"}
        return {"ok": False, "defer": True,
                "why": f"quiet hours for this person ({n_(h)}:00 local"
                       + ("; " + text(quiet.get("why")) if quiet and quiet.get("why") else "") + ")"}
    day = math.nan if local_day in ("", None) else num(local_day)
    if not policy(reads, "weekend_ok") and day in (0, 6):
        if rule["skip_weekend"]:
            return {"ok": True, "skipped": "the weekend",
                    "why": f"a weekend, and priority {rule['name']} is not held by it — it asks for nothing"}
        return {"ok": False, "defer": True, "why": "a weekend, and compliance is not urgent enough to cost one"}
    return {"ok": True, "why": "inside the window"}


def gap_for(reads: L.Reads, band: Any) -> float:
    """commGapFor_: how long to wait before asking again, given what the message was about."""
    key = {"overdue": "gap_overdue_hours", "soon": "gap_soon_hours", "open": "gap_open_hours"}.get(text(band))
    return num(policy(reads, key or "min_gap_hours"))


def gap_verdict(reads: L.Reads, last_ms: float, now_ms: float, band: Any, priority: str) -> dict[str, Any]:
    """commGapVerdict_: has this already been asked recently enough?"""
    rule = priority_rule(priority)
    if rule["skip_gap"]:
        return {"ok": True, "skipped": "the gap",
                "why": f"not paced — priority {rule['name']} is not another ask, and the gap counts asks"}
    if not last_ms:
        return {"ok": True, "why": "never asked"}
    hours = (now_ms - last_ms) / 3600000.0
    gap = gap_for(reads, band)
    if hours < gap:
        return {"ok": False, "defer": True,
                "why": f"asked {n_(gsjs.js_round(hours))}h ago; the floor is {n_(gap)}h"}
    return {"ok": True, "why": f"{n_(gsjs.js_round(hours))}h since the last ask"}


def test_gap_verdict(reads: L.Reads, last_ms: float, now_ms: float, priority: str) -> dict[str, Any]:
    """commTestGapVerdict_: the test-mode pace, 0 switches it off."""
    rule = priority_rule(priority)
    if rule["skip_gap"]:
        return {"ok": True, "skipped": "the test pace",
                "why": f"not paced — priority {rule['name']} is not another ask (test pace)"}
    gap = num(policy(reads, "test_gap_hours"))
    if not gap > 0:
        return {"ok": True, "why": "test mode, no pace"}
    if not last_ms:
        return {"ok": True, "why": "never asked"}
    hours = (now_ms - last_ms) / 3600000.0
    if hours < gap:
        return {"ok": False, "defer": True,
                "why": f"asked {n_(gsjs.js_round(hours))}h ago; the test pace is {n_(gap)}h"}
    return {"ok": True, "why": f"{n_(gsjs.js_round(hours))}h since the last ask (test pace {n_(gap)}h)"}


def attempt_verdict(reads: L.Reads, attempts: Any, priority: str) -> dict[str, Any]:
    """commAttemptVerdict_: is there any point asking again?"""
    n = num_or0(attempts)
    rule = priority_rule(priority)
    cap = attempt_cap(reads, priority)
    after = num(policy(reads, "escalate_after"))
    numbered = isinstance(rule["cap"], int)
    if cap == 0:
        return {"ok": True, "escalate": n >= after,
                "why": f"attempt {n_(n + 1)}, uncapped — priority {rule['name']} is tried until it is delivered or "
                       "a person takes it"}
    if n >= cap:
        return {"ok": False, "defer": False, "escalate": True,
                "why": (f"priority {rule['name']} is said once per person and this one is spent — it is a person's "
                        "job now, and never a retry") if numbered
                else f"{n_(n)} attempts with no answer — this is a person's job now, not a reminder's"}
    return {"ok": True, "escalate": n >= after,
            "why": f"attempt {n_(n + 1)} of {n_(cap)}" + (f" (priority {rule['name']})" if numbered else "")}


def urgency_band(b: dict | None) -> str:
    """commUrgencyBand_: the three bands a message can honestly speak in."""
    state = text((b or {}).get("state"))
    return "overdue" if state == "expired" else "soon" if state == "expiring" else "open"


def consolidate(bindings: list[dict] | None) -> list[dict]:
    """commConsolidate_: the bindings grouped by band, the most urgent band first."""
    groups: dict[str, list[dict]] = {}
    for b in bindings or ():
        groups.setdefault(urgency_band(b), []).append(b)
    return [{"band": band, "bindings": groups[band]} for band in ("overdue", "soon", "open") if groups.get(band)]


def plan_verdict(reads: L.Reads, intent: dict, ctx: dict[str, Any], dial: str) -> dict[str, Any]:
    """commPlanVerdict_: the whole verdict for one intent, with every reason it reached; what the policy decided kept
    apart from whether the dial lets it act."""
    reasons: list[str] = []
    skipped: list[str] = []
    test = bool(ctx.get("test"))
    verdict: dict[str, Any] = {"send": True, "defer": False, "escalate": False, "test": test}
    soft = " — not enforced in test mode"
    pri = priority_of(reads, intent)
    verdict.update(priority=pri["priority"], priority_id=pri["id"],
                   droppable=bool(priority_rule(pri["priority"])["droppable"]))
    reasons.append("priority: " + pri["why"])
    verdict["parts"] = consolidate(intent.get("bindings"))
    att = attempt_verdict(reads, ctx.get("attempts"), verdict["priority"])
    if att["escalate"]:
        verdict["escalate"] = True
    if not att["ok"] and test:
        reasons.append("attempts: " + att["why"] + soft)
    else:
        reasons.append("attempts: " + att["why"])
        if not att["ok"]:
            verdict["send"], verdict["defer"] = False, bool(att.get("defer"))
    if verdict["send"]:
        lead = verdict["parts"][0]["band"] if verdict["parts"] else ""
        gap = (test_gap_verdict(reads, ctx.get("last_ms") or 0, ctx["now_ms"], verdict["priority"]) if test
               else gap_verdict(reads, ctx.get("last_ms") or 0, ctx["now_ms"], lead, verdict["priority"]))
        reasons.append("gap: " + gap["why"])
        if gap.get("skipped"):
            skipped.append(gap["skipped"])
        if not gap["ok"]:
            verdict["send"], verdict["defer"] = False, True
    if verdict["send"]:
        win = window_verdict(reads, ctx.get("local_hour"), ctx.get("local_day"), ctx.get("quiet"), verdict["priority"])
        if not win["ok"] and test:
            reasons.append("window: " + win["why"] + soft)
        else:
            reasons.append("window: " + win["why"])
            if win.get("skipped"):
                skipped.append(win["skipped"])
            if not win["ok"]:
                verdict["send"], verdict["defer"] = False, True
    verdict["skipped"] = skipped
    if skipped:
        reasons.append("skipped: " + ", ".join(skipped) + " — priority " + verdict["priority"] + " allows it")
    verdict["reasons"] = reasons
    verdict["dial"] = dial
    verdict["policy"] = "would send" if verdict["send"] else ("held" if verdict["defer"] else "blocked")
    if dial != "send":
        verdict["send"] = False
        reasons.append("dial: " + dial + " — worked out, not handed over")
    return verdict


def dial_state(reads: L.Reads) -> dict[str, Any]:
    """commDial_ and commTestMode_ off one reading of the switch: record while test mode is on, send while it is off;
    off, and held as test mode, when it cannot be read."""
    try:
        st = SCD.test_mode_state(reads.config())
    except Exception:  # noqa: BLE001 - an unread switch is off
        return {"dial": "off", "test": True}
    if st["unrecognized"]:
        return {"dial": "off", "test": True}
    return {"dial": "record", "test": True} if st["on"] else {"dial": "send", "test": False}


# ---- the route: consent per channel (CommConsent.gs) and the hours (CommCortex.gs) --------------------------------

def consent_row_verdict(row: dict | None, now_ms: float) -> str:
    """commConsentRowVerdict_."""
    if not row:
        return "unknown"
    status = gsjs.trim(text(row.get("status"))).lower()
    if status in CONSENT_REFUSED:
        return "refused"
    if status not in CONSENT_GRANTED:
        return "unknown"
    if gsjs.trim(text(row.get("expires_at"))):
        until = ms(row.get("expires_at"))
        if until and until < now_ms:
            return "unknown"
    if gsjs.trim(text(row.get("effective_at"))):
        start = ms(row.get("effective_at"))
        if start and start > now_ms:
            return "unknown"
    return "granted"


def consent_verdict(reads: L.Reads, rows: list[dict], refused: dict, channel: str, purpose: str,
                    now_ms: float) -> dict[str, Any]:
    """commConsentVerdict_: a refusal wins; a grant permits only its own purpose; silence is the comm_silence rule."""
    ch = gsjs.trim(text(channel)).lower()
    why = gsjs.trim(text(purpose)).lower()
    if refused and (refused.get("all") or refused.get(ch)):
        return {"ok": False, "hard": True,
                "why": "this person asked us to stop" + ("" if refused.get("all") else " on " + ch)}
    live = [r for r in rows or () if gsjs.trim(text(r.get("channel_type"))).lower() == ch
            and consent_row_verdict(r, now_ms) == "granted"]
    if any(not p or p == why for p in (gsjs.trim(text(r.get("purpose"))).lower() for r in live)):
        return {"ok": True, "why": "granted for " + ch + (" · " + why if why else "")}
    others: list[str] = []
    for r in live:
        p = gsjs.trim(text(r.get("purpose"))).lower()
        if p and p not in others:
            others.append(p)
    seen = f" (granted for {', '.join(others)}, not for this)" if others else ""
    try:
        rule = text(SCD.digest_word(reads, "comm_silence", "employment")) or "employment"
    except Exception:  # noqa: BLE001 - the floor is the rule
        rule = "employment"
    rule = gsjs.trim(rule).lower()
    if rule == "allow":
        return {"ok": True, "why": "no record for this purpose" + seen + ", and the words book allows silence"}
    if rule == "employment" and why in EMPLOYMENT_PURPOSES:
        return {"ok": True, "why": "no consent record for this purpose" + seen + "; permitted because " + why
                                   + " is the employment relationship's own purpose, not marketing"}
    return {"ok": False, "hard": False,
            "why": "no consent record for " + ch + (" · " + why if why else "") + seen + " — silence is not permission"}


def route_for(reads: L.Reads, rows: list[dict], refused: dict, purpose: str, channels: list[str],
              now_ms: float) -> dict[str, Any]:
    """commRouteFor_: the first channel consent permits, every channel tried said."""
    tried: list[str] = []
    for ch in channels or ["sms", "email", "voice"]:
        v = consent_verdict(reads, rows, refused, ch, purpose, now_ms)
        tried.append(ch + ": " + v["why"])
        if v["ok"]:
            return {"channel": ch, "ok": True, "why": v["why"], "tried": tried}
    return {"channel": "", "ok": False, "why": "no permitted route", "tried": tried}


def refused_of(reads: L.Reads, person: dict | None) -> dict[str, bool]:
    """commRecordRefused_: what the opt-out list says about this person, per channel; an unread list refuses."""
    out = {"sms": False, "email": False}
    if not person:
        return out
    for ch, target in (("sms", person.get("phone")), ("email", person.get("email"))):
        try:
            if target and OO.opt_out_blocked(reads, target, OPT_OUT_SCOPE):
                out[ch] = True
        except Exception:  # noqa: BLE001 - a list that cannot be asked refuses
            out[ch] = True
    return out


def reach_ms(v: Any) -> float:
    """commReachMs_: an instant off the wire or off a cell, or 0."""
    if v is None or v == "":
        return 0
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return math.floor(v) if math.isfinite(v) and v > 0 else 0
    t = s_(v)
    if not t:
        return 0
    if re.fullmatch(r"\d{10,16}", t):
        return math.floor(float(t))
    return ms(v)


def reach_hold_ms(reach: dict | None, now_ms: float) -> float:
    """commReachHoldMs_: is this person held, and until when."""
    if not reach:
        return 0
    hold = reach_ms(reach.get("hold_until_ms")) or reach_ms(reach.get("hold_until"))
    return hold if hold and hold > now_ms else 0


def cortex_window(reach_rows: dict[str, dict], route: dict | None, floor_from: Any, floor_to: Any,
                  now_ms: float) -> dict[str, Any]:
    """commCortexWindowFrom_ as the sweep calls it: the platform's quiet hours, narrowed by the cortex's shifts, held
    whole while the reach house holds the person. The pass it would carry beside the pair is read by no verdict here,
    so it is not drawn."""
    quiet_from, quiet_to = num(floor_from), num(floor_to)
    who = gsjs.trim(text((route or {}).get("person_key"))).lower() if route else ""
    reach = reach_rows.get(who) if who else None
    hold = reach_hold_ms(reach, now_ms)
    if hold:
        at = datetime.fromtimestamp(hold / 1000.0, tz=timezone.utc).astimezone(NY).strftime("%a %H:%M")
        return {"from": 0, "to": 24, "hold_until_ms": hold,
                "why": f"they are not at work today, held until {at} — "
                       + (s_(reach.get("why")) or "a call-off the platform already holds")}
    if not route:
        return {"from": wire(quiet_from), "to": wire(quiet_to), "why": "the platform default"}
    frm, to = text(route.get("window_from")), text(route.get("window_to"))
    if frm == "" or to == "":
        return {"from": wire(quiet_from), "to": wire(quiet_to),
                "why": "the cortex holds no shift for them — the default stands"}
    return {"from": wire(js_min(quiet_from, num(to))), "to": wire(js_max(quiet_to, num(frm))),
            "why": "narrowed by their own shifts: " + text(route.get("window_why"))}


def contact(people: dict[str, dict], routes: dict[str, dict], person_key: Any) -> dict[str, str] | None:
    """commRecordContact_: the People house first, the cortex's proposal when the house is silent."""
    k = gsjs.trim(text(person_key)).lower()
    p, r = people.get(k), routes.get(k)
    if not p and not r:
        return None
    return {"name": text((p or {}).get("name")) or text((r or {}).get("name")),
            "phone": s_((p or {}).get("phone")) or s_((r or {}).get("phone")),
            "email": s_((p or {}).get("email")) or s_((r or {}).get("email"))}


# ---- the translation for the send door (CommDispatch.gs) ---------------------------------------------------------

def situation_for(reads: L.Reads, purpose: str) -> dict | None:
    """commSituationFor_: the bound situation (the words book's Smart Comms tab, the floor behind it), while it is on;
    absent or off is None, and None sends nothing."""
    try:
        sid = gsjs.or_blank(MD.bindings(reads).get(purpose))
    except Exception:  # noqa: BLE001 - the floor names it
        sid = ""
    sid = sid or SITUATION_FLOOR.get(purpose, "")
    if not sid:
        return None
    try:
        sit = SC.situation_row(SC.read_situations(reads.db), sid)
    except Exception:  # noqa: BLE001 - an unread house says nothing
        return None
    return sit if sit is not None and SC.smart_on(sit.get("enabled")) else None


def channels_of(situation: dict) -> list[str]:
    """commRecordChannels_: the channels a situation lists, in its order; sms then email when silent."""
    got = [x for x in (gsjs.trim(c).lower() for c in SC.smart_list(situation.get("channels"))) if x]
    return got or ["sms", "email"]


def dispatch_item(intent: dict, person: dict | None, situation: dict | None) -> dict | None:
    """commDispatchItem_: the open bindings, the earliest date, the ledger's key."""
    if not intent or not situation:
        return None
    bindings = [b for b in intent.get("bindings") or () if (text(b.get("binding_state")) or "open") == "open"]
    if not bindings:
        return None
    soonest, left = "", None
    for b in bindings:
        d = None if b.get("days_left") is None else num(b["days_left"])
        if d is not None and (left is None or d < left):
            left, soonest = d, text(b.get("expires"))
        if left is None and not soonest and b.get("expires"):
            soonest = gsjs.or_blank(b["expires"])
    return {"situation": text(situation.get("id")), "key": "CI|" + text(intent.get("intent_key")),
            "name": text(intent.get("person_name")), "name_key": text(intent.get("person_key")),
            "phone": text((person or {}).get("phone")), "email": text((person or {}).get("email")),
            "credential": text(situation.get("credential")), "expires": soonest,
            "days_left": "" if left is None else (int(left) if left == int(left) else left),
            "intent_key": text(intent.get("intent_key")), "bindings": [text(b.get("demand_id")) for b in bindings],
            "binding_count": len(bindings), "raw_bindings": bindings}


def dispatch_summary(bindings: list[dict], label_for: Callable[[str], str]) -> str:
    """commDispatchSummary_."""
    names = []
    for b in bindings or ():
        rid = text(b.get("req_id")) or text(b.get("demand_id"))
        label = text(label_for(rid)) if label_for else ""
        if label or rid:
            names.append(label or rid)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return names[0] + " and " + names[1]
    return ", ".join(names[:2]) + f" and {len(names) - 2} more"


def dispatch_vars(reads: L.Reads, item: dict, situation: dict, label_for: Callable[[str], str]) -> dict[str, str]:
    """commDispatchBaseVars_. commDispatchVars_ joins a correction the repair lane owes as the message's lead; that lane
    is Apps Script's (its owed count and claims live there), so no lead is joined here and the debt stays in
    comm_repairs, as commDispatchVars_ leaves it when the lead cannot be joined."""
    name = text(item.get("name"))
    bindings = item.get("raw_bindings") or []
    days = item.get("days_left")
    return {"first_name": _SPLIT_WS.split(name)[0] if name else "", "name": name, "expires": text(item.get("expires")),
            "days_left": "" if days == "" else n_(days),
            "credential": dispatch_summary(bindings, label_for) or SK.credential_label(reads, situation or {}),
            "items": str(len(bindings)), "sender": text(situation.get("sender")) or SC.SENDER_DEFAULT,
            "correction": text(item.get("correction")), "status_at": text(item.get("status_at")),
            "token": reply_token(item.get("intent_key"))}


def dispatch_allowed(intent: dict, verdict: dict, consent: dict | None, dial: str) -> dict[str, Any]:
    """commDispatchAllowed_: every gate asked, so a refusal names all its reasons."""
    if not intent:
        return {"ok": False, "why": "no intent", "blocked": ["no intent"]}
    blocked = []
    if dial != "send":
        blocked.append("the dial says " + dial + " — nothing is handed over")
    if not verdict or not verdict.get("send"):
        blocked.append("the policy did not clear it: " + " · ".join((verdict or {}).get("reasons") or []))
    if not consent or not consent.get("ok"):
        blocked.append("no permitted route: " + (text((consent or {}).get("why")) or "unknown"))
    open_ = [b for b in intent.get("bindings") or () if (text(b.get("binding_state")) or "open") == "open"]
    if not open_:
        blocked.append("every obligation in this intent is already settled")
    if blocked:
        return {"ok": False, "why": " · ".join(blocked), "blocked": blocked}
    return {"ok": True, "why": f"cleared: {len(open_)} open via {consent['channel']}", "blocked": []}


def is_doubt(error: Any) -> bool:
    """commRecordIsDoubt_: which transport answers mean "we do not know" rather than "no"."""
    e = text(error).lower()
    if not e:
        return False
    if e in ("transport", "threw", "provider_bad_shape") or re.fullmatch(r"provider_5\d\d", e):
        return True
    if re.fullmatch(r"provider_4\d\d", e):
        return False
    return e not in ("opted_out", "missing_param", "no_provider_key", "no_sending_line", "undeclared_method",
                     "test_redirect_no_sms", "test_redirect_no_email")


# ---- the rows (CommRecord.gs) ------------------------------------------------------------------------------------

def record_rows(intent: dict, verdict: dict, now_iso: str, prior: dict | None) -> dict[str, Any] | None:
    """commRecordRows_: one intent as the two rows it becomes; the state and the pacing memory ride forward."""
    prior = prior or {}
    if not intent:
        return None
    key = text(intent.get("intent_key"))
    reasons = verdict.get("reasons") or []
    bindings = intent.get("bindings") or []
    was = text(prior.get("state"))
    head = {
        "id": "CMI_" + record_id(key), "intent_key": key, "purpose": text(intent.get("purpose")),
        "person_key": text(intent.get("person_key")), "person_name": text(intent.get("person_name")),
        "state": was if was in KEPT_STATES else (text(intent.get("state")) or "planned"),
        "open_count": sum(1 for b in bindings if (text(b.get("binding_state")) or "open") == "open"),
        "worst": text(intent.get("worst")), "dial": text(verdict.get("dial")) or "off",
        "verdict": text(verdict.get("policy")) or "unplanned", "reasons": " · ".join(reasons),
        "channel": text(verdict.get("channel")), "route_tried": " · ".join(verdict.get("route_tried") or []),
        "carried": len(bindings), "deferred": num_or0(intent.get("deferred")), "planned_at": now_iso,
        "last_asked_at": text(prior.get("last_asked_at")), "attempts": num_or0(prior.get("attempts")),
        "test_attempts": num_or0(prior.get("test_attempts")),
        "test_last_asked_at": text(prior.get("test_last_asked_at")),
        "test_mode": "yes" if verdict.get("test") else "no", "escalate": "yes" if verdict.get("escalate") else "no",
        "escalate_why": (next((r for r in reasons if r.startswith("attempts:")), "") or "attempt budget")
        if verdict.get("escalate") else "",
        "escalate_to": text(verdict.get("supervisor")),
        "escalate_to_confidence": text(verdict.get("supervisor_confidence")),
        "reply_token": reply_token(key), "tenant": ""}
    bands: dict[str, str] = {}
    for p in verdict.get("parts") or ():
        for b in p.get("bindings") or ():
            bands[text(b.get("demand_id")) or text(b.get("req_id"))] = p["band"]
    rows = []
    for b in bindings:
        demand = text(b.get("demand_id"))
        rows.append({"id": "CMB_" + record_id(key + "|" + demand), "intent_key": key, "demand_id": demand,
                     "person_key": text(intent.get("person_key")), "req_id": text(b.get("req_id")),
                     "state": text(b.get("state")), "expires": text(b.get("expires")),
                     "days_left": "" if b.get("days_left") is None else n_(b["days_left"]),
                     "band": bands.get(demand or text(b.get("req_id")), ""),
                     "binding_state": text(b.get("binding_state")) or "open",
                     "also": " · ".join(b.get("also") or []), "settles": " · ".join(b.get("settles") or [])})
    return {"intent": head, "bindings": rows}


def memory(was: dict | None, test: bool) -> dict[str, Any]:
    """commRecordMemory_: the pacing memory of one mode, read off a prior row (a row of the test era counts for none
    outside it)."""
    out: dict[str, Any] = {"attempts": 0, "last_ms": 0.0, "last_iso": ""}
    if was is None:
        return out
    if test:
        a, last = was.get("test_attempts"), was.get("test_last_asked_at")
    else:
        if text(was.get("test_mode")) != "no":
            return out
        a, last = was.get("attempts"), was.get("last_asked_at")
    out["attempts"] = num_or0(a)
    out["last_iso"] = text(last)
    out["last_ms"] = ms(last) if out["last_iso"] else 0.0
    return out


def attempt_row(intent: dict, attempt: int, out: dict, test: bool, now_iso: str) -> dict[str, Any]:
    """commAttemptRow_: one attempt as the evidence row it becomes — what we said, never what we wrote."""
    to = text(out.get("to"))
    sha, sit, sender = text(out.get("words_sha")), text(out.get("situation")), text(out.get("sender_used"))
    return {"id": "CMA_" + record_id(f"{text(intent.get('intent_key'))}|{attempt}|{now_iso}"),
            "intent_key": text(intent.get("intent_key")), "person_key": text(intent.get("person_key")),
            "attempt": int(attempt), "channel": text(out.get("channel")), "to_masked": "•••" + to[-4:] if to else "",
            "receipt": text(out.get("receipt")), "error": text(out.get("error")),
            "redirected": "yes" if out.get("redirected") else "no", "doubt": "yes" if out.get("doubt") else "no",
            "test_mode": "yes" if test else "no", "at": now_iso, "words_sha": sha, "situation": sit,
            "sender_used": sender, "words_known": "yes" if (sha or sit or sender) else "no"}


def observation_row(kind: str, intent: dict | None, payload: dict, source: str, actor: str,
                    now_iso: str) -> dict[str, Any]:
    """commObservationRow_: the trail's row, its payload as JSON.stringify writes it, cut at 2000."""
    import smart_comms_writes as SW  # noqa: PLC0415 - its JavaScript slice
    import writes as W  # noqa: PLC0415
    body = W.json_text(payload or {})
    if SCO.utf16_len(body) > OBSERVATION_PAYLOAD_MAX:
        body = SW.js_slice(body, OBSERVATION_PAYLOAD_MAX)
    ik = text((intent or {}).get("intent_key"))
    return {"event_id": "cmo_" + record_id(f"{kind}|{ik}|{now_iso}|{SW.js_slice(body, SCO.OBSERVATION_KEY_BODY)}"),
            "type": kind, "actor": actor or SCO.ACTOR_DEFAULT, "subject_type": "person",
            "subject_key": text((intent or {}).get("person_key")),
            "subject_name": text((intent or {}).get("person_name")) or text((intent or {}).get("name")),
            "intent_key": ik, "payload": body, "source": source or "sweep", "at": now_iso, "tenant": ""}


# ---- what the sweep reads --------------------------------------------------------------------------------------

def matrix(reads: L.Reads) -> list[dict[str, str]]:
    """commRecordMatrix_: the obligations matrix by header name, each cell as String(getValues()).trim(), the rows
    naming a person and a requirement — Postgres's once the Compliance Engine keeps the states, else the tab's copy;
    an expiry as expiry_text reads it."""
    if CE.owned(reads.db):
        grid = CE.states_grid(reads)
        hdr, values = [gsjs.trim(gsjs.js_str(h)) for h in grid["hdr"]], grid["values"]
    else:
        res = reads.db.resolve(CE.STATES_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind requirement_states")
            return []
        hdr = [gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers]
        values = [[raw.get(h) for h in res.ref.headers] for _rn, raw in reads.db.rows(res.ref)]
    at: dict[str, int] = {}
    for i, h in enumerate(hdr):
        if h and h not in at:
            at[h] = i

    def cell(row: list, col: str) -> str:
        if col not in at or at[col] >= len(row):
            return ""
        v = row[at[col]]
        if col == "expires":
            return expiry_text(v)
        if v is None or isinstance(v, str):
            v = hubdb.typed(v, "hub")
        return gsjs.trim(gsjs.or_blank(v))

    cols = ("person_key", "person_name", "req_id", "state", "expires", "days_left")
    out = []
    for row in values:
        r = {c: cell(row, c) for c in cols}
        if r["person_key"] and r["req_id"]:
            out.append(r)
    return out


def roster(reads: L.Reads) -> dict[str, int]:
    """commRecordRoster_: who may be spoken to at all, the Master's active rows by name key."""
    out: dict[str, int] = {}
    for r in SP.cert_read_tab(reads, SP.cert_source_tab(reads, "master")):
        if s_(r.get("status")).lower() not in ROSTER_ACTIVE:
            continue
        k = name_key(s_(r.get("employee")) or (s_(r.get("firstname")) + " " + s_(r.get("lastname"))))
        if k:
            out[k] = 1
    return out


def requirements_for_smart(reads: L.Reads) -> list[dict[str, str]] | None:
    """requirementsForSmart_: the enabled requirements a situation is named for (the code's catalogue when the tab
    holds none)."""
    try:
        rows = SP.requirements(reads)
    except Defer:
        rows = [dict(r) for r in CE.CATALOG]
    out = [{"req_id": s_(r.get("req_id")), "consequence": s_(r.get("consequence"))} for r in rows
           if s_(r.get("enabled")).lower() == "yes" and s_(r.get("consequence"))]
    return out or None


def owned_reqs(reads: L.Reads, sits: list[dict] | None) -> dict[str, str]:
    """commRecordOwnedReqs_: one voice per credential — the req_ids an ON reminder situation already speaks for."""
    out: dict[str, str] = {}
    for r in requirements_for_smart(reads) or ():
        if not r["consequence"] or not r["req_id"] or sits is None:
            continue
        sit = SC.situation_row(sits, r["consequence"])
        if sit is not None and SC.smart_on(sit.get("enabled")):
            out[r["req_id"]] = r["consequence"]
    return out


def people(reads: L.Reads) -> dict[str, dict[str, str]]:
    """commRecordPeople_: who can be reached, by name key — the People house read the way Smart Comms reads it."""
    out: dict[str, dict[str, str]] = {}
    for p in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))):
        k = name_key((p or {}).get("name"))
        if k and k not in out:
            out[k] = {"name": text(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email"))}
    return out


def routes(reads: L.Reads) -> dict[str, dict]:
    """commRecordRoutes_: the cortex's route rows by person_key, the first of each — from the house where it is kept
    (comm_routes: Postgres once the routes are, else the copy)."""
    import comm_routes  # noqa: PLC0415 - the routes' owner
    return comm_routes.routes(reads)


def consent_rows(reads: L.Reads) -> dict[str, list[dict]]:
    """commRecordConsentRows_: the canonical consent store's rows, by the matrix's name key."""
    out: dict[str, list[dict]] = {}
    for r in SCD.board_rows(reads, CONSENT_TAB):
        k = name_key(r.get("entity_name"))
        if k:
            out.setdefault(k, []).append(r)
    return out


def reach_rows(reads: L.Reads) -> dict[str, dict]:
    """commReachRows_: the reach house by person_key, the last row of each."""
    rows = SCD.board_rows(reads, REACH_TAB)
    out: dict[str, dict] = {}
    for r in rows:
        if "person_key" not in r:
            return {}
        who = gsjs.trim(text(r.get("person_key"))).lower()
        if who:
            out[who] = r
    return out


def state(reads: L.Reads) -> dict[str, str]:
    """The Script Properties the sweep kept (its pace and its resume point), from their table — inside a write, as its
    own cursor sees it."""
    try:
        return {s_(k): gsjs.or_blank(v) for k, v in RR._q(reads, f"select key, value from {STATE}")}
    except Exception as exc:  # noqa: BLE001 - a pace that cannot be read is not an empty one
        raise Defer(f"the obligations sweep's state could not be read ({type(exc).__name__})") from None


def due(st: dict[str, str], now_ms: float) -> bool:
    """commRecordSweepMaybe_'s window: never stamped, or stamped six hours ago or more."""
    last = num_or0(st.get(SWEEP_KEY))
    return not last or (now_ms - last) / 1000.0 >= SWEEP_GAP_S


def _soft(unread: list[str], what: str, read: Callable[[], Any], fallback: Any) -> Any:
    """A reader the sweep's own catch guards: its fallback, and the failure said."""
    try:
        return read()
    except Exception as exc:  # noqa: BLE001 - commRecordSweep_'s readers each answer their safe direction
        unread.append(f"{what}: {type(exc).__name__}")
        return fallback


def plan(reads: L.Reads, dial: dict[str, Any]) -> tuple[dict[str, Any], list[dict]]:
    """commRecordSweep_ up to its loop: the matrix grouped by person, the reminder lane's credentials left to it, one
    intent per person on the roster, the queue in its stable order from the resume point, and for each thread what
    the loop needs (its hours, its supervisor, how to reach them, the route consent allows)."""
    now_iso = gsjs.iso(reads.now)
    now_ms = reads.now.timestamp() * 1000.0
    test = bool(dial["test"])
    unread: list[str] = []
    rows = _soft(unread, "the obligations matrix", lambda: matrix(reads), [])
    if not rows:
        return {"skipped": True, "why": MATRIX_EMPTY, "unread": unread}, []
    on_roster = _soft(unread, "the roster", lambda: roster(reads), {})
    sits = _soft(unread, "the situations", lambda: SC.read_situations(reads.db), None)
    owned = _soft(unread, "the reminder lane's requirements", lambda: owned_reqs(reads, sits), {})
    dropped = 0
    by_person: dict[str, dict] = {}
    for r in rows:
        k = gsjs.trim(r["person_key"]).lower()
        if not k:
            continue
        if owned.get(r["req_id"]):
            dropped += 1
            continue
        by_person.setdefault(k, {"name": r["person_name"], "rows": []})["rows"].append(r)
    planned = intents_from(by_person, on_roster, now_iso)
    queue = sorted(planned["intents"], key=lambda i: i["intent_key"])
    folk = _soft(unread, "the People house", lambda: people(reads), {})
    route_rows = _soft(unread, "the cortex's routes", lambda: routes(reads), {})
    consent = _soft(unread, "the consent store", lambda: consent_rows(reads), {})
    reach = _soft(unread, "the reach house", lambda: reach_rows(reads), {})
    quiet_from, quiet_to = policy(reads, "quiet_from"), policy(reads, "quiet_to")
    situation = situation_for(reads, PURPOSE)
    channels = channels_of(situation) if situation else ["sms", "email"]
    cursor = int(num_or0(state(reads).get(CURSOR_KEY)))
    if cursor >= len(queue) or cursor < 0:
        cursor = 0
    plans = []
    for i in range(cursor, len(queue)):
        intent = queue[i]
        pk = intent["person_key"]
        route_row = route_rows.get(pk) or {}
        person = contact(folk, route_rows, pk)
        route = route_for(reads, consent.get(pk) or [], refused_of(reads, person), intent["purpose"], channels, now_ms)
        if not route["ok"] and test:
            route = {"ok": True, "channel": channels[0] if channels else "email",
                     "why": route["why"] + " — not enforced in test mode", "tried": route["tried"]}
        group = (by_person.get(pk) or {}).get("rows") or []
        still = sorted({r["person_key"] + "|" + r["req_id"] for r in group if r["state"] in OPEN_STATES})
        plans.append({"at": i, "intent": intent,
                      "quiet": cortex_window(reach, route_rows.get(pk), quiet_from, quiet_to, now_ms),
                      "supervisor": text(route_row.get("supervisor")),
                      "supervisor_confidence": text(route_row.get("supervisor_confidence")),
                      "person": person, "route": route, "open": still})
    run = {"now": now_iso, "dial": dial["dial"], "test": test, "planned": len(queue), "resumed_from": cursor,
           "people_considered": len(by_person), "left_to_reminders": dropped, "skipped": planned["skipped"],
           "unread": unread}
    return run, plans


# ---- the door ------------------------------------------------------------------------------------------------------

def sweep_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commRecordPlan (the relay's own, in commRecordSweep's place): the dial and the six-hour window asked as
    commRecordSweepMaybe_ asks them (`force` skips the window), then the sweep planned; `due` says whether the relay
    carries it to commRecordKeep, and `stamp` whether that keep stamps the window."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    force = p.get("force") is True or gsjs.or_blank(p.get("force")) == "true"
    reads = sess.reads
    dial = dial_state(reads)
    if dial["dial"] == "off":
        data = {"skipped": True, "dial": "off", "note": DIAL_OFF} if force else {"skipped": True, "why": WINDOW_WHY}
        return {"status": 200, "data": {"due": False, **data}}
    if not force and not due(state(reads), reads.now.timestamp() * 1000.0):
        return {"status": 200, "data": {"due": False, "skipped": True, "why": WINDOW_WHY}}
    run, plans = plan(reads, dial)
    return {"status": 200, "data": {"due": True, "stamp": not force, "run": run, "plans": plans}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"commRecordPlan": sweep_plan}
POLICY: dict[str, dict[str, Any]] = {"commRecordPlan": {"params": {"force": "boolean"}}}
