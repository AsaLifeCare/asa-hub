"""SCHEDULING'S FLOW ROWS AND THE TIME OFF DECISION, IN PYTHON (SchedulingFlows.gs schedFlowRow_, schedFlowOwe_,
schedInbox_, schedFlowItemsSettle_, schedFlowCallOffApply_, schedFlowExpireOn_, schedFlowDecideTimeOff_): the director
seat marked; on approval each held shift of the person inside the span given up (time off, R/O) and opened for cover
as a call-off, the days past the last period kept for the roll; the flow closed, its text owed and the inbox told.
Every row is kept in app.edits, which the two-way sync carries to the Scheduling books; the flow clock on Python says
the owed texts and reaches out for the open shifts (scheduling_flow_writes answers the item)."""
from __future__ import annotations

import json
import urllib.parse
from datetime import datetime
from typing import Any

import gsjs
import locations as L
import scheduling as SCH
import scheduling_flows as SF
import scheduling_writes as SW

FLOWS, INBOX, CELLS, ROWS = "sched_flows", "sched_inbox", "sched_cells", "sched_rows"
SUBJECT = SCH.APP_ID
NOTE_MAX = 500


def _s(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(v))


def _clean(row: dict) -> dict:
    """A row as it is written again: its own columns, never the copy's bookkeeping."""
    return {k: v for k, v in row.items() if not str(k).startswith("_")}


def _json(v: Any) -> str:
    """JSON.stringify."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _ms(iso: Any) -> float | None:
    """Date.parse of an instant; None for what it cannot read."""
    t = _s(iso)
    if not t:
        return None
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return None


def _test_word(reads: L.Reads) -> str:
    """schedFlowTestWord_: anything unreadable is on."""
    try:
        return "no" if SCH.test_mode(reads).get("on") is False else "yes"
    except Exception:  # noqa: BLE001 - test mode fails closed
        return "yes"


def _house_word(reads: L.Reads, code: Any) -> str:
    """schedFlowHouseWord_."""
    try:
        return _s(SCH.house_label(reads, code)) or _s(code)
    except Exception:  # noqa: BLE001 - the code stands in for the label
        return _s(code)


def _shift(text: Any) -> str:
    """schedFlowShiftWords_ over a flow's (or an exchange's) shift text."""
    return SCH.shift_words(text) or _s(text)


def _link(house: Any, day: Any) -> str:
    """schedFlowLink_."""
    q = "-_.!~*'()"
    return ("/app/scheduling/calendar?house=" + urllib.parse.quote(_s(house), safe=q) + "&day=" +
            urllib.parse.quote(_s(day), safe=q))


def _num(v: Any) -> str:
    """Number(v) as the sheet keeps it."""
    n = SF._num(v)
    if n != n or abs(n) == float("inf"):
        return _s(v)
    return str(int(n)) if n == int(n) else str(n)


def _swap_where(reads: L.Reads, f: dict) -> str:
    """schedFlowSwapWhere_."""
    ex = SW.flow_exchange_of(f)
    if not ex:
        return SF._day_words(f.get("date")) + " · " + _shift(f.get("shift_text")) + " · " + \
            _house_word(reads, f.get("house_code"))
    return (_house_word(reads, f.get("house_code")) + " " + SF._day_words(f.get("date")) + " " +
            _shift(f.get("shift_text")) + " ⇄ " + _house_word(reads, ex.get("house")) + " " +
            SF._day_words(ex.get("date")) + " " + _shift(ex.get("text")))


# ---- the flow row ----------------------------------------------------------------------------------------------

def _flow_row(plan: SW.Plan, fields: dict) -> dict:
    """schedFlowRow_."""
    row = {h: "" for h in SCH.HEADERS[FLOWS]}
    row.update(fields)
    if not row["created_at"]:
        row["created_at"] = plan.now
    row["updated_at"] = plan.now
    if not row["test_mode"]:
        row["test_mode"] = _test_word(plan.reads)
    if not row["outreach_log"]:
        row["outreach_log"] = "{}"
    return row


def _close(flow: dict, state: str, by: str, now: str) -> None:
    """schedFlowClose_."""
    flow["state"] = state
    flow["closed_at"] = now
    flow["closed_by"] = _s(by)
    flow["updated_at"] = now


def _note(flow: dict, line: str) -> None:
    """schedFlowNote_."""
    flow["note"] = (_s(flow.get("note")) + " · " if _s(flow.get("note")) else "") + line


def _log(flow: dict) -> dict:
    got = SCH.jparse(flow.get("outreach_log"), {})
    return got if isinstance(got, dict) else {}


def _owe(flow: dict, sit: str, key: Any, values: dict, now: str, now_ms: float, while_state: str = "") -> None:
    """schedFlowOwe_: a text owed by the flow, kept on it for the clock, said once per situation and person (only while
    the flow still stands in `while_state`, when one is named)."""
    if not _s(key) or flow.get("kind") == "call_off":
        return
    log = _log(flow)
    owed = log.get("owed") if isinstance(log.get("owed"), list) else []
    idem = "sched:" + _s(flow.get("id")) + ":" + sit + ":" + _s(key)
    if any(isinstance(o, dict) and o.get("idem") == idem for o in owed):
        return
    owed.append({"idem": idem, "sit": sit, "key": _s(key), "vars": values or {}, "while": while_state or ""})
    log["owed"] = owed
    flow["outreach_log"] = _json(log)
    at = _ms(flow.get("outreach_next_at"))
    if at is None or at > now_ms:
        flow["outreach_next_at"] = now


def _seat_mark(flow: dict, seat: str, word: str, note: str, actor: dict, now: str) -> list:
    """schedFlowSeatMark_: the seats, the last waiting one of `seat` answered."""
    seats = SCH.jparse(flow.get("seats"), [])
    seats = seats if isinstance(seats, list) else []
    cur = None
    for s in seats:
        if isinstance(s, dict) and s.get("seat") == seat and s.get("state") == "waiting":
            cur = s
    if cur is not None:
        cur["state"] = "approved" if word == "approve" else "declined"
        cur["by"] = actor["name"]
        cur["by_uid"] = _s(actor["uid"])
        cur["at"] = now
        cur["note"] = note
    flow["seats"] = _json(seats)
    return seats


# ---- My Work / My Inbox items ------------------------------------------------------------------------------------

def _item(reads: L.Reads, flow: dict, box: str, kind: str, seat: str, to: dict | None, title: str, body: str) -> dict:
    """schedFlowItem_: one item for one recipient; an exchange's names both shifts."""
    house = _s(flow.get("house_code"))
    it = {"flow_id": _s(flow.get("id")), "box": box, "kind": kind, "seat": seat,
          "to_uid": _s((to or {}).get("uid")), "to_email": _s((to or {}).get("email")),
          "to_name": _s((to or {}).get("name")), "title": title, "body": body or "", "house_code": house,
          "house_label": _house_word(reads, house) if house else "", "date": _s(flow.get("date")),
          "shift_text": _shift(flow.get("shift_text")) if _s(flow.get("shift_text")) else "",
          "link": _link(house, flow.get("date")) if house else "/app/scheduling/calendar"}
    ex = SW.flow_exchange_of(flow)
    if ex:
        if _s(ex.get("house")) != house:
            it["house_label"] += " ⇄ " + _house_word(reads, ex.get("house"))
        it["shift_text"] = (SF._day_words(flow.get("date")) + " " + _shift(flow.get("shift_text")) + " ⇄ " +
                            SF._day_words(ex.get("date")) + " " + _shift(ex.get("text")))
    return it


