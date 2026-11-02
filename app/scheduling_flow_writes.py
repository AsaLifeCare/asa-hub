"""SCHEDULING'S FLOWS, WRITTEN IN PYTHON (SchedulingFlows.gs, after scheduling_flows' refusals): a call-off, a Request
Off, a time off, a swap or an exchange filed, an open shift taken, a request withdrawn, and every My Work answer
decided — the cells, rows, flows, My Work items and calendar log lines kept in app.edits as one final write, which the
two-way sync carries to the Scheduling books. The texts a flow owes are kept on the flow and said through Smart Comms
by the flow clock on Python (scheduling_clock_writes), as Apps Script's clock said them; a call-off's outreach is the
clock's too. Nothing is handed to Apps Script."""
from __future__ import annotations

import json
import re
from typing import Any

import gsjs
import locations as L
import scheduling as SCH
import scheduling_clock as SCK
import scheduling_flows as SF
import scheduling_timeoff as ST
import scheduling_training as TR
import scheduling_writes as SW
import scope as sc
import staff_views
import writes as W
from writes import Decision

FLOWS, INBOX, CELLS, ROWS = ST.FLOWS, ST.INBOX, ST.CELLS, ST.ROWS
OUTREACH = SCK.OUTREACH
OVERRIDE_NOTE = SCH.PREFS_OVERRIDE_NOTE
NOTE_MAX = 500
ASKED = "Asked. Both directors have it in My Work; the first answer decides."
SWAP_SEAT_STATE = {"staff": "waiting_staff", "house_manager": "waiting_manager", "director": "waiting_director"}
DECLINED_SIT = {"staff": "sched_swap_declined_staff", "house_manager": "sched_swap_declined_manager",
                "director": "sched_swap_declined_director"}

s_ = ST._s


# ---- small helpers -------------------------------------------------------------------------------------------------

def _plan(reads: L.Reads, g: dict) -> SW.Plan:
    return SW.Plan(reads, {"uid": s_(g.get("uid")), "name": s_(g.get("name"))})


def _js_num(v: Any) -> Any:
    """Number(v) as JSON.stringify writes it: whole numbers whole, NaN as null."""
    n = SF._num(v)
    if n != n or abs(n) == float("inf"):
        return None
    return int(n) if n == int(n) else n


def logged(user: dict | None, action: str, what: str) -> None:
    """hubSysLog_ after a flow write: the action's line in the system log."""
    staff_views.record(user, action, what)


def override_logged(user: dict | None, action: str, house: str, day: str, key: str, against: dict) -> None:
    """schedPrefsOverrideLog_: the preferences crossed by name, never what they hold."""
    fields = [f for f in against.get("fields") or [] if f]
    staff_views.record(user, action, "override " + house + " " + (day or "") + " " + key + ": " + ", ".join(fields))


def prefs_note(note: Any) -> str:
    """schedPrefsNote_."""
    n = s_(note)
    return n + " — " + OVERRIDE_NOTE if n else OVERRIDE_NOTE


def flow_answer(sess: L.Session, plan: SW.Plan, said: str, flow_id: str, day: str, houses: list, keys: list,
                subject: str, extra: dict | None = None, edition: str = "") -> Decision:
    """schedFlowWriteAnswer_: the sentence, the flow and the houses read back, the rows kept final."""
    p = SCH.period_of(plan.reads, s_(day)) if SCH.iso_valid(day) else None
    return SW.finish(plan, SCH.gate(sess), said, p["id"] if p else "", houses, [k for k in keys if k],
                     {"flow_id": flow_id, **(extra or {})}, subject or SCH.APP_ID, SW.verdict_books(plan.reads),
                     edition)


def kick_words(reads: L.Reads) -> str:
    """schedFlowKickWords_ with the house's texts left to the clock's next ring."""
    if SCK.quiet(SCK.now_ms(reads)):
        return "the texts wait for 08:00 (quiet hours)."
    return "the house is texted on the next clock ring."


def swap_where(reads: L.Reads, f: dict) -> str:
    return ST._swap_where(reads, f)


def swap_title(reads: L.Reads, f: dict) -> str:
    """schedFlowSwapTitle_."""
    arrow = " ⇄ " if SW.flow_exchange_of(f) else " → "
    return "Swap — " + s_(f.get("person")) + arrow + s_(f.get("replacement")) + " · " + swap_where(reads, f)


def exchange_vars(reads: L.Reads, f: dict) -> dict[str, Any]:
    """schedFlowExchangeVars_."""
    v = SCK.flow_vars(reads, f)
    ex = SW.flow_exchange_of(f) or {}
    v["their_house"] = ST._house_word(reads, ex.get("house"))
    v["their_date"] = SF._day_words(ex.get("date"))
    v["their_shift"] = ST._shift(ex.get("text"))
    return v


def same_house_why(reads: L.Reads, house: str, key: str, day: str) -> bool:
    """schedFlowSameHouseBar_ over the houses as this write leaves them."""
    had = SW.cell_at(reads, house, "P:" + key, day)
    cls = SCH.classify(had["text"]) if had and s_(had.get("text")) else None
    return bool(cls and cls.kind != "off")


def ensure_row(plan: SW.Plan, house: str, key: str, name: str, flow_id: str, ctx: dict) -> dict:
    """schedFlowEnsureRow_: the person's row at a house, added (or switched back on) when a swap or a take lands them
    there."""
    row_id = "P:" + key
    hit, order, location = None, 0.0, ""
    for r in SCH.read_tab(plan.reads, ROWS):
        if s_(r.get("house_code")) != house:
            continue
        order = max(order, SCH.js_num(r.get("order")) or 0.0)
        if not location:
            location = s_(r.get("location"))
        if s_(r.get("row_id")) == row_id:
            hit = r
    if hit:
        if s_(hit.get("active")) == "no":
            hit = ST._clean(dict(hit))
            hit.update({"active": "yes", "updated_at": plan.now, "updated_by": s_(ctx.get("name"))})
            plan.upsert(ROWS, hit)
        return hit
    row = {"id": SCH.row_id_of(house, row_id), "house_code": house, "location": location, "row_id": row_id,
           "row_kind": "person", "name": s_(name) or key, "person_key": key, "designation": "",
           "order": gsjs.num_str(order + 1), "active": "yes", "source": "flow:" + flow_id, "updated_at": plan.now,
           "updated_by": s_(ctx.get("name"))}
    plan.upsert(ROWS, row)
    return row


