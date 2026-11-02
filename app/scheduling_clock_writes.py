"""Scheduling's clock, its write (SchedulingFlows.gs schedFlowWork_ after the claim: schedFlowExpireStale_,
schedFlowStageRun_, schedFlowSayOwed_, schedFlowRecord_), after schedulingClockDue planned it: the requests nobody
answered before their day closed and their askers told; each due call-off's outreach run one stage — the house first,
everyone after the wait — and each one-off text a flow owes said, every text through Smart Comms under Apps Script's
own keys; each outcome recorded on its flow. Every row is kept in app.edits as one final write over Scheduling's
houses, the texts in the same transaction."""
from __future__ import annotations

import json
import logging
import math
import time
from typing import Any, Callable

import gsjs
import locations as L
import recon as R
import scheduling as SCH
import scheduling_clock as SCK
import scheduling_flows as SF
import scheduling_timeoff as ST
import scheduling_writes as SW
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

FLOWS, CELLS, INBOX, ROWS = SCK.FLOWS, SCK.CELLS, SCK.INBOX, SCK.ROWS
STALE = "What the clock read is out of date or was not read here, so nothing was written. The next ring reads again."
BUSY = "Another write holds the platform's lock — the next ring tries again."
BY = "the clock"
# the texts this write says before it records them, inside main.py's WRITE_BUDGET_S
BUDGET_S = 4.0

s_ = gsjs.str_


def _json(v: Any) -> str:
    """JSON.stringify."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _count(v: Any) -> int | float:
    """Number(v || 0), kept whole when it is whole."""
    n = SF._num(v or 0)
    if math.isnan(n) or math.isinf(n):
        return 0
    return int(n) if n == int(n) else n


def _iso(ms: float) -> str:
    return SCK.iso_ms(ms)


# ---- the one text door ---------------------------------------------------------------------------------------------

def say(reads: L.Reads, sit: str, phone: Any, values: dict, key: str, who: dict) -> dict[str, Any]:
    """schedText_: every text handed to Smart Comms."""
    return SC.raise_situation(None, situation=sit, to=s_(phone), vars=values or {}, key=key,
                              person=s_(who.get("name")), person_key=s_(who.get("key")), occasion=s_(who.get("date")),
                              ledger_key=s_(who.get("ledger_key")), lane=SCK.LANE, at_ms=int(SCK.now_ms(reads)),
                              prune=True)


def send_many(reads: L.Reads, sit: str, people: list[dict], values: dict, base: str, already: Any, deadline: float,
              cap: int) -> dict[str, Any]:
    """schedFlowSendMany_: one situation to a list, one key per person, inside a deadline and a per-ring cap (the rest
    are `left` for the next ring)."""
    t: dict[str, Any] = {"asked": 0, "sent": 0, "held": 0, "refused": 0, "failed": 0, "no_phone": 0, "quiet": False,
                         "off": False, "left": 0, "told": list(already) if isinstance(already, list) else [], "why": ""}
    done = {s_(k) for k in t["told"]}
    todo = [p for p in people or [] if s_(p.get("key")) not in done]
    for i, p in enumerate(todo):
        if time.time() > deadline:
            t["left"], t["why"] = len(todo) - i, "the time budget ran out — the rest are said on the next ring"
            break
        if cap and t["asked"] >= cap:
            t["left"], t["why"] = len(todo) - i, f"the cap of {cap} texts a ring — the rest on the next ring"
            break
        key = s_(p.get("key"))
        res = say(reads, sit, p.get("phone"), values, base + ":" + key,
                  {"key": key, "name": p.get("name"), "ledger_key": base})
        state = s_(res.get("state"))
        if state == "off":
            t["off"], t["why"] = True, s_(res.get("why"))
            break
        if s_(res.get("held")) == "quiet":
            t["quiet"], t["left"], t["why"] = True, len(todo) - i, s_(res.get("why"))
            break
        t["asked"] += 1
        if state in ("sent", "already"):
            t["sent"] += 1
        elif state == "held":
            t["held"] += 1
        elif state == "refused":
            t["refused"] += 1
        elif state == "no_phone":
            t["no_phone"] += 1
        else:
            t["failed"] += 1
        t["told"].append(key)
    return t


def tally(t: dict, now: float, extra: dict, prev: Any) -> dict[str, Any]:
    """schedFlowTally_: a stage's ring added to what its earlier rings already said."""
    p = prev if isinstance(prev, dict) else {}
    e: dict[str, Any] = {"at": _iso(now)}
    for k in ("asked", "sent", "held", "refused", "failed", "no_phone"):
        e[k] = _count(t.get(k)) + _count(p.get(k))
    e.update({"told": t["told"], "why": t["why"], "off": bool(t["off"]), "left": t["left"] or 0})
    e.update(extra or {})
    return e


