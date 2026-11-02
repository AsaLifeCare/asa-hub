"""A call-off the hotline heard, answered as CommCallOff.gs commCallOffRecorded_ answers it and heard by Scheduling as
SchedulingFlows.gs schedulingCallOffHeard_ hears it: the shift on the calendar called off and put up open (or a
director told a person has to find it), the call-off house's row (comm_call_offs), the acknowledgement to the person
who called off, then the house manager, the cover offer, everyone, and the 5558 group with the reason — each raised
through Smart Comms in the filing's own write. One person hears about one call-off once. The shift's house, hour and
day come from Scheduling, the roster's owner; who is off that day is its time off."""
from __future__ import annotations

import contextvars
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import gsjs
import hotline as H
import hotline_comms as HC
import locations as L
import scheduling as SCH
import scheduling_flows as SF
import scheduling_timeoff as ST
import scheduling_writes as SW
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import support_desk_writes as SDW
import writes as W
from gsjs import NY

s_ = H.s_

# ---- 1 — the vocabulary ------------------------------------------------------------------------------------------

TYPES = {"call off": "call_off", "call-off": "call_off", "calloff": "call_off", "schedule - call off": "call_off",
         "no show no call": "no_show", "no show / no call": "no_show", "no-show no-call": "no_show",
         "late show": "late_show", "sent home": "sent_home"}
EFFECT = {
    "call_off": {"acknowledge": True, "tell_others": True, "opens_shift": True, "tell_directors": True,
                 "why": "called off this shift — not getting ready, and not a free line for routine traffic today"},
    "sent_home": {"acknowledge": True, "tell_others": False, "opens_shift": False, "tell_directors": False,
                  "why": "sent home mid-shift — the pre-shift moment already passed, the day is theirs"},
    "no_show": {"acknowledge": True, "tell_others": True, "opens_shift": True, "tell_directors": False,
                "why": "no show, no call — the house is uncovered and we are trying to find them"},
    "late_show": {"acknowledge": False, "tell_others": False, "opens_shift": False, "tell_directors": False,
                  "why": "late show — they WORKED; this lane says nothing at all"}}
KIND_WORDS = {"call_off": "called off", "no_show": "did not come in and did not call", "sent_home": "was sent home",
              "late_show": "arrived late"}
SUBJECT_SITUATION = "call_off_acknowledged"
MANAGER_SITUATION = "call_off_house_manager"
OFFER_SITUATION = "call_off_cover_offer"
EVERYONE_SITUATION = "call_off_everyone"
DIRECTORS_SITUATION = "call_off_reason_directors"
HOUSE = "comm_call_offs"
HOUSE_UNKNOWN = "(the house was not named on the call)"
MANAGER_UNKNOWN = "(the calendar names no manager for this house)"
BLAST_MAX = 200
SMS_MAX = 1600
WHY_MAX = 900
URGENT_KEYS = ("house", "time", "day_word", "location", "reason", "link", "ref")
URGENT_JOINS = ("at", "for", "on", "in")
URGENT_ABBREV = frozenset({"st", "ave", "dr", "rd", "apt", "blvd", "ln", "ct", "hwy", "mr", "mrs", "ms", "jr", "sr",
                           "no", "ste", "pkwy", "mt", "ft"})
DIRECTORS_KEYS = ("employee", "house", "time", "day_word", "reason")
STATE_COLS = {"subject": ("subject_state", "subject_at", "subject_why"),
              "house_manager": ("manager_state", "manager_at", "manager_why"),
              "everyone": ("everyone_state", "everyone_at", "everyone_why"),
              "cover_offer": ("offer_send_state", "offer_send_at", "offer_send_why"),
              "directors": ("directors_state", "directors_at", "directors_why")}
LANE = "call off"
SYSTEM = {"uid": "", "name": "Hotline", "key": ""}
# on only inside hotlineFile's write: anywhere else a page is planned, never raised
SPEAK: contextvars.ContextVar[bool] = contextvars.ContextVar("hotline_calloff_speak", default=False)


def kind_of(raw: Any) -> str:
    return TYPES.get(re.sub(r"\s+", " ", s_(raw).lower()), "")


def speaks_to(kind: str, audience: str) -> bool:
    """commCallOffSpeaksTo_."""
    eff = EFFECT.get(kind)
    if not eff:
        return False
    return {"subject": eff["acknowledge"], "house_manager": eff["tell_others"], "cover_offer": eff["tell_others"],
            "everyone": eff["opens_shift"], "directors": eff["tell_directors"]}.get(audience, False)


def not_owed(kind: str, nothing: str) -> str:
    return EFFECT.get(kind, {}).get("why") or "this kind is owed nothing" if kind else nothing


def facts_of(row: dict) -> dict[str, str]:
    """commCallOffFacts_: the fact and the person, never the row's prose."""
    name, frm = s_(row.get("employee_name")), s_(row.get("name_from"))
    return {"kind": kind_of(row.get("type")), "date": SCD.call_off_date(row.get("date")), "name": name,
            "name_from": frm, "person_key": gsjs.name_key(name) if frm else ""}


def house_code(location: Any) -> str:
    """commCallOffHouseCode_: "CAN - JH - ABD2704" → "ABD2704"."""
    loc = s_(location)
    return loc.split(" - ")[-1].strip().upper() if loc else ""


def address_key(v: Any) -> str:
    """commCallOffAddressKey_."""
    d = re.sub(r"\D", "", s_(v))
    return d[-10:] if len(d) >= 10 else s_(v).lower()


# ---- 2 — the day ---------------------------------------------------------------------------------------------------