def cancel_pending(plan: SW.Plan, flow: dict, ctx: dict, house: str, row_id: str, day: str) -> str:
    """schedFlowCancelPending_: an editor changes a cell a waiting flow holds and cancels the flow in the same write."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    by = s_(ctx.get("name")) or "An editor"
    what = SW.pending_what(flow, house, row_id, day)
    line = by + " changed the shift, so the pending " + what + " was cancelled."
    ex = SW.flow_exchange_of(flow)
    values = exchange_vars(reads, flow) if ex else SCK.flow_vars(reads, flow)
    ST._close(flow, "cancelled", by, plan.now)
    ST._note(flow, line)
    ST._settle(plan, s_(flow.get("id")), "", "closed", by)
    training = flow.get("kind") == "training"
    if flow.get("kind") == "swap":
        head = "Swap cancelled — " + swap_where(reads, flow)
        hm_only = not ctx or (not ctx.get("is_master") and not ctx.get("is_director"))
        sit = "sched_swap_declined_manager" if hm_only else "sched_swap_declined_director"
        ST._owe(flow, sit, flow.get("person_key"), values, plan.now, now_ms)
        if ex:
            theirs = json.loads(json.dumps(values))
            theirs["house"], theirs["date"], theirs["shift"] = (values["their_house"], values["their_date"],
                                                                values["their_shift"])
            ST._owe(flow, sit, flow.get("replacement_key"), theirs, plan.now, now_ms)
    else:
        where = (SF._day_words(flow.get("date")) + " · " + ST._shift(flow.get("shift_text")) + " · " +
                 ST._house_word(reads, flow.get("house_code")))
        head = ("Training" if training else "Request Off") + " cancelled — " + where
        values["result"] = "cancelled: the shift was changed on the calendar"
        if training:
            values["trainee"] = s_(flow.get("person"))
        ST._owe(flow, "sched_training_decided" if training else "sched_request_decided", flow.get("person_key"),
                values, plan.now, now_ms)
    items = [ST._item(reads, flow, "inbox", "info", "trainee" if training else "requester",
                      {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}, head, line)]
    if flow.get("kind") == "swap" and s_(flow.get("replacement_uid")):
        items.append(ST._item(reads, flow, "inbox", "info", "staff",
                              {"uid": flow.get("replacement_uid"), "name": flow.get("replacement"), "email": ""},
                              head, line))
    plan.upsert(FLOWS, flow)
    ST._inbox(plan, items)
    return line


def covered_by(plan: SW.Plan, flow_id: str, by: str) -> dict | None:
    """schedFlowCoveredBy_: an editor gave a call-off's OPEN shift to somebody, so its outreach is covered."""
    co = TR.flow_of(plan.reads, flow_id)
    if not co or co.get("kind") != "call_off" or s_(co.get("state")) not in OUTREACH:
        return None
    co = ST._clean(dict(co))
    ST._close(co, "covered", by, plan.now)
    ST._note(co, "assigned by " + s_(by))
    co["outreach_next_at"] = ""
    plan.upsert(FLOWS, co)
    return co


def exchange_training(reads: L.Reads, x: dict, y: dict) -> list[dict]:
    """schedFlowExchangeTraining_: who would land at a house without its IST — a training there, never a refusal."""
    out = []
    for me, take in ((x, y), (y, x)):
        try:
            got = TR.need(reads, take["house"], me["key"])
        except Exception:  # noqa: BLE001 - schedFlowExchangeTraining_ reads a throw as no training
            got = None
        if got:
            out.append({"who": me, "house": take["house"], "need": got})
    return out


def training_list_words(reads: L.Reads, trained: list[dict]) -> str:
    """schedFlowTrainingWords_."""
    return " ".join(t["who"]["name"] + " has no IST at " + ST._house_word(reads, t["house"]) + " (" +
                    s_(t["need"].get("why")) + "), so works it there as a training with the house manager — the "
                    "house manager and a director approve that too." for t in trained)


# ---- the filings ---------------------------------------------------------------------------------------------------

def call_off(sess: L.Session, g: dict, s: dict, p: dict) -> Decision:
    """HUB_ACTIONS.schedulingCallOff after its refusals: the cell called off, its shift opened at the top, the directors
    warned and the call-off's outreach started."""
    reads = sess.reads
    W.gate(reads)
    plan = _plan(reads, g)
    reason = SF._text(p.get("reason"), 500)
    house, row_id, day = s["house"], s["row"], s["date"]
    cell = SW.cell_at(reads, house, row_id, day)
    own = bool(g["key"]) and row_id == "P:" + g["key"]
    key = row_id[2:]
    if own:
        who = {"name": g["name"], "key": g["key"], "uid": g["uid"]}
    else:
        row = SW.row_at(reads, house, row_id) or {}
        who = {"name": s_(row.get("name")) or key, "key": key,
               "uid": s_((SCH.user_by_key(reads, key) or {}).get("uid"))}
    ST._expire_on(plan, house, row_id, day, g["name"])
    flow = ST._call_off_apply(plan, g, house, row_id, day, cell, who, "called_off", "C/O", "call_off", "", "",
                              source="platform" if own else "editor", reason=reason, warn=True)
    logged(sess.user, "schedulingCallOff", house + " " + day)
    said = ("Called off. The shift is open at the top of " + ST._house_word(reads, house) + " and the directors are "
            "warned; " + kick_words(reads))
    return flow_answer(sess, plan, said, flow["id"], day, [house], [flow.get("person_key")], house)


def request_off(sess: L.Session, g: dict, s: dict, p: dict, askable: list[dict]) -> Decision:
    """HUB_ACTIONS.schedulingRequestOff after its refusals: the flow waiting on the directors, each asked in My Work."""
    reads = sess.reads
    W.gate(reads)
    plan = _plan(reads, g)
    note = SF._text(p.get("note"), 500)
    house, row_id, day = s["house"], s["row"], s["date"]
    cell = SW.cell_at(reads, house, row_id, day) or {}
    f = ST._flow_row(plan, {
        "id": SF._new_id("SF", house + "|" + row_id + "|" + day, SF._now_ms(reads)), "kind": "request_off",
        "state": "waiting", "house_code": house, "date": day, "row_id": row_id, "person": g["name"],
        "person_key": g["key"], "person_uid": g["uid"], "shift_text": s_(cell.get("text")),
        "start_min": ST._num(cell.get("start_min")), "end_min": ST._num(cell.get("end_min")), "note": note,
        "source": "platform", "created_by": g["uid"],
        "seats": ST._json([{"seat": "director", "to": askable, "state": "waiting", "by": "", "at": "", "note": "",
                            "why": ""}])})
    plan.upsert(FLOWS, f)
    head = ("Request Off — " + g["name"] + " · " + SF._day_words(day) + " · " + ST._shift(f["shift_text"]) + " · " +
            ST._house_word(reads, house))
    body = (('"' + note + '" — ') if note else "") + ("Approve to open the shift at the top of the house and start the "
                                                      "call-off outreach. The first director to answer decides.")
    ST._inbox(plan, [ST._item(reads, f, "work", "approval", "director", d, head, body) for d in askable])
    logged(sess.user, "schedulingRequestOff", house + " " + day)
    return flow_answer(sess, plan, ASKED, f["id"], day, [house], [g["key"]], house)


