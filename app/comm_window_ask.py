"""The window ask on Python (CommWindowAsk.gs commWindowAskSweep_): while nobody has said when we may reach them, the
platform asks — once a day, inside the window before their own next shift (comm_when), at most three times, then it
is a person's job. Each ask is a thread of the comm_intents house under the purpose contact.window, judged by the
obligations sweep's own policy, consent and route (app/comm_record.py). The look (commWindowAskPlan) is a read: the
dial, the lane's nine-minute window, who is inside their window this minute, and for each what the loop needs; the
keep (app/comm_window_ask_writes.py) writes the threads and asks under the write lock. The window's stamp, Apps
Script's Script Property, lives in app.comm_window_ask_state (db/comm_window_ask.sql)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import comm_record as CR
import comm_routes as CRO
import comm_when as CW
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import staff_views
from gsjs import NY
from scope import Defer

APP_ID = "comm-window-ask"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
PURPOSE = "contact.window"
SITUATION = "contact_window_ask"
PRIORITY = "ask"
FLOOR = {"max_asks": 3, "gap_hours": 0}
STATE = "app.comm_window_ask_state"
SWEEP_KEY = "comm_window_ask_last_run"
SWEEP_GAP_S = 9 * 60
# COMM_WINDOW_ASK_BUDGET_MS: the whole sweep's, its passes together
BUDGET_S = 60.0
ACTOR = "asa-hub:comm"
WINDOW_WHY = "inside this lane's window, or the dial is off"
DIAL_OFF = "the dial is off — nothing was planned and nothing was written"

s_ = gsjs.str_
text = CR.text


def setting(reads: L.Reads, key: str) -> float:
    """commWindowAskSetting_: the words book's comm_window_ask_<key>, the floor behind it."""
    floor = FLOOR[key]
    try:
        return float(SCD.digest_setting(reads, "comm_window_ask_" + key, floor, 0, 9999))
    except Exception:  # noqa: BLE001 - the floor is the answer
        return float(floor)


def moments(reads: L.Reads, now_ms: float) -> tuple[list[dict[str, Any]] | None, str]:
    """commWindowAskMoments_: who is reachable and inside their own window this minute, keyed the platform's way;
    None (and commWhenRefusal_'s reason) when the window house did not answer — never an empty roster."""
    try:
        rows, why = CW.when_rows(reads)
    except Exception:  # noqa: BLE001 - a reader that throws did not answer
        return None, ""
    if rows is None:
        return None, why
    out = []
    for r in rows:
        r = r or {}
        if gsjs.or_text(r.get("state")) != "reachable":
            continue
        frm, to = gsjs.date_parse(gsjs.or_text(r.get("window_from"))), gsjs.date_parse(gsjs.or_text(r.get("window_to")))
        if frm is None or to is None or now_ms < frm or now_ms > to:
            continue
        key = gsjs.name_key(r.get("name") or r.get("person_key"))
        if not key:
            continue
        only = r.get("only_by_this_rule")
        out.append({"person_key": key, "name": gsjs.or_text(r.get("name")),
                    "window_from": gsjs.or_text(r.get("window_from")), "window_to": gsjs.or_text(r.get("window_to")),
                    "moment_at": gsjs.or_text(r.get("moment_at")), "shift_at": gsjs.or_text(r.get("shift_at")),
                    "only_by_this_rule": only is True or gsjs.or_blank(only) == "true"
                    or gsjs.or_blank(only).lower() == "yes",
                    "why": gsjs.or_text(r.get("why"))})
    return out, ""


def quiet_of(moment: dict | None) -> dict[str, Any] | None:
    """commWindowAskQuiet_: the quiet hours answered by the person instead of by the platform."""
    if not moment or not moment.get("window_from"):
        return None
    return {"from": 0, "to": 0,
            "why": "their own shift starts at " + gsjs.or_text(moment.get("shift_at"))[11:16]
                   + " — measured from the roster, not assumed; the company-wide quiet hours are a stand-in for being "
                     "asleep and this person is provably awake"}


def stated_window(consent_rows: list[dict] | None) -> str:
    """commWindowAskStatedWindow_: what the consent house holds about this person's hours, or ''."""
    for r in consent_rows or ():
        frm = gsjs.trim(gsjs.or_text((r or {}).get("window_from")))
        to = gsjs.trim(gsjs.or_text((r or {}).get("window_to")))
        if frm or to:
            return (frm or "?") + "-" + (to or "?")
    return ""