# ---- one due flow, one step ------------------------------------------------------------------------------------------

def stage_run(reads: L.Reads, f: dict, st: dict, deadline: float, r: dict, plan: dict) -> None:
    """schedFlowStageRun_: covered and ended stop the outreach; the quiet window moves it to 08:00; stage 1 texts the
    house, stage 2 everyone after the wait."""
    now = SCK.now_ms(reads)
    lg = SCK.log_of(f)
    stage = SF._num(f.get("outreach_stage"))
    stage = 0 if math.isnan(stage) else int(stage) if stage == int(stage) else stage
    r["state"], r["stage"] = s_(f.get("state")), stage
    if SF._ended(f.get("date"), f.get("end_min"), now):
        r.update(state="stopped", next_at="", why="the shift ended before the outreach finished")
        return
    if not SCK.still_open(reads, f):
        r.update(state="covered", next_at="", why="the open shift was filled")
        return
    key = "stage1" if stage == 0 else "stage2"
    if SCK.quiet(now):
        r["next_at"] = _iso(SCK.next8(now))
        r["stage_key"] = key
        held = lg.get(key) if isinstance(lg.get(key), dict) else {}
        r["stage_entry"] = {**held, "held_quiet_at": _iso(now), "resumes_at": r["next_at"]}
        return
    aud = plan.get("audience")
    if not isinstance(aud, dict):
        # the look did not plan this stage (it read the quiet window, or the flow moved): the next ring does
        r["skip"] = True
        return
    # the open-shift texts never carry who called off
    values = SCK.flow_vars(reads, f)
    values.pop("original", None)
    values.pop("replacement", None)
    fid = s_(f.get("id"))
    if stage == 0:
        prev = lg.get("stage1") if isinstance(lg.get("stage1"), dict) else {}
        if not aud.get("readable"):
            r["next_at"] = _iso(now + SCK.RETRY_MS)
            r["stage_key"] = "stage1"
            r["stage_entry"] = {**prev, "why": s_(aud.get("why")), "retry_at": r["next_at"]}
            return
        t1 = send_many(reads, SCK.HOUSE_SITUATION, aud.get("people") or [], values, f"sched:{fid}:s1",
                       prev.get("told"), deadline, 0)
        r["stage_key"] = "stage1"
        r["stage_entry"] = tally(t1, now, {"audience": len(aud.get("people") or []), "busy": aud.get("busy") or 0,
                                           "why": " · ".join(x for x in (t1["why"], s_(aud.get("why"))) if x)}, prev)
        if t1["quiet"]:
            r.update(state="outreach_1", next_at=_iso(SCK.next8(now)))
        elif t1["off"]:
            r.update(state="outreach_1", next_at=_iso(now + SCK.RETRY_MS))
        elif t1["left"]:
            r.update(state="outreach_1", next_at=_iso(now))
        else:
            r.update(state="outreach_wait", stage=1, next_at=_iso(now + st["outreach_wait_min"] * 60000.0))
        return
    prev2 = lg.get("stage2") if isinstance(lg.get("stage2"), dict) else {}
    if not aud.get("readable"):
        r["next_at"] = _iso(now + SCK.RETRY_MS)
        r["stage_key"] = "stage2"
        r["stage_entry"] = {**prev2, "why": s_(aud.get("why")), "retry_at": r["next_at"]}
        return
    blast_end = min(deadline, time.time() + SCK.BLAST_BUDGET_MS / 1000.0)
    t2 = send_many(reads, SCK.EVERYONE_SITUATION, aud.get("people") or [], values, f"sched:{fid}:s2",
                   prev2.get("told"), blast_end, SCK.BLAST_MAX)
    r["stage_key"] = "stage2"
    r["stage_entry"] = tally(t2, now, {"audience": len(aud.get("people") or []), "resolver": s_(aud.get("why"))},
                             prev2)
    if t2["quiet"]:
        r.update(state="outreach_2", next_at=_iso(SCK.next8(now)))
    elif t2["off"]:
        r.update(state="outreach_2", next_at=_iso(now + SCK.RETRY_MS))
    elif t2["left"]:
        r.update(state="outreach_2", next_at=_iso(now))
    else:
        r.update(state="done", stage=2, next_at="")


