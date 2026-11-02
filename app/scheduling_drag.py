"""House Calendars' drag and drop for a house manager and above (the operator, 2026-11-02): a shift dropped on another
cell of the same house changes hands at once, auto-approved — no approval chain — once the side panel has listed what
that drop does and it is confirmed. Swap shifts, and the drag of anyone below (which opens the approval workflows), are
unchanged.

A drop, by where it lands (one house; any shift not yet begun):
  move      a person's shift on a person's empty or OFF cell, any day: it lands there and leaves its own cell
  exchange  a person's shift on another person's shift (or their own on another day): the two change places
  assign    an OPEN shift on a person's empty or OFF cell the same day: they are given it (a call-off's outreach stops)
  release   a person's shift on an empty OPEN cell: it becomes OPEN there; nobody is texted to cover it (Call Off is
            what reaches out)

Who: Scheduling open, then App Control's row `scheduling.dragMove` opening the whole view AND naming a badge the account
has ticked (the role word never). The master, a Scheduling director and a Platform Lead, Director, Supervisor,
Administrator or Admin move at every house; anyone else the row opens (House Manager, Team Lead) only at a house whose
** row is theirs.

Everyone whose shifts changed is told twice: a text through Smart Comms (owed on the move's own flow, kind `move`, said
by the Scheduling clock) and an informative in My Work (sched_inbox box work, state posted). The checks are the editors'
own (scheduling_writes.cell_save, give_cell, assign_open); a preview runs the whole move on the request's copy and
keeps nothing."""
from __future__ import annotations

from typing import Any

import gsjs
import locations as L
import scheduling as SCH
import scheduling_clock as SCK
import scheduling_flow_writes as FW
import scheduling_flows as SF
import scheduling_timeoff as ST
import scheduling_training as TR
import scheduling_writes as SW
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

FEATURE = "scheduling.dragMove"
FEATURE_LABEL = "Scheduling › Drag and drop"
# the badges that move at every house; any other badge the row names moves only at its own ** houses
EVERY_HOUSE = ("PLATFORMLEAD", "DIRECTOR", "SUPERVISOR", "ADMINISTRATOR", "ADMIN")
VIA = "move"
# Smart Comms situations (smart_comms.SEEDS)
SIT_MOVED = "sched_drag_moved"
SIT_OPEN = "sched_open_assigned"
# the My Work informatives: their own kinds, never an approval (box work, state posted)
NOTE_MOVED, NOTE_OPEN = "moved", "open_assigned"
NOTE_KINDS = (NOTE_MOVED, NOTE_OPEN)
NOTE_SEAT, NOTE_STATE = "informed", "posted"
MOVERS_ONLY = ("Drag and drop moves shifts at once for a house manager or team lead at the houses they manage, and for "
               "a supervisor, an admin, a director and the master at every house.")
# the panel lists what stops a drop first, then what it warns of, then what it only says
TONE_ORDER = {"block": 0, "warn": 1, "info": 2}
OFF_WORDS = {"called_off": "called off", "requested_off": "on Request Off", "time_off": "on time off"}

s_ = gsjs.str_


# ---- who moves ---------------------------------------------------------------------------------------------------

def row_opens(reads: L.Reads, user: dict | None) -> bool:
    """App Control's row opens every row to this viewer AND names a badge the account has ticked (recon.badge_opens);
    the master always. FAIL-CLOSED."""
    if sc.is_real_master(user):
        return True
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    try:
        g = sc.profile_app_gate(FEATURE, user, reads.scope_sources())
        rule = (reads.app_rules().get("rules") or {}).get(FEATURE) or []
    except Defer:
        return False
    return (g.get("open") is True and (g.get("scope") or {}).get("kind") == "all"
            and any(b in rule for b in sc.badges_worn(user.get("types"), "")))


def every_house(ctx: dict) -> bool:
    if ctx.get("is_master") or ctx.get("is_director"):
        return True
    worn = sc.badges_worn((ctx.get("user") or {}).get("types"), "")
    return any(b in worn for b in EVERY_HOUSE)