def answered(prior: dict | None, consent_rows: list[dict] | None) -> dict[str, Any]:
    """commWindowAskAnswered_: has this person already answered?"""
    st = gsjs.or_text((prior or {}).get("state"))
    if st == "answered":
        return {"answered": True, "why": "they replied — the thread is answered"}
    if st == "stopped":
        return {"answered": True, "why": "they asked us to stop"}
    said = stated_window(consent_rows)
    if said:
        return {"answered": True, "why": "a window is already on record: " + said}
    return {"answered": False, "why": ""}


def day_key(ms: float) -> str:
    """commWindowAskDayKey_: the calendar day on the script's clock."""
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).astimezone(NY).strftime("%Y-%m-%d")


def day_verdict(reads: L.Reads, last_ms: float, now_ms: float) -> dict[str, Any]:
    """commWindowAskDayVerdict_: once a day means once."""
    if not last_ms:
        return {"ok": True, "why": "never asked"}
    if day_key(last_ms) == day_key(now_ms):
        return {"ok": False, "defer": True, "why": "already asked today — once a day means once"}
    gap = setting(reads, "gap_hours")
    if gap > 0:
        hours = (now_ms - last_ms) / 3600000.0
        if hours < gap:
            return {"ok": False, "defer": True,
                    "why": f"asked {CR.n_(gsjs.js_round(hours))}h ago; this lane's floor is {CR.n_(gap)}h"}
    return {"ok": True, "why": "not asked today"}


def attempt_verdict(reads: L.Reads, attempts: Any) -> dict[str, Any]:
    """commWindowAskAttemptVerdict_: is there any point asking again, and what happens when there is not."""
    n = CR.num_or0(attempts)
    cap = setting(reads, "max_asks")
    after = CR.num(CR.policy(reads, "escalate_after"))
    if cap > 0 and n >= cap:
        return {"ok": False, "defer": False, "escalate": True, "spent": True,
                "why": f"{CR.n_(n)} asks with no answer — this lane stops here for good; asking somebody this every "
                       "day for ever is harassment, and it is a person's job now"}
    return {"ok": True, "escalate": cap > 0 and n >= after,
            "why": f"ask {CR.n_(n + 1)}" + (f" of {CR.n_(cap)}" if cap > 0 else " (uncapped by the book)")}


def situation(reads: L.Reads) -> dict | None:
    """commWindowAskSituation_: the book's re-point (commSituationFor_), else this lane's own row while it is on."""
    sit = CR.situation_for(reads, PURPOSE)
    if sit is not None:
        return sit
    try:
        return SCD.situation_on(SC.read_situations(reads.db), SITUATION)
    except Exception:  # noqa: BLE001 - absent
        return None


def intent_of(moment: dict) -> dict[str, Any]:
    """commWindowAskIntent_: one person, one question, no obligations."""
    return {"intent_key": CR.intent_key(moment["person_key"], PURPOSE), "purpose": PURPOSE,
            "person_key": gsjs.or_text(moment.get("person_key")), "person_name": gsjs.or_text(moment.get("name")),
            "state": "planned", "bindings": [], "worst": "", "deferred": 0}


def item_of(intent: dict, person: dict | None, sit: dict) -> dict[str, Any]:
    """commWindowAskItem_: the shape the transport carries."""
    chans = SC.smart_list(sit.get("channels"))
    return {"situation": gsjs.or_text(sit.get("id")), "key": "CI|" + gsjs.or_text(intent.get("intent_key")),
            "name": gsjs.or_text(intent.get("person_name")), "name_key": gsjs.or_text(intent.get("person_key")),
            "phone": gsjs.or_text((person or {}).get("phone")), "email": gsjs.or_text((person or {}).get("email")),
            "credential": "", "expires": "", "days_left": "", "channels": chans or ["sms", "email"],
            "rehearsal": False, "rehearsed": False, "intent_key": gsjs.or_text(intent.get("intent_key")),
            "bindings": [], "binding_count": 0, "raw_bindings": []}


def state(reads: L.Reads) -> dict[str, str]:
    """The Script Property the sweep kept (its window's stamp), from its table — inside a write, as its own cursor
    sees it."""
    try:
        return {s_(k): gsjs.or_blank(v) for k, v in RR._q(reads, f"select key, value from {STATE}")}
    except Exception as exc:  # noqa: BLE001 - a window that cannot be read is not an open one
        raise Defer(f"the window ask's state could not be read ({type(exc).__name__})") from None