def say_owed(reads: L.Reads, f: dict, deadline: float, r: dict, plan: dict) -> None:
    """schedFlowSayOwed_: the owed one-off texts of a flow; a stale one (the flow moved on) is dropped and said so."""
    now = SCK.now_ms(reads)
    owed = SCK.owed_of(f)
    if not owed:
        return
    if SCK.quiet(now):
        r["owed_next"] = _iso(SCK.next8(now))
        return
    phones = plan.get("phones") if isinstance(plan.get("phones"), dict) else {}
    for o in owed:
        if time.time() > deadline:
            r["owed_next"] = _iso(now)
            break
        if s_(o.get("while")) and s_(f.get("state")) != s_(o.get("while")):
            r["handled"].append(o.get("idem"))
            r["texts"].append({"sit": o.get("sit"), "key": o.get("key"), "state": "stale",
                               "why": "the flow moved on before it could be said", "at": _iso(now)})
            continue
        key = s_(o.get("key"))
        if key not in phones:
            # owed after the look read it: the next ring says it
            r["owed_next"] = _iso(now)
            break
        values = o.get("vars") if isinstance(o.get("vars"), dict) else {}
        res = say(reads, s_(o.get("sit")), phones[key], values, s_(o.get("idem")), {"key": key, "date": f.get("date")})
        if s_(res.get("held")) == "quiet":
            r["owed_next"] = _iso(SCK.next8(now))
            break
        r["handled"].append(o.get("idem"))
        r["texts"].append({"sit": o.get("sit"), "key": o.get("key"), "state": res.get("state"),
                           "held": res.get("held"), "why": res.get("why"), "at": _iso(now)})


def record(reads: L.Reads, cur: dict, r: dict) -> None:
    """schedFlowRecord_: the outcome written onto the flow as it stands now."""
    now = SCK.now_ms(reads)
    lg = SCK.log_of(cur)
    if r.get("stage_key"):
        lg[r["stage_key"]] = r["stage_entry"]
    if r["handled"]:
        owed = lg.get("owed") if isinstance(lg.get("owed"), list) else []
        lg["owed"] = [o for o in owed if not (isinstance(o, dict) and o.get("idem") in r["handled"])]
    if r["texts"]:
        had = lg.get("texts") if isinstance(lg.get("texts"), list) else []
        lg["texts"] = (had + r["texts"])[-60:]
    if r.get("why") and not r.get("stage_key"):
        lg["last_why"] = r["why"]
    if SCK.reaching(cur) and r.get("state"):
        cur["state"] = r["state"]
        cur["outreach_stage"] = str(r["stage"])
        if r["state"] not in SCK.OUTREACH:
            cur["closed_at"] = _iso(now)
            cur["closed_by"] = "outreach"
            if r.get("why"):
                ST._note(cur, r["why"])
    nxt = ""
    if SCK.reaching(cur):
        nxt = r.get("next_at") or _iso(now + SCK.RETRY_MS)
    if isinstance(lg.get("owed"), list) and lg["owed"]:
        ow = r.get("owed_next") or _iso(now)
        if not nxt or (SCK.ms_of(ow) or 0) < (SCK.ms_of(nxt) or 0):
            nxt = ow
    cur["outreach_next_at"] = nxt
    cur["outreach_log"] = _json(lg)
    cur["updated_at"] = _iso(now)


# ---- the requests nobody answered --------------------------------------------------------------------------------------

