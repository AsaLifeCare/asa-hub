"""Scheduling's clock on Python (SchedulingFlows.gs schedulingClockTick_ → schedFlowWork_), rung by the relay instead
of Apps Script's hiring sweep. The look (schedulingClockDue) reads the flows off asa-hub-db and plans each one the
clock owes now whole — a call-off's outreach stage with the people it reaches and their numbers, the one-off texts a
flow owes with each person's number, the requests nobody answered before their day — sealed for its write
(scheduling_clock_writes), which says the texts through Smart Comms and records every outcome on its flow."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Callable

import comm_broadcast as CB
import gsjs
import hotline_calloff as HCO
import locations as L
import recon as R
import scheduling as SCH
import scheduling_flows as SF
import scheduling_timeoff as ST
import smart_comms as SC
import team_alerts as TA
from gsjs import NY

APP_ID = SCH.APP_ID
DOOR = "schedulingClockDue"
DENIED = {"status": 403, "message": "This is the relay's own door."}
FLOWS, CELLS, INBOX, ROWS = ST.FLOWS, ST.CELLS, ST.INBOX, ST.ROWS
# SchedulingFlows.gs
OUTREACH = ("outreach_1", "outreach_wait", "outreach_2")
WAITING = SF.WAITING
RETRY_MS = 600000.0
BLAST_MAX = 200
BLAST_BUDGET_MS = 60000.0
LANE = "scheduling"
HOUSE_SITUATION = "sched_calloff_house"
EVERYONE_SITUATION = "sched_calloff_everyone"

s_ = gsjs.str_


# ---- time ------------------------------------------------------------------------------------------------------------

def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def iso_ms(ms: float) -> str:
    """schedFlowIso_."""
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc))


def ms_of(v: Any) -> float | None:
    """Date.parse; None for NaN."""
    return gsjs.date_parse(s_(v))


def quiet(ms: float) -> bool:
    """schedFlowQuiet_ (hubQuietAt_)."""
    return SC.quiet_at(ms / 1000.0)


def next8(ms: float) -> float:
    """schedFlowNext8_: the next 08:00 Ohio after `ms`."""
    return SC.quiet_end(ms / 1000.0) * 1000.0


def ohio_day(ms: float) -> str:
    """schedFlowDay_."""
    return datetime.fromtimestamp(ms / 1000.0, tz=NY).strftime("%Y-%m-%d")


def shift_start_ms(day: Any, start_min: Any) -> float:
    """schedFlowShiftMs_(...).start."""
    return SF._at_min(day, SF._num(start_min))


# ---- a flow and the clock ----------------------------------------------------------------------------------------------

def log_of(f: dict) -> dict:
    """schedFlowJson_(flow.outreach_log, {})."""
    got = SF._json(f.get("outreach_log"), {})
    return got if isinstance(got, dict) else {}


def owed_of(f: dict) -> list[dict]:
    got = log_of(f).get("owed")
    return [o for o in got if isinstance(o, dict)] if isinstance(got, list) else []


def reaching(f: dict) -> bool:
    return f.get("kind") == "call_off" and s_(f.get("state")) in OUTREACH


def wants(f: dict) -> bool:
    """schedFlowWants_: a call-off still reaching out, or any flow owing a text."""
    return reaching(f) or bool(owed_of(f))


def due_now(f: dict, now: float) -> bool:
    """A flow the clock claims now: it wants the clock and its next look is not after now."""
    if not wants(f):
        return False
    at = ms_of(f.get("outreach_next_at"))
    return not (at is not None and at > now)


def stale(f: dict, now: float, today: str) -> bool:
    """schedFlowExpireStale_'s test: a waiting request whose shift (or day) passed before anybody answered."""
    if s_(f.get("state")) not in WAITING:
        return False
    ex = SF._exchange_of(f)
    if ex is not None:
        return not (shift_start_ms(f.get("date"), f.get("start_min")) > now) or \
            not (shift_start_ms(ex.get("date"), ex.get("start_min")) > now)
    kind = f.get("kind")
    if kind in ("request_off", "swap", "training"):
        return bool(SF._ymd(f.get("date"))) and s_(f.get("end_min")) != "" and \
            SF._ended(f.get("date"), f.get("end_min"), now)
    return kind == "time_off" and bool(SF._ymd(f.get("date"))) and s_(f.get("date")) < today