def time_off(sess: L.Session, g: dict, p: dict) -> Decision:
    """HUB_ACTIONS.schedulingTimeOff: schedFlowTimeOffAsk_ as My Calendar files it, then the houses with the person's
    rows read back, so their "time off asked" marks are drawn at once."""
    import support_desk_vacation as SDV  # noqa: PLC0415 - the one port of schedFlowTimeOffAsk_
    reads = sess.reads
    refused, plan, flow = SDV.time_off_ask(reads, g, p, "platform")
    if refused is not None:
        return Decision(refused, fresh=refused["status"] != 400)
    logged(sess.user, "schedulingTimeOff", s_(flow.get("date")) + ".." + s_(flow.get("date_to")))
    homes: list[str] = []
    for r in SCH.read_tab(reads, ROWS):
        if s_(r.get("person_key")) == g["key"] and s_(r.get("active")) != "no" and s_(r.get("house_code")) not in homes:
            homes.append(s_(r.get("house_code")))
    return flow_answer(sess, plan, ASKED, flow["id"], flow["date"], homes, [g["key"]], SCH.APP_ID)


def swap(sess: L.Session, g: dict, s: dict, cell: dict, who: dict, holder: dict, p: dict, crossed: dict | None,
         own: bool, edition: str) -> Decision:
    """HUB_ACTIONS.schedulingSwapPropose after its refusals: the swap waiting on the one asked, asked in My Work and by
    text (owed to the flow clock)."""
    reads = sess.reads
    W.gate(reads)
    plan = _plan(reads, g)
    note = SF._text(p.get("note"), 500)
    rep = SF._text(p.get("replacement"), 120)
    rep_name = who["name"] or rep
    to = {"uid": who["uid"], "name": rep_name, "email": who["email"]}
    house, row_id, day = s["house"], s["row"], s["date"]
    f = ST._flow_row(plan, {
        "id": SF._new_id("SF", house + "|" + row_id + "|" + day + "|" + rep, SF._now_ms(reads)), "kind": "swap",
        "state": "waiting_staff", "house_code": house, "date": day, "row_id": row_id, "person": holder["name"],
        "person_key": holder["key"], "person_uid": holder["uid"], "shift_text": s_(cell.get("text")),
        "start_min": ST._num(cell.get("start_min")), "end_min": ST._num(cell.get("end_min")),
        "replacement": rep_name, "replacement_key": rep, "replacement_uid": to["uid"], "source": "platform",
        "created_by": g["uid"], "note": note,
        "seats": ST._json([{"seat": "staff", "to": [to], "state": "waiting", "by": "", "at": "", "note": "",
                            "why": ""}])})
    if crossed:
        ST._note(f, OVERRIDE_NOTE)
    ST._owe(f, "sched_swap_ask", rep, SCK.flow_vars(reads, f), plan.now, SF._now_ms(reads), "waiting_staff")
    plan.upsert(FLOWS, f)
    ST._inbox(plan, [ST._item(reads, f, "work", "approval", "staff", to, swap_title(reads, f),
                              (g["name"] if own else g["name"] + ", for " + holder["name"] + ",") +
                              " asks you to take this shift." + (' "' + note + '"' if note else "") +
                              " Then the house manager and a director approve.")])
    logged(sess.user, "schedulingSwapPropose", house + " " + day)
    if crossed:
        override_logged(sess.user, "schedulingSwapPropose", house, day, rep, crossed)
    return flow_answer(sess, plan, "Asked " + rep_name + ". Next the house manager, then a director.", f["id"], day,
                       [house], [holder["key"], rep], house, edition=edition)


def exchange(sess: L.Session, g: dict, s: dict, x: dict, y: dict, who: dict, p: dict, crossed: list[dict],
             own: bool) -> Decision:
    """schedFlowExchangePropose_ after its refusals: two people's shifts asked to change hands, the partner asked
    first; whoever would land at a house without its IST is told it is a training there."""
    reads = sess.reads
    W.gate(reads)
    plan = _plan(reads, g)
    note = SF._text(p.get("note"), 500)
    trained = exchange_training(reads, x, y)
    to = {"uid": y["uid"], "name": y["name"], "email": s_(who.get("email"))}
    f = ST._flow_row(plan, {
        "id": SF._new_id("SF", "|".join((x["house"], x["row"], x["date"], y["house"], y["row"], y["date"])),
                         SF._now_ms(reads)),
        "kind": "swap", "state": "waiting_staff", "house_code": x["house"], "date": x["date"], "row_id": x["row"],
        "person": x["name"], "person_key": x["key"], "person_uid": x["uid"], "shift_text": x["text"],
        "start_min": ST._num(x["start"]), "end_min": ST._num(x["end"]), "replacement": y["name"],
        "replacement_key": y["key"], "replacement_uid": y["uid"], "source": "platform", "created_by": g["uid"],
        "note": note,
        "outreach_log": ST._json({"exchange": {"house": y["house"], "row_id": y["row"], "date": y["date"],
                                               "text": y["text"], "start_min": _js_num(y["start"]),
                                               "end_min": _js_num(y["end"])}}),
        "seats": ST._json([{"seat": "staff", "to": [to], "state": "waiting", "by": "", "at": "", "note": "",
                            "why": ""}])})
    if crossed:
        ST._note(f, OVERRIDE_NOTE)
    ST._owe(f, "sched_exchange_ask", y["key"], exchange_vars(reads, f), plan.now, SF._now_ms(reads), "waiting_staff")
    plan.upsert(FLOWS, f)
    ST._inbox(plan, [ST._item(
        reads, f, "work", "approval", "staff", to, swap_title(reads, f),
        (g["name"] if own else g["name"] + ", for " + x["name"] + ",") + " asks to swap: you take " +
        SF._side_words(reads, x) + " and " + x["name"] + " takes your " + SF._side_words(reads, y) + "." +
        (' "' + note + '"' if note else "") + " Then the house manager of each house and a director approve." +
        (" " + training_list_words(reads, trained) if trained else ""))])
    logged(sess.user, "schedulingSwapPropose", s["house"] + " " + s["date"] + " ⇄ " + y["house"] + " " + y["date"])
    for c in crossed:
        override_logged(sess.user, "schedulingSwapPropose", c["house"], c["date"], c["key"], c["against"])
    houses = [s["house"]] + ([y["house"]] if y["house"] != s["house"] else [])
    said = ("Asked " + y["name"] + ". Next the house manager of each house, then a director." +
            (" " + training_list_words(reads, trained) if trained else ""))
    return flow_answer(sess, plan, said, f["id"], s["date"], houses, [x["key"], y["key"]], s["house"])


