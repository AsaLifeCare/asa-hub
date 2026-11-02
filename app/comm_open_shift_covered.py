"""The covered-shift follow-up on Python (CommOpenShiftCovered.gs openShiftCovered): when a call-off's open shift is
filled, the people its URGENT OPEN SHIFT reached — exactly those, never anybody new — are told it is covered, once per
shift. The relay notes each fill (server/open_shift_covered.py) and hands them over;
app/comm_open_shift_covered_writes.py answers each under the platform's write lock, the call-off house
(comm_call_offs) written as app.edits records and every message through the one send door. Here: what the follow-up
reads and decides before anything is written — the call-off a fill follows, who that call-off reached, and the
words."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import comm_record as CR
import gsjs
import hotline_calloff as HCO
import locations as L
import smart_comms as SC
import smart_comms_desk as SCD

APP_ID = "open-shift-covered"
SITUATION = SCD.OPEN_SHIFT_COVERED_SITUATION
MAX_ROWS = 6
# No row starts past this: the relay's pass hands the rest to the next one.
START_BUDGET_S = 4.0
SENDING_STALE_MS = 10 * 60 * 1000
PASS_BY = "asa-hub:open-shift-covered"
NEVER = ("employee", "reason", "called_off_by", "caller")
COLS = SCD.COVERED_COLS
# CommCallOff.gs COMM_CALLOFF_REHEARSAL_MARK, COMM_CALLOFF_WHY_MAX, COMM_CALLOFF_BLAST_MAX, COMM_CALLOFF_SUBJECT_PURPOSE
REHEARSAL_MARK = "REHEARSAL (test mode — the testers heard it, not this audience; the turn is still owed) — "
WHY_MAX = HCO.WHY_MAX
BLAST_MAX = HCO.BLAST_MAX
SUBJECT_PURPOSE = "shift"
CLAIMABLE = ("", "planned", "deferred", "recorded")
RANK = {"none": 0, "unknown": 1, "written": 2, "testers": 3, "real": 4}


def t(v: Any) -> str:
    """openShiftCoveredStr_."""
    return gsjs.trim("" if v is None else gsjs.js_str(v))


def either(a: Any, b: Any) -> Any:
    """a || b."""
    return b if gsjs.falsy(a) else a


def day_before(iso: Any) -> str:
    """openShiftCoveredDayBefore_."""
    at = gsjs.date_parse(gsjs.or_blank(iso) + "T12:00:00Z")
    if at is None:
        return ""
    return gsjs.iso(datetime.fromtimestamp(at / 1000.0 - 86400, tz=timezone.utc))[:10]


def hour_word(hhmm: Any) -> str:
    """commCallOffHourWord_: "14:00" → "2pm", "14:30" → "2:30pm", "00:00" → "12am"."""
    m = re.match(r"^(\d{1,2}):(\d{2})", gsjs.trim(gsjs.or_text(hhmm)))
    if not m:
        return ""
    h = int(m.group(1))
    if h > 23:
        return ""
    return f"{(h % 12) or 12}" + ("" if m.group(2) == "00" else ":" + m.group(2)) + ("am" if h < 12 else "pm")


def match(r: dict, rows: dict[str, dict]) -> dict[str, Any]:
    """openShiftCoveredMatch_: the call-off rows this fill follows — the caller's own key on the day (a hotline row
    may be dated the day before the shift it opened), at the house when both name one; by every word of the name
    only when one person's call-offs answer."""
    out: dict[str, Any] = {"rows": [], "why": "", "ambiguous": False}
    who = t(either(r.get("called_off_by"), r.get("open_row")))
    day = t(r.get("col_iso"))[:10]
    if not who or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        out["why"] = "the row names no caller or no day"
        return out
    key = gsjs.name_key(who)
    tokens = [x for x in re.split(r"[^a-z0-9]+", who.lower()) if len(x) >= 2]
    code = HCO.house_code(r.get("location"))
    before = day_before(day)
    exact: list[dict] = []
    loose: list[dict] = []
    for rid in CR.js_keys(rows):
        c = rows[rid] or {}
        if not HCO.speaks_to(t(c.get("kind")), "everyone"):
            continue
        aud = SCD.audience_read(c.get("everyone_audience"))
        shift_day = SCD.call_off_date(c.get("shift_date"))
        ok = (aud["day"] == day) if aud["day"] else (
            shift_day == day or (shift_day == before and t(c.get("source")) == "hotline"))
        if not ok:
            continue
        theirs = HCO.house_code(aud["house"])
        if code and theirs and code != theirs:
            continue
        if key and t(c.get("person_key")) == key:
            exact.append(c)
            continue
        words = " " + re.sub(r"[^a-z0-9]+", " ", t(c.get("person_name")).lower()) + " "
        if len(tokens) >= 2 and all(" " + w + " " in words for w in tokens):
            loose.append(c)
    if exact:
        out["rows"] = exact
        return out
    people: dict[str, bool] = {}
    for c in loose:
        people[t(c.get("person_key")) or t(c.get("id"))] = True
    if len(people) > 1:
        out["ambiguous"] = True
        out["why"] = (f"{len(people)} different people's call-offs match \"{who}\" on {day} — nobody is told rather "
                      "than the wrong people")
        return out
    if loose:
        out["rows"] = loose
        return out
    out["why"] = (f"no call-off this platform recorded for \"{who}\" on {day}" + (f" at {code}" if code else "")
                  + " — the URGENT OPEN SHIFT it would follow was never sent from here")
    return out