def moves_at(reads: L.Reads, ctx: dict) -> Any:
    """The test of a house this viewer moves shifts at."""
    if not ctx.get("open") or not ctx.get("uid") or not row_opens(reads, ctx.get("user")):
        return lambda _code: False
    if every_house(ctx):
        return lambda _code: True
    return ctx["editor_of"]


def houses_for(reads: L.Reads, ctx: dict, codes: list[str]) -> list[str]:
    """The board's houses this viewer moves shifts at (the board says them as viewer.drag_move)."""
    test = moves_at(reads, ctx)
    return [c for c in codes if test(c)]


# ---- the cells ---------------------------------------------------------------------------------------------------

def _cls(text: Any) -> Any:
    return SCH.classify(s_(text))


def _timed(text: Any) -> bool:
    c = _cls(text)
    return bool(c and c.start is not None)


def _span(text: str) -> tuple[int, int] | None:
    return SCH.value_span(_cls(text), text)


def _begins_later(reads: L.Reads, day: str, text: str) -> bool:
    """The shift `text` on `day` has not begun yet (Ohio)."""
    span = _span(text)
    return bool(span) and SF._at_min(day, span[0]) > SF._now_ms(reads)


def _under(cell: dict | None, busy: dict | None) -> dict | None:
    """A cancelled training's cell is written as the plain shift under it (cell_save, give_cell)."""
    if busy and cell and s_(cell.get("state")) == "training" and s_(cell.get("flow_id")) == s_(busy.get("id")):
        return {"id": cell["id"], "text": s_(cell.get("base")), "state": "", "base": "", "flow_id": ""}
    return cell


def _row_name(row: dict) -> str:
    """A person's name, or an OPEN row as the grid labels it."""
    if row.get("row_kind") != "open":
        return s_(row.get("name"))
    n = SCH.open_n(row.get("row_id"))
    return "OPEN " + str(n) if n > 1 else "OPEN"


def _short(day: str) -> str:
    return SF._day_words(day)


def _words(text: str) -> str:
    return ST._shift(text) if s_(text) else ""


# ---- what a drop does ------------------------------------------------------------------------------------------------