def _item_key(it: dict) -> str:
    return "|".join(_s(it.get(k)) for k in ("flow_id", "box", "kind", "seat", "to_uid", "title"))


def _inbox(plan: SW.Plan, items: list[dict]) -> None:
    """schedInbox_: each telling once per flow, box, kind, seat, recipient and title."""
    keep = [it for it in items if it and it.get("box") in ("work", "inbox")
            and (_s(it.get("to_uid")) or it.get("seat") == "everyone")]
    if not keep:
        return
    have = {_item_key(r) for r in SCH.read_tab(plan.reads, INBOX)}
    tm = _test_word(plan.reads)
    for it in keep:
        k = _item_key(it)
        if k in have:
            continue
        have.add(k)
        plan.upsert(INBOX, {
            "id": SCH.new_id("SI"), "flow_id": it["flow_id"], "box": it["box"], "kind": it["kind"],
            "seat": it["seat"], "to_uid": "" if it["seat"] == "everyone" else it["to_uid"],
            "to_email": it["to_email"], "to_name": it["to_name"], "title": it["title"], "body": it["body"],
            "house_code": it["house_code"], "house_label": it["house_label"], "date": it["date"],
            "shift_text": it["shift_text"], "state": "waiting" if it["box"] == "work" else "posted",
            "answered_by": "", "answered_at": "", "note": "", "link": it["link"], "test_mode": tm,
            "created_at": plan.now})


