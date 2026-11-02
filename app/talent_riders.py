"""The clock riders Apps Script ran inside its hiring sweep (Hired.gs hubHiredSweepMaybe_), each a service read the
relay's clock asks first (`…Due`) before the write that records it (talent_riders_writes): the Talent finisher
(talentFinishSweepMaybe_), the automatic crossing (tpAutoCrossSweepMaybe_), the store's no-contact archive
(tpArchiveNoContactMaybe_), the rehearsal cards' archive (testCardArchiveMaybe_), the unreachable archive
(unreachableArchiveSweepMaybe_) and the floor under New (tpAutoFillNewMaybe_). A pass that does nothing says why in the
service's log, once every six hours per rider (tpSweepIdle_)."""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Callable

import candidates as CND
import gsjs
import hiring_hired as HH
import hiring_sim as HS
import hubdb
import locations as L
import mail_designs as MD
import talent_pipeline as TP
import writes as W
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "hiring"
s_ = gsjs.str_
SERVICE_ONLY = HH.SERVICE_ONLY
STORE = TP.TP_TABS["candidates"]
HISTORY_TAB = "log_status_history"
# each rider's per-pass budget, as the .gs bounds it
FINISH_PER_PASS = 20
NOCONTACT_PER_PASS = 25
TEST_CARD_PER_PASS = 5
UNREACHABLE_PER_PASS = 5
# the queue a pass is handed: past it the next pass reads again
QUEUE_MAX = 60
# TP_AUTOCROSS_ARMED_PROP, kept with the hiring marks (app.hiring_marks)
AUTOCROSS_ARMED = "HUB_TALENT_AUTOCROSS_ARMED_AT"
TRIED_STEPS = ("outreach", "manual_contact")
UNREACHABLE = (MD.UNREACHABLE_KEY, MD.UNREACHABLE_SIT)
# the phone ladders whose end is told, not archived: the card stays at New (the operator's order, 2026-10-28)
CONTACT_FAILED = ("hiring.contact_failed", "hiring_contact_failed")
FAILED_STEPS = ("phone_collect", "phone_confirm")
CONTACT_FAILED_STEP = "contact_failed"
# who each rider writes as
FINISH_BY, AUTOCROSS_BY, NOCONTACT_BY = "asa-hub:talent-finish", "asa-hub:talent-autocross", "asa-hub:talent-nocontact"
TEST_CARDS_BY, UNREACHABLE_BY, AUTOFILL_BY = "asa-hub:test-cards", "asa-hub:unreachable", "asa-hub:talent-autofill"
FINISH_WHY = "crossed from the Talent Pipeline already employed — the record was closed"
NOCONTACT_WHY = "no phone and no e-mail on the record — nobody can reach them"
IDLE_EVERY_S = 21600.0
_IDLE: dict[str, float] = {}
_IDLE_LOCK = threading.Lock()


def idle(name: str, why: str) -> None:
    """tpSweepIdle_: a machine that only speaks when it acts cannot be told from a dead one — once in six hours."""
    now = time.monotonic()
    with _IDLE_LOCK:
        last = _IDLE.get(name)
        if last is not None and now - last < IDLE_EVERY_S:
            return
        _IDLE[name] = now
    log.info("asa-hub:%s: %s_idle — %s", name, name, why[:400])


def cards(reads: L.Reads) -> list[dict]:
    """readTabNormalized_(HUB_DB, TALENT_CANDIDATES_TAB)."""
    return CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)


def archived(c: dict | None) -> bool:
    return s_((c or {}).get("archived")).lower() == "true"


def stage(c: dict) -> str:
    return CND.stage_of(c.get("status")) or ""


def cfg(reads: L.Reads, key: str) -> str:
    """simCfgVal_."""
    return HS.val(reads, key)


def autocross_per_pass(reads: L.Reads) -> int:
    """tpAutoCrossPerPass_: an unreadable cell turns it off, a blank or bad one is 10, never past 50."""
    got, why = CND.soft(lambda: TP.parse_int(cfg(reads, "sim_talent_autocross_per_pass")))
    n = 0 if why else got
    if n is None or n < 0:
        return 10
    return min(n, 50)