def assess(reads: L.Reads, ctx: dict, house: str, src: tuple[str, str], dst: tuple[str, str]) -> dict[str, Any]:
    """What dropping the shift at `src` (row_id, day) on `dst` does, every check the editors' writes make, before
    anything is written: {kind, title, blocks, notes, changes, ...}."""
    a: dict[str, Any] = {"house": house, "src": src, "dst": dst, "kind": "", "title": "Move shift", "blocks": [],
                         "notes": [], "changes": [], "busy": [], "prefs": [], "seen_from": "", "seen_to": ""}
    block = a["blocks"].append
    label = SCH.house_label(reads, house)
    src_row, dst_row = SW.row_at(reads, house, src[0]), SW.row_at(reads, house, dst[0])
    if not src_row or src_row["active"] == "no" or not dst_row or dst_row["active"] == "no":
        block("That row is not on " + label + "'s calendar.")
        return a
    if src == dst:
        block("The shift was dropped where it already is.")
        return a
    for day in {src[1], dst[1]}:
        if not SCH.period_of(reads, day):
            block(SCH.day_words(day) + " is not on any calendar period yet.")
            return a
    a["src_row"], a["dst_row"] = src_row, dst_row
    sc_cell, dc_cell = SW.cell_at(reads, house, *src), SW.cell_at(reads, house, *dst)
    a["src_cell"], a["dst_cell"] = sc_cell, dc_cell
    s_text, t_text = s_((sc_cell or {}).get("text")), s_((dc_cell or {}).get("text"))
    s_state, t_state = s_((sc_cell or {}).get("state")), s_((dc_cell or {}).get("state"))
    a["seen_from"], a["seen_to"], a["s_text"], a["t_text"] = s_text, t_text, s_text, t_text
    if not _timed(s_text):
        block("There is no timed shift in that cell to move.")
        return a
    if src_row["row_kind"] == "open":
        if s_state != "open":
            block("That OPEN shift is not open any more — somebody took it a moment ago.")
            return a
    elif src_row["row_kind"] == "person":
        if s_state in SCH.OFF_STATES:
            block("That shift is " + (OFF_WORDS.get(s_state) or "not held by anybody now") +
                  ": only a shift somebody holds is moved.")
            return a
    else:
        block("Only a person's shift or an OPEN shift is moved.")
        return a
    if not _begins_later(reads, src[1], s_text):
        block("This shift has already begun — only a shift still to come is moved.")
        return a
    tc = _cls(t_text)
    held = bool(t_text and tc and tc.start is not None and t_state not in SCH.OFF_STATES)
    dst_name = s_(dst_row["name"])

    def dst_free_or_block() -> bool:
        """A person's cell a shift may land on: empty, OFF or given away; anything else is said."""
        if t_state in OFF_WORDS:
            block("Not possible: " + dst_name + " is " + OFF_WORDS[t_state] + " that day.")
            return False
        if t_text and tc and tc.kind == "ro":
            block("Not possible: " + dst_name + " is on R/O that day.")
            return False
        if t_text and t_state not in SCH.OFF_STATES and not (tc and tc.kind == "off"):
            block("Not possible: " + dst_name + " already has " + t_text + " at " + label + " that day.")
            return False
        return True

    if src_row["row_kind"] == "open":
        a["kind"], a["title"] = "assign", "Give the OPEN shift"
        if dst_row["row_kind"] != "person" or not s_(dst_row["person_key"]):
            block("An OPEN shift is dropped on somebody's row.")
            return a
        if dst[1] != src[1]:
            block("An OPEN shift stays on its own day: drop it on " + SCH.day_words(src[1]) + ".")
            return a
        if not dst_free_or_block():
            return a
        a["changes"] = [_change(src_row, src[1], s_text, ""), _change(dst_row, dst[1], t_text, s_text)]
        _place_checks(reads, ctx, a, dst_row, dst[1], s_text, dc_cell, (s_((dc_cell or {}).get("id")),))
        flow_id = s_((sc_cell or {}).get("flow_id"))
        co = TR.flow_of(reads, flow_id) if flow_id else None
        if co and co.get("kind") == "call_off" and s_(co.get("state")) in FW.OUTREACH:
            a["notes"].append(_note("info", "This OPEN shift came from a call-off still reaching out for cover: the "
                                            "outreach stops, it is covered."))
        a["told"] = [_tell(reads, dst_row, SIT_OPEN, NOTE_OPEN, dst[1], s_text, s_text)]
    elif dst_row["row_kind"] == "open":
        a["kind"], a["title"] = "release", "Make the shift OPEN"
        if t_text:
            block("That OPEN cell already holds " + t_text + ": drop the shift on an empty one.")
            return a
        if dst[1] != src[1] and not _begins_later(reads, dst[1], s_text):
            block("On " + SCH.day_words(dst[1]) + " this shift would already have begun.")
            return a
        a["changes"] = [_change(src_row, src[1], s_text, ""), _change(dst_row, dst[1], "", s_text)]
        a["notes"].append(_note("info", "It stays OPEN on " + label + "'s calendar. Nobody is texted to cover it — Call "
                                        "Off is what reaches out; give it to somebody by dropping it on their row."))
        a["told"] = [_tell(reads, src_row, SIT_MOVED, NOTE_MOVED, src[1], s_text, "")]
    elif dst_row["row_kind"] == "person" and s_(dst_row["person_key"]):
        same = dst_row["row_id"] == src_row["row_id"]
        if held:
            a["kind"], a["title"] = "exchange", "Exchange the shifts"
            if not _begins_later(reads, dst[1], t_text):
                block(dst_name + "'s " + t_text + " on " + SCH.day_words(dst[1]) + " has already begun.")
                return a
            for day, text in ((dst[1], s_text), (src[1], t_text)):
                if not _begins_later(reads, day, text):
                    block(text + " on " + SCH.day_words(day) + " would already have begun.")
                    return a
            ids = (s_((sc_cell or {}).get("id")), s_((dc_cell or {}).get("id")))
            a["changes"] = [_change(src_row, src[1], s_text, t_text), _change(dst_row, dst[1], t_text, s_text)]
            _place_checks(reads, ctx, a, dst_row, dst[1], s_text, dc_cell, ids)
            _place_checks(reads, ctx, a, src_row, src[1], t_text, sc_cell, ids)
            a["told"] = [_tell(reads, src_row, SIT_MOVED, NOTE_MOVED, src[1], s_text, t_text)]
            if not same:
                a["told"].append(_tell(reads, dst_row, SIT_MOVED, NOTE_MOVED, dst[1], t_text, s_text))
        else:
            a["kind"], a["title"] = "move", ("Move the shift to another day" if same else "Move the shift")
            if not dst_free_or_block():
                return a
            if not _begins_later(reads, dst[1], s_text):
                block(s_text + " on " + SCH.day_words(dst[1]) + " would already have begun.")
                return a
            a["changes"] = [_change(src_row, src[1], s_text, ""), _change(dst_row, dst[1], t_text, s_text)]
            _place_checks(reads, ctx, a, dst_row, dst[1], s_text, dc_cell,
                          (s_((dc_cell or {}).get("id")), s_((sc_cell or {}).get("id"))))
            a["told"] = [_tell(reads, dst_row, SIT_MOVED, NOTE_MOVED, dst[1], t_text, s_text)] if same else [
                _tell(reads, src_row, SIT_MOVED, NOTE_MOVED, src[1], s_text, ""),
                _tell(reads, dst_row, SIT_MOVED, NOTE_MOVED, dst[1], t_text, s_text)]
    else:
        block("A shift is dropped on somebody's row or on an OPEN row.")
        return a
    # a swap, a Request Off or a training waiting on either cell is cancelled with it, its asker told
    for row, day in ((src_row, src[1]), (dst_row, dst[1])):
        busy = SW.cell_busy(reads, house, row["row_id"], day)
        if busy and all(b[0].get("id") != busy.get("id") for b in a["busy"]):
            a["busy"].append((busy, row["row_id"], day))
            a["notes"].append(_note("warn", "The pending " + SW.pending_what(busy, house, row["row_id"], day) +
                                            " on " + s_(row["name"]) + "'s " + _short(day) +
                                            " shift is cancelled; whoever asked is told."))
    for t in a.get("told") or []:
        if not t["uid"]:
            a["notes"].append(_note("info", t["name"] + " has no platform account: no My Work note can reach them."))
    a["notes"].append(_note("info", _told_line(a.get("told") or [])))
    if ST._test_word(reads) == "yes":
        a["notes"].append(_note("info", "Test mode is on: Smart Comms holds the texts, so nobody is contacted yet."))
    return a