def _settle(plan: SW.Plan, flow_id: str, seat: str, state: str, by: str, except_id: str = "",
            houses: list | None = None) -> int:
    """schedFlowItemsSettle_: every waiting My Work item of the flow (one seat, at some houses, when named) closed,
    naming who."""
    changed = 0
    for r in [dict(x) for x in SCH.read_tab(plan.reads, INBOX)]:
        if _s(r.get("flow_id")) != flow_id or r.get("box") != "work" or r.get("state") != "waiting":
            continue
        if seat and _s(r.get("seat")) != seat:
            continue
        if houses and _s(r.get("house_code")) not in houses:
            continue
        if except_id and _s(r.get("id")) == except_id:
            continue
        r = _clean(r)
        r["state"], r["answered_by"], r["answered_at"] = state, _s(by), plan.now
        plan.upsert(INBOX, r)
        changed += 1
    return changed


# ---- the calendar ------------------------------------------------------------------------------------------------

def _base_of(cell: dict | None) -> str:
    """schedBaseOf_."""
    return SW.base_of(cell)


def _open_shift(plan: SW.Plan, house: str, day: str, text: str, flow_id: str, base: str) -> str:
    """schedOpenShift_: the text on the first OPEN row free that day (a new OPEN row when none is), state open."""
    reads = plan.reads
    ids = {c["id"]: True for c in SCH.read_tab(reads, CELLS)
           if c.get("date") == day and c.get("house_code") == house and (c.get("text") or c.get("base"))}
    pick = SW.open_row_for(house, day, SCH.read_tab(reads, ROWS), ids)
    if pick["fresh"]:
        plan.upsert(ROWS, SW.open_row_record(reads, house, pick["fresh"], plan.ctx, plan.now))
    SW.set_cell(plan, house, pick["row_id"], day, {"text": text, "state": "open", "flow_id": flow_id or "",
                                                   "base": _s(base), "source": "flow:" + flow_id if flow_id else "app"},
                "open", "", flow_id)
    return pick["row_id"]


def _call_off_apply(plan: SW.Plan, actor: dict, house: str, row_id: str, day: str, cell: dict, person: dict,
                    state: str, text: str, via: str, source_ref: str, parent_id: str, *, source: str = "platform",
                    reason: str = "", note: str = "", patch: dict | None = None, open_base: str = "",
                    warn: bool = False) -> dict:
    """schedFlowCallOffApply_: the person's cell becomes `state` with `text` (or `patch`), its shift is put up open
    and a call-off flow starts its outreach, which the clock runs; `warn` tells the directors in My Inbox."""
    reads = plan.reads
    fid = SCH.new_id("SF")
    old = _s(cell.get("text"))
    cell_flow = parent_id or fid
    SW.set_cell(plan, house, row_id, day, patch or {"text": text, "state": state, "base": _base_of(cell),
                                                    "flow_id": cell_flow, "source": "flow:" + cell_flow},
                via, note, cell_flow)
    open_row = _open_shift(plan, house, day, old, fid, open_base)
    flow = _flow_row(plan, {
        "id": fid, "kind": "call_off", "state": "outreach_1", "house_code": house, "date": day, "row_id": row_id,
        "person": _s(person.get("name")), "person_key": _s(person.get("key")), "person_uid": _s(person.get("uid")),
        "shift_text": old, "start_min": _num(cell.get("start_min")), "end_min": _num(cell.get("end_min")),
        "open_row_id": open_row, "reason": _s(reason), "note": _s(note), "source": source, "source_ref": source_ref,
        "outreach_stage": "0", "outreach_next_at": plan.now, "created_by": _s(actor.get("uid"))})
    if warn:
        dirs = SF._directors(reads)
        if not dirs["readable"] or not dirs["list"]:
            _note(flow, "the directors were not warned: " + _s(dirs.get("why")))
        wait = SCH.settings(reads)["outreach_wait_min"]
        where = _house_word(reads, house)
        title = "Call off — " + SF._day_words(day) + " · " + _shift(old) + " · " + where
        body = (_s(person.get("name")) + " called off" + (" (" + _s(reason) + ")" if _s(reason) else "") + ". " +
                ("Marked by " + _s(actor.get("name")) + ". " if source == "editor" else "") +
                ("Heard on the hotline. " if source == "hotline" else "") +
                "The shift is open at the top of " + where + "; the house is texted first, then everyone after " +
                str(wait) + " minutes if it is still open.")
        _inbox(plan, [_item(reads, flow, "inbox", "warning", "director", d, title, body) for d in dirs["list"]])
    plan.upsert(FLOWS, flow)
    return flow


