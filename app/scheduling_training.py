"""SCHEDULING'S TRAINING, IN PYTHON (Scheduling.gs schedIstFor_ / schedTrainingNeed_, SchedulingFlows.gs
schedTraining*_ and schedFlowDecideTraining_): somebody new to a house without its IST works a shift there as a
training beside the house manager — the IST read where the Builder reads it (IST Records), the two seats asked in My
Work, the asks owed as texts for the flow clock, an approval that lets it stand, a decline that takes the trainee off
and opens the shift with the call-off outreach. Every row is a Scheduling row kept in app.edits."""
from __future__ import annotations

import re
from typing import Any

import locations as L
import scheduling as SCH
import scheduling_builder as SB
import scheduling_clock as SCK
import scheduling_flows as SF
import scheduling_timeoff as ST
import scheduling_writes as SW

FLOWS, INBOX = ST.FLOWS, ST.INBOX

s_ = ST._s


def flow_of(reads: L.Reads, fid: Any) -> dict | None:
    """schedFlowFlowById_ over the houses as this write leaves them: the last row with the id."""
    hit = None
    for f in SCH.read_tab(reads, FLOWS):
        if s_(f.get("id")) == s_(fid):
            hit = f
    return hit


def house_managers(reads: L.Reads, house: Any) -> list[dict]:
    """schedHouseManagers_: name, key, uid and e-mail of each house manager."""
    out = []
    for m in SCH.house_managers(reads, s_(house)):
        u = SCH.user_by_key(reads, m["key"])
        out.append({"name": m["name"], "key": m["key"], "uid": u["uid"] if u else "", "email": u["email"] if u else ""})
    return out


def ist_for(reads: L.Reads, key: Any, house: Any) -> dict[str, Any]:
    """schedIstFor_ as the Builder reads it: { has, state, why }, never naming a client."""
    return SB._ist_for(SB._ist_warm(reads), SCH.house_list(reads), key, house)


def need(reads: L.Reads, house: str, key: Any) -> dict | None:
    """schedTrainingNeed_: placing `key` at `house` makes them a trainee — new to the house and without its IST."""
    if SW.on_roster(reads, house, key):
        return None
    got = ist_for(reads, key, house)
    return None if got["has"] is True else got


def title(reads: L.Reads, f: dict) -> str:
    """schedTrainingTitle_."""
    return ("Training — " + s_(f.get("person")) + " · " + SF._day_words(f.get("date")) + " · " +
            ST._shift(f.get("shift_text")) + " · " + ST._house_word(reads, f.get("house_code")))


def words(name: str, why: str) -> str:
    """schedTrainingWords_: the sentence a write adds when it placed somebody as a training."""
    return (name + " works it as a training with the house manager, not as the DSP (" + why + "): the house manager "
            "and a director approve it in My Work; a decline takes " + name + " off and opens the shift.")


def plan_of(reads: L.Reads, house: str, person: dict, now: str) -> dict[str, Any]:
    """schedTrainingPlan_: the two seats, both asked at once; a refusal ({status, message}) when nobody can approve."""
    dirs = SF._directors(reads)
    if not dirs["readable"]:
        return {"status": 503, "message": "Nobody can approve a training right now: " + s_(dirs.get("why")) + "."}
    dir_to = [d for d in dirs["list"] if d["uid"] != s_(person.get("uid"))]
    if not dir_to:
        return {"status": 409, "message": "There is no director who can approve this training: " +
                                          (s_(dirs.get("why")) or "the only one is the person placed") + "."}
    hms: list[dict] = []
    why = ""
    try:
        for h in house_managers(reads, house):
            if not h["uid"] or h["key"] == s_(person.get("key")) or h["uid"] == s_(person.get("uid")):
                continue
            if any(x["uid"] == h["uid"] for x in hms):
                continue
            hms.append(h)
        if not hms:
            why = ("the house has no house manager with an account other than the trainee, so the seat passes to the "
                   "directors")
    except Exception:  # noqa: BLE001 - schedTrainingPlan_ passes the seat on when the managers cannot be read
        why = "the house managers could not be read, so the seat passes to the directors"
    return {"hms": hms, "dirs": dir_to, "seats": [
        {"seat": "house_manager", "to": [{"uid": h["uid"], "name": h["name"], "email": h["email"]} for h in hms],
         "state": "waiting" if hms else "skipped", "by": "", "at": "" if hms else now, "note": "", "why": why},
        {"seat": "director", "to": dir_to, "state": "waiting", "by": "", "at": "", "note": "", "why": ""}]}