def _change(row: dict, day: str, was: str, now: str) -> dict[str, str]:
    return {"row_id": s_(row.get("row_id")), "name": _row_name(row), "date": day, "day": SCH.day_words(day),
            "was": was, "now": now}


def _note(tone: str, text: str) -> dict[str, str]:
    return {"tone": tone, "text": text}


def _place_checks(reads: L.Reads, ctx: dict, a: dict, row: dict, day: str, text: str, was: dict | None,
                  ignore: tuple) -> None:
    """A shift placed on a person: free at every house (their own cells this drop changes set aside), their Staff
    Preferences for a day they had no shift, and the training it makes for somebody new to the house without its IST."""
    name, key = s_(row["name"]), s_(row["person_key"])
    span = _span(text)
    hit = SCH.clash(reads, key, day, span[0] if span else None, span[1] if span else None,
                    ignore=tuple(i for i in ignore if i), house_code=a["house"], value=text)
    if hit:
        a["blocks"].append(SCH.clash_sentence(reads, name, hit, ctx, key))
        return
    if not _timed((was or {}).get("text")):
        crossed = SCH.prefs_against(reads, key, name, a["house"], day)
        if crossed:
            a["prefs"].append((key, day, crossed))
            a["notes"].append(_note("warn", crossed["why"] + " Confirming overrides them, and the override is logged."))
    held_one_off = was and s_(was.get("state")) in SCH.HELD_ONE_OFF and s_(was.get("text"))
    need = None if held_one_off else TR.need(reads, a["house"], key)
    if need:
        u = SCH.user_by_key(reads, key)
        t_plan = TR.plan_of(reads, a["house"], {"name": name, "key": key, "uid": u["uid"] if u else ""},
                            SCH.now_iso(reads))
        if t_plan.get("status"):
            a["blocks"].append(s_(t_plan["message"]))
            return
        a["notes"].append(_note("warn", TR.words(name, s_(need.get("why")))))