def _expire_on(plan: SW.Plan, house: str, row_id: str, day: str, by: str) -> None:
    """schedFlowExpireOn_: a waiting Request Off, swap or training on a shift just given up expires."""
    reads = plan.reads
    busy = SW.cell_busy(reads, house, row_id, day)
    if not busy:
        return
    b = _clean(dict(busy))
    _close(b, "expired", by, plan.now)
    _note(b, "the shift was given up (called off or time off)")
    plan.upsert(FLOWS, b)
    _settle(plan, _s(b.get("id")), "", "closed", by)
    if b.get("kind") != "swap":
        return
    own = _s(b.get("house_code")) == house and _s(b.get("row_id")) == row_id and _s(b.get("date")) == day
    to = ({"uid": b.get("replacement_uid"), "name": b.get("replacement"), "email": ""} if own
          else {"uid": b.get("person_uid"), "name": b.get("person"), "email": ""})
    if not _s(to["uid"]):
        return
    _inbox(plan, [_item(reads, b, "inbox", "info", "staff" if own else "requester", to,
                        "Swap ended — " + _swap_where(reads, b),
                        "The shift it was about was given up, so the swap ended before it was approved." if own
                        else "The other shift in it was given up, so the swap ended before it was approved. Your "
                             "shift is still yours.")])


# ---- the decision ------------------------------------------------------------------------------------------------

def _decide(plan: SW.Plan, flow: dict, word: str, note: str, actor: dict, now_ms: float) -> str:
    """schedFlowDecideTimeOff_: the sentence the answer says."""
    reads, now = plan.reads, plan.now
    _seat_mark(flow, "director", word, note, actor, now)
    span = SF._day_words(flow.get("date")) + " to " + SF._day_words(_s(flow.get("date_to")) or flow.get("date"))
    requester = {"uid": flow.get("person_uid"), "name": flow.get("person"), "email": ""}
    values: dict[str, Any] = {"dates": span}
    if word == "decline":
        _close(flow, "declined", actor["name"], now)
        values["result"] = "not approved"
        _owe(flow, "sched_timeoff_decided", flow.get("person_key"), values, now, now_ms)
        _inbox(plan, [_item(reads, flow, "inbox", "info", "requester", requester, "Time off not approved — " + span,
                            "Not approved by " + actor["name"] + (': "' + note + '"' if note else ".") +
                            " Nothing on the calendar changed.")])
        return "Declined. " + _s(flow.get("person")) + " is told."
    first, last = _s(flow.get("date")), _s(flow.get("date_to")) or _s(flow.get("date"))
    row_id = "P:" + _s(flow.get("person_key"))
    cells = [dict(c) for c in SCH.read_tab(reads, CELLS)
             if _s(c.get("row_id")) == row_id and first <= _s(c.get("date")) <= last]
    person = {"name": flow.get("person"), "key": flow.get("person_key"), "uid": flow.get("person_uid")}
    applied: list[dict] = []
    future: list[str] = []
    day = first
    while day and day <= last:
        if not SCH.period_of(reads, day):
            future.append(day)
        else:
            for c in cells:
                if _s(c.get("date")) != day or not SF._holds(c) or SF._ended(day, c.get("end_min"), now_ms):
                    continue
                _expire_on(plan, _s(c.get("house_code")), _s(c.get("row_id")), day, actor["name"])
                co = _call_off_apply(plan, actor, _s(c.get("house_code")), _s(c.get("row_id")), day, c, person,
                                     "time_off", "R/O", "time_off", _s(flow.get("id")), _s(flow.get("id")))
                applied.append({"date": day, "house": _s(c.get("house_code")), "open_row_id": co["open_row_id"],
                                "flow": co["id"]})
        day = SF._add_days(day, 1)
    log = _log(flow)
    log["applied"] = applied
    log["future"] = future
    flow["outreach_log"] = _json(log)
    _close(flow, "approved_future" if future else "approved", actor["name"], now)
    if future:
        flow["closed_at"] = ""
    values["result"] = "approved"
    _owe(flow, "sched_timeoff_decided", flow.get("person_key"), values, now, now_ms)
    title = "Time off approved — " + _s(flow.get("person")) + " · " + span
    body = ("Approved by " + actor["name"] + ". " + str(len(applied)) + " shift(s) put up as open shifts with the "
            "call-off outreach" + ("; " + str(len(future)) + " day(s) beyond the last calendar period are applied "
                                   "when the roll creates them" if future else "") + ".")
    items = [_item(reads, flow, "inbox", "info", "director", d, title, body) for d in SF._directors(reads)["list"]]
    items.append(_item(reads, flow, "inbox", "info", "requester", requester, title, body))
    _inbox(plan, items)
    return ("Approved. " + str(len(applied)) + " shift(s) are open now" +
            ("; the days beyond the last period are kept for the roll" if future else "") + ".")