def autocross_backlog(reads: L.Reads) -> bool:
    """tpAutoCrossBacklog_."""
    got, why = CND.soft(lambda: cfg(reads, "sim_talent_autocross_backlog").lower())
    return not why and bool(re.fullmatch(r"(yes|true|sim|1)", got or ""))


def autofill_cfg(reads: L.Reads, key: str, dflt: int, mx: int) -> int:
    """tpAutoFillCfg_."""
    got, why = CND.soft(lambda: TP.parse_int(cfg(reads, key)))
    n = None if why else got
    if n is None or n < 0:
        return dflt
    return min(n, mx)


def last_human_touch(reads: L.Reads) -> str:
    """tpLastHumanTouch_: the last moment a person moved a card, '' when nobody ever has — the machines all name
    themselves."""
    rows, why = CND.soft(lambda: CND.read_tab(reads, HISTORY_TAB))
    if why:
        return ""
    newest = ""
    for h in rows or []:
        who = s_(h.get("actor"))
        if not who or "@service.local" in who:
            continue
        if who.startswith("asa-hub:") or who.startswith("asa-hub-") or who.startswith("auto-"):
            continue
        at = s_(h.get("timestamp"))
        if at > newest:
            newest = at
    return newest


def tries_said(ask: dict | None) -> str:
    """unreachableTriesSaid_: what their own ask actually did, in words."""
    n = TP.parse_int((ask or {}).get("sentcount")) or 0
    if not n:
        return "every configured try"
    mins = TP.parse_int((ask or {}).get("intervalminutes")) or 0
    hours = int(gsjs.js_round((n * mins) / 60))
    return f"{n} time(s)" + (f" over {hours}h" if hours else "")


# ---- what each rider finds due ----------------------------------------------------------------------------------

def finish_plan(reads: L.Reads) -> dict[str, Any]:
    """talentFinishSweepMaybe_'s look: the cards that stood at Ready to start past their talent_finish_at."""
    rows, why = CND.soft(lambda: cards(reads))
    if why:
        return {"finish": [], "why": why}
    now = W.now_iso(reads)
    out = []
    for c in rows:
        if len(out) >= FINISH_PER_PASS:
            break
        at = s_(c.get("talentfinishat"))
        if not at or at > now or archived(c) or stage(c) != "ready":
            continue
        out.append({"cid": s_(c.get("candidateid")), "name": s_(c.get("candidatename")),
                    "why": s_(c.get("talentfinishwhy"))})
    return {"finish": out}