def _tell(reads: L.Reads, row: dict, sit: str, kind: str, day: str, was: str, now: str) -> dict[str, Any]:
    """Somebody whose shifts this drop changes: their cell on `day` read `was` and reads `now` afterwards."""
    u = SCH.user_by_key(reads, row["person_key"])
    return {"key": s_(row["person_key"]), "name": s_(row["name"]), "uid": u["uid"] if u else "", "sit": sit,
            "kind": kind, "day": day, "was": was, "now": now, "text": now or was}


def _told_line(told: list[dict]) -> str:
    names = [t["name"] for t in told]
    who = " and ".join(names) if len(names) <= 2 else ", ".join(names[:-1]) + " and " + names[-1]
    return "Auto-approved: nothing is asked of anybody." + (
        " " + who + (" is" if len(names) == 1 else " are") + " told by text (Smart Comms) and in My Work." if names
        else "")


# ---- the write ---------------------------------------------------------------------------------------------------

def apply(plan: SW.Plan, ctx: dict, a: dict) -> dict[str, Any]:
    """The move written on the plan, in the editors' own steps; {trainings, refusal}."""
    house = a["house"]
    src, dst = a["src"], a["dst"]
    src_row, dst_row, sc_cell, dc_cell = a["src_row"], a["dst_row"], a["src_cell"], a["dst_cell"]
    busy_of = {(r, d): b for b, r, d in a["busy"]}
    s_text, t_text = a["s_text"], a["t_text"]
    by = s_(ctx.get("name")) or "An editor"
    trainings: list[dict] = []

    def place(row: dict, day: str, value: str, was: dict | None, note: str) -> dict | None:
        placed = SW.editor_place(plan, house, row, day, value, _under(was, busy_of.get((row["row_id"], day))), VIA,
                                 note, None)
        if placed.get("status"):
            return {"status": placed["status"], "message": placed["message"]}
        if placed.get("training"):
            trainings.append({"name": s_(row["name"]), **placed["training"]})
        return None

    kind = a["kind"]
    if kind == "assign":
        no = _assign(plan, ctx, a, trainings)
    elif kind == "release":
        SW.set_cell(plan, house, dst[0], dst[1], {"text": s_text, "source": "app"}, VIA,
                    "Made OPEN by " + by + " (drag and drop), from " + s_(src_row["name"]), "")
        no = place(src_row, src[1], "", sc_cell, "Made OPEN by " + by + " (drag and drop)")
    elif kind == "move":
        no = place(dst_row, dst[1], s_text, dc_cell, "Moved by " + by + " (drag and drop) from " +
                   s_(src_row["name"]) + " " + _short(src[1]))
        if not no:
            no = place(src_row, src[1], "", sc_cell, "Moved by " + by + " (drag and drop) to " +
                       s_(dst_row["name"]) + " " + _short(dst[1]))
    else:
        no = place(dst_row, dst[1], s_text, dc_cell, "Exchanged by " + by + " (drag and drop) with " +
                   s_(src_row["name"]) + " " + _short(src[1]))
        if not no:
            no = place(src_row, src[1], t_text, sc_cell, "Exchanged by " + by + " (drag and drop) with " +
                       s_(dst_row["name"]) + " " + _short(dst[1]))
    if no:
        return {"refusal": no, "trainings": trainings}
    for busy, row_id, day in a["busy"]:
        FW.cancel_pending(plan, {k: v for k, v in busy.items() if not k.startswith("_")}, ctx, house, row_id, day)
    _record(plan, ctx, a)
    return {"refusal": None, "trainings": trainings}