def open_flow(plan: SW.Plan, o: dict) -> dict:
    """schedTrainingOpen_: the training flow, once the trainee's cell is written (state training, flow_id o['id']) —
    both seats asked in My Work and by text, the trainee told."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    cell = o.get("cell") or {}
    person = o["person"]
    who, by = s_(person.get("name")), s_((o.get("ctx") or {}).get("name"))
    how = {"editor": "Placed on the calendar by " + by, "assign": "Given the open shift by " + by,
           "take": who + " took the open shift on the Hub",
           "swap": "A swap with " + s_(o.get("giver"))}.get(o["source"], "")
    ist = o.get("ist") or {}
    f = ST._flow_row(plan, {
        "id": o["id"], "kind": "training", "state": "waiting", "house_code": o["house"], "date": o["date"],
        "row_id": "P:" + s_(person.get("key")), "person": who, "person_key": s_(person.get("key")),
        "person_uid": s_(person.get("uid")), "shift_text": s_(cell.get("text")),
        "start_min": ST._num(cell.get("start_min")), "end_min": ST._num(cell.get("end_min")),
        "seats": ST._json(o["plan"]["seats"]), "reason": s_(ist.get("why")),
        "note": how + " · IST " + s_(ist.get("state")), "source": o["source"], "source_ref": s_(o.get("source_ref")),
        "created_by": s_((o.get("ctx") or {}).get("uid"))})
    values = SCK.flow_vars(reads, f)
    values["trainee"] = who
    house, head = ST._house_word(reads, o["house"]), title(reads, f)
    body = (who + " has no IST at " + house + " (" + s_(ist.get("state")) + "). " + how + "; they work it as a "
            "training with the house manager, not as the DSP. Approve: the training stands. Decline: they leave the "
            "shift and it opens at the top with the call-off outreach. The house manager and a director both answer; "
            "one decline decides.")
    items = []
    for h in o["plan"]["hms"]:
        items.append(ST._item(reads, f, "work", "approval", "house_manager", h, head, body))
        ST._owe(f, "sched_training_ask", h["key"], values, plan.now, now_ms, "waiting")
    for d in o["plan"]["dirs"]:
        items.append(ST._item(reads, f, "work", "approval", "director", d, head, body))
        dk = SCH.fold(d.get("name"))
        if dk:
            ST._owe(f, "sched_training_ask", dk, values, plan.now, now_ms, "waiting")
    if s_(person.get("uid")):
        items.append(ST._item(reads, f, "inbox", "info", "trainee", {"uid": person["uid"], "name": who, "email": ""},
                              "On a shift as a training — " + SF._day_words(o["date"]) + " · " +
                              ST._shift(f.get("shift_text")) + " · " + house,
                              "There is no IST for you at " + house + " on file, so you work this shift as a training "
                              "with the house manager, not as the DSP. The house manager and a director approve it; a "
                              "decline takes you off the shift."))
    plan.upsert(FLOWS, f)
    ST._inbox(plan, items)
    return f


def told(reads: L.Reads, f: dict, head: str, body: str, dir_kind: str = "info") -> list[dict]:
    """schedTrainingTold_: the trainee, the house managers and the directors, each told the same thing."""
    items: list[dict] = []
    seen: set[str] = set()

    def add(seat: str, kind: str, to: dict) -> None:
        uid = s_(to.get("uid"))
        if not uid or seat + "|" + uid in seen:
            return
        seen.add(seat + "|" + uid)
        items.append(ST._item(reads, f, "inbox", kind, seat,
                              {"uid": uid, "name": s_(to.get("name")), "email": s_(to.get("email"))}, head, body))

    add("trainee", "info", {"uid": f.get("person_uid"), "name": f.get("person")})
    try:
        for h in house_managers(reads, f.get("house_code")):
            if h["uid"] != s_(f.get("person_uid")):
                add("house_manager", "info", h)
    except Exception:  # noqa: BLE001 - schedTrainingTold_ notes it and tells the others
        ST._note(f, "the house managers could not be read to be told")
    for d in SF._directors(reads)["list"]:
        if d["uid"] != s_(f.get("person_uid")):
            add("director", dir_kind or "info", d)
    return items


def end(plan: SW.Plan, fid: str, state: str, ctx: dict, why: str) -> dict | None:
    """schedTrainingEnd_: a training still waiting that ends without an answer."""
    f = flow_of(plan.reads, fid)
    if not f or f.get("kind") != "training" or s_(f.get("state")) != "waiting":
        return None
    by = s_(ctx.get("name"))
    f = ST._clean(dict(f))
    ST._close(f, state, by, plan.now)
    ST._note(f, why)
    plan.upsert(FLOWS, f)
    ST._settle(plan, s_(f.get("id")), "", "closed", by)
    if s_(f.get("person_uid")):
        ST._inbox(plan, [ST._item(plan.reads, f, "inbox", "info", "trainee",
                                  {"uid": f["person_uid"], "name": f.get("person"), "email": ""},
                                  "Training closed — " + re.sub(r"^Training — ", "", title(plan.reads, f)),
                                  "Nothing waits on it any more: " + why + ".")])
    return f


def moved(plan: SW.Plan, fid: str, cell: dict | None, ctx: dict) -> dict | None:
    """schedTrainingMoved_: an editor changed a training shift's hours, and the flow carries the new ones."""
    f = flow_of(plan.reads, fid)
    if not f or f.get("kind") != "training" or not cell:
        return None
    f = ST._clean(dict(f))
    f["shift_text"] = s_(cell.get("text"))
    f["start_min"] = ST._num(cell.get("start_min"))
    f["end_min"] = ST._num(cell.get("end_min"))
    f["updated_at"] = plan.now
    ST._note(f, "hours changed to " + s_(cell.get("text")) + " by " + s_(ctx.get("name")))
    plan.upsert(FLOWS, f)
    return f