def flows(reads: L.Reads) -> list[dict]:
    return SCH.read_tab(reads, FLOWS)


def cell_at(reads: L.Reads, house: Any, row_id: Any, day: Any) -> dict | None:
    """schedCellAt_ over the houses as this request holds them (a write's own rows laid)."""
    want = SCH.cell_id(s_(house), s_(row_id), s_(day))
    return next((c for c in SCH.read_tab(reads, CELLS) if s_(c.get("id")) == want), None)


def still_open(reads: L.Reads, f: dict) -> bool:
    """The call-off's OPEN shift is still open and still its own (schedFlowStageRun_'s covered test)."""
    cell = cell_at(reads, f.get("house_code"), f.get("open_row_id"), f.get("date"))
    return bool(cell) and s_(cell.get("state")) == "open" and s_(cell.get("flow_id")) == s_(f.get("id"))


# ---- the words -----------------------------------------------------------------------------------------------------

def street(reads: L.Reads, house: Any) -> str:
    """schedFlowStreet_: the house's street from the registry; '' when it cannot be told."""
    try:
        hit = ""
        for h in reads.homes() or []:
            if h and s_(h.get("code")) == s_(house):
                hit = s_(h.get("address"))
        return hit
    except Exception:  # noqa: BLE001 - schedFlowStreet_ answers '' for anything it cannot read
        return ""


def flow_vars(reads: L.Reads, f: dict) -> dict[str, str]:
    """schedFlowVars_."""
    day = s_(f.get("date"))
    return {"house": ST._house_word(reads, f.get("house_code")), "date": SF._day_words(day),
            "day_word": SF._day_word(day, reads.today()), "time": SF._hour_word(f.get("start_min")),
            "shift": ST._shift(f.get("shift_text")), "location": street(reads, f.get("house_code")),
            "original": s_(f.get("person")), "replacement": s_(f.get("replacement")),
            "link": SF.PLATFORM_URL + "/#" + ST._link(f.get("house_code"), day)}


# ---- the people ------------------------------------------------------------------------------------------------------

def phone_of(reads: L.Reads, key: Any) -> str:
    """schedPhoneOf_: the People house's number of somebody on staff, as E.164; '' otherwise."""
    k = s_(key)
    if not k:
        return ""
    people = reads.once("schclock:people", lambda: CB.people(reads))
    if not people.get("readable"):
        return ""
    row = people["by_key"].get(k)
    if not row or s_(row.get("status")).lower() not in people["on_staff"]:
        return ""
    e = TA.e164(row.get("phone"))
    return e if len(e) >= 11 and e[0] == "+" and e[1:].isdigit() and len(e) <= 16 else ""


def stage1_audience(reads: L.Reads, f: dict) -> dict[str, Any]:
    """schedFlowStage1Audience_: the house managers, then the house's roster people free for the shift — never the
    person who called off."""
    out: dict[str, Any] = {"readable": True, "people": [], "busy": 0, "why": ""}
    seen: set[str] = set()
    if s_(f.get("person_key")):
        seen.add(s_(f.get("person_key")))

    def add(key: str, name: str, seat: str) -> None:
        if not key or key in seen:
            return
        seen.add(key)
        try:
            phone = phone_of(reads, key)
        except Exception:  # noqa: BLE001 - a number that cannot be read is no number
            phone = ""
        out["people"].append({"key": key, "name": name, "phone": phone, "seat": seat})

    house = s_(f.get("house_code"))
    try:
        for h in SCH.house_managers(reads, house):
            add(s_(h.get("key")), s_(h.get("name")), "house_manager")
    except Exception:  # noqa: BLE001 - said, and the roster still reads
        out["why"] = "the house managers could not be read"
    try:
        rows = SCH.read_tab(reads, ROWS)
        SCH.holds_now(reads)
    except Exception as exc:  # noqa: BLE001 - not readable is said, and retried
        out["readable"] = False
        out["why"] = "the house roster could not be read: " + (str(exc) or type(exc).__name__)[:200]
        return out
    for r in rows:
        key = s_(r.get("person_key"))
        if s_(r.get("house_code")) != house or s_(r.get("row_kind")) != "person" or not key or key in seen:
            continue
        if s_(r.get("active")) == "no":
            continue
        try:
            clash = SCH.clash(reads, key, s_(f.get("date")), SF._num(f.get("start_min")), SF._num(f.get("end_min")),
                              house_code=house) or \
                SF._same_house_bar(reads, house, key, s_(f.get("date")), s_(r.get("name")))
        except Exception:  # noqa: BLE001 - a clash that cannot be read keeps the person out
            clash = {"why": "unreadable"}
        if clash:
            out["busy"] += 1
            continue
        add(key, s_(r.get("name")), "staff")
    return out