def _assign(plan: SW.Plan, ctx: dict, a: dict, trainings: list[dict]) -> dict | None:
    """assign_open's own write, the checks already made: the OPEN shift placed on the person (a training when they are
    new to the house without its IST), the OPEN cell cleared, a call-off's outreach covered."""
    reads, house = plan.reads, a["house"]
    (open_row, day), row = a["src"], a["dst_row"]
    opened, was, text = a["src_cell"], a["dst_cell"], a["s_text"]
    flow_id = s_(opened.get("flow_id"))
    n = SCH.open_n(open_row)
    why = ("Assigned from " + ("OPEN " + str(n) if n > 1 else "OPEN") + " by " + s_(ctx.get("name")) +
           " (drag and drop)")
    need = TR.need(reads, house, row["person_key"])
    t_plan, person = None, None
    if need:
        u = SCH.user_by_key(reads, row["person_key"])
        person = {"name": row["name"], "key": row["person_key"], "uid": u["uid"] if u else ""}
        t_plan = TR.plan_of(reads, house, person, plan.now)
        if t_plan.get("status"):
            return {"status": t_plan["status"], "message": t_plan["message"]}
    tid = SF._new_id("SF", house + "|" + row["row_id"] + "|" + day + "|training", SF._now_ms(reads)) if need else ""
    if tid:
        placed = SW.set_cell(plan, house, row["row_id"], day, {"text": text, "state": "training", "base": SW.base_of(was),
                                                               "flow_id": tid, "source": "flow:" + tid}, VIA, why, tid)
    elif flow_id:
        placed = SW.set_cell(plan, house, row["row_id"], day, {"text": text, "state": "taken", "base": SW.base_of(was),
                                                               "flow_id": flow_id, "source": "flow:" + flow_id},
                             VIA, why, flow_id)
    else:
        placed = SW.set_cell(plan, house, row["row_id"], day, {"text": text, "source": "app"}, VIA, why, "")
    if flow_id and s_(opened.get("base")):
        SW.set_cell(plan, house, open_row, day, {"text": "", "state": "taken", "base": s_(opened["base"]), "flow_id": "",
                                                 "source": "app"}, VIA, "Assigned to " + s_(row["name"]), flow_id)
    else:
        SW.set_cell(plan, house, open_row, day, {"text": ""}, VIA, "Assigned to " + s_(row["name"]), flow_id)
    if flow_id:
        FW.covered_by(plan, flow_id, s_(ctx.get("name")))
    if tid:
        TR.open_flow(plan, {"id": tid, "house": house, "date": day, "cell": placed, "person": person, "ist": need,
                            "source": "assign" if flow_id else "editor", "source_ref": flow_id, "ctx": ctx,
                            "plan": t_plan})
        trainings.append({"name": s_(row["name"]), "flow_id": tid, "why": s_(need.get("why"))})
    return None


def _change_words(a: dict, t: dict) -> str:
    """One person's change as their text and their My Work note say it."""
    src, dst, kind = a["src"], a["dst"], a["kind"]
    src_row, dst_row = a.get("src_row") or {}, a.get("dst_row") or {}
    was, now, day = _words(t["was"]), _words(t["now"]), _short(t["day"])
    same = src_row.get("row_id") == dst_row.get("row_id")
    other = s_(dst_row.get("name")) if t["key"] == s_(src_row.get("person_key")) else s_(src_row.get("name"))
    if kind == "assign":
        return "you are on the schedule for an open shift: " + now + " on " + day + "."
    if kind == "release":
        return "your " + was + " shift on " + day + " is off your schedule; it is an OPEN shift now."
    if kind == "move":
        if same:
            return "your " + now + " shift moved from " + _short(src[1]) + " to " + _short(dst[1]) + "."
        if not now:
            return "your " + was + " shift on " + day + " now goes to " + other + "."
        return "you now work " + now + " on " + day + " (it was " + other + "'s)."
    if same:
        return ("your shifts changed days: " + _words(a["s_text"]) + " is now on " + _short(dst[1]) + " and " +
                _words(a["t_text"]) + " on " + _short(src[1]) + ".")
    return "you now work " + now + " on " + day + " instead of " + was + " (exchanged with " + other + ")."