def due(st: dict[str, str], now_ms: float) -> bool:
    """commWindowAskSweepMaybe_'s window: never stamped, or stamped nine minutes ago or more."""
    last = CR.num_or0(st.get(SWEEP_KEY))
    return not last or (now_ms - last) / 1000.0 >= SWEEP_GAP_S


def plan(reads: L.Reads, dial: dict[str, Any], who: str) -> tuple[dict[str, Any], list[dict]]:
    """commWindowAskSweep_ up to its loop: who is inside their window, the house that must already exist, and for each
    person what the loop needs — on the roster or not, how to reach them, the route consent allows, their hours."""
    now_ms = reads.now.timestamp() * 1000.0
    now_iso = gsjs.iso(reads.now)
    got, why = moments(reads, now_ms)
    if got is None:
        why = (why or "no reader answers for the shift moments (commWhenRows_)")
        staff_views.record({"email": who or ACTOR}, "comm_window_ask_no_reader",
                           why + " — nobody was asked. This lane never picks an hour of its own.")
        return {"skipped": True, "why": why + " — nobody was asked", "dial": dial["dial"]}, []
    if not got:
        return {"done": True, "asked": 0, "considered": 0, "dial": dial["dial"],
                "note": "nobody is inside their window this minute"}, []
    if SCD.house_where(reads, CR.INTENTS_HOUSE).ref is None:
        return {"skipped": True, "dial": dial["dial"],
                "why": f"the {CR.INTENTS_HOUSE} house has not been minted — this lane writes it, it does not create "
                       "it"}, []
    sit = situation(reads)
    roster = CR.roster(reads)
    folk = CR.people(reads)
    route_rows = CRO.routes(reads)
    consent = CR.consent_rows(reads)
    test = bool(dial["test"])
    channels = CR.channels_of(sit) if sit else ["sms", "email"]
    plans = []
    for i, m in enumerate(got):
        pk = m["person_key"]
        if not roster.get(pk):
            plans.append({"at": i, "moment": m, "off_roster": True})
            continue
        person = CR.contact(folk, route_rows, pk)
        refused = CR.refused_of(reads, person)
        rows = consent.get(pk) or []
        route = CR.route_for(reads, rows, refused, PURPOSE, channels, now_ms)
        if not route["ok"] and test:
            # softened only where the `no` came from silence
            open_ = [ch for ch in channels if not refused.get(ch)]
            route = ({"ok": True, "channel": open_[0], "why": route["why"] + " — not enforced in test mode",
                      "tried": route["tried"]} if open_ else
                     {"ok": False, "channel": "", "why": route["why"] + " — and a refusal is never softened, test "
                                                                       "mode or not", "tried": route["tried"]})
        plans.append({"at": i, "moment": m, "person": person, "route": route, "consent": rows,
                      "quiet": quiet_of(m)})
    run = {"now": now_iso, "dial": dial["dial"], "test": test, "planned": len(plans),
           "words": gsjs.or_text((sit or {}).get("id"))}
    return run, plans


def sweep_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commWindowAskPlan (in commWindowAskSweep's place): the dial and the nine-minute window asked as
    commWindowAskSweepMaybe_ asks them (`force` skips the window), then the sweep planned; `due` says whether the
    relay carries it to commWindowAskKeep (a sweep with nothing to ask too, so its window is stamped), and `stamp`
    whether that keep stamps the window."""
    user = sess.user or {}
    if user.get("is_service") is not True and (not sess.user or gsjs.js_str(user.get("role")) != "admin"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    force = p.get("force") is True or gsjs.or_blank(p.get("force")) == "true"
    reads = sess.reads
    dial = CR.dial_state(reads)
    if dial["dial"] == "off":
        data = {"skipped": True, "dial": "off", "note": DIAL_OFF} if force else {"skipped": True, "why": WINDOW_WHY}
        return {"status": 200, "data": {"due": False, **data}}
    if not force and not due(state(reads), reads.now.timestamp() * 1000.0):
        return {"status": 200, "data": {"due": False, "skipped": True, "why": WINDOW_WHY}}
    run, plans = plan(reads, dial, "" if user.get("is_service") else s_(user.get("email")))
    # a sweep that finds nothing to do is still stamped, before the work, by the keep
    return {"status": 200, "data": {"due": True, "stamp": not force, "run": run, "plans": plans}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"commWindowAskPlan": sweep_plan}
POLICY: dict[str, dict[str, Any]] = {"commWindowAskPlan": {"params": {"force": "boolean"}}}