def stage2_audience(reads: L.Reads, f: dict, told: list) -> dict[str, Any]:
    """schedFlowStage2Audience_: every active member of staff the platform can text (allstaff), less everyone stage 1
    asked."""
    try:
        aud = HCO.everyone_audience(reads, reads.config(), {"person_key": s_(f.get("person_key")),
                                                            "date": s_(f.get("date")), "name": s_(f.get("person"))})
    except Exception:  # noqa: BLE001 - the staff list unread is said, and retried
        aud = None
    if not aud or not aud.get("readable"):
        return {"readable": False, "people": [], "why": s_((aud or {}).get("why")) or "the staff list could not be read"}
    skip = {s_(k) for k in told or []}
    if s_(f.get("person_key")):
        skip.add(s_(f.get("person_key")))
    people = []
    for p in aud.get("people") or []:
        k = s_(p.get("person_key"))
        if not k or k in skip:
            continue
        skip.add(k)
        people.append({"key": k, "name": s_(p.get("name")), "phone": s_(p.get("phone")), "seat": "everyone"})
    return {"readable": True, "people": people, "why": s_(aud.get("why"))}


# ---- the look --------------------------------------------------------------------------------------------------------

def plan_of(reads: L.Reads, f: dict, now: float) -> dict[str, Any]:
    """One due flow as its write needs it: who its stage reaches (with their numbers) and the numbers its owed texts
    go to; the stage itself is decided again in the write, on the flow as it stands then."""
    plan: dict[str, Any] = {"id": s_(f.get("id")), "kind": s_(f.get("kind")), "state": s_(f.get("state")),
                            "stage": s_(f.get("outreach_stage")), "next_at": s_(f.get("outreach_next_at"))}
    if reaching(f) and not SF._ended(f.get("date"), f.get("end_min"), now) and not quiet(now) and \
            still_open(reads, f):
        stage = SF._num(f.get("outreach_stage"))
        stage = 0 if math.isnan(stage) else stage
        if stage == 0:
            plan["audience"] = stage1_audience(reads, f)
        else:
            lg = log_of(f)
            told = (lg.get("stage1") or {}).get("told") if isinstance(lg.get("stage1"), dict) else None
            plan["audience"] = stage2_audience(reads, f, told if isinstance(told, list) else [])
    owed = owed_of(f)
    if owed:
        plan["phones"] = {}
        for o in owed:
            k = s_(o.get("key"))
            if k and k not in plan["phones"]:
                try:
                    plan["phones"][k] = phone_of(reads, k)
                except Exception:  # noqa: BLE001 - schedFlowSayOwed_ reads a throw as no number
                    plan["phones"][k] = ""
    return plan


def due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """schedulingClockTick_'s look: the requests nobody answered before their day, and each flow the clock owes now
    planned whole; `next_at` is the clock's next look when nothing is due before it."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    reads = sess.reads
    if not reads.db.house_moved(FLOWS):
        return {"status": 200, "data": {"due": False, "why": "Scheduling's flows house is not set up"}}
    now = now_ms(reads)
    today = ohio_day(now)
    rows = flows(reads)
    expire = [s_(f.get("id")) for f in rows if stale(f, now, today)]
    plans, nxt = [], math.inf
    for f in rows:
        if not wants(f):
            continue
        if due_now(f, now):
            plans.append(plan_of(reads, f, now))
            continue
        nxt = min(nxt, ms_of(f.get("outreach_next_at")) or now)
    # the day's look: a request's day passes at midnight
    nxt = min(nxt, SF._midnight_ms(SF._add_days(today, 1)) + 300000.0)
    data = {"due": bool(plans or expire), "flows": plans, "expire": expire, "quiet": quiet(now),
            "next_at": iso_ms(nxt)}
    return {"status": 200, "data": R.seal(DOOR, "service", data)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"schedulingClockDue": due}
POLICY: dict[str, dict[str, Any]] = {"schedulingClockDue": {}}