def _record(plan: SW.Plan, ctx: dict, a: dict) -> dict:
    """The move's own flow (kind move, done at once): the texts it owes each person told, and their My Work notes."""
    reads, house = plan.reads, a["house"]
    src, dst = a["src"], a["dst"]
    told = a.get("told") or []
    first = told[0] if told else {"name": "", "key": "", "uid": ""}
    other = told[1] if len(told) > 1 else {"name": "", "key": "", "uid": ""}
    span = _span(a["s_text"]) or (0, 0)
    by = s_(ctx.get("name")) or "An editor"
    fid = SF._new_id("SF", house + "|" + src[0] + "|" + src[1] + "|move", SF._now_ms(reads))
    f = ST._flow_row(plan, {
        "id": fid, "kind": "move", "state": "done", "house_code": house, "date": min(src[1], dst[1]),
        "date_to": max(src[1], dst[1]) if src[1] != dst[1] else "", "row_id": src[0],
        "person": first["name"], "person_key": first["key"], "person_uid": first["uid"],
        "shift_text": a["s_text"], "start_min": str(span[0]), "end_min": str(span[1]),
        "open_row_id": dst[0] if a["kind"] == "release" else (src[0] if a["kind"] == "assign" else ""),
        "replacement": other["name"], "replacement_key": other["key"], "replacement_uid": other["uid"],
        "note": a["title"] + " by " + by + " (drag and drop): " + "; ".join(
            c["name"] + " " + c["day"] + " " + (c["was"] or "∅") + " → " + (c["now"] or "∅") for c in a["changes"]),
        "source": "drag", "created_by": s_(ctx.get("uid"))})
    ST._close(f, "done", by, plan.now)
    now_ms = SF._now_ms(reads)
    label = ST._house_word(reads, house)
    items: list[dict] = []
    for t in told:
        change = _change_words(a, t)
        values = {"house": label, "date": _short(t["day"]), "day_word": SF._day_word(t["day"], reads.today()),
                  "shift": _words(t["text"]), "time": SF._hour_word(span[0]),
                  "location": SCK.street(reads, house), "by": by, "change": change,
                  "link": SF.PLATFORM_URL + "/#" + ST._link(house, t["day"])}
        ST._owe(f, t["sit"], t["key"], values, plan.now, now_ms)
        if not t["uid"]:
            continue
        if t["kind"] == NOTE_OPEN:
            title = ("You are on the schedule for an open shift — " + _short(t["day"]) + " · " + _words(t["text"]) +
                     " · " + label)
        else:
            title = "Schedule change — " + label + " · " + _short(t["day"])
        items.append({"flow_id": fid, "box": "work", "kind": t["kind"], "seat": NOTE_SEAT, "to_uid": t["uid"],
                      "to_email": "", "to_name": t["name"], "title": title,
                      "body": change[:1].upper() + change[1:] + " Changed by " + by + " in House Calendars.",
                      "house_code": house, "house_label": label, "date": t["day"], "shift_text": _words(t["text"]),
                      "link": ST._link(house, t["day"])})
    plan.upsert(ST.FLOWS, f)
    test = ST._test_word(reads)
    for it in items:
        plan.upsert(ST.INBOX, {"id": SCH.new_id("SI"), **it, "state": NOTE_STATE, "answered_by": "",
                               "answered_at": "", "note": "", "test_mode": test, "created_at": plan.now})
    return f


# ---- the door: schedulingCellSave with via "move" ------------------------------------------------------------------

def preview_of(a: dict, after: list[dict]) -> dict[str, Any]:
    # a drop something stops says only what stops it: nobody is told of a move that will not happen
    notes = [_note("block", b) for b in a["blocks"]] if a["blocks"] else \
        sorted(a["notes"] + after, key=lambda n: TONE_ORDER.get(n["tone"], 2))
    return {"kind": a["kind"], "title": a["title"], "changes": a["changes"], "notes": notes,
            "blocked": a["blocks"][0] if a["blocks"] else "", "needs_override": bool(a["prefs"]),
            "seen_from": a["seen_from"], "seen_to": a["seen_to"]}


def _after(reads: L.Reads, ctx: dict, a: dict, trainings: list[dict]) -> list[dict]:
    """What the write left that only its result tells: the trainings it made, a week over 40 hours."""
    out = [_note("warn", TR.words(t["name"], s_(t.get("why")))) for t in trainings
           if not any(n["text"] == TR.words(t["name"], s_(t.get("why"))) for n in a["notes"])]
    if not SCH.hours_hidden(reads, ctx):
        SCH.forget(reads)
        seen: set[str] = set()
        for c in a["changes"]:
            row = next((r for r in (a.get("src_row"), a.get("dst_row")) if r and r["row_id"] == c["row_id"]), None)
            key = s_((row or {}).get("person_key"))
            if not key or not c["now"] or (key + c["date"]) in seen:
                continue
            seen.add(key + c["date"])
            wk = SCH.week_hours(reads, key, c["date"])
            if wk > 40:
                out.append(_note("warn", s_(row["name"]) + " now has " + gsjs.num_str(wk) + " hours in the week of " +
                                 SCH.day_words(SCH.week_key(c["date"])) + "."))
    return out