def take(sess: L.Session, g: dict, s: dict, p: dict, crossed: dict | None) -> Decision:
    """HUB_ACTIONS.schedulingTake after its refusals: the open shift the person's own, the call-off's outreach covered;
    somebody new to the house without its IST takes it as a training (refused when nobody could approve it)."""
    reads = sess.reads
    house, open_row, day = s["house"], s["row"], s["date"]
    me = {"name": g["name"], "key": g["key"], "uid": g["uid"]}
    need = TR.need(reads, house, g["key"])
    W.gate(reads)
    plan = _plan(reads, g)
    t_plan = None
    if need:
        t_plan = TR.plan_of(reads, house, me, plan.now)
        if t_plan.get("status"):
            return Decision({"status": t_plan["status"], "message": t_plan["message"]}, fresh=SW.verdict_books(reads))
    opened = SW.cell_at(reads, house, open_row, day) or {}
    my_row = "P:" + g["key"]
    now_ms = SF._now_ms(reads)
    fid = SF._new_id("SF", house + "|" + open_row + "|" + day + "|take", now_ms)
    tid = SF._new_id("SF", house + "|" + my_row + "|" + day + "|training", now_ms) if need else ""
    f = ST._flow_row(plan, {
        "id": fid, "kind": "take", "state": "done", "house_code": house, "date": day, "row_id": my_row,
        "person": g["name"], "person_key": g["key"], "person_uid": g["uid"], "shift_text": s_(opened.get("text")),
        "start_min": ST._num(opened.get("start_min")), "end_min": ST._num(opened.get("end_min")),
        "open_row_id": open_row, "source": "platform", "source_ref": s_(opened.get("flow_id")),
        "created_by": g["uid"]})
    if crossed:
        ST._note(f, OVERRIDE_NOTE)
    ST._close(f, "done", g["name"], plan.now)
    ensure_row(plan, house, g["key"], g["name"], fid, g)
    mine = SW.cell_at(reads, house, my_row, day)
    cell_flow = tid or fid
    placed = SW.set_cell(plan, house, my_row, day, {"text": s_(opened.get("text")),
                                                    "state": "training" if tid else "taken",
                                                    "base": ST._base_of(mine or {}), "flow_id": cell_flow,
                                                    "source": "flow:" + cell_flow},
                         "take", OVERRIDE_NOTE if crossed else "", cell_flow)
    # a call-off's OPEN cell is a one-off and goes; one that keeps a pattern (a genuinely open shift) keeps it
    keep_base = s_(opened.get("base")) if s_(opened.get("flow_id")) else s_(opened.get("text"))
    SW.set_cell(plan, house, open_row, day,
                {"text": "", "state": "taken", "base": keep_base, "flow_id": "", "source": "flow:" + fid} if keep_base
                else {"text": "", "state": "", "base": "", "flow_id": "", "source": ""}, "take", "", fid)
    co = TR.flow_of(reads, opened.get("flow_id")) if s_(opened.get("flow_id")) else None
    if co and co.get("kind") == "call_off" and s_(co.get("state")) in OUTREACH:
        co = ST._clean(dict(co))
        ST._close(co, "covered", g["name"], plan.now)
        ST._note(co, "taken by " + g["name"] + (" as a training" if tid else ""))
        co["outreach_next_at"] = ""
        plan.upsert(FLOWS, co)
    plan.upsert(FLOWS, f)
    training = None
    if tid:
        TR.open_flow(plan, {"id": tid, "house": house, "date": day, "cell": placed, "person": me, "ist": need,
                            "source": "take", "source_ref": fid, "ctx": g, "plan": t_plan})
        training = {"flow_id": tid, "why": s_(need.get("why"))}
    where = ST._house_word(reads, house)
    head = "Open shift taken — " + SF._day_words(day) + " · " + ST._shift(f["shift_text"]) + " · " + where
    body = (g["name"] + " took it on the Hub; the outreach for it stopped." +
            (" " + g["name"] + " has no IST at " + where + ", so it is a training waiting on the house manager and a "
             "director in My Work." if tid else ""))
    items = [ST._item(reads, f, "inbox", "info", "house_manager", h, head, body)
             for h in TR.house_managers(reads, house) if h["uid"] and h["uid"] != g["uid"]]
    items += [ST._item(reads, f, "inbox", "info", "director", d, head, body) for d in SF._directors(reads)["list"]]
    ST._inbox(plan, items)
    logged(sess.user, "schedulingTake", house + " " + day)
    if crossed:
        override_logged(sess.user, "schedulingTake", house, day, g["key"], crossed)
    said = ("It is yours as a training with the house manager, not as the DSP (" + training["why"] + "). The house "
            "manager and a director approve it in My Work; a decline puts it back up as an open shift." if training
            else "It is yours. The house manager and the directors are told.")
    return flow_answer(sess, plan, said, fid, day, [house], [g["key"]], house,
                       {"training": training} if training else None)


def withdraw(sess: L.Session, g: dict, fid: str) -> Decision:
    """HUB_ACTIONS.schedulingWithdraw after its refusals: the request closed and its My Work items with it."""
    reads = sess.reads
    W.gate(reads)
    plan = _plan(reads, g)
    f = ST._clean(dict(TR.flow_of(reads, fid) or {}))
    ST._close(f, "withdrawn", g["name"], plan.now)
    plan.upsert(FLOWS, f)
    ST._settle(plan, s_(f.get("id")), "", "closed", g["name"])
    logged(sess.user, "schedulingWithdraw", fid)
    house = s_(f.get("house_code"))
    return flow_answer(sess, plan, "Withdrawn. Nothing on the calendar changed.", fid, s_(f.get("date")),
                       [house] if house else [], [g["key"]], house or SCH.APP_ID)


# ---- the answer from My Work ---------------------------------------------------------------------------------------

def _last(rows: list[dict], key: str) -> dict | None:
    hit = None
    for r in rows:
        if s_(r.get("id")) == key:
            hit = r
    return hit