def autocross_plan(reads: L.Reads) -> dict[str, Any]:
    """tpAutoCrossSweepMaybe_'s look: armed from its first pass (that pass takes nobody); then each signed application
    in no other book, signed after the arming day unless the backlog is let in, with a number somebody can ring."""
    budget = autocross_per_pass(reads)
    if budget <= 0:
        return {"budget": 0, "arm": False, "items": []}
    armed = HH.mark(reads, AUTOCROSS_ARMED)
    if not armed:
        return {"budget": budget, "arm": True, "items": []}
    backlog = autocross_backlog(reads)
    armed_day = armed[:10]
    try:
        waiting = TP.applications_waiting(reads, TP.on_board_index(reads), TP.soft_rows(reads, STORE),
                                          TP.staff_index(reads))
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as exc:  # noqa: BLE001 - said, and the next pass reads again
        log.warning("%s: talent_autocross_read_failed — %s", AUTOCROSS_BY, str(exc)[:300])
        return {"budget": budget, "arm": False, "items": [], "failed": True}
    items: list[dict[str, str]] = []
    skipped = 0
    for p in waiting:
        signed = s_(p.get("signed_at"))
        if not backlog and (not signed or signed <= armed_day):
            skipped += 1
            continue
        if len(re.sub(r"\D", "", s_(p.get("phone")))) < 10:
            skipped += 1
            continue
        if len(items) < QUEUE_MAX:
            items.append({"name": s_(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email")),
                          "location": s_(p.get("location")), "srid": s_(p.get("srid")), "signed": signed,
                          "landing": s_(p.get("landing")) or "new", "landing_why": s_(p.get("landing_why"))})
    said = (" (backlog included)" if backlog else
            f" (armed {armed_day}; everything signed before that day is a press in Actions, and "
            "sim_talent_autocross_backlog is off)")
    if not items:
        idle("talent-autocross", f"ran and took nobody — {len(waiting)} waiting, {skipped} skipped" + said)
    return {"budget": budget, "arm": False, "items": items, "skipped": skipped, "waiting": len(waiting),
            "backlog": backlog, "armed_day": armed_day}


def nocontact_plan(reads: L.Reads) -> dict[str, Any]:
    """tpArchiveNoContactMaybe_'s look: the live store rows with neither a phone nor an e-mail — the same test the
    queue uses, so the store and the queue cannot disagree about who is reachable."""
    out = []
    for r in TP.soft_rows(reads, STORE):
        if len(out) >= NOCONTACT_PER_PASS:
            break
        rid = s_(r.get("candidateid"))
        if not rid or s_(r.get("archived")).lower() == "true" or s_(r.get("phone")) or s_(r.get("email")):
            continue
        out.append({"id": rid, "name": s_(r.get("name")) or rid})
    if not out:
        idle("talent-nocontact", "every live store row carries a phone or an e-mail")
    return {"rows": out}


def test_cards_plan(reads: L.Reads) -> dict[str, Any]:
    """testCardArchiveMaybe_'s look: the rehearsal cards untouched (their last touch, not their birth) for
    sim_archive_test_days."""
    days = TP.parse_int(cfg(reads, "sim_archive_test_days"))
    if days is None or days <= 0:
        idle("test-cards", "sim_archive_test_days is 0 — rehearsal cards stay on the board, and a rehearsal standing "
                           "at New counts against the floor")
        return {"days": 0, "cards": []}
    cutoff = CND.now_ms(reads) - days * 86400000.0
    rows, why = CND.soft(lambda: cards(reads))
    if why:
        return {"days": days, "cards": [], "why": why}
    out = []
    for c in rows:
        if len(out) >= TEST_CARD_PER_PASS:
            break
        if archived(c) or not HH.is_test(reads, c):
            continue
        when = CND.js_date_ms(s_(c.get("updatedat")) or s_(c.get("createdat")))
        if when is None or when > cutoff:
            continue
        cid = s_(c.get("candidateid"))
        out.append({"cid": cid, "name": s_(c.get("candidatename")) or cid})
    if not out:
        idle("test-cards", f"no rehearsal card has been sitting still for {days} day(s)")
    return {"days": days, "cards": out}


def unreachable_plan(reads: L.Reads) -> dict[str, Any]:
    """unreachableArchiveSweepMaybe_'s look: while its situation is on, the cards still at New whose outreach or
    manual first-contact ask ran out of tries; and, while hiring_contact_failed is on, the cards at New whose
    phone-collect or phone-confirm tries ran out, not told yet (`failed` — the team is told once, the card stays)."""
    sid = HH.sit_id(reads, UNREACHABLE)
    fsid = HH.sit_id(reads, CONTACT_FAILED)
    on, fon = HH.situation_on(reads, sid) is not None, HH.situation_on(reads, fsid) is not None
    out: dict[str, Any] = {"on": on, "sid": sid, "items": [], "failed_on": fon, "failed_sid": fsid, "failed": []}
    if not on:
        idle("unreachable", f"{UNREACHABLE[1]} is OFF — nobody is archived for never answering, and the queue stays "
                            "blocked behind them")
    if not on and not fon:
        return out
    asks, why = CND.soft(lambda: HH.sim_rows(reads))
    if why:
        return {**out, "why": why}
    spent: dict[str, dict] = {}
    failed: dict[str, dict] = {}
    for r in asks:
        if s_(r.get("state")) != "exhausted":
            continue
        step = s_(r.get("step"))
        if on and step in TRIED_STEPS:
            spent[s_(r.get("candidateid"))] = r
        elif fon and step in FAILED_STEPS:
            failed[s_(r.get("candidateid"))] = r
    if not spent and on:
        idle("unreachable", "nobody has run out of outreach tries")
    if not spent and not failed:
        return out
    rows, why = CND.soft(lambda: cards(reads))
    if why:
        return {**out, "why": why}
    by_id = {s_(c.get("candidateid")): c for c in rows}
    for cid, ask in spent.items():
        if len(out["items"]) >= UNREACHABLE_PER_PASS:
            break
        cand = by_id.get(cid)
        if cand is None or archived(cand) or stage(cand) != "new":
            continue
        out["items"].append({"cid": cid, "name": s_(cand.get("candidatename")), "tries": tries_said(ask),
                             "phone": s_(cand.get("phone")), "email": s_(cand.get("email")),
                             "rehearsal": HH.is_rehearsal(reads, cand)})
    for cid, ask in failed.items():
        if len(out["failed"]) >= UNREACHABLE_PER_PASS:
            break
        cand = by_id.get(cid)
        if cand is None or archived(cand) or stage(cand) != "new":
            continue
        # told once: the journey line the telling writes is its memo
        journey = CND.journey_for(reads, cid)
        if journey is None or any(s_(j.get("step")) == CONTACT_FAILED_STEP for j in journey):
            continue
        out["failed"].append({"cid": cid, "name": s_(cand.get("candidatename")), "tries": tries_said(ask),
                              "step": s_(ask.get("step")), "phone": s_(cand.get("phone")),
                              "email": s_(cand.get("email")), "rehearsal": HH.is_rehearsal(reads, cand)})
    return out


def autofill_plan(reads: L.Reads) -> dict[str, Any]:
    """tpAutoFillNewMaybe_'s look: when New has fewer cards than the floor and no person has moved one for the idle
    hours, the crossing queue's next names, in its own order."""
    none: dict[str, Any] = {"ready": []}
    floor = autofill_cfg(reads, "sim_talent_autofill_new_floor", 2, 20)
    if floor <= 0:
        idle("talent-autofill", "off — sim_talent_autofill_new_floor is 0")
        return none
    take = autofill_cfg(reads, "sim_talent_autofill_take", 3, 20)
    if take <= 0:
        return none
    idle_hours = autofill_cfg(reads, "sim_talent_autofill_idle_hours", 12, 720)
    rows, why = CND.soft(lambda: cards(reads))
    if why:
        idle("talent-autofill", "the board could not be read — an unread board decides nothing")
        return none
    at_new = sum(1 for c in rows if not archived(c) and stage(c) == "new")
    if at_new >= floor:
        idle("talent-autofill", f"nothing to do — {at_new} card(s) stand at New and the floor is {floor}")
        return none
    last = last_human_touch(reads)
    if last:
        t = CND.js_date_ms(last)
        if t is not None:
            age_h = (CND.now_ms(reads) - t) / 3600000.0
            if age_h < idle_hours:
                idle("talent-autofill", f"New is low ({at_new} of {floor}) but somebody IS watching — a person moved "
                                        f"a card {int(gsjs.js_round(age_h))}h ago and the idle threshold is "
                                        f"{idle_hours}h")
                return none
    queue, why = CND.soft(lambda: TP.crossing(reads))
    if why:
        return none
    ready = (queue or {}).get("ready") or []
    if not ready:
        idle("talent-autofill", f"New is low ({at_new} of {floor}) and nobody has been watching, but the queue is "
                                "empty — there is nobody to start")
        return none
    return {"ready": [{"tp_candidate_id": s_(p.get("tp_candidate_id")), "srid": s_(p.get("srid")),
                       "name": s_(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email"))}
                      for p in ready[:QUEUE_MAX]],
            "at_new": at_new, "floor": floor, "take": take, "idle_hours": idle_hours}


# ---- the doors the relay's clock asks first ---------------------------------------------------------------------

def _due(build: Callable[[L.Reads], dict[str, Any]], count: Callable[[dict], int],
         sealed_for: str = "") -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        if not HH.service(sess):
            return dict(SERVICE_ONLY)
        plan = build(sess.reads)
        data = {**plan, "due": count(plan)}
        return {"status": 200, "data": TP.seal(sealed_for, "service", data) if sealed_for else data}
    return door


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "talentFinishDue": _due(finish_plan, lambda p: len(p["finish"])),
    "talentAutoCrossDue": _due(autocross_plan, lambda p: 1 if p["arm"] else len(p["items"]), "talentAutoCrossSweep"),
    "talentNoContactDue": _due(nocontact_plan, lambda p: len(p["rows"])),
    "testCardsDue": _due(test_cards_plan, lambda p: len(p["cards"])),
    "unreachableDue": _due(unreachable_plan, lambda p: len(p["items"]) + len(p["failed"])),
    "talentAutoFillDue": _due(autofill_plan, lambda p: len(p["ready"]), "talentAutoFillSweep"),
}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