def shift_day_from(words: Any, call_day: str) -> str:
    """commCallOffShiftDayFrom_: the one day the call's words name, or today / tomorrow said, or ''."""
    call = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s_(call_day))
    if not call:
        return ""
    text = "" if words is None else str(words)
    found: set[str] = set(f"{m[1]}-{m[2]}-{m[3]}" for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", text))
    for m in re.finditer(r"(^|[^\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])", text):
        mo, da = int(m[2]), int(m[3])
        if not 1 <= mo <= 12 or not 1 <= da <= 31:
            continue
        yr = int("20" + m[4] if m[4] and len(m[4]) == 2 else m[4]) if m[4] else int(call[1])
        if not m[4] and mo < int(call[2]) - 6:
            yr += 1
        found.add(f"{yr}-{mo:02d}-{da:02d}")
    if len(found) == 1:
        return next(iter(found))
    if found:
        return ""
    if re.search(r"\btomorrow\b", text, re.I) and not re.search(r"\b(today|tonight)\b", text, re.I):
        return (datetime(int(call[1]), int(call[2]), int(call[3])) + timedelta(days=1)).strftime("%Y-%m-%d")
    if re.search(r"\b(today|tonight|this (morning|afternoon|evening))\b", text, re.I) and \
            not re.search(r"\btomorrow\b", text, re.I):
        return s_(call_day)
    return ""


def hour_word(start_min: Any) -> str:
    """commCallOffHourWord_ over a minute of the day: 840 → '2pm', 870 → '2:30pm'."""
    try:
        m = int(float(s_(start_min)))
    except ValueError:
        return ""
    h, mm = divmod(m, 60)
    if not 0 <= h <= 23:
        return ""
    return f"{(h % 12) or 12}" + ("" if mm == 0 else f":{mm:02d}") + ("am" if h < 12 else "pm")


def day_word(day: str, now: datetime) -> str:
    """commCallOffDayWord_: today, tomorrow, or the weekday."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return ""
    local = now.astimezone(NY)
    if day == local.strftime("%Y-%m-%d"):
        return "today"
    if day == (local + timedelta(days=1)).strftime("%Y-%m-%d"):
        return "tomorrow"
    return datetime.strptime(day, "%Y-%m-%d").strftime("%A")


# ---- 3 — the audiences ---------------------------------------------------------------------------------------------

def manager_audience(cell: Any) -> dict[str, Any]:
    """commCallOffHouseManagerAudience_: the manager the hotline resolved, by name and number."""
    c = s_(cell)
    out: dict[str, Any] = {"ok": False, "name": "", "phone": "", "why": ""}
    if not c:
        out["why"] = ("the call-off row names no house manager — the location did not resolve to one, and a message to "
                      "nobody in particular is not a message")
        return out
    out["name"] = re.sub(r"\+?\d[\d\s().-]{6,}\d", "", c).strip()
    out["phone"] = SC.team_copy(re.sub(r"\D", "", c))
    if not out["phone"]:
        out["why"] = f"the house manager is named ({out['name'] or c[:40]}) and carries no number we may text"
        return out
    out["ok"], out["why"] = True, "the manager the hotline resolved for this shift, from the queued call-off row"
    return out


def away_keys(reads: L.Reads, day: str) -> set[str]:
    """commCallOffAway_: who Scheduling has on time off that day."""
    return {s_(c.get("row_id"))[2:] for c in SCH.read_tab(reads, "sched_cells")
            if c.get("date") == day and s_(c.get("state")) == "time_off" and s_(c.get("row_id")).startswith("P:")}


def everyone_audience(reads: L.Reads, cfg: dict, facts: dict) -> dict[str, Any]:
    """commCallOffEveryoneAudience_(facts): every active member of staff we may text, never the person who called
    off, nor their handset under another name, nor anybody on time off that day."""
    got = SCD.everyone_audience(reads, cfg)
    if not got["readable"]:
        return got
    skip = facts.get("person_key") or ""
    rows = SCD.SP.without_isp_clients(reads, SCD.SP.people_merged(reads, SCD.SP._people(reads)))
    her = {address_key(SC.sendable(p.get("phone")) or p.get("phone")) for p in rows
           if skip and gsjs.name_key(p.get("name")) == skip}
    her = {k for k in her if len(k) >= 10}
    try:
        away = away_keys(reads, facts.get("date") or "")
    except Exception:  # noqa: BLE001 - fail open, said
        away = set()
        got["missing"] += " · who is on time off could not be read, so this list can include somebody off that day"
    people, counted = [], got["counted"]
    counted["her_number"] = counted["time_off"] = 0
    for p in got["people"]:
        if p["person_key"] == skip:
            continue
        if p["person_key"] in away:
            counted["time_off"] += 1
            continue
        if address_key(p["phone"]) in her:
            counted["her_number"] += 1
            continue
        people.append(p)
    got["people"], got["ok"] = people, bool(people)
    return got


def audience_from(reads: L.Reads, cfg: dict, sit: dict, facts: dict) -> dict[str, Any]:
    """commCallOffAudienceFrom_: the row's to and cc, its keywords resolved, one address once."""
    out: dict[str, Any] = {"readable": True, "entries": [], "why": [], "notes": []}
    cells = SC.smart_list(sit.get("to")) + SC.smart_list(sit.get("cc"))
    if not cells:
        out["why"].append("this row names nobody in `Goes to` — an empty audience is an answer, and it means nobody has "
                          "said who this row may reach")
        return out
    seen: set[str] = set()
    resolvers = {"allstaff": lambda: everyone_audience(reads, cfg, facts),
                 "housemanagers": lambda: SCD.house_managers_audience(reads), "directors": SCD.directors_audience}
    for entry in (s_(c) for c in cells):
        if not entry:
            continue
        word = SCD.to_keyword(entry)
        if not word:
            k = address_key(entry)
            if k not in seen:
                seen.add(k)
                # the 5558 line written out is that group, as the `directors` keyword is
                out["entries"].append({"to": entry, "name": "",
                                       "group": SCD.digits(entry)[-10:] == SCD.COMMS_OPERATOR_LINE_DIGITS})
            continue
        try:
            got = resolvers[word]()
        except Exception as exc:  # noqa: BLE001 - "we cannot see", never "nobody"
            got = {"readable": False, "why": type(exc).__name__}
        if not got.get("readable", got.get("ok")):
            out["readable"] = False
            out["why"].append(f"`{word}` could not be resolved: {s_(got.get('why')) or 'the house behind it did not answer'}"
                              " — that is \"we cannot see\", never \"this reaches nobody\"")
            continue
        for p in got.get("people") or []:
            to = s_(p.get("phone") or p.get("email"))
            if not to or address_key(to) in seen:
                continue
            seen.add(address_key(to))
            out["entries"].append({"to": to, "name": s_(p.get("name")), "group": word == "directors"})
        if got.get("missing"):
            out["why"].append(f"`{word}`: {got['missing']}")
        if (got.get("counted") or {}).get("her_number"):
            out["notes"].append(f"{got['counted']['her_number']} member(s) of staff carry the caller's own phone and are "
                                f"not in `{word}`")
    return out


# ---- 4 — the shift, as Scheduling holds it --------------------------------------------------------------------------

def find_shift(reads: L.Reads, facts: dict, place: dict, now: datetime) -> dict[str, Any]:
    """commCallOffFindShift_ off Scheduling: the person's timed shift on the day (or, asked over two days from the
    call, the first not begun), at the house the call named when it named one."""
    out: dict[str, Any] = {"shift": None, "day": ""}
    key, code = facts.get("person_key") or "", house_code(place.get("house"))
    day = place.get("shift_day") if place.get("day_from_call") else facts.get("date")
    days = [day] if day else []
    if place.get("day_from_call") and not day and facts.get("date"):
        days = [facts["date"], (datetime.strptime(facts["date"], "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")]
    if not key or not days:
        return out
    local = now.astimezone(NY)
    now_day, now_min = local.strftime("%Y-%m-%d"), local.hour * 60 + local.minute
    cells = [c for c in SCH.read_tab(reads, "sched_cells") if s_(c.get("row_id")) == "P:" + key and SF._holds(c)]
    for d in days:
        for c in sorted((c for c in cells if c.get("date") == d), key=lambda c: float(s_(c.get("start_min")) or 0)):
            if code and s_(c.get("house_code")).upper() != code:
                continue
            if len(days) > 1 and (d < now_day or (d == now_day and float(s_(c.get("start_min")) or 0) <= now_min)):
                continue
            out["shift"], out["day"] = c, d
            return out
    return out


def urgent_vars(reads: L.Reads, facts: dict, place: dict, now: datetime, words: str, link: str) -> dict[str, Any]:
    """commCallOffUrgentVars_: the house, the hour and the day of the absence; a value not found is never shown."""
    out: dict[str, Any] = {k: "" for k in URGENT_KEYS}
    out.update(day="", why=[])
    found = find_shift(reads, facts, place, now)
    mine = found["shift"]
    code = s_(mine.get("house_code")) if mine else house_code(place.get("house"))
    home = next((h for h in reads.homes() if s_(h.get("code")).upper() == code.upper()), None) if code else None
    label = SCD.house_label(place.get("house"))
    out["house"] = s_((home or {}).get("home_name")) or (label + " home" if label else "")
    out["location"] = s_((home or {}).get("address"))
    say = (place.get("shift_day") if place.get("day_from_call") else facts.get("date")) or found["day"]
    out["day"] = say or ""
    out["day_word"] = day_word(say, now) if say else ""
    out["time"] = hour_word(mine.get("start_min")) if say and mine else ""
    out["link"] = link
    if place.get("day_from_call") and not say:
        out["why"].append("the call did not say which day, and the roster showed no open shift")
    for k in URGENT_KEYS:
        if k == "reason":
            if "{reason}" in words:
                out["why"].append("the reason is never sent to everybody — it goes to the 5558 group alone")
        elif not out[k] and "{" + k + "}" in words:
            out["why"].append("no " + k.replace("_", " "))
    return out


def sentences(line: str) -> list[str]:
    """commCallOffSentences_: one line cut into sentences, every character kept."""
    out, start = [], 0
    for m in re.finditer(r"[.!?]+(?=\s|$)\s*", line):
        before = re.search(r"([A-Za-z]+)$", line[start:m.start()])
        word = before[1].lower() if before else ""
        if m[0].rstrip() == "." and (len(word) == 1 or word in URGENT_ABBREV):
            continue
        out.append(line[start:m.end()])
        start = m.end()
    if start < len(line):
        out.append(line[start:])
    return out


def urgent_prune(template: Any, vals: dict) -> str:
    """commCallOffUrgentPrune_: a sentence a missing value would break loses the value, or goes."""
    def missing(k: str) -> bool:
        return not s_(vals.get(k))

    def holds(s: str) -> list[str]:
        return [k for k in URGENT_KEYS if "{" + k + "}" in s]
    out = []
    for line in s_(template).split("\n") if template is not None else []:
        if not [k for k in holds(line) if missing(k)]:
            out.append(line)
            continue
        kept, dropped = [], False
        for s in sentences(line):
            here = holds(s)
            gone = [k for k in here if missing(k)]
            if not gone:
                kept.append(s)
                continue
            if len(gone) == len(here):
                dropped = True
                continue
            t = s
            for k in gone:
                joined = re.compile(r"\s+(?:" + "|".join(URGENT_JOINS) + r")\s+\{" + k + r"\}", re.I)
                t = joined.sub("", t, count=1) if joined.search(t) else re.sub(r"\s*\{" + k + r"\}", "", t, count=1)
            kept.append(t)
        joined_line = "".join(kept)
        if dropped:
            joined_line = joined_line.rstrip()
        if joined_line.strip():
            out.append(joined_line)
    return "\n".join(out)


def directors_prune(template: Any, vals: dict) -> str:
    """commCallOffDirectorsPrune_."""
    out = []
    for line in s_(template).split("\n") if template is not None else []:
        here = [k for k in DIRECTORS_KEYS if "{" + k + "}" in line]
        gone = [k for k in here if not s_(vals.get(k))]
        if not gone:
            out.append(line)
            continue
        if len(gone) == len(here):
            continue
        t = line
        for k in gone:
            t = re.sub(r"\s*\{" + k + r"\}", "", t)
        t = re.sub(r"\s+-\s*([.!?])", r"\1", t)
        t = re.sub(r":\s*-\s+", ": ", t)
        t = re.sub(r"\s+-\s*$", "", t)
        t = re.sub(r"[ \t]{2,}", " ", t)
        if t.strip():
            out.append(t)
    return "\n".join(out)


def sms_parts(body: str, cap: int = SMS_MAX) -> list[str]:
    """commCallOffSmsParts_: never cut to fit one text — numbered parts instead."""
    if len(body) <= cap:
        return [body]
    budget, chunks, rest = cap - 10, [], body
    while len(rest) > budget:
        cut = max(rest.rfind(" ", 0, budget), rest.rfind("\n", 0, budget))
        if cut < budget / 2:
            cut = budget
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:
        chunks.append(rest)
    return [f"({i + 1}/{len(chunks)}) {c}" for i, c in enumerate(chunks)]


# ---- 5 — the words and the sends -----------------------------------------------------------------------------------

def channels_with_words(sit: dict) -> list[str]:
    """commCallOffChannelsWithWords_."""
    chans = [c.lower() for c in SC.smart_list(sit.get("channels"))] or ["sms", "email"]
    return [c for c in chans if (c == "sms" and s_(sit.get("sms_text"))) or (c == "email" and s_(sit.get("email_subject")))]


def other_situation(rows: list[dict], sid: str) -> dict | None:
    """commCallOffOtherSituation_: on, and written on a channel it names."""
    sit = SC.situation_row(rows, sid)
    if sit is None or not SC.smart_on(sit.get("enabled")):
        return None
    return sit if channels_with_words(sit) else None


def other_vars(facts: dict, over: dict | None = None) -> dict[str, Any]:
    """commCallOffOtherVars_."""
    name = facts.get("name") or ""
    v = {"employee": name, "name": name, "first_name": (name.split() or [""])[0], "date": facts.get("date") or "",
         "kind": KIND_WORDS.get(facts.get("kind") or "", "")}
    v.update(over or {})
    return v


def ending(got: dict) -> str:
    """What Smart Comms did with one page, in the words the call-off house keeps."""
    st, held = s_(got.get("state")), s_(got.get("held"))
    if st == "sent":
        return "told"
    if st == "already":
        return "already"
    if held == "test_mode" or held == "recorded":
        return "recorded"
    if held == "quiet":
        return "deferred"
    return "held"


def leg_ending(states: list[str]) -> str:
    """commCallOffEnding_ over the pages one audience got."""
    for word in ("told", "deferred", "recorded", "already", "planned"):
        if word in states:
            return word
    return "held" if states else "nobody"


def say(sid: str, to: str, vars_: dict, key: str, person: str, at_ms: int, *, team: Any = True, words: Any = None,
        channel: str = "sms") -> dict[str, Any]:
    if not SPEAK.get():
        return {"to": SC.mask_to(to), "state": "planned", "why": "", "key": key, "channel": channel}
    got = SC.raise_situation(None, situation=sid, to=to, vars=vars_, key=key, person=person, lane=LANE, at_ms=at_ms,
                             prune=True, team=team if channel == "sms" else False, words=words, channel=channel)
    return {"to": SC.mask_to(to), "state": ending(got), "why": s_(got.get("why"))[:200]}


def copy_to(dest: str, sid: str, chans: list[str], vars_: dict, key: str, person: str, at_ms: int,
            words: Any = None, team: Any = True) -> dict[str, Any]:
    """commCallOffCopyTo_: an address a letter, a number a team copy."""
    if "@" in dest:
        if "email" not in chans:
            return {"to": SC.mask_to(dest), "state": "skipped", "why": "an e-mail address, and this row has no written letter"}
        return say(sid, dest, vars_, key, person, at_ms, channel="email")
    if "sms" not in chans:
        return {"to": SC.mask_to(dest), "state": "skipped", "why": "a number, and this row has no written text"}
    return say(sid, dest, vars_, key, person, at_ms, team=team, words=words)


# ---- 6 — the legs --------------------------------------------------------------------------------------------------

def ack(reads: L.Reads, rows: list[dict], facts: dict, instance: str, at_ms: int) -> dict[str, Any]:
    """commCallOffSpeakOne_: the person who called off, answered once, never somebody the caller ID only guessed."""
    res: dict[str, Any] = {"state": "held", "why": "", "to_key": ""}
    if not speaks_to(facts["kind"], "subject"):
        res.update(state="not_owed", why=not_owed(facts["kind"], "the type of day could not be recognised — nothing is "
                                                                 "said about a day we cannot name"))
        return res
    sit = SC.situation_row(rows, SUBJECT_SITUATION)
    if sit is None or not SC.smart_on(sit.get("enabled")) or not channels_with_words(sit):
        res["why"] = (f"the situation `{SUBJECT_SITUATION}` is absent, switched off, or still has no words — a message "
                      "with no words waits for somebody to write them")
        return res
    if not facts["person_key"]:
        res["why"] = "the row names nobody this lane can key"
        return res
    if facts["name_from"] == "phone":
        res["why"] = ("who this was came from the caller ID, not from anybody saying it — the call-off is on the row and "
                      "nothing is said to somebody we only think it was")
        return res
    person = HC._psi_people(reads).get(facts["person_key"])
    if not person or not (person["phone"] or person["email"]):
        res["why"] = "no contact in the People house — a person has to find them"
        return res
    pick = None
    for c in channels_with_words(sit):
        if c == "sms" and SC.sendable(person["phone"]):
            pick = ("sms", SC.sendable(person["phone"]))
        elif c == "email" and SC.letter_to(person["email"]):
            pick = ("email", SC.letter_to(person["email"]))
        if pick:
            break
    if pick is None:
        res["why"] = "no channel of this situation reaches them"
        return res
    res["to_key"] = address_key(pick[1])
    intent = f"CO|{instance}|{facts['person_key']}"
    v = {"first_name": (facts["name"].split() or [""])[0], "name": facts["name"], "expires": facts["date"],
         "days_left": "", "credential": "", "items": "0", "correction": "", "status_at": ""}
    got = say(SUBJECT_SITUATION, pick[1], v, "ci_" + intent + "_1", facts["name"], at_ms, team=False, channel=pick[0])
    res.update(state=got["state"], why=got["why"] or ("answered on " + pick[0] if got["state"] == "told" else ""),
               channel=pick[0])
    return res


def tell_manager(rows: list[dict], facts: dict, instance: str, place: dict, at_ms: int) -> dict[str, Any]:
    """commCallOffTellManager_."""
    res: dict[str, Any] = {"audience": "house_manager", "state": "held", "why": "", "heard": [], "pages": []}
    if not speaks_to(facts["kind"], "house_manager"):
        res.update(state="not_owed", why=not_owed(facts["kind"], "the type of day could not be recognised"))
        return res
    sit = other_situation(rows, MANAGER_SITUATION)
    if sit is None:
        res.update(state="wordless", why=f"the situation `{MANAGER_SITUATION}` is absent, switched off, or has no "
                                         "written words on any channel it names — nothing was sent")
        return res
    who = manager_audience(place.get("manager"))
    v = other_vars(facts, {"house_manager": who["name"] if who["ok"] else MANAGER_UNKNOWN,
                           "house": s_(place.get("house")) or HOUSE_UNKNOWN})
    chans = channels_with_words(sit)
    why = who["why"]
    if who["ok"]:
        res["heard"] = [address_key(who["phone"])]
        one = copy_to(who["phone"], MANAGER_SITUATION, chans, v, "co_hm_" + instance[:48], who["name"], at_ms)
        res["pages"].append(one)
        why = "the house manager the hotline resolved for this shift was told" if one["state"] == "told" else one["why"]
    # the row's own copy list (`cc`), each once and never the manager again — told even when no manager was found
    copies = 0
    for i, entry in enumerate(SC.smart_list(sit.get("cc"))):
        got = SCD.team_dest(entry)
        if got is None or address_key(got[0]) in res["heard"]:
            continue
        res["heard"].append(address_key(got[0]))
        res["pages"].append(copy_to(got[0], MANAGER_SITUATION, chans, v, f"co_hm_cc{i}_{instance[:40]}",
                                    "the call-off copy list", at_ms, team=got[1]))
        copies += 1
    if not res["pages"]:
        res.update(state="nobody", why=why)
        return res
    res["state"] = leg_ending([p["state"] for p in res["pages"]])
    res["why"] = why + (f" · {copies} on the copy list" if copies else "")
    return res


def _skipped_why(dropped: list[str], told: dict, endings: dict) -> str:
    """commCallOffSkippedWhy_."""
    if not dropped:
        return ""
    by: dict[str, int] = {}
    for k in dropped:
        by[told.get(k, "")] = by.get(told.get(k, ""), 0) + 1
    names = {"house_manager": MANAGER_SITUATION, "cover_offer": OFFER_SITUATION, "everyone": EVERYONE_SITUATION,
             "subject": SUBJECT_SITUATION}
    parts = [f"{n} heard it first from `{names.get(who, who or 'an earlier leg')}` ({endings.get(who, '')})"
             for who, n in by.items()]
    return f"{len(dropped)} skipped: " + ", ".join(parts) + " — one person hears about one call-off once"


def offer_send(reads: L.Reads, cfg: dict, rows: list[dict], facts: dict, instance: str, place: dict, told: dict,
               endings: dict, at_ms: int) -> dict[str, Any]:
    """commCallOffOfferSend_: the people who decide who covers it, less anybody already told."""
    res: dict[str, Any] = {"audience": "cover_offer", "state": "held", "why": "", "heard": [], "pages": []}
    if not speaks_to(facts["kind"], "cover_offer"):
        res.update(state="not_owed", why=not_owed(facts["kind"], "the type of day could not be recognised"))
        return res
    sit = other_situation(rows, OFFER_SITUATION)
    if sit is None:
        res.update(state="wordless", why=f"the situation `{OFFER_SITUATION}` is absent, switched off, or has no written "
                                         "words on any channel it names — nothing was offered")
        return res
    aud = audience_from(reads, cfg, sit, facts)
    if not aud["readable"]:
        res.update(state="unreadable", why=" · ".join(aud["why"]))
        return res
    entries = [e for e in aud["entries"] if address_key(e["to"]) not in told]
    dropped = [address_key(e["to"]) for e in aud["entries"] if address_key(e["to"]) in told]
    skipped = _skipped_why(dropped, told, endings)
    if not entries:
        res.update(state="skipped" if dropped else "nobody",
                   why=skipped or " · ".join(aud["why"]) or "this row names nobody — write the people, or the keyword "
                                                             "`housemanagers`")
        return res
    who = manager_audience(place.get("manager"))
    v = other_vars(facts, {"house": s_(place.get("house")) or HOUSE_UNKNOWN,
                           "house_manager": who["name"] or MANAGER_UNKNOWN})
    chans = channels_with_words(sit)
    for i, e in enumerate(entries[:BLAST_MAX]):
        res["heard"].append(address_key(e["to"]))
        res["pages"].append(copy_to(e["to"], OFFER_SITUATION, chans, v, f"co_offer{i}_{instance[:40]}", e["name"],
                                    at_ms, team="group" if e["group"] else True))
    states = [p["state"] for p in res["pages"]]
    res["state"] = leg_ending(states)
    res["why"] = f"{states.count('told')} of {len(entries)} reached" + (f" · {skipped}" if skipped else "")
    return res


def blast(reads: L.Reads, cfg: dict, rows: list[dict], facts: dict, instance: str, place: dict, told: dict,
          endings: dict, at_ms: int, now: datetime, link: str) -> dict[str, Any]:
    """commCallOffBlast_: every active member of staff, once, for an open shift — the urgent words pruned of what
    could not be found, `{first_name}` the person texted."""
    res: dict[str, Any] = {"audience": "everyone", "state": "held", "why": "", "heard": [], "pages": [], "resolved": 0,
                           "audience_cell": ""}
    if not speaks_to(facts["kind"], "everyone"):
        res.update(state="not_owed", why="this kind leaves no shift open: " + not_owed(facts["kind"], "nothing is owed")
                   if facts["kind"] else "the type of day could not be recognised — nobody is texted about it")
        return res
    sit = other_situation(rows, EVERYONE_SITUATION)
    if sit is None:
        res.update(state="wordless", why=f"the situation `{EVERYONE_SITUATION}` is absent, switched off, or has no "
                                         "written words on any channel it names — nobody was texted")
        return res
    aud = audience_from(reads, cfg, sit, facts)
    if not aud["readable"]:
        res.update(state="unreadable", why=" · ".join(aud["why"]))
        return res
    people = [e for e in aud["entries"] if address_key(e["to"]) not in told]
    dropped = [address_key(e["to"]) for e in aud["entries"] if address_key(e["to"]) in told]
    skipped = " · ".join(x for x in [_skipped_why(dropped, told, endings)] + aud["notes"] if x)
    res["resolved"] = len(people)
    if not people:
        res.update(state="skipped" if dropped else "nobody",
                   why=skipped or " · ".join(aud["why"]) or "the audience resolved to nobody this platform may text")
        return res
    urgent = urgent_vars(reads, facts, place, now, s_(sit.get("sms_text")), link)
    words = urgent_prune(sit.get("sms_text"), urgent)
    if urgent["why"]:
        skipped = (skipped + " · " if skipped else "") + ("the URGENT OPEN SHIFT words left out what could not be found ("
                                                          + ", ".join(urgent["why"]) + ") rather than show a gap")
    chans = channels_with_words(sit)
    for i, p in enumerate(people[:BLAST_MAX]):
        v = other_vars(facts, {k: urgent[k] for k in URGENT_KEYS})
        v.update(name=p["name"], first_name=(p["name"].split() or [""])[0])
        res["heard"].append(address_key(p["to"]))
        res["pages"].append(copy_to(p["to"], EVERYONE_SITUATION, chans, v, f"co_all{i}_{instance[:40]}", p["name"],
                                    at_ms, words=words))
    states = [p["state"] for p in res["pages"]]
    reached = [people[i] for i, s in enumerate(states) if s in ("told", "recorded", "deferred", "planned")]
    res["audience_cell"] = SDW.json_text({"day": urgent["day"], "house": s_(place.get("house")),
                                          "to": [[p["to"], p["name"]] for p in reached]})
    res["state"] = leg_ending(states)
    stopped = len(people) - min(len(people), BLAST_MAX)
    res["why"] = (f"{states.count('told')} of {len(people)} reached" +
                  (f" · {stopped} NEVER ASKED — past the cap of {BLAST_MAX}" if stopped else "") +
                  (f" · {skipped}" if skipped else ""))
    if stopped:
        res["state"] = "partial"
    return res


def tell_directors(reads: L.Reads, cfg: dict, rows: list[dict], facts: dict, instance: str, place: dict, at_ms: int,
                   now: datetime, link: str) -> dict[str, Any]:
    """commCallOffTellDirectors_: the 5558 group alone hears the reason, never cut to fit one text."""
    res: dict[str, Any] = {"audience": "directors", "state": "held", "why": "", "heard": [], "pages": []}
    if not speaks_to(facts["kind"], "directors"):
        res.update(state="not_owed", why="only a Call Off carries a reason somebody gave — this kind is owed nothing here"
                   if facts["kind"] else "the type of day could not be recognised")
        return res
    sit = other_situation(rows, DIRECTORS_SITUATION)
    if sit is None:
        res.update(state="wordless", why=f"the situation `{DIRECTORS_SITUATION}` is absent, switched off, or has no "
                                         "written words on any channel it names — nothing was sent")
        return res
    aud = audience_from(reads, cfg, sit, facts)
    if not aud["readable"]:
        res.update(state="unreadable", why=" · ".join(aud["why"]))
        return res
    dests = [e for e in aud["entries"] if s_(e["to"])]
    if not dests:
        res.update(state="nobody", why=" · ".join(aud["why"]) or "the audience resolved to nobody this platform may text")
        return res
    res["heard"] = [address_key(e["to"]) for e in dests]
    urgent = urgent_vars(reads, facts, place, now, s_(sit.get("sms_text")), link)
    reason = s_(place.get("reason"))
    vals = {"employee": facts["name"], "house": urgent["house"], "time": urgent["time"], "day_word": urgent["day_word"],
            "reason": reason}
    words = directors_prune(sit.get("sms_text"), vals)
    v = other_vars(facts, {"house": urgent["house"], "time": urgent["time"], "day_word": urgent["day_word"],
                           "location": urgent["location"], "reason": reason})
    left = [k for k in DIRECTORS_KEYS if "{" + k + "}" in s_(sit.get("sms_text")) and not s_(vals.get(k))]
    chans = channels_with_words(sit)
    for i, e in enumerate(dests):
        idem = f"co_dir{i}_{instance[:40]}"
        if "@" in e["to"]:
            res["pages"].append(copy_to(e["to"], DIRECTORS_SITUATION, chans, v, idem, e["name"], at_ms, words=words))
            continue
        if "sms" not in chans:
            res["pages"].append({"to": SC.mask_to(e["to"]), "state": "skipped",
                                 "why": "a number, and this row has no written text to send"})
            continue
        parts = sms_parts(SC.render(words, v))
        for n, part in enumerate(parts):
            one = say(DIRECTORS_SITUATION, e["to"], v, idem + (f"_p{n + 1}" if len(parts) > 1 else ""), e["name"],
                      at_ms, team="group", words=part)
            res["pages"].append(one)
            if one["state"] not in ("told", "recorded", "deferred", "already", "planned"):
                break
        if len(parts) > 1:
            res["parts"] = len(parts)
    states = [p["state"] for p in res["pages"]]
    res["state"] = leg_ending(states)
    res["why"] = (("the 5558 group was told why" if "told" in states else "planned — raised only in the filing's write"
                   if states and set(states) == {"planned"} else
                   " · ".join(p["why"] for p in res["pages"] if p["why"]) or "the send door refused") +
                  (f" · the reason was long, so it went in {res['parts']} texts" if res.get("parts") else "") +
                  (" · left out, never shown as a gap: " + ", ".join(left) if left else ""))
    return res


# ---- 7 — Scheduling hears it ---------------------------------------------------------------------------------------

def hear(plan: SW.Plan, instance: str, facts: dict, call_day: str, shift_day: str) -> dict[str, Any]:
    """schedFlowHeardLocked_: the one shift the caller holds that day called off and put up open, the directors told;
    when the name, the day or the shift is not certain, a phone flow a director finishes."""
    reads = plan.reads
    now_ms = SF._now_ms(reads)
    for f in SCH.read_tab(reads, ST.FLOWS):
        if s_(f.get("source_ref")) == instance and f.get("kind") in ("call_off", "phone"):
            return {"state": "already", "flow_id": s_(f.get("id")), "why": ""}
    name, key, day = facts["name"][:120], facts["person_key"], shift_day
    why, found = "", []
    if facts["name_from"] == "phone":
        why = "the name came from the caller ID only, not from what the caller said"
    elif not key:
        why = "the call did not give a name"
    elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        why = "the call did not say which day"
    else:
        found = [c for c in SCH.read_tab(reads, ST.CELLS) if s_(c.get("row_id")) == "P:" + key and c.get("date") == day
                 and SF._holds(c) and not SF._ended(day, c.get("end_min"), now_ms)]
        if not found:
            why = "no shift of theirs that day is on the calendar"
        elif len(found) > 1:
            why = f"they hold {len(found)} shifts that day, so which one is not clear"
    st = SCH.settings(reads)
    dirs = SCH.directors(reads, st)
    if why:
        flow = ST._flow_row(plan, {"id": SF._new_id("SF", instance, now_ms), "kind": "phone", "state": "needs_human",
                                   "date": day if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else call_day,
                                   "person": name, "person_key": key, "note": why, "source": "hotline",
                                   "source_ref": instance, "created_by": ""})
        if not dirs["list"]:
            ST._note(flow, "the directors were not told: " + (dirs["why"] or "nobody on the list"))
        title = (f"Phone call-off needs a human — {name or 'unknown caller'} · "
                 f"{SF._day_words(flow['date'])}")
        body = (f"The hotline heard a call-off, but nothing was opened on the calendar: {why}. Find the shift and mark "
                "the call-off for them in Scheduling.")
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "warning", "director", d, title, body) for d in dirs["list"]])
        plan.upsert(ST.FLOWS, flow)
        return {"state": "needs_human", "flow_id": flow["id"], "why": why}
    c = found[0]
    house, row_id = s_(c.get("house_code")), s_(c.get("row_id"))
    row = SW.row_at(reads, house, row_id) or {}
    uid = s_((SCH.user_by_key(reads, key) or {}).get("uid"))
    ST._expire_on(plan, house, row_id, day, "Hotline")
    fid = SF._new_id("SF", f"{house}|{row_id}|{day}", now_ms)
    old = s_(c.get("text"))
    SW.set_cell(plan, house, row_id, day, {"text": "C/O", "state": "called_off", "base": ST._base_of(c), "flow_id": fid,
                                           "source": "flow:" + fid}, "call_off", "heard on the hotline", fid)
    open_row = ST._open_shift(plan, house, day, old, fid, "")
    flow = ST._flow_row(plan, {
        "id": fid, "kind": "call_off", "state": "outreach_1", "house_code": house, "date": day, "row_id": row_id,
        "person": s_(row.get("name")) or name, "person_key": key, "person_uid": uid, "shift_text": old,
        "start_min": s_(c.get("start_min")), "end_min": s_(c.get("end_min")), "open_row_id": open_row, "reason": "",
        "note": "heard on the hotline", "source": "hotline", "source_ref": instance, "outreach_stage": "0",
        "outreach_next_at": plan.now, "created_by": ""})
    if not dirs["readable"] or not dirs["list"]:
        ST._note(flow, "the directors were not warned: " + dirs["why"])
    wait = st.get("outreach_wait_min") or 7
    house_word = SF._house_word(reads, house)
    title = f"Call off — {SF._day_words(day)} · {SF._shift_words(old)} · {house_word}"
    body = (f"{s_(row.get('name')) or name} called off. Heard on the hotline. The shift is open at the top of "
            f"{house_word}; the house is texted first, then everyone after {wait} minutes if it is still open.")
    ST._inbox(plan, [ST._item(reads, flow, "inbox", "warning", "director", d, title, body) for d in dirs["list"]])
    plan.upsert(ST.FLOWS, flow)
    return {"state": "opened", "flow_id": fid, "why": "", "house": house, "day": day}