def answer(sess: L.Session, item_id: str, word: str, note: Any, stand_in: bool) -> Decision:
    """schedFlowAnswerLocked_ after schedulingAnswer's refusals: the item answered, its flow decided — a Request Off,
    a time off, a training, a swap or an exchange — and the item's siblings settled."""
    reads, user = sess.reads, sess.user or {}
    g = SF._ctx(sess)
    me = gsjs.str_(user.get("id"))
    actor = {"uid": me, "name": (g or {}).get("name") or s_(user.get("display_name")) or s_(user.get("email"))}
    W.gate(reads)
    plan = SW.Plan(reads, dict(actor))
    words = SCH.u16(SF._text(note, 500), NOTE_MAX)
    books = SW.verdict_books(reads)
    item = _last(SCH.read_tab(reads, INBOX), item_id)
    if item is None:
        return SF._no(404, "This item is not on the calendar any more.")
    item = ST._clean(dict(item))
    if item.get("box") == "inbox":
        item["answered_by"], item["answered_at"] = actor["name"], plan.now
        plan.upsert(INBOX, item)
        logged(sess.user, "schedulingAnswer", item_id + " " + word)
        return Decision({"status": 200, "data": {"ok": True, "changed": True, "said": "Marked as seen.",
                                                 "state": item.get("state") or ""}},
                        edits=plan.records(SCH.APP_ID) or None, subject=SCH.APP_ID, fresh=books)
    flow = _last(SCH.read_tab(reads, FLOWS), s_(item.get("flow_id")))
    if flow is None:
        return SF._no(404, "The request behind this item is gone.")
    flow = ST._clean(dict(flow))
    kind = flow.get("kind")
    exchange_ = SW.flow_exchange_of(flow) is not None
    want = "waiting" if kind in ("request_off", "time_off", "training") else \
        (SWAP_SEAT_STATE.get(s_(item.get("seat")), "") if kind == "swap" else "")
    if s_(flow.get("state")) != want:
        item["state"], item["answered_by"], item["answered_at"] = "closed", actor["name"], plan.now
        plan.upsert(INBOX, item)
        data = {"ok": True, "changed": False, "state": item["state"],
                "said": "This request is no longer waiting on you (" + s_(flow.get("state")) + ")."}
        return Decision({"status": 200, "data": data}, edits=plan.records(SCH.APP_ID) or None, subject=SCH.APP_ID,
                        fresh=books)
    # the decision's own writes first, the flow after them, the item and its siblings last
    if kind == "request_off":
        r = decide_request_off(plan, flow, word, words, actor)
    elif kind == "time_off":
        r = {"said": ST._decide(plan, flow, word, words, actor, SF._now_ms(reads))}
    elif kind == "training":
        r = TR.decide(plan, flow, item, word, words, actor)
    elif exchange_:
        r = decide_exchange(plan, flow, item, word, words, actor)
    else:
        r = decide_swap(plan, flow, s_(item.get("seat")), word, words, actor)
    plan.upsert(FLOWS, flow)
    item["state"] = "approved" if word == "approve" else "declined"
    item["answered_by"], item["answered_at"], item["note"] = actor["name"], plan.now, words
    plan.upsert(INBOX, item)
    # an exchange's house-manager seats are one per house: an answer settles only the houses it sat for
    ST._settle(plan, s_(flow.get("id")), s_(item.get("seat")), "superseded", actor["name"], s_(item.get("id")),
               r.get("settle_houses"))
    logged(sess.user, "schedulingAnswer", item_id + " " + word)
    data: dict[str, Any] = {"ok": True, "changed": True, "said": r["said"], "state": item["state"]}
    if r.get("training"):
        data["training"] = r["training"]
    edition = ""
    if stand_in and kind == "time_off" and not sc.is_real_master(user) and \
            not any(s_(d.get("uid")) == me for d in SF._directors(reads)["list"]):
        edition = SCH.TIME_OFF_EDITION
    return Decision({"status": 200, "data": data}, edits=plan.records(SCH.APP_ID) or None, subject=SCH.APP_ID,
                    fresh=books, edition=edition)


def decide_request_off(plan: SW.Plan, flow: dict, word: str, note: str, actor: dict) -> dict[str, Any]:
    """schedFlowDecideRequestOff_."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    ST._seat_mark(flow, "director", word, note, actor, plan.now)
    day, shift = SF._day_words(flow.get("date")), ST._shift(flow.get("shift_text"))
    house = ST._house_word(reads, flow.get("house_code"))
    requester = {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}
    values = SCK.flow_vars(reads, flow)
    if word == "decline":
        ST._close(flow, "declined", actor["name"], plan.now)
        values["result"] = "not approved: the shift is still yours"
        ST._owe(flow, "sched_request_decided", flow.get("person_key"), values, plan.now, now_ms)
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester", requester,
                                  "Request Off not approved — " + day + " · " + shift + " · " + house,
                                  "Not approved by " + actor["name"] + (': "' + note + '"' if note else ".") +
                                  " The shift is still yours.")])
        return {"said": "Declined. " + s_(flow.get("person")) + " is told."}
    code, row_id, date = s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date"))
    cell = SW.cell_at(reads, code, row_id, date)
    if SF._hold_bar(reads, cell) is not None or s_((cell or {}).get("text")) != s_(flow.get("shift_text")):
        ST._close(flow, "expired", actor["name"], plan.now)
        ST._note(flow, "the shift changed before it was approved")
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester", requester,
                                  "Request Off could not be applied — " + day + " · " + shift + " · " + house,
                                  "Approved by " + actor["name"] + ", but the shift had changed on the calendar, so "
                                  "nothing was done.")])
        return {"said": "The shift changed since it was asked for, so nothing was done; " + s_(flow.get("person")) +
                        " is told."}
    co = ST._call_off_apply(plan, actor, code, row_id, date, cell,
                            {"name": flow.get("person"), "key": flow.get("person_key"), "uid": flow.get("person_uid")},
                            "requested_off", "R/O", "request_off", s_(flow.get("id")), s_(flow.get("id")))
    flow["open_row_id"] = co["open_row_id"]
    ST._close(flow, "approved", actor["name"], plan.now)
    values["result"] = "approved: the shift is now open for cover"
    ST._owe(flow, "sched_request_decided", flow.get("person_key"), values, plan.now, now_ms)
    head = "Request Off approved — " + s_(flow.get("person")) + " · " + day + " · " + shift + " · " + house
    body = ("Approved by " + actor["name"] + ". The shift is open at the top of " + house + " and the call-off "
            "outreach has started.")
    items = [ST._item(reads, flow, "inbox", "info", "director", d, head, body) for d in SF._directors(reads)["list"]]
    items.append(ST._item(reads, flow, "inbox", "info", "requester", requester, head, body))
    ST._inbox(plan, items)
    return {"said": "Approved. The shift is open at the top of " + house + " and the outreach has started."}


def decide_swap(plan: SW.Plan, flow: dict, seat: str, word: str, note: str, actor: dict) -> dict[str, Any]:
    """schedFlowDecideSwap_: a seat answered on a one-sided swap."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    seats = ST._seat_mark(flow, seat, word, note, actor, plan.now)
    day, shift = SF._day_words(flow.get("date")), ST._shift(flow.get("shift_text"))
    house = ST._house_word(reads, flow.get("house_code"))
    original = {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}
    values = SCK.flow_vars(reads, flow)
    if word == "decline":
        ST._close(flow, "declined", actor["name"], plan.now)
        who = {"staff": s_(flow.get("replacement")) + " declined.", "house_manager": "The house manager declined.",
               "director": "The director declined."}.get(seat, "")
        ST._owe(flow, DECLINED_SIT.get(seat, ""), flow.get("person_key"), values, plan.now, now_ms)
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester", original,
                                  "Swap declined — " + day + " · " + shift + " · " + house,
                                  who + (' "' + note + '"' if note else "") + " The shift is still yours.")])
        return {"said": "Declined. " + s_(flow.get("person")) + " is told."}
    answered = {s_(s.get("by_uid")) for s in seats if isinstance(s, dict) and s_(s.get("by_uid"))}
    answered |= {s_(flow.get("person_uid")), s_(flow.get("replacement_uid"))}
    if seat == "staff":
        hms: list[dict] = []
        why = ""
        try:
            for h in TR.house_managers(reads, flow.get("house_code")):
                if not h["uid"]:
                    continue
                if h["key"] in (s_(flow.get("person_key")), s_(flow.get("replacement_key"))) or h["uid"] in answered:
                    continue
                hms.append(h)
            if not hms:
                why = ("the house has no house manager with an account outside this swap, so the seat passes to the "
                       "directors")
        except Exception:  # noqa: BLE001 - schedFlowDecideSwap_ passes the seat on when the managers cannot be read
            why = "the house managers could not be read, so the seat passes to the directors"
        if hms:
            seats.append({"seat": "house_manager", "to": [{"uid": h["uid"], "name": h["name"], "email": h["email"]}
                                                          for h in hms],
                          "state": "waiting", "by": "", "at": "", "note": "", "why": ""})
            flow["seats"] = ST._json(seats)
            flow["state"] = "waiting_manager"
            for h in hms:
                ST._owe(flow, "sched_swap_ask", h["key"], values, plan.now, now_ms, "waiting_manager")
            ST._inbox(plan, [ST._item(reads, flow, "work", "approval", "house_manager", h, swap_title(reads, flow),
                                      s_(flow.get("replacement")) + " accepted. As the house manager, approve or "
                                      "decline; a director decides last.") for h in hms])
            return {"said": "Accepted. The house manager is asked next."}
        seats.append({"seat": "house_manager", "to": [], "state": "skipped", "by": "", "at": plan.now, "note": "",
                      "why": why})
        flow["seats"] = ST._json(seats)
        return open_director_seat(plan, flow, seats, answered, values, "Accepted. ")
    if seat == "house_manager":
        return open_director_seat(plan, flow, seats, answered, values, "Approved. ")
    return swap_complete(plan, flow, values, actor)