def heard(matched: list[dict], now_ms: float) -> dict[str, Any]:
    """openShiftCoveredHeard_: who the matched call-offs' URGENT OPEN SHIFT reached, and how — for real, at the
    testers, only written down — one address once."""
    out: dict[str, Any] = {"heard": "none", "audience": [], "why": [], "deferred": []}
    best, sending, seen = "none", False, set()
    for c in matched or ():
        prod, test = t(c.get("everyone_state")), t(c.get("everyone_test_state"))
        aud = SCD.audience_read(c.get("everyone_audience"))
        kind = "none"
        if prod in ("told", "partial"):
            kind = "real"
        elif test in ("told", "partial", "rehearsed"):
            kind = "testers"
        elif prod == "sending" or test == "sending":
            at = gsjs.date_parse(t(c.get("everyone_at")))
            if at is not None and now_ms - at < SENDING_STALE_MS:
                sending = True
                continue
            kind = "unknown"
            out["why"].append("its URGENT OPEN SHIFT pass was cut short while sending and never said who it reached")
        elif prod == "recorded":
            kind = "written"
        elif prod == "deferred":
            out["deferred"].append(c)
            continue
        else:
            out["why"].append(f"its URGENT OPEN SHIFT ended `{prod or test or 'blank'}` and reached nobody")
            continue
        if kind != "unknown" and not aud["readable"]:
            kind = "unknown"
            out["why"].append("its URGENT OPEN SHIFT went out before the platform kept who it reached")
        if kind != "unknown":
            for a in aud["to"]:
                k = HCO.address_key(a["to"])
                if not k or k in seen:
                    continue
                seen.add(k)
                out["audience"].append(a)
        if RANK[kind] > RANK[best]:
            best = kind
    if sending:
        out["heard"] = "sending"
        return out
    if best == "none" and out["deferred"]:
        out["heard"] = "deferred"
        return out
    out["heard"] = best
    return out


def situation(rows: list[dict] | None) -> dict | None:
    """openShiftCoveredSituation_: on, written on a channel it names, and that channel the text."""
    sit = HCO.other_situation(rows or [], SITUATION)
    if sit is None:
        return None
    return None if "sms" not in HCO.channels_with_words(sit) else sit


def vars_of(r: dict, sit: dict | None, now: datetime) -> dict[str, str]:
    """openShiftCoveredVars_."""
    label = SCD.house_label(r.get("location"))
    day = t(r.get("col_iso"))[:10]
    return {"house": t(r.get("house_name")) or (label + " home" if label else ""),
            "time": hour_word(t(r.get("start_hm"))), "day_word": HCO.day_word(day, now),
            "location": t(r.get("address")), "date": day,
            "sender": t((sit or {}).get("sender")) or SC.SENDER_DEFAULT}


def words(sit: dict, vals: dict[str, str]) -> dict[str, Any]:
    """openShiftCoveredWords_: a line that names the caller, the employee or the reason loses it (or goes, when that
    was all it held), then the urgent pruning for what could not be found."""
    banned = re.compile(r"[ \t]*\{(" + "|".join(NEVER) + r")\}")
    kept = []
    for line in gsjs.or_text(sit.get("sms_text")).split("\n"):
        clean = banned.sub("", line)
        if clean != line and not re.search(r"\{\w+\}", clean):
            continue
        kept.append(clean)
    copy = dict(sit)
    copy["sms_text"] = HCO.urgent_prune("\n".join(kept), vals)
    return copy


def filled_words(r: dict) -> str:
    """openShiftCoveredFilledWords_."""
    by, how = t(r.get("filled_by")), t(r.get("filled_how"))
    said = ("applied and approved" if how == "approved" else "assigned by the house manager" if how == "assigned"
            else f"taken ({how})" if how else "filled")
    return f"filled by {by}, {said}" if by else said


def ending(sent: int, redirected: int, asked: int) -> str:
    """commCallOffEnding_."""
    if sent > 0:
        return "told"
    if redirected > 0:
        return "rehearsed"
    if asked > 0:
        return "held"
    return "nobody"


def quiet_now() -> bool:
    """commCallOffQuietNow_: the send door's own answer, now."""
    import time  # noqa: PLC0415
    return SC.quiet_at(time.time())


def quiet_refusal() -> str:
    return (f"inside the quiet window ({SC.QUIET_WORDS}): nothing is said, the fill is written down, and the relay "
            f"offers it again at {SC.QUIET_TO}")


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