def expire(plan: SW.Plan, now: float, today: str) -> int:
    """schedFlowExpireStale_: a Request Off, a swap or a training whose shift ended, a time off whose first day passed —
    closed, its waiting items closed, its asker told."""
    reads = plan.reads
    gone = []
    for f in SCK.flows(reads):
        if not SCK.stale(f, now, today):
            continue
        g = ST._clean(dict(f))
        ST._close(g, "expired", BY, plan.now)
        ST._note(g, "nobody answered before the shift ended; it stood as a training" if g.get("kind") == "training"
                 else "nobody answered before the day")
        gone.append(g)
    for g in gone:
        plan.upsert(FLOWS, g)
    items = []
    for g in gone:
        ST._settle(plan, s_(g.get("id")), "", "closed", "the day passed")
        kind = g.get("kind")
        if kind == "time_off":
            what = ("Time off — " + SF._day_words(g.get("date")) + " to " +
                    SF._day_words(s_(g.get("date_to")) or g.get("date")))
        elif kind == "swap":
            what = "Swap — " + ST._swap_where(reads, g)
        else:
            what = ({"request_off": "Request Off", "training": "Training"}.get(s_(kind), "undefined") + " — " +
                    SF._day_words(g.get("date")) + " · " + ST._shift(g.get("shift_text")) + " · " +
                    ST._house_word(reads, g.get("house_code")))
        training = kind == "training"
        items.append(ST._item(reads, g, "inbox", "info", "trainee" if training else "requester",
                              {"uid": g.get("person_uid"), "name": g.get("person"), "email": ""},
                              "Not answered in time — " + what,
                              "Nobody answered before the shift ended; it stood as a training with the house manager."
                              if training else "Nobody answered before the day, so it closed and nothing changed."))
    ST._inbox(plan, items)
    return len(gone)


# ---- the door ------------------------------------------------------------------------------------------------------

def sweep(sess: L.Session, payload: dict) -> Decision:
    """schedulingClockTick_'s write, after schedulingClockDue: the stale requests closed, each due flow claimed, its
    texts said and its outcome recorded — the flows the look planned and that still stand as it read them."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(SCK.DENIED))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("schedulingClockSweep is read by schedulingClockDue first")
    prep = R.unsealed(SCK.DOOR, "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    out: dict[str, Any] = {"due": bool(prep.get("due")), "expired": 0, "claimed": 0, "skipped": 0, "left": 0,
                           "results": []}
    if not prep.get("due"):
        return Decision({"status": 200, "data": out})
    reads = sess.reads
    deadline = time.time() + BUDGET_S
    W.gate(reads)
    plan = SW.Plan(reads, {"uid": "", "name": BY})
    now = SCK.now_ms(reads)
    out["expired"] = expire(plan, now, SCK.ohio_day(now))
    st = SCH.settings(reads)
    for fp in prep.get("flows") or []:
        if not isinstance(fp, dict):
            continue
        fid = s_(fp.get("id"))
        cur = None
        for f in SCK.flows(reads):
            if s_(f.get("id")) == fid:
                cur = f
        if cur is None or not SCK.due_now(cur, now) or s_(cur.get("state")) != s_(fp.get("state")) or \
                s_(cur.get("outreach_stage")) != s_(fp.get("stage")) or \
                s_(cur.get("outreach_next_at")) != s_(fp.get("next_at")):
            out["skipped"] += 1
            continue
        if time.time() > deadline:
            out["left"] += 1
            continue
        cur = ST._clean(dict(cur))
        r: dict[str, Any] = {"id": fid, "state": "", "stage": 0, "next_at": "", "why": "", "handled": [], "texts": [],
                             "owed_next": ""}
        try:
            if SCK.reaching(cur):
                stage_run(reads, cur, st, deadline, r, fp)
            if not r.get("skip"):
                say_owed(reads, cur, deadline, r, fp)
        except Exception as exc:  # noqa: BLE001 - schedFlowWork_: the flow is tried again after the retry wait
            r["why"] = (str(exc) or type(exc).__name__)[:200]
            r["next_at"] = _iso(now + SCK.RETRY_MS)
        if r.get("skip"):
            out["skipped"] += 1
            continue
        record(reads, cur, r)
        plan.upsert(FLOWS, cur)
        out["claimed"] += 1
        out["results"].append({"id": fid, "state": cur.get("state"), "stage": r.get("stage_key") or "",
                               "next_at": cur.get("outreach_next_at"), "texts": len(r["texts"]),
                               "why": s_(r.get("why")) or s_((r.get("stage_entry") or {}).get("why"))})
    log.info("schedulingClockSweep: %s expired, %s claimed, %s skipped, %s left", out["expired"], out["claimed"],
             out["skipped"], out["left"])
    d = W.final({"status": 200, "data": out}, plan.records(SCH.APP_ID), SCH.APP_ID)
    d.fresh = SCH.books_of(reads, FLOWS, CELLS, INBOX, ROWS, SCH.TABS["settings"])
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"schedulingClockSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"schedulingClockSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"schedulingClockSweep": {"status": 409, "message": BUSY}}