def move(sess: L.Session, payload: dict) -> Decision:
    """A shift dragged on another cell of the same house: `preview` says what it does and writes nothing; without it the
    move is written at once (auto-approved), refused when anything blocks it or a cell changed since the preview."""
    SCH_, ctx = SW._gate(sess)
    if not ctx["open"]:
        return SW.refused(SCH_.closed())
    reads = sess.reads
    house = s_(payload.get("house"))
    src = (s_(payload.get("from_row_id")), s_(payload.get("from_date")))
    dst = (s_(payload.get("to_row_id")), s_(payload.get("to_date")))
    if not house or not all(src) or not all(dst) or not SCH.iso_valid(src[1]) or not SCH.iso_valid(dst[1]):
        return W.refuse(400, "Drop a shift on a cell of the same house.")
    books = SW.verdict_books(reads)
    if not any(h["code"] == house for h in SCH.house_list(reads)):
        return SW.refused(SCH.refuse(404, "There is no such house."), books)
    if not moves_at(reads, ctx)(house):
        return SW.refused(SCH.refuse(403, MOVERS_ONLY), books)
    preview = payload.get("preview") is True
    a = assess(reads, ctx, house, src, dst)
    if preview:
        after: list[dict] = []
        if not a["blocks"]:
            # the whole move on this request's copy, kept nowhere: what only its result tells
            got = apply(SW.Plan(reads, ctx), ctx, a)
            if got["refusal"]:
                a["blocks"].append(s_(got["refusal"]["message"]))
            else:
                after = _after(reads, ctx, a, got["trainings"])
        return Decision({"status": 200, "data": {"ok": True, "preview": preview_of(a, after)}}, fresh=books)
    for k, now in (("seen_from", a["seen_from"]), ("seen_to", a["seen_to"])):
        seen = payload.get(k)
        if isinstance(seen, str) and s_(seen) != now:
            return SW.refused(SCH.refuse(409, SW.STALE_CELL.format(now=now or "nothing")), books)
    if a["blocks"]:
        return SW.refused(SCH.refuse(409, a["blocks"][0]), books)
    if a["prefs"] and payload.get("override") is not True:
        return SW.refused(SCH.prefs_refusal(a["prefs"][0][2]), books)
    W.gate(reads)
    plan = SW.Plan(reads, ctx)
    got = apply(plan, ctx, a)
    if got["refusal"]:
        return SW.refused(SCH.refuse(got["refusal"]["status"], got["refusal"]["message"]), books)
    for key, day, crossed in a["prefs"]:
        FW.override_logged(sess.user, "schedulingCellSave", house, day, key, crossed)
    extra: dict[str, Any] = {}
    warn = [n["text"] for n in _after(reads, ctx, a, []) if "hours in the week" in n["text"]]
    if warn:
        extra["warn"] = " ".join(warn)
    said = a["title"] + ": " + "; ".join(c["name"] + " " + c["day"] + " " + (c["was"] or "∅") + " → " +
                                         (c["now"] or "∅") for c in a["changes"]) + "."
    names = [t["name"] for t in a.get("told") or []]
    if names:
        said += " " + " and ".join(names) + (" is" if len(names) == 1 else " are") + " told by text and in My Work."
    for t in got["trainings"]:
        said += " " + TR.words(t["name"], s_(t.get("why")))
        extra["training"] = {"flow_id": t["flow_id"], "why": s_(t.get("why"))}
    keys = [s_(r["person_key"]) for r in (a["src_row"], a["dst_row"]) if r and s_(r.get("person_key"))]
    period = SCH.period_of(reads, src[1]) or SCH.current_period(reads)
    return SW.finish(plan, ctx, said, period["id"], [house], keys, extra, house, books, "")