# ---- 8 — the door the filing calls ---------------------------------------------------------------------------------

def house_row(reads: L.Reads, row_id: str, patch: dict, subject: str) -> list[dict]:
    """commRecordUpsert_ on the call-off house: the row appended whole, or its changed cells edited."""
    res = SCD.where(reads, HOUSE)
    if res.ref is None:
        raise W.Defer("the call-off house holds no tab in the copy: Apps Script makes it on its first call-off")
    sid, tab = W.where_of(res)
    heads = set(res.ref.headers)
    cells = {k: SDW.json_text(v) if isinstance(v, (dict, list)) else s_(v) for k, v in patch.items() if k in heads}
    was = SCD.call_off_rows(reads).get(row_id)
    if was is None:
        cells.setdefault("createdAt", patch.get("updatedAt", ""))
        return [W.kept_record(sid, tab, "append", "id", row_id, subject, cells)]
    changed = {k: v for k, v in cells.items() if k != "id" and s_(was.get(k)) != v}
    return [W.kept_record(sid, tab, "edit", "id", row_id, subject, changed,
                          before={k: s_(was.get(k)) for k in changed})] if changed else []


def recorded(reads: L.Reads, row: dict, instance: str, place: dict, call_day: str, subject: str) -> dict[str, Any]:
    """commCallOffRecorded_ + schedulingCallOffHeard_ for one call-off the filing kept: the Scheduling hearing and the
    call-off house's row as app.edits records, each page raised in this write; {edits, said}."""
    facts = facts_of(row)
    out: dict[str, Any] = {"edits": [], "said": {"instance": instance}}
    if not facts["person_key"]:
        out["said"]["why"] = "the recorded row names nobody this lane can key"
        return out
    now = reads.now if reads.now.tzinfo else reads.now.replace(tzinfo=timezone.utc)
    at_ms, now_iso = int(now.timestamp() * 1000), gsjs.iso(now)
    # the shift as the calendar holds it before anything is said (the hearing below calls it off), and its day's link
    found = find_shift(reads, facts, place, now)
    shift = found["shift"]
    link = SF.PLATFORM_URL + "/#" + ST._link(shift.get("house_code"), found["day"]) if shift else ""
    rows = SC.read_situations(reads.db)
    cfg = reads.config()
    row_id = "COF_" + SCO.record_id(f"{instance}|{facts['person_key']}")
    a = ack(reads, rows, facts, instance, at_ms)
    told: dict[str, str] = {a["to_key"]: "subject"} if a.get("to_key") else {}
    endings = {"subject": a["state"]}
    legs: dict[str, dict] = {}

    def run(name: str, fn: Any) -> None:
        try:
            r = fn()
        except Exception as exc:  # noqa: BLE001 - a leg never fails the filing; its row says so
            r = {"audience": name, "state": "held", "why": f"the {name} leg threw and the recorded row stands: "
                                                         f"{type(exc).__name__}", "heard": [], "pages": []}
        legs[name] = r
        endings[name] = r["state"]
        for k in r.get("heard") or []:
            told.setdefault(k, name)

    run("house_manager", lambda: tell_manager(rows, facts, instance, place, at_ms))
    run("cover_offer", lambda: offer_send(reads, cfg, rows, facts, instance, place, told, endings, at_ms))
    run("everyone", lambda: blast(reads, cfg, rows, facts, instance, place, told, endings, at_ms, now, link))
    run("directors", lambda: tell_directors(reads, cfg, rows, facts, instance, place, at_ms, now, link))
    # then Scheduling hears it, as the sweep has it: the shift called off and put up open, or a director told
    plan = SW.Plan(reads, dict(SYSTEM))
    heard = hear(plan, instance, facts, call_day, place.get("shift_day") or "")
    out["edits"] += plan.records(subject)
    out["said"]["scheduling"] = heard
    patch: dict[str, Any] = {"id": row_id, "instance": instance, "person_key": facts["person_key"],
                             "person_name": facts["name"], "name_from": facts["name_from"], "kind": facts["kind"],
                             "shift_date": facts["date"], "source": "hotline", "recorded_at": now_iso,
                             "cover_state": "refused", "offer_state": "unreadable",
                             "offer_why": "the roster is Scheduling's, and no cover ranking is in this build",
                             "subject_state": a["state"], "subject_at": now_iso,
                             "subject_why": s_(a["why"])[:WHY_MAX], "subject_channel": s_(a.get("channel")),
                             "test_mode": "no", "updatedAt": now_iso}
    for name, r in legs.items():
        state_col, at_col, why_col = STATE_COLS[name]
        patch[state_col], patch[at_col], patch[why_col] = r["state"], now_iso, s_(r["why"])[:WHY_MAX]
    ev = legs.get("everyone") or {}
    patch["everyone_count"] = f"{[p['state'] for p in ev.get('pages', [])].count('told')}/{ev.get('resolved', 0)}"
    if ev.get("audience_cell"):
        patch["everyone_audience"] = ev["audience_cell"]
    out["edits"] += house_row(reads, row_id, patch, subject)
    out["said"].update(row_id=row_id, ack={k: a.get(k) for k in ("state", "why", "channel")},
                       legs={n: {"state": r["state"], "why": s_(r["why"])[:300], "pages": r.get("pages", [])}
                             for n, r in legs.items()})
    return out