def open_director_seat(plan: SW.Plan, flow: dict, seats: list, answered: set, values: dict,
                       lead: str) -> dict[str, Any]:
    """schedFlowOpenDirectorSeat_: the directors outside the swap asked last; none left stops it."""
    reads = plan.reads
    ex = SW.flow_exchange_of(flow)
    dirs = SF._directors(reads)
    to = [d for d in dirs["list"] if d["uid"] not in answered]
    if not to:
        ST._close(flow, "expired", "the swap", plan.now)
        why = "no director outside this swap is left to approve it" if dirs["readable"] else s_(dirs.get("why"))
        ST._note(flow, why)
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester",
                                  {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""},
                                  "Swap could not finish — " + swap_where(reads, flow),
                                  "It stopped before the last approval: " + why + ". " +
                                  ("Both shifts stay as they were." if ex else "The shift is still yours."))])
        return {"said": lead + "But " + why + ", so the swap stopped."}
    seats.append({"seat": "director", "to": to, "state": "waiting", "by": "", "at": "", "note": "", "why": ""})
    flow["seats"] = ST._json(seats)
    flow["state"] = "waiting_director"
    for d in to:
        dk = SCH.fold(d.get("name"))
        if dk:
            ST._owe(flow, "sched_exchange_ask" if ex else "sched_swap_ask", dk, values, plan.now, SF._now_ms(reads),
                    "waiting_director")
    body = (s_(flow.get("replacement")) + " accepted and the house manager seats are settled. The first director to "
            "answer decides; both shifts are checked again before they change hands." if ex
            else "The replacement accepted and the house manager seat is settled. The first director to answer "
                 "decides.")
    ST._inbox(plan, [ST._item(reads, flow, "work", "approval", "director", d, swap_title(reads, flow), body)
                     for d in to])
    return {"said": lead + "A director is asked last."}