def decide(plan: SW.Plan, flow: dict, item: dict, word: str, note: str, actor: dict) -> dict[str, Any]:
    """schedFlowDecideTraining_: a seat answered on a training; approve waits for the other seat, one decline decides."""
    reads = plan.reads
    seats = ST._seat_mark(flow, s_(item.get("seat")), word, note, actor, plan.now)
    values = SCK.flow_vars(reads, flow)
    values["trainee"] = s_(flow.get("person"))
    if word == "decline":
        return decline(plan, flow, actor, note, values)
    other = "house_manager" if s_(item.get("seat")) == "director" else "director"
    left = 0
    for r in [dict(x) for x in SCH.read_tab(reads, INBOX)]:
        if s_(r.get("flow_id")) != s_(flow.get("id")) or r.get("box") != "work" or r.get("state") != "waiting" or \
                s_(r.get("seat")) != other:
            continue
        if s_(r.get("to_uid")) != s_(actor.get("uid")):
            left += 1
            continue
        r = ST._clean(r)
        r.update({"state": "closed", "answered_by": actor["name"], "answered_at": plan.now,
                  "note": "answered on the other seat"})
        plan.upsert(INBOX, r)
    for s in seats:
        if not isinstance(s, dict) or s.get("seat") != other or s.get("state") != "waiting" or left:
            continue
        s["state"] = "skipped"
        s["at"] = plan.now
        s["why"] = (actor["name"] + " answered as a director and no other house manager is left, so the seat passes "
                    "to the directors" if other == "house_manager"
                    else actor["name"] + " answered as the house manager and no other director is left to answer")
    flow["seats"] = ST._json(seats)
    waiting = [s for s in seats if isinstance(s, dict) and s.get("state") == "waiting"]
    if waiting:
        return {"said": "Approved. Waiting on " + ("a director" if waiting[0].get("seat") == "director"
                                                   else "the house manager") + "."}
    ST._close(flow, "approved", actor["name"], plan.now)
    # an editor's placement is their pattern from now on: the roll gives it to them
    cell = SW.cell_at(reads, s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date")))
    if flow.get("source") == "editor" and cell and s_(cell.get("state")) == "training" and \
            s_(cell.get("flow_id")) == s_(flow.get("id")):
        SW.set_cell(plan, s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date")),
                    {"text": s_(cell.get("text")), "state": "training", "base": s_(cell.get("text")),
                     "flow_id": s_(flow.get("id")), "source": s_(cell.get("source"))},
                    "training", "training approved", s_(flow.get("id")))
    values["result"] = "approved: you work it as a training with the house manager"
    ST._owe(flow, "sched_training_decided", flow.get("person_key"), values, plan.now, SF._now_ms(reads))
    by_who = " and ".join(s_(s.get("by")) for s in seats if isinstance(s, dict) and s.get("state") == "approved")
    ST._inbox(plan, told(reads, flow, "Training approved — " + re.sub(r"^Training — ", "", title(reads, flow)),
                         "Approved by " + by_who + ". " + s_(flow.get("person")) + " works the shift as a training "
                         "with the house manager, not as the DSP."))
    return {"said": "Approved. The training stands: " + s_(flow.get("person")) + " works the shift as a trainee, not "
                    "as the DSP."}


def decline(plan: SW.Plan, flow: dict, actor: dict, note: str, values: dict) -> dict[str, Any]:
    """schedTrainingDecline_: the trainee leaves the cell (back to what it held before), the shift goes to an OPEN row
    at the top with the call-off outreach."""
    reads = plan.reads
    house = ST._house_word(reads, flow.get("house_code"))
    ST._close(flow, "declined", actor["name"], plan.now)
    ST._settle(plan, s_(flow.get("id")), "", "closed", actor["name"])
    code, row_id, day = s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date"))
    cell = SW.cell_at(reads, code, row_id, day)
    live = bool(cell and s_(cell.get("state")) == "training" and s_(cell.get("flow_id")) == s_(flow.get("id")))
    if not live:
        what = "The shift had changed on the calendar, so nothing opened."
    elif SF._ended(day, cell.get("end_min"), SF._now_ms(reads)):
        what = "The shift had already ended, so nothing opened."
    else:
        before = s_(cell.get("base"))
        co = ST._call_off_apply(
            plan, actor, code, row_id, day, cell,
            {"name": flow.get("person"), "key": flow.get("person_key"), "uid": flow.get("person_uid")}, "", "",
            "training", s_(flow.get("id")), "", source="training", note="training declined by " + actor["name"],
            patch={"text": before, "state": "scheduled" if before else "", "base": "", "flow_id": "", "source": "app"},
            open_base=s_(cell.get("text")) if flow.get("source") == "editor" else "")
        flow["open_row_id"] = co["open_row_id"]
        what = "The shift is open at the top of " + house + " and the call-off outreach has started."
    ST._note(flow, "declined by " + actor["name"] + (': "' + note + '"' if note else "") + " — " + what)
    values["result"] = "not approved" + (": you are off that shift" if live else "")
    ST._owe(flow, "sched_training_decided", flow.get("person_key"), values, plan.now, SF._now_ms(reads))
    head = "Training declined — " + re.sub(r"^Training — ", "", title(reads, flow))
    body = ("Declined by " + actor["name"] + (': "' + note + '"' if note else "") + ". " + s_(flow.get("person")) +
            " is off the shift. " + what)
    items = told(reads, flow, head, body, "warning")
    if flow.get("source") == "swap":
        sw = flow_of(reads, flow.get("source_ref"))
        mine = bool(sw) and s_(sw.get("person_key")) == s_(flow.get("person_key"))
        other_uid = (s_(sw.get("replacement_uid")) if mine else s_(sw.get("person_uid"))) if sw else ""
        other_name = (s_(sw.get("replacement")) if mine else s_(sw.get("person"))) if sw else ""
        if other_uid:
            items.append(ST._item(reads, flow, "inbox", "info", "staff",
                                  {"uid": other_uid, "name": other_name, "email": ""}, head,
                                  "The swap had finished, but " + s_(flow.get("person")) + "'s training was not "
                                  "approved. " + what))
    ST._inbox(plan, items)
    return {"said": "Declined. " + s_(flow.get("person")) + " is off the shift. " + what}