def swap_complete(plan: SW.Plan, flow: dict, values: dict, actor: dict) -> dict[str, Any]:
    """schedFlowSwapComplete_: every seat said yes — the shift and the replacement checked again, then the names change
    places (somebody new to the house without its IST takes it as a training)."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    code, row_id, date = s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date"))
    rep_key, rep_name = s_(flow.get("replacement_key")), s_(flow.get("replacement"))
    cell = SW.cell_at(reads, code, row_id, date)
    stale = "the shift changed on the calendar" if SF._hold_bar(reads, cell) is not None or \
        s_((cell or {}).get("text")) != s_(flow.get("shift_text")) else ""
    if not stale and SCH.clash(reads, rep_key, date, SF._num(flow.get("start_min")), SF._num(flow.get("end_min")),
                               house_code=code):
        stale = rep_name + " is no longer free then"
    if not stale and same_house_why(reads, code, rep_key, date):
        stale = rep_name + " now has another shift at " + ST._house_word(reads, code) + " that day"
    need, t_plan = None, None
    rep = {"name": rep_name, "key": rep_key, "uid": s_(flow.get("replacement_uid"))}
    if not stale:
        need = TR.need(reads, code, rep_key)
        if need:
            t_plan = TR.plan_of(reads, code, rep, plan.now)
            if t_plan.get("status"):
                stale = rep_name + " would work it as a training, and " + re.sub(r"\.$", "", s_(t_plan["message"]))
    day, shift, house = SF._day_words(date), ST._shift(flow.get("shift_text")), ST._house_word(reads, code)
    if stale:
        ST._close(flow, "expired", actor["name"], plan.now)
        ST._note(flow, stale)
        head = "Swap could not finish — " + day + " · " + shift + " · " + house
        body = "Every seat approved, but " + stale + ", so nothing changed."
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester",
                                  {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}, head, body),
                         ST._item(reads, flow, "inbox", "info", "staff",
                                  {"uid": flow.get("replacement_uid"), "name": rep_name, "email": ""}, head, body)])
        return {"said": "Approved, but " + stale + ", so the swap could not finish."}
    text = s_(cell.get("text"))
    rep_row = "P:" + rep_key
    there = SW.cell_at(reads, code, rep_row, date)
    fid = s_(flow.get("id"))
    SW.set_cell(plan, code, row_id, date, {"text": "", "state": "swapped_out", "base": ST._base_of(cell),
                                           "flow_id": fid, "source": "flow:" + fid}, "swap", "", fid)
    ensure_row(plan, code, rep_key, rep_name, fid, actor)
    tid = SF._new_id("SF", code + "|" + rep_row + "|" + date + "|training", now_ms) if need else ""
    cell_flow = tid or fid
    placed = SW.set_cell(plan, code, rep_row, date, {"text": text, "state": "training" if tid else "swap_in",
                                                     "base": ST._base_of(there or {}), "flow_id": cell_flow,
                                                     "source": "flow:" + cell_flow}, "swap", "", cell_flow)
    ST._close(flow, "done", actor["name"], plan.now)
    ST._owe(flow, "sched_swap_done", flow.get("person_key"), values, plan.now, now_ms)
    ST._owe(flow, "sched_swap_done", rep_key, values, plan.now, now_ms)
    if tid:
        ST._note(flow, rep_name + " works it as a training (" + s_(need.get("why")) + ")")
        TR.open_flow(plan, {"id": tid, "house": code, "date": date, "cell": placed, "person": rep, "ist": need,
                            "source": "swap", "source_ref": fid, "ctx": actor, "plan": t_plan,
                            "giver": flow.get("person")})
    ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "everyone", None,
                              "Shift swapped: " + house + " " + day + " " + shift + " — " + s_(flow.get("person")) +
                              " → " + rep_name,
                              "Approved by " + actor["name"] + "." +
                              (" " + rep_name + " works it as a training with the house manager, waiting on the house "
                               "manager and a director." if tid else ""))])
    if not tid:
        return {"said": "Approved. The swap is done: " + rep_name + " has the shift."}
    return {"said": "Approved. The swap is done: " + rep_name + " has the shift as a training with the house "
                    "manager (" + s_(need.get("why")) + "); the house manager and a director are asked in My Work.",
            "training": {"flow_id": tid, "why": s_(need.get("why"))}}


def decide_exchange(plan: SW.Plan, flow: dict, item: dict, word: str, note: str, actor: dict) -> dict[str, Any]:
    """schedFlowDecideExchange_: a seat answered on an exchange."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    seat = s_(item.get("seat"))
    seats = SF._json(flow.get("seats"), [])
    seats = seats if isinstance(seats, list) else []
    mark = [s for s in seats if isinstance(s, dict) and s.get("seat") == seat and s.get("state") == "waiting" and
            (seat != "house_manager" or s_(s.get("house")) == s_(item.get("house_code")) or
             any(isinstance(t, dict) and s_(t.get("uid")) == s_(actor["uid"]) for t in s.get("to") or []))]
    for s in mark:
        s["state"] = "approved" if word == "approve" else "declined"
        s["by"] = actor["name"]
        s["by_uid"] = s_(actor["uid"])
        s["at"] = plan.now
        s["note"] = note
    flow["seats"] = ST._json(seats)
    settled = [s_(s.get("house")) for s in mark if s_(s.get("house"))]
    where = swap_where(reads, flow)
    if word == "decline":
        ST._close(flow, "declined", actor["name"], plan.now)
        ST._settle(plan, s_(flow.get("id")), "", "closed", actor["name"], s_(item.get("id")))
        who = {"staff": s_(flow.get("replacement")) + " declined.",
               "house_manager": "The house manager of " + ST._house_word(reads, item.get("house_code")) + " declined.",
               "director": "The director declined."}.get(seat, "")
        ST._owe(flow, DECLINED_SIT.get(seat, ""), flow.get("person_key"), SCK.flow_vars(reads, flow), plan.now,
                now_ms)
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester",
                                  {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""},
                                  "Swap declined — " + where,
                                  who + (' "' + note + '"' if note else "") + " Both shifts stay as they were.")])
        return {"said": "Declined. " + s_(flow.get("person")) + " is told."}
    answered = {s_(s.get("by_uid")) for s in seats if isinstance(s, dict) and s_(s.get("by_uid"))}
    answered |= {u for u in (s_(flow.get("person_uid")), s_(flow.get("replacement_uid")), s_(flow.get("created_by")))
                 if u}
    values = exchange_vars(reads, flow)
    if seat == "staff":
        return exchange_managers(plan, flow, seats, answered, values)
    if seat == "house_manager":
        left = [s for s in seats if isinstance(s, dict) and s.get("seat") == "house_manager" and
                s.get("state") == "waiting"]
        r = {"said": "Approved. Waiting on the house manager of " +
                     " and ".join(ST._house_word(reads, s.get("house")) for s in left) + "."} if left \
            else open_director_seat(plan, flow, seats, answered, values, "Approved. ")
        r["settle_houses"] = settled
        return r
    return exchange_complete(plan, flow, actor)


def exchange_managers(plan: SW.Plan, flow: dict, seats: list, answered: set, values: dict) -> dict[str, Any]:
    """schedFlowExchangeManagers_: the partner accepted — one house-manager seat per house, asked together; a house with
    nobody passes to the directors."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    ex = SW.flow_exchange_of(flow)
    houses = [s_(flow.get("house_code"))]
    if s_(ex.get("house")) not in houses:
        houses.append(s_(ex.get("house")))
    asked: list[str] = []
    items: list[dict] = []
    for h in houses:
        hms: list[dict] = []
        why = ""
        try:
            for m in TR.house_managers(reads, h):
                if not m["uid"] or m["uid"] in answered:
                    continue
                if m["key"] in (s_(flow.get("person_key")), s_(flow.get("replacement_key"))):
                    continue
                if any(x["uid"] == m["uid"] for x in hms):
                    continue
                hms.append(m)
            if not hms:
                why = (ST._house_word(reads, h) + " has no house manager with an account outside this swap, so the "
                       "seat passes to the directors")
        except Exception:  # noqa: BLE001 - schedFlowExchangeManagers_ passes the seat on
            why = ("the house managers of " + ST._house_word(reads, h) + " could not be read, so the seat passes to "
                   "the directors")
        if not hms:
            seats.append({"seat": "house_manager", "house": h, "to": [], "state": "skipped", "by": "", "at": plan.now,
                          "note": "", "why": why})
            continue
        seats.append({"seat": "house_manager", "house": h,
                      "to": [{"uid": m["uid"], "name": m["name"], "email": m["email"]} for m in hms],
                      "state": "waiting", "by": "", "at": "", "note": "", "why": ""})
        asked.append(h)
        day = s_(flow.get("date")) if h == s_(flow.get("house_code")) else s_(ex.get("date"))
        for m in hms:
            ST._owe(flow, "sched_exchange_ask", m["key"], values, plan.now, now_ms, "waiting_manager")
            it = ST._item(reads, flow, "work", "approval", "house_manager", m, swap_title(reads, flow),
                          s_(flow.get("replacement")) + " accepted. As the house manager of " +
                          ST._house_word(reads, h) + ", approve or decline; a director decides last.")
            it["house_code"] = h
            it["link"] = ST._link(h, day)
            items.append(it)
    flow["seats"] = ST._json(seats)
    if not asked:
        return open_director_seat(plan, flow, seats, answered, values, "Accepted. ")
    flow["state"] = "waiting_manager"
    ST._inbox(plan, items)
    names = [ST._house_word(reads, h) for h in asked]
    return {"said": "Accepted. The house manager" + ("s of " + " and ".join(names) + " are" if len(names) > 1
                                                     else " of " + names[0] + " is") + " asked next."}


def exchange_complete(plan: SW.Plan, flow: dict, actor: dict) -> dict[str, Any]:
    """schedFlowExchangeComplete_: every seat said yes — both shifts checked again, then they change hands."""
    reads, now_ms = plan.reads, SF._now_ms(plan.reads)
    ex = SW.flow_exchange_of(flow)
    fid = s_(flow.get("id"))
    x = SF._side(reads, s_(flow.get("house_code")), s_(flow.get("row_id")), s_(flow.get("date")),
                 s_(flow.get("person")), s_(flow.get("person_uid")))
    y = SF._side(reads, s_(ex.get("house")), s_(ex.get("row_id")), s_(ex.get("date")), s_(flow.get("replacement")),
                 s_(flow.get("replacement_uid")))
    stale = ""
    if x["text"] != s_(flow.get("shift_text")) or y["text"] != s_(ex.get("text")):
        stale = "A shift changed on the calendar since it was asked."
    if not stale:
        # said to both people: a call-off or time off of either is only "not free"
        bar = SF._exchange_bar(reads, x, y, None, fid)
        if bar is not None:
            stale = s_((bar.answer or {}).get("message"))
    trained = [] if stale else exchange_training(reads, x, y)
    for t in trained:
        if stale:
            break
        t["plan"] = TR.plan_of(reads, t["house"], {"name": t["who"]["name"], "key": t["who"]["key"],
                                                   "uid": t["who"]["uid"]}, plan.now)
        m = s_(t["plan"].get("message"))
        if t["plan"].get("status"):
            stale = t["who"]["name"] + " would work it as a training, but " + m[:1].lower() + m[1:]
    where = swap_where(reads, flow)
    if stale:
        ST._close(flow, "expired", actor["name"], plan.now)
        ST._note(flow, stale)
        head = "Swap could not finish — " + where
        body = "Every seat approved, but it could not finish: " + stale + " Nothing changed."
        ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "requester",
                                  {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}, head, body),
                         ST._item(reads, flow, "inbox", "info", "staff",
                                  {"uid": flow.get("replacement_uid"), "name": flow.get("replacement"), "email": ""},
                                  head, body)])
        return {"said": "Approved, but the swap could not finish: " + stale + " Nothing changed."}
    need = {t["who"]["key"]: t for t in trained}

    def tid_of(side: dict, take: dict) -> str:
        return SF._new_id("SF", take["house"] + "|" + side["row"] + "|" + take["date"] + "|training", now_ms) \
            if side["key"] in need else ""

    def put(side: dict, take: dict, tid: str, base: str) -> dict | None:
        cf = tid or fid
        return SW.set_cell(plan, take["house"], side["row"], take["date"],
                           {"text": take["text"], "state": "training" if tid else "swap_in", "base": base,
                            "flow_id": cf, "source": "flow:" + cf}, "swap", "", cf)

    tid_x, tid_y = tid_of(x, y), tid_of(y, x)
    # each side keeps its own pattern's base where it lands: the roll gives every shift back to its first holder
    if x["house"] == y["house"] and x["date"] == y["date"]:
        placed_x = put(x, y, tid_x, ST._base_of(x["cell"]))
        placed_y = put(y, x, tid_y, ST._base_of(y["cell"]))
    else:
        there_x = SW.cell_at(reads, y["house"], x["row"], y["date"])
        there_y = SW.cell_at(reads, x["house"], y["row"], x["date"])
        for side in (x, y):
            SW.set_cell(plan, side["house"], side["row"], side["date"],
                        {"text": "", "state": "swapped_out", "base": ST._base_of(side["cell"]), "flow_id": fid,
                         "source": "flow:" + fid}, "swap", "", fid)
        ensure_row(plan, y["house"], x["key"], x["name"], fid, actor)
        ensure_row(plan, x["house"], y["key"], y["name"], fid, actor)
        placed_x = put(x, y, tid_x, ST._base_of(there_x or {}))
        placed_y = put(y, x, tid_y, ST._base_of(there_y or {}))
    ST._close(flow, "done", actor["name"], plan.now)
    values = exchange_vars(reads, flow)
    ST._owe(flow, "sched_exchange_done", x["key"], values, plan.now, now_ms)
    ST._owe(flow, "sched_exchange_done", y["key"], values, plan.now, now_ms)
    notes: list[str] = []
    first = None
    for me, take, tid, placed in ((x, y, tid_x, placed_x), (y, x, tid_y, placed_y)):
        t = need.get(me["key"])
        if not t:
            continue
        TR.open_flow(plan, {"id": tid, "house": take["house"], "date": take["date"], "cell": placed,
                            "person": {"name": me["name"], "key": me["key"], "uid": me["uid"]}, "ist": t["need"],
                            "source": "swap", "source_ref": fid, "ctx": actor, "plan": t["plan"],
                            "giver": take["name"]})
        if first is None:
            first = {"flow_id": tid, "why": s_(t["need"].get("why"))}
        notes.append(me["name"] + " works " + ST._house_word(reads, take["house"]) + " as a training with the house "
                     "manager (" + s_(t["need"].get("why")) + ")")
    if notes:
        ST._note(flow, "; ".join(notes))
    tail = " " + "; ".join(notes) + " — the house manager and a director approve it in My Work." if notes else ""
    xw, yw = SF._side_words(reads, x), SF._side_words(reads, y)
    ST._inbox(plan, [ST._item(reads, flow, "inbox", "info", "everyone", None,
                              "Shifts swapped: " + x["name"] + " ⇄ " + y["name"] + " — " + xw + " · " + yw,
                              "Approved by " + actor["name"] + ". " + x["name"] + " now works " + yw + "; " +
                              y["name"] + " works " + xw + "." + tail)])
    out: dict[str, Any] = {"said": "Approved. The swap is done: " + x["name"] + " has " + yw + " and " + y["name"] +
                                   " has " + xw + "." + tail}
    if first:
        out["training"] = first
    return out
