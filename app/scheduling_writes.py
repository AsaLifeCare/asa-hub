"""Scheduling's writes (apps-script/Scheduling.gs) decided off asa-hub-db and kept in app.edits as the truth; the
seed reads the house books' grids the sheet keeper keeps there (scheduling_seed)."""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scheduling_builder as SB
import scheduling_flows as SF
import scheduling_seed as SD
import time_off_rows
import writes as W
from gsjs import SheetDate, NY
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "scheduling"
UNKNOWN = "Unknown action."
# SchedulingFlows.gs: the states a waiting flow is in
FLOW_WAITING = frozenset({"waiting", "waiting_staff", "waiting_manager", "waiting_director"})
SETTINGS_TAB = "sched_settings"
# the Time Off house carried over (Scheduling.gs SCHED_TO_*)
TO_TAB = "time_off"
TO_TAKEN = {"scheduled": "approved", "pending": "waiting"}
TO_STANDING = frozenset({"waiting", "approved", "approved_future"})
TO_RANK = {"would_import": 0, "imported": 0, "unmatched": 1, "skipped": 2, "already_imported": 3}
STALE_CELL = "That cell changed since it was opened: it now reads {now}. Nothing was saved — open it again first."
STALE_SETTINGS = "The Scheduling settings changed since they were opened ({keys}) — they were read again."
DIRECTORS_MASTER = "Only the master changes who the Scheduling directors are."
SETTINGS_MASTER = frozenset({"directors"})


def edition_only(ctx: dict, house: str) -> bool:
    """Let in by the calendar edition alone: none of the house's own editors."""
    return bool(ctx.get("open") and ctx.get("calendar_edition") and house and not ctx["editor_of"](house))


def _S() -> Any:
    import scheduling as SCH  # noqa: PLC0415 - the read module loads beside this one
    return SCH


def s_(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(v))


def line_text(v: Any) -> str:
    """schedLine_: an object as JSON, null as blank, anything else String()."""
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return gsjs.or_blank(v)


def verdict_books(reads: L.Reads) -> tuple[str, ...]:
    """The books a Scheduling write rests on: the houses it reads and Staff Preferences (who may write: the relay's settle)."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    SCH = _S()
    return SCH.books_of(reads, "sched_cells", "sched_rows", "sched_flows", "sched_log", SETTINGS_TAB, SP.PREFS_TAB)


# ---- the rows one write changes -----------------------------------------------------------------------------------

class Plan:
    """The rows a write sets, laid over this request's copy of the houses and kept as app.edits records."""

    def __init__(self, reads: L.Reads, ctx: dict | None) -> None:
        self.reads = reads
        self.ctx = ctx
        self.now = _S().now_iso(reads)
        self.touched: list[tuple[str, str]] = []
        self.orig: dict[tuple[str, str], dict | None] = {}

    @staticmethod
    def idf(tab: str) -> str:
        return "key" if tab == SETTINGS_TAB else "id"

    def _at(self, tab: str, key: str) -> int | None:
        idf = self.idf(tab)
        return next((i for i, r in enumerate(_S().read_tab(self.reads, tab)) if r.get(idf) == key), None)

    def _remember(self, tab: str, key: str) -> None:
        if (tab, key) in self.orig:
            return
        SCH = _S()
        at = self._at(tab, key)
        if at is not None:
            was: dict | None = dict(SCH.read_tab(self.reads, tab)[at])
        else:
            gone = SCH.gone_rows(self.reads, tab).get(key)
            was = dict(gone) if gone else None
        self.orig[(tab, key)] = was
        self.touched.append((tab, key))

    def upsert(self, tab: str, row: dict) -> dict:
        """schedUpsert_: the whole line, by id (by key for the settings)."""
        SCH = _S()
        key = s_(row.get(self.idf(tab)))
        if not key:
            raise ValueError(f"a {tab} row needs its {self.idf(tab)}")
        self._remember(tab, key)
        full = {h: line_text(row.get(h)) for h in SCH.HEADERS[tab]}
        for h, v in row.items():
            if h not in full:
                full[h] = line_text(v)
        kept = {h: gsjs.trim(v) for h, v in full.items()}
        kept["_line"] = full
        rows = SCH.read_tab(self.reads, tab)
        at = self._at(tab, key)
        if at is None:
            rows.append(kept)
        else:
            rows[at] = kept
        SCH.forget(self.reads)
        return kept

    def remove(self, tab: str, key: str) -> None:
        """schedRemove_: the row goes; the copy keeps it as a cleared line."""
        SCH = _S()
        self._remember(tab, key)
        at = self._at(tab, key)
        if at is not None:
            del SCH.read_tab(self.reads, tab)[at]
        SCH.forget(self.reads)

    def records(self, subject: str) -> list[dict]:
        """Each touched row as app.edits keeps it: appended whole, its changed cells, or cleared (seen values named)."""
        SCH = _S()
        out: list[dict] = []
        for tab, key in self.touched:
            if HT.tabled(tab):
                self._tabled(tab, key)
                continue
            res = W.tab_of(self.reads, tab)
            if res.ref is None:
                raise Defer(f"the {tab} house holds no tab in the copy: Apps Script makes it on its first write")
            sid, name = W.where_of(res)
            match = "cols:key" if tab == SETTINGS_TAB else "id"
            was = self.orig[(tab, key)]
            at = self._at(tab, key)
            now = SCH.read_tab(self.reads, tab)[at] if at is not None else None
            if now is not None:
                line = now.get("_line") or {h: v for h, v in now.items() if not h.startswith("_")}
                if was is None:
                    out.append(W.kept_record(sid, name, "append", match, key, subject, line))
                    continue
                cells = {h: v for h, v in line.items() if gsjs.trim(v) != (was.get(h) or "")}
                if cells:
                    out.append(W.kept_record(sid, name, "edit", match, key, subject, cells,
                                             before={h: was.get(h) or "" for h in cells}))
                continue
            if was is None:
                continue
            # a removed cell: every cell it held cleared, the clearing stamped
            cells = {h: "" for h, v in was.items() if h != self.idf(tab) and not h.startswith("_") and v}
            cells["updated_at"] = self.now
            cells["updated_by"] = (self.ctx or {}).get("uid") or "system"
            out.append(W.kept_record(sid, name, "edit", match, key, subject, cells,
                                     before={h: was.get(h) or "" for h in cells}))
        return out

    def _tabled(self, tab: str, key: str) -> None:
        """One touched row of a house kept in its own table: made, changed, or taken out there."""
        SCH = _S()
        by = (self.ctx or {}).get("uid") or "system"
        at = self._at(tab, key)
        now = SCH.read_tab(self.reads, tab)[at] if at is not None else None
        if now is not None:
            line = now.get("_line") or {h: v for h, v in now.items() if not h.startswith("_")}
            HT.put(self.reads, tab, self.idf(tab), key, line, by)
            return
        was = self.orig[(tab, key)]
        if was is None:
            return
        # a removed row, as the copy keeps one: every cell it held cleared, the clearing stamped, its id staying
        cells = {h: "" for h, v in was.items() if h != self.idf(tab) and not h.startswith("_") and v}
        cells["updated_at"], cells["updated_by"] = self.now, by
        HT.put(self.reads, tab, self.idf(tab), key, cells, by)


def finish(plan: Plan, ctx: dict, said: str, period_id: str, houses: list | None, keys: list | None,
           extra: dict | None, subject: str, books: tuple[str, ...], edition: str = "") -> Decision:
    """schedAnswerAfter_: the write answer off the rows as the write leaves them, the rows kept final."""
    SCH = _S()
    SCH.forget(plan.reads)
    answer = SCH.answer(plan.reads, ctx, said, period_id, houses, keys, extra)
    edits = plan.records(subject)
    return Decision(answer, edits=edits or None, subject=subject, fresh=books, edition=edition)


def refused(env: dict, books: tuple[str, ...] | bool = False) -> Decision:
    return Decision(env, fresh=books)


def calendar_edition(ctx: dict, house: str) -> str:
    """The edition a calendar write is kept under: '' for the house's own editors."""
    return _S().CALENDAR_EDITION if edition_only(ctx, house) else ""


def _fw() -> Any:
    import scheduling_flow_writes as FW  # noqa: PLC0415 - the flows' writes build on this module
    return FW


def _tr() -> Any:
    import scheduling_training as TR  # noqa: PLC0415 - the training builds on this module
    return TR


def _drag() -> Any:
    import scheduling_drag as DR  # noqa: PLC0415 - the drag and drop builds on this module
    return DR


# ---- rows and cells ------------------------------------------------------------------------------------------------

def row_at(reads: L.Reads, house: str, row_id: str) -> dict | None:
    return next((r for r in _S().read_tab(reads, "sched_rows") if r["house_code"] == house and r["row_id"] == row_id),
                None)


def cell_at(reads: L.Reads, house: str, row_id: str, day: str) -> dict | None:
    cid = _S().cell_id(house, row_id, day)
    return next((c for c in _S().read_tab(reads, "sched_cells") if c["id"] == cid), None)


def location_of(reads: L.Reads, house: str) -> str:
    loc = ""
    for h in _S().house_list(reads):
        if h["code"] == house:
            loc = h["location"]
    return loc


def cell_row(reads: L.Reads, house: str, row_id: str, day: str, text: str, extra: dict, now: str) -> dict:
    """schedCellRow_."""
    SCH = _S()
    c = SCH.classify(text)
    p = SCH.period_of(reads, day)
    row = {"id": SCH.cell_id(house, row_id, day), "period_id": p["id"] if p else "", "house_code": house, "date": day,
           "row_id": row_id, "text": text, "kind": c.kind if c else "",
           "start_min": str(int(gsjs.js_round(c.start * 60))) if c and c.start is not None else "",
           "end_min": str(int(gsjs.js_round(c.end * 60))) if c and c.end is not None else "",
           "hours": f"{c.hours:.2f}" if c else "0.00", "token": c.token if c and c.token else "", "color": "",
           "state": "", "base": "", "flow_id": "", "source": "app", "note": "", "updated_at": now, "updated_by": ""}
    row.update(extra)
    return row


def log_row(ctx: dict | None, house: str, day: str, row_id: str, was: str, now_text: str, via: str, flow_id: str,
            note: Any, now: str) -> dict:
    SCH = _S()
    return {"id": SCH.new_id("SL"), "at": now, "by_uid": ctx["uid"] if ctx else "system",
            "by_name": ctx["name"] if ctx else "Scheduling", "house_code": house, "date": day, "row_id": row_id,
            "was": was, "now": now_text, "via": via, "flow_id": flow_id or "", "note": SCH.u16(s_(note), 500),
            "undone_at": ""}


def set_cell(plan: Plan, house: str, row_id: str, day: str, patch: dict, via: str, note: Any, flow_id: str) -> dict | None:
    """schedSetCell_: writes or clears one cell and logs it; no text and no base removes it."""
    SCH = _S()
    reads, ctx = plan.reads, plan.ctx
    was = cell_at(reads, house, row_id, day)
    text = s_(patch.get("text"))
    base = s_(patch["base"]) if "base" in patch else ""
    rec = row_at(reads, house, row_id)
    out = None
    if not text and not base:
        if was:
            plan.remove("sched_cells", was["id"])
    else:
        c = SCH.classify(text)
        state = s_(patch.get("state")) or ("open" if rec and rec["row_kind"] == "open" and c and c.start is not None
                                           else "scheduled")
        out = cell_row(reads, house, row_id, day, text, {
            "state": state, "base": base, "flow_id": s_(patch["flow_id"] if "flow_id" in patch else flow_id),
            "source": s_(patch.get("source")) or ("flow:" + flow_id if flow_id else "app"),
            "color": was["color"] if was else "", "note": SCH.u16(s_(note), 500),
            "updated_by": ctx["uid"] if ctx else "system"}, plan.now)
        plan.upsert("sched_cells", out)
    plan.upsert("sched_log", log_row(ctx, house, day, row_id, was["text"] if was else "", text, via, flow_id, note,
                                     plan.now))
    return out


def person_row(reads: L.Reads, ctx: dict | None, house: str, name: str, key: str, known: dict | None, now: str) -> dict:
    """schedPersonRow_."""
    SCH = _S()
    top = 0.0
    for r in SCH.read_tab(reads, "sched_rows"):
        if r["house_code"] == house and r["row_kind"] == "person":
            top = max(top, SCH.pfloat(r["order"]))
    if known:
        rec = {k: v for k, v in known.items() if not k.startswith("_")}
    else:
        rec = {"id": SCH.row_id_of(house, "P:" + key), "house_code": house, "location": location_of(reads, house),
               "row_id": "P:" + key, "row_kind": "person", "name": s_(name), "person_key": key, "designation": "",
               "order": gsjs.num_str(top + 1), "source": "app"}
    rec["active"] = "yes"
    rec["updated_at"] = now
    rec["updated_by"] = ctx["uid"] if ctx else "system"
    return rec


def flow_exchange_of(f: dict) -> dict | None:
    """schedFlowExchangeOf_."""
    if not f or f.get("kind") != "swap":
        return None
    log = _S().jparse(f.get("outreach_log"), {})
    ex = log.get("exchange") if isinstance(log, dict) else None
    if not isinstance(ex, dict) or not s_(ex.get("house")) or not re.match(r"^P:.", s_(ex.get("row_id"))) or \
            not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", s_(ex.get("date"))):
        return None
    return ex


def cell_busy(reads: L.Reads, house: str, row_id: str, day: str) -> dict | None:
    """schedFlowCellBusy_: a waiting Request Off, swap or training on this very cell."""
    hit = None
    for f in _S().read_tab(reads, "sched_flows"):
        if f["kind"] not in ("request_off", "swap", "training") or s_(f["state"]) not in FLOW_WAITING:
            continue
        ex = flow_exchange_of(f)
        here = s_(f["house_code"]) == house and s_(f["row_id"]) == row_id and s_(f["date"]) == day
        there = bool(ex) and s_(ex.get("house")) == house and s_(ex.get("row_id")) == row_id and s_(ex.get("date")) == day
        if here or there:
            hit = f
    return hit


def pending_what(busy: dict, house: str, row_id: str, day: str) -> str:
    """schedFlowPendingWhat_: what waits on this cell, as an editor reads it."""
    if busy["kind"] == "training":
        return "training"
    if busy["kind"] == "request_off":
        return "Request Off"
    own = s_(busy["house_code"]) == house and s_(busy["row_id"]) == row_id and s_(busy["date"]) == day
    return "swap with " + (s_(busy["replacement"]) if own else s_(busy["person"]))


def pending_words(busy: dict, house: str, row_id: str, day: str) -> str:
    return "This shift has a pending " + pending_what(busy, house, row_id, day) + ": answer it or cancel it first."


def on_roster(reads: L.Reads, house: str, person_key: Any) -> bool:
    """schedOnRoster_: an active person row there from the book, or one that already held a shift."""
    SCH = _S()
    key = s_(person_key)
    if not key:
        return False
    row = None
    for r in SCH.read_tab(reads, "sched_rows"):
        if r["house_code"] == house and r["row_kind"] == "person" and r["person_key"] == key and r["active"] != "no":
            row = r
    if not row:
        return False
    if re.match(r"^seed:", s_(row["source"])):
        return True
    for c in SCH.read_tab(reads, "sched_cells"):
        if c["house_code"] != house or c["row_id"] != row["row_id"] or c["state"] == "training":
            continue
        a, b = SCH.classify(c["text"]), SCH.classify(c["base"])
        if (a and a.start is not None) or (b and b.start is not None):
            return True
    return False


def same_house_bar(reads: L.Reads, house: str, name: str, was: dict | None) -> dict | None:
    SCH = _S()
    c = SCH.classify(was["text"]) if was and s_(was["text"]) else None
    if not c or c.kind == "off":
        return None
    return SCH.refuse(409, name + " already has " + s_(was["text"]) + " at " + SCH.house_label(reads, house) +
                      " that day — a row holds one shift a day.")


def editor_place(plan: Plan, house: str, row: dict, day: str, value: str, was: dict | None, via: str, note: Any,
                 new_row: dict | None) -> dict[str, Any]:
    """schedEditorPlace_: an editor writes `value` on a row's cell — {cell, training}, or the refusal ({status,
    message}) when it would make a training nobody can approve. Somebody new to the house without its IST is placed
    as a training; new hours on a training move it; a training's shift taken off ends it."""
    SCH, TR = _S(), _tr()
    ctx = plan.ctx or {}
    c = SCH.classify(value)
    timed = bool(value and c and c.start is not None)
    was_state = s_(was.get("state")) if was else ""
    if was and was_state in SCH.HELD_ONE_OFF and timed and s_(was.get("text")):
        # a pattern that is the shift itself (an approved editor's training) follows its new hours
        kept_base = value if s_(was.get("base")) and s_(was.get("base")) == s_(was.get("text")) else s_(was.get("base"))
        kept = set_cell(plan, house, row["row_id"], day, {"text": value, "state": was_state, "base": kept_base,
                                                          "flow_id": s_(was.get("flow_id")),
                                                          "source": s_(was.get("source")) or "app"},
                        via, note, s_(was.get("flow_id")))
        if was_state == "training":
            TR.moved(plan, s_(was.get("flow_id")), kept, ctx)
        return {"cell": kept, "training": None}
    need = TR.need(plan.reads, house, row["person_key"]) if timed and row["row_kind"] == "person" else None
    t_plan, person = None, None
    if need:
        u = SCH.user_by_key(plan.reads, row["person_key"])
        person = {"name": row["name"], "key": row["person_key"], "uid": u["uid"] if u else ""}
        t_plan = TR.plan_of(plan.reads, house, person, plan.now)
        if t_plan.get("status"):
            return {"status": t_plan["status"], "message": t_plan["message"]}
    if new_row:
        plan.upsert("sched_rows", new_row)
    if was_state == "training" and s_(was.get("flow_id")):
        TR.end(plan, s_(was.get("flow_id")), "withdrawn", ctx,
               "the shift was taken off the calendar by " + s_(ctx.get("name")))
    if not need:
        return {"cell": set_cell(plan, house, row["row_id"], day, {"text": value, "source": "app"}, via, note, ""),
                "training": None}
    tid = SF._new_id("SF", house + "|" + row["row_id"] + "|" + day + "|training", SF._now_ms(plan.reads))
    cell = set_cell(plan, house, row["row_id"], day, {"text": value, "state": "training",
                                                      "base": base_of(was), "flow_id": tid, "source": "flow:" + tid},
                    via, note, tid)
    TR.open_flow(plan, {"id": tid, "house": house, "date": day, "cell": cell, "person": person, "ist": need,
                        "source": "editor", "source_ref": "", "ctx": ctx, "plan": t_plan})
    return {"cell": cell, "training": {"flow_id": tid, "why": s_(need.get("why"))}}


def base_of(cell: dict | None) -> str:
    """schedBaseOf_: a one-off keeps the base it replaced, anything else is its own."""
    if not cell:
        return ""
    return s_(cell.get("base")) if s_(cell.get("state")) in _S().ONE_OFF_STATES else s_(cell.get("text"))


# ---- the doors -----------------------------------------------------------------------------------------------------

def _gate(sess: L.Session) -> tuple[Any, dict]:
    SCH = _S()
    return SCH, SCH.gate(sess)


def cell_save(sess: L.Session, payload: dict) -> Decision:
    """schedulingCellSave: an editor adds, edits or deletes one cell, or gives an OPEN shift; `via` move is House
    Calendars' drag and drop for a house manager and above (scheduling_drag), its own gate and checks."""
    if s_(payload.get("via")) == "move":
        return _drag().move(sess, payload)
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    reads = sess.reads
    house, day, via = s_(payload.get("house")), s_(payload.get("date")), s_(payload.get("via")) or "edit"
    open_row = s_(payload.get("open_row_id"))
    if via not in ("add", "edit", "delete"):
        return W.refuse(400, "A cell is added, edited or deleted.")
    if not house or not SCH.iso_valid(day):
        return W.refuse(400, "Pick a house and a day.")
    if open_row and (via != "add" or not re.fullmatch(r"OPEN:[0-9]+", open_row)):
        return W.refuse(400, "Pick the OPEN shift to give.")
    from_row = s_(payload.get("from_row_id"))
    if from_row and (via != "add" or open_row or not from_row.startswith("P:")):
        return W.refuse(400, "Pick the shift to give.")
    books = verdict_books(reads)
    if not ctx["edits"](house):
        return refused(SCH.refuse(403, SCH.EDITORS_ONLY), books)
    period = SCH.period_of(reads, day)
    if not period:
        return refused(SCH.refuse(400, "That day is not on any calendar period yet."), books)
    if not any(h["code"] == house for h in SCH.house_list(reads)):
        return refused(SCH.refuse(404, "There is no such house."), books)
    value = "" if via == "delete" else s_(payload.get("value"))
    if not open_row and via != "delete" and not value and (s_(payload.get("start")) or s_(payload.get("end"))):
        built = SCH.value_from_times(payload.get("start"), payload.get("end"))
        if "error" in built:
            return W.refuse(400, built["error"])
        value = built["code"]
    if not open_row and via != "delete" and not value:
        return W.refuse(400, "Type a shift, or pick its start and end.")
    W.gate(reads)
    plan = Plan(reads, ctx)
    row_id, new_row = s_(payload.get("row_id")), None
    if not row_id:
        who = s_(payload.get("person"))
        key = SCH.fold(who)
        if not key:
            return W.refuse(400, "Pick a row or a person.")
        for r in SCH.read_tab(reads, "sched_rows"):
            if r["row_kind"] == "person" and r["person_key"] == key:
                who = r["name"]
                break
        row_id = "P:" + key
        known = row_at(reads, house, row_id)
        if not known or known["active"] == "no":
            new_row = person_row(reads, ctx, house, who, key, known, plan.now)
    row = new_row or row_at(reads, house, row_id)
    if not row or row["active"] == "no":
        return refused(SCH.refuse(404, "That row is not on this house's calendar."), books)
    if open_row:
        return assign_open(plan, ctx, house, day, open_row, row, new_row, payload.get("note"), period,
                           payload.get("override") is True, books, sess.user)
    if from_row:
        return give_cell(plan, ctx, house, day, from_row, row, new_row, value, payload, period, books, sess.user)
    # a swap (either side), a Request Off or a training waiting on the cell: answered or cancelled first
    busy = cell_busy(reads, house, row_id, day)
    if busy and payload.get("cancel_pending") is not True:
        return refused(SCH.refuse(409, pending_words(busy, house, row_id, day)), books)
    was = cell_at(reads, house, row_id, day)
    # the cell as the editor saw it: a newer one is said, never written over
    seen = payload.get("seen")
    if isinstance(seen, str) and s_(seen) != s_(was["text"] if was else ""):
        return refused(SCH.refuse(409, STALE_CELL.format(now=s_(was["text"] if was else "") or "nothing")), books)
    # OFF is free: an add over it replaces it
    if via == "add" and was and was["text"] and (SCH.classify(was["text"]) or SCH.Cls("", "", None, None, None, 0)).kind != "off":
        return refused(SCH.refuse(409, row["name"] + " already has " + was["text"] + " that day — edit it instead."), books)
    c = SCH.classify(value)
    if value and row["row_kind"] == "person" and c and c.kind not in ("off", "ro"):
        span = SCH.value_span(c, value)
        hit = SCH.clash(reads, row["person_key"], day, span[0] if span else None, span[1] if span else None,
                        ignore=(was["id"],) if was else (), house_code=house, value=value)
        if hit:
            return refused(SCH.refuse(409, SCH.clash_sentence(reads, row["name"], hit, ctx, row["person_key"])), books)
    # a new shift for somebody (not new hours on one they already work) is read against their Staff Preferences
    crossed = None
    was_c = SCH.classify(was["text"]) if was and s_(was["text"]) else None
    if value and row["row_kind"] == "person" and c and c.start is not None and not (was_c and was_c.start is not None):
        crossed = SCH.prefs_against(reads, row["person_key"], row["name"], house, day)
        if crossed and payload.get("override") is not True:
            return refused(SCH.prefs_refusal(crossed), books)
    # a cancelled training's cell is written as the plain shift under it: the edit is the editor's own placement
    under = {"id": was["id"], "text": s_(was["base"]), "state": "", "base": "", "flow_id": ""} \
        if busy and was and s_(was["state"]) == "training" and s_(was["flow_id"]) == s_(busy["id"]) else was
    placed = editor_place(plan, house, row, day, value, under, via,
                          _fw().prefs_note(payload.get("note")) if crossed else payload.get("note"), new_row)
    if placed.get("status"):
        return refused(SCH.refuse(placed["status"], placed["message"]), books)
    what = ""
    if busy:
        what = pending_what(busy, house, row_id, day)
        _fw().cancel_pending(plan, {k: v for k, v in busy.items() if not k.startswith("_")}, ctx, house, row_id, day)
    extra: dict[str, Any] = {}
    if placed["cell"] and row["row_kind"] == "person" and c and c.start is not None and \
            not SCH.hours_hidden(reads, ctx):
        SCH.forget(reads)
        wk = SCH.week_hours(reads, row["person_key"], day)
        if wk > 40:
            extra["warn"] = (row["name"] + " now has " + gsjs.num_str(wk) + " hours in the week of " +
                             SCH.day_words(SCH.week_key(day)) + ".")
    if via == "delete":
        said = "Removed " + (was["text"] if was else "the shift") + " from " + row["name"] + " on " + SCH.day_words(day) + "."
    else:
        said = "Saved " + value + " for " + row["name"] + " on " + SCH.day_words(day) + "."
    if busy:
        said += " The pending " + what + " was cancelled; whoever asked is told."
    if placed["training"]:
        said += " " + _tr().words(row["name"], placed["training"]["why"])
        extra["training"] = placed["training"]
    if crossed:
        _fw().override_logged(sess.user, "schedulingCellSave", house, day, row["person_key"], crossed)
    return finish(plan, ctx, said, period["id"], [house], [row["person_key"]] if row["person_key"] else [], extra,
                  house, books, calendar_edition(ctx, house))


def give_cell(plan: Plan, ctx: dict, house: str, day: str, from_row: str, row: dict, new_row: dict | None, value: str,
              payload: dict, period: dict, books: tuple[str, ...], user: dict | None) -> Decision:
    """An editor gives a cell's shift to somebody else at the house, in one write: it is placed on their row and the
    holder's own shift that day comes off with it. An OFF or a time off stays where it is: only the shift moves."""
    SCH = _S()
    reads = plan.reads
    src = row_at(reads, house, from_row)
    if not src or src["active"] == "no" or src["row_kind"] != "person":
        return refused(SCH.refuse(404, "That shift's row is not on this house's calendar."), books)
    if row["row_kind"] != "person":
        return refused(SCH.refuse(400, "A shift is given to a person."), books)
    if row["row_id"] == src["row_id"]:
        return refused(SCH.refuse(400, "Pick somebody else to give it to."), books)
    c = SCH.classify(value)
    if not c or c.start is None:
        return refused(SCH.refuse(400, "Pick the shift's start and end to give it."), books)
    held = cell_at(reads, house, from_row, day)
    # the cell as the editor saw it: a newer one is said, never written over
    seen = payload.get("seen")
    if isinstance(seen, str) and s_(seen) != s_(held["text"] if held else ""):
        return refused(SCH.refuse(409, STALE_CELL.format(now=s_(held["text"] if held else "") or "nothing")), books)
    held_busy = cell_busy(reads, house, from_row, day)
    if held_busy and payload.get("cancel_pending") is not True:
        return refused(SCH.refuse(409, pending_words(held_busy, house, from_row, day)), books)
    busy = cell_busy(reads, house, row["row_id"], day)
    if busy:
        return refused(SCH.refuse(409, row["name"] + "'s cell that day has a pending " +
                                  pending_what(busy, house, row["row_id"], day) + ": answer it or cancel it first."), books)
    was = cell_at(reads, house, row["row_id"], day)
    bar = same_house_bar(reads, house, row["name"], was)
    if bar:
        return refused(bar, books)
    span = SCH.value_span(c, value)
    hit = SCH.clash(reads, row["person_key"], day, span[0] if span else None, span[1] if span else None,
                    ignore=(was["id"],) if was else (), house_code=house, value=value)
    if hit:
        return refused(SCH.refuse(409, SCH.clash_sentence(reads, row["name"], hit, ctx, row["person_key"])), books)
    crossed = SCH.prefs_against(reads, row["person_key"], row["name"], house, day)
    if crossed and payload.get("override") is not True:
        return refused(SCH.prefs_refusal(crossed), books)
    note = s_(payload.get("note"))
    why = "Given from " + src["name"] + (" — " + note if note else "")
    placed = editor_place(plan, house, row, day, value, was, "add", _fw().prefs_note(why) if crossed else why, new_row)
    if placed.get("status"):
        return refused(SCH.refuse(placed["status"], placed["message"]), books)
    # the holder's own shift comes off; an OFF, an R/O, a call-off or a time off is not theirs to work and stays
    hc = SCH.classify(held["text"]) if held and s_(held["text"]) else None
    clears = bool(hc and hc.start is not None and s_(held["state"]) not in SCH.OFF_STATES)
    if clears:
        # a cancelled training's cell is cleared as the plain shift under it, the training closed by its cancel
        under = {"id": held["id"], "text": s_(held["base"]), "state": "", "base": "", "flow_id": ""} \
            if held_busy and s_(held["state"]) == "training" and s_(held["flow_id"]) == s_(held_busy["id"]) else held
        editor_place(plan, house, src, day, "", under, "delete", "Given to " + row["name"] + (" — " + note if note else ""),
                     None)
    what = ""
    if held_busy:
        what = pending_what(held_busy, house, from_row, day)
        _fw().cancel_pending(plan, {k: v for k, v in held_busy.items() if not k.startswith("_")}, ctx, house, from_row,
                             day)
    extra: dict[str, Any] = {}
    if placed["cell"] and not SCH.hours_hidden(reads, ctx):
        SCH.forget(reads)
        wk = SCH.week_hours(reads, row["person_key"], day)
        if wk > 40:
            extra["warn"] = (row["name"] + " now has " + gsjs.num_str(wk) + " hours in the week of " +
                             SCH.day_words(SCH.week_key(day)) + ".")
    said = "Gave " + value + " on " + SCH.day_words(day) + " to " + row["name"] + \
        (", off " + src["name"] + "'s calendar." if clears else ".")
    if held_busy:
        said += " The pending " + what + " was cancelled; whoever asked is told."
    if placed["training"]:
        said += " " + _tr().words(row["name"], placed["training"]["why"])
        extra["training"] = placed["training"]
    if crossed:
        _fw().override_logged(user, "schedulingCellSave", house, day, row["person_key"], crossed)
    keys = [k for k in (row["person_key"], src["person_key"]) if k]
    return finish(plan, ctx, said, period["id"], [house], keys, extra, house, books, calendar_edition(ctx, house))


def assign_open(plan: Plan, ctx: dict, house: str, day: str, open_row: str, row: dict, new_row: dict | None, note: Any,
                period: dict, override: bool, books: tuple[str, ...], user: dict | None) -> Decision:
    """schedAssignOpen_: an editor gives an OPEN shift to somebody, in one write; a call-off's outreach is covered."""
    SCH = _S()
    reads = plan.reads
    if row["row_kind"] != "person":
        return refused(SCH.refuse(400, "An OPEN shift is given to a person."), books)
    opened = cell_at(reads, house, open_row, day)
    if not opened or s_(opened["state"]) != "open" or not s_(opened["text"]):
        return refused(SCH.refuse(409, "That OPEN shift is not open any more — somebody took it a moment ago."), books)
    text = s_(opened["text"])
    was = cell_at(reads, house, row["row_id"], day)
    bar = same_house_bar(reads, house, row["name"], was)
    if bar:
        return refused(bar, books)
    c = SCH.classify(text)
    span = SCH.value_span(c, text)
    hit = SCH.clash(reads, row["person_key"], day, span[0] if span else None, span[1] if span else None,
                    ignore=(was["id"],) if was else (), house_code=house, value=text)
    if hit:
        return refused(SCH.refuse(409, SCH.clash_sentence(reads, row["name"], hit, ctx, row["person_key"])), books)
    crossed = SCH.prefs_against(reads, row["person_key"], row["name"], house, day) if c and c.start is not None else None
    if crossed and not override:
        return refused(SCH.prefs_refusal(crossed), books)
    if crossed:
        note = _fw().prefs_note(note)
    # somebody new to the house without its IST is given it as a training (asked before anything is written)
    TR = _tr()
    need = TR.need(reads, house, row["person_key"]) if c and c.start is not None else None
    t_plan, person = None, None
    if need:
        u = SCH.user_by_key(reads, row["person_key"])
        person = {"name": row["name"], "key": row["person_key"], "uid": u["uid"] if u else ""}
        t_plan = TR.plan_of(reads, house, person, plan.now)
        if t_plan.get("status"):
            return refused(SCH.refuse(t_plan["status"], t_plan["message"]), books)
    if new_row:
        plan.upsert("sched_rows", new_row)
    flow_id = s_(opened["flow_id"])
    n = SCH.open_n(open_row)
    why = "Assigned from " + ("OPEN " + str(n) if n > 1 else "OPEN") + (" — " + s_(note) if s_(note) else "")
    tid = SF._new_id("SF", house + "|" + row["row_id"] + "|" + day + "|training", SF._now_ms(reads)) if need else ""
    if tid:
        placed = set_cell(plan, house, row["row_id"], day, {"text": text, "state": "training", "base": base_of(was),
                                                            "flow_id": tid, "source": "flow:" + tid}, "add", why, tid)
    elif flow_id:
        placed = set_cell(plan, house, row["row_id"], day, {"text": text, "state": "taken", "base": base_of(was),
                                                            "flow_id": flow_id, "source": "flow:" + flow_id},
                          "add", why, flow_id)
    else:
        placed = set_cell(plan, house, row["row_id"], day, {"text": text, "source": "app"}, "add", why, "")
    # a call-off's OPEN cell goes; one that keeps a pattern's base keeps it for the roll
    if flow_id and s_(opened["base"]):
        set_cell(plan, house, open_row, day, {"text": "", "state": "taken", "base": s_(opened["base"]), "flow_id": "",
                                              "source": "app"}, "delete", "Assigned to " + row["name"], flow_id)
    else:
        set_cell(plan, house, open_row, day, {"text": ""}, "delete", "Assigned to " + row["name"], flow_id)
    if flow_id:
        _fw().covered_by(plan, flow_id, ctx["name"])
    said = "Gave " + text + " on " + SCH.day_words(day) + " to " + row["name"] + "."
    extra = None
    if tid:
        # a genuinely open shift given is the editor's pattern; one a call-off opened stays a one-off
        TR.open_flow(plan, {"id": tid, "house": house, "date": day, "cell": placed, "person": person, "ist": need,
                            "source": "assign" if flow_id else "editor", "source_ref": flow_id, "ctx": ctx,
                            "plan": t_plan})
        said += " " + TR.words(row["name"], s_(need.get("why")))
        extra = {"training": {"flow_id": tid, "why": s_(need.get("why"))}}
    if crossed:
        _fw().override_logged(user, "schedulingCellSave", house, day, row["person_key"], crossed)
    return finish(plan, ctx, said, period["id"], [house], [row["person_key"]] if row["person_key"] else [], extra,
                  house, books, calendar_edition(ctx, house))


def add_person(sess: L.Session, payload: dict) -> Decision:
    """schedulingAddPerson: an editor puts somebody on a house's rows."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    reads = sess.reads
    house, name = s_(payload.get("house")), s_(payload.get("person"))
    key = SCH.fold(name)
    if not house or not key:
        return W.refuse(400, "Pick a house and a person.")
    if SCH.row_kind_of(name) != "person":
        return W.refuse(400, "An OPEN or WORKSHOP row is not a person.")
    books = verdict_books(reads)
    if not ctx["edits"](house):
        return refused(SCH.refuse(403, SCH.EDITORS_ONLY), books)
    if not any(h["code"] == house for h in SCH.house_list(reads)):
        return refused(SCH.refuse(404, "There is no such house."), books)
    W.gate(reads)
    plan = Plan(reads, ctx)
    known = row_at(reads, house, "P:" + key)
    if known and known["active"] != "no":
        return refused(SCH.refuse(409, known["name"] + " is already on " + SCH.house_label(reads, house) + "."), books)
    crossed = SCH.prefs_against(reads, key, (known and known["name"]) or name, house, "")
    if crossed and payload.get("override") is not True:
        return refused(SCH.prefs_refusal(crossed), books)
    rec = plan.upsert("sched_rows", person_row(reads, ctx, house, name, key, known, plan.now))
    plan.upsert("sched_log", log_row(ctx, house, "", rec["row_id"], "", rec["name"], "add_person", "",
                                     SCH.PREFS_OVERRIDE_NOTE if crossed else "", plan.now))
    if crossed:
        _fw().override_logged(sess.user, "schedulingAddPerson", house, "", key, crossed)
    return finish(plan, ctx, rec["name"] + " is on " + SCH.house_label(reads, house) + ".",
                  SCH.current_period(reads)["id"], [house], [key], None, house, books, calendar_edition(ctx, house))


def undo(sess: L.Session, payload: dict) -> Decision:
    """schedulingUndo: the editor's own last change on a house, put back."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    reads = sess.reads
    house = s_(payload.get("house"))
    if not house:
        return W.refuse(400, "Pick a house.")
    books = verdict_books(reads)
    if not ctx["edits"](house):
        return refused(SCH.refuse(403, SCH.EDITORS_ONLY), books)
    W.gate(reads)
    plan = Plan(reads, ctx)
    mine = [x for x in SCH.read_tab(reads, "sched_log") if x["house_code"] == house and x["by_uid"] == ctx["uid"]
            and not x["undone_at"] and x["via"] in ("add", "edit", "delete", "add_person")]
    mine.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
    if not mine:
        return refused(SCH.refuse(404, "Nothing of yours to undo on " + SCH.house_label(reads, house) + "."), books)
    act = {k: v for k, v in mine[0].items() if not k.startswith("_")}
    row = row_at(reads, house, act["row_id"])
    keys = [row["person_key"]] if row and row["person_key"] else []
    period_id = SCH.current_period(reads)["id"]
    trained = None
    if act["via"] == "add_person":
        if row:
            off = {k: v for k, v in row.items() if not k.startswith("_")}
            off.update({"active": "no", "updated_at": plan.now, "updated_by": ctx["uid"]})
            plan.upsert("sched_rows", off)
    else:
        if not row:
            return refused(SCH.refuse(404, "That row is no longer on this house's calendar."), books)
        busy = cell_busy(reads, house, act["row_id"], act["date"])
        if busy:
            return refused(SCH.refuse(409, pending_words(busy, house, act["row_id"], act["date"])), books)
        cur = cell_at(reads, house, act["row_id"], act["date"])
        if s_(cur["text"] if cur else "") != s_(act["now"]):
            return refused(SCH.refuse(409, "That cell changed since — undo would overwrite " +
                                      (s_(cur["text"] if cur else "") or "an empty cell") + "."), books)
        back = s_(act["was"])
        c = SCH.classify(back)
        if back and row["row_kind"] == "person" and c and c.kind not in ("off", "ro"):
            span = SCH.value_span(c, back)
            hit = SCH.clash(reads, row["person_key"], act["date"], span[0] if span else None,
                            span[1] if span else None, ignore=(cur["id"],) if cur else (), house_code=house, value=back)
            if hit:
                return refused(SCH.refuse(409, SCH.clash_sentence(reads, row["name"], hit, ctx, row["person_key"])),
                               books)
        placed = editor_place(plan, house, row, act["date"], back, cur, "undo", "undo of " + act["id"], None)
        if placed.get("status"):
            return refused(SCH.refuse(placed["status"], placed["message"]), books)
        trained = placed["training"]
        p = SCH.period_of(reads, act["date"])
        if p:
            period_id = p["id"]
    act["undone_at"] = plan.now
    plan.upsert("sched_log", act)
    if act["via"] == "add_person":
        said = "Undone: " + (row["name"] if row else "the person") + " is off the house again."
    else:
        said = "Undone: " + (s_(act["was"]) or "an empty cell") + " is back."
    if trained:
        said += " " + _tr().words(row["name"], trained["why"])
    return finish(plan, ctx, said, period_id, [house], keys, {"training": trained} if trained else None, house, books,
                  calendar_edition(ctx, house))


def _settable(k: str, v: Any) -> dict[str, str]:
    """SCHED_SETTABLE."""
    SCH = _S()
    if k == "directors":
        lst = [x for x in re.split(r"[,;\s]+", s_(v)) if x]
        if not lst or any(not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", x) for x in lst):
            return {"error": "Directors are e-mail addresses, separated by commas."}
        return {"value": ", ".join(x.lower() for x in lst)}
    n = SCH.int_of(v, -1)
    if k == "cycle_days":
        return {"value": str(n)} if 7 <= n <= 84 and n % 7 == 0 else {"error": "The cycle is 7 to 84 days, in whole weeks."}
    if k == "roll_lead_days":
        return {"value": str(n)} if 1 <= n <= 28 else {"error": "The roll runs 1 to 28 days before a period ends."}
    if k == "outreach_wait_min":
        return {"value": str(n)} if 5 <= n <= 10 else {"error": "The outreach waits 5 to 10 minutes."}
    return {"value": str(n)} if 0 <= n <= 60 else {"error": "Requests are 0 to 60 days ahead."}


SETTABLE = ("directors", "cycle_days", "roll_lead_days", "outreach_wait_min", "min_days_ahead")


def settings_public(reads: L.Reads) -> dict[str, Any]:
    s = _S().settings(reads)
    return {"readable": s["readable"], "why": s["why"],
            "directors": [{"email": d["email"], "name": d["name"]} for d in s["directors"]],
            "directors_readable": s["directors_readable"], "directors_why": s["directors_why"],
            "cycle_days": s["cycle_days"], "roll_lead_days": s["roll_lead_days"],
            "outreach_wait_min": s["outreach_wait_min"], "min_days_ahead": s["min_days_ahead"],
            "periods": s["periods"],
            "houses": [{"code": h["code"], "location": h["location"], "short": h["short"]} for h in s["houses"]],
            "seeded_at": s["seeded_at"]}


def settings_set(sess: L.Session, payload: dict) -> Decision:
    """schedulingSettingsSet: the master's Scheduling settings; the settings edition changes all but the directors."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    master = bool(ctx["is_master"])
    if not master and not ctx.get("settings_edition"):
        return W.refuse(403, "Only the master changes the Scheduling settings.")
    reads = sess.reads
    values = payload.get("values") if isinstance(payload.get("values"), dict) else {}
    rows, bad = [], []
    now = SCH.now_iso(reads)
    for k in SCH.js_keys(values):
        if k not in SETTABLE:
            bad.append(k + " is not a setting this screen changes.")
            continue
        if k in SETTINGS_MASTER and not master:
            bad.append(DIRECTORS_MASTER)
            continue
        got = _settable(k, values[k])
        if "error" in got:
            bad.append(got["error"])
        else:
            rows.append({"key": k, "value": got["value"], "note": "", "updated_at": now, "updated_by": ctx["uid"]})
    if bad:
        return W.refuse(403 if DIRECTORS_MASTER in bad else 400, " ".join(bad))
    if not rows:
        return W.refuse(400, "Nothing to change.")
    books = verdict_books(reads)
    # each value as the editor saw it: a newer one is said, never written over
    seen = payload.get("seen") if isinstance(payload.get("seen"), dict) else {}
    now_of = SCH.settings(reads)
    stale = [r["key"] for r in rows if r["key"] not in SETTINGS_MASTER and r["key"] in seen
             and s_(seen[r["key"]]) != s_(now_of.get(r["key"]))]
    if stale:
        return W.refuse(409, STALE_SETTINGS.format(keys=", ".join(stale)), fresh=books)
    W.gate(reads)
    plan = Plan(reads, ctx)
    for r in rows:
        plan.upsert(SETTINGS_TAB, r)
    SCH.forget(reads)
    answer = {"status": 200, "data": {"ok": True, "said": "Saved.", "settings": settings_public(reads)}}
    edits = plan.records(SCH.APP_ID)
    return Decision(answer, edits=edits or None, subject=SCH.APP_ID, fresh=books,
                    edition="" if master else SCH.SETTINGS_EDITION)


def seed(sess: L.Session, payload: dict) -> Decision:
    """schedulingSeed (schedSeed_): the house books named by the Dashboard index, each CALENDAR grid as the sheet keeper
    keeps it in asa-hub-db, read into the board's rows and cells — a dry run unless dry_run is false; the first copy
    runs once."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    if not ctx["is_master"]:
        return W.refuse(403, "Only the master copies the calendars in.")
    first = s_(payload.get("first")) or SCH.FIRST_PERIOD["first"]
    last = s_(payload.get("last")) or SCH.FIRST_PERIOD["last"]
    if not SCH.iso_valid(first) or not SCH.iso_valid(last) or first > last:
        return W.refuse(400, "The period needs a first and a last day.")
    if (SCH.day_index(last) - SCH.day_index(first) + 1) % 7 != 0:
        return W.refuse(400, "A period is whole weeks.")
    dry = payload.get("dry_run") is not False
    reads = sess.reads
    fresh = SCH.books_of(reads, SETTINGS_TAB)
    got = SD.books(reads, first, last)
    if isinstance(got, str):
        return W.refuse(503, got, fresh=fresh)
    now = SCH.now_iso(reads)
    plan = SD.plan(got, first, last, now)
    counts = {"houses": len(plan["houses"]), "rows": len(plan["rows"]), "cells": len(plan["cells"])}
    if dry:
        return Decision({"status": 200, "data": {"ok": True, "dry_run": True, "said": "Dry run: nothing was written.",
                                                 "report": plan["report"], "counts": counts}}, fresh=fresh)
    st = SCH.settings(reads)
    if not st["readable"]:
        return W.refuse(503, "The Scheduling settings could not be read: " + st["why"], fresh=fresh)
    if st["seeded_at"]:
        return refused(SCH.refuse(409, "The calendars were already copied (" + st["seeded_at"] +
                                  ") — the seed runs once."), fresh)
    W.gate(reads)
    edits = SB._upserts(reads, "sched_rows", plan["rows"], SCH.APP_ID) if plan["rows"] else []
    edits += SB._upserts(reads, "sched_cells", plan["cells"], SCH.APP_ID) if plan["cells"] else []
    edits += SB._appends(reads, "sched_log", [
        log_row(ctx, h["code"], first, "", "", "seeded " + first + ".." + last, "seed", "", h["book_id"], now)
        for h in plan["houses"]], SCH.APP_ID)
    period = {"id": "P" + first, "first": first, "last": last, "state": "live", "rolled_from": "", "rolled_at": "",
              "by": ctx["uid"] if ctx else ""}
    kv = st["raw"] or {}
    srows = [{"key": "periods", "value": line_text([period])}, {"key": "houses", "value": line_text(plan["houses"])},
             {"key": "seed_report", "value": SCH.u16(line_text(plan["report"]), 45000)},
             {"key": "seeded_at", "value": now}]
    srows += [{"key": k, "value": v} for k, v in SCH.SETTING_DEFAULTS.items() if not s_(kv.get(k))]
    for r in srows:
        r.update({"note": "", "updated_at": now, "updated_by": ctx["uid"] if ctx else "seed"})
    edits += SB._upserts(reads, SETTINGS_TAB, srows, SCH.APP_ID)
    out = W.final({"status": 200, "data": {"ok": True, "dry_run": False,
                                           "said": "Copied " + str(counts["cells"]) + " cells of " +
                                                   str(counts["houses"]) + " houses.",
                                           "report": plan["report"], "counts": counts}}, edits, SCH.APP_ID)
    out.fresh = verdict_books(reads)
    return out


# ---- the roll ------------------------------------------------------------------------------------------------------

def roll_cell(house: str, row_id: str, day: str, text: str, state: str, extra: dict) -> dict:
    """schedRollCell_."""
    SCH = _S()
    c = SCH.classify(text)
    row = {"id": SCH.cell_id(house, row_id, day), "period_id": "", "house_code": house, "date": day, "row_id": row_id,
           "text": text, "kind": c.kind if c else "",
           "start_min": str(int(gsjs.js_round(c.start * 60))) if c and c.start is not None else "",
           "end_min": str(int(gsjs.js_round(c.end * 60))) if c and c.end is not None else "",
           "hours": f"{c.hours:.2f}" if c else "0.00", "token": c.token if c and c.token else "", "color": "",
           "state": state, "base": "", "flow_id": "", "source": "", "note": "", "updated_at": "", "updated_by": ""}
    for k, v in extra.items():
        row[k] = "" if v is None else v
    return row


def open_row_record(reads: L.Reads, house: str, n: int, ctx: dict | None, now: str) -> dict:
    SCH = _S()
    rid = "OPEN:" + str(n)
    return {"id": SCH.row_id_of(house, rid), "house_code": house, "location": location_of(reads, house), "row_id": rid,
            "row_kind": "open", "name": "OPEN" if n == 1 else "OPEN " + str(n), "person_key": "", "designation": "",
            "order": str(n), "active": "yes", "source": "app", "updated_at": now,
            "updated_by": ctx["uid"] if ctx else "system"}


def open_row_for(house: str, day: str, rows: list[dict], cell_ids: dict) -> dict:
    """The first OPEN row with nothing that day, or the next new one."""
    SCH = _S()
    opened = SCH.row_sorted([r for r in rows if r["house_code"] == house and r["row_kind"] == "open"
                             and r["active"] != "no"])
    top = 0
    for r in opened:
        top = max(top, SCH.open_n(r["row_id"]))
        if not cell_ids.get(SCH.cell_id(house, r["row_id"], day)):
            return {"row_id": r["row_id"], "fresh": None}
    for r in rows:
        if r["house_code"] == house and r["row_kind"] == "open":
            top = max(top, SCH.open_n(r["row_id"]))
    n = top + 1
    while cell_ids.get(SCH.cell_id(house, "OPEN:" + str(n), day)):
        n += 1
    return {"row_id": "OPEN:" + str(n), "fresh": n}


def roll_plan(reads: L.Reads, src: dict, nxt: dict, cells: list, rows: list, flows: list, tokens: dict, now: str,
              by: str) -> dict[str, Any]:
    """schedRollPlan_: the base pattern of `src` laid onto `nxt`. Pure."""
    SCH = _S()
    offset = SCH.day_index(nxt["first"]) - SCH.day_index(src["first"])
    active = {r["house_code"] + "|" + r["row_id"]: r for r in rows if r["active"] != "no"}
    dropped = {"one_off": 0, "ro": 0, "call_off_open": 0, "echo": 0, "inactive_row": 0, "outside": 0,
               "training_waiting": 0}
    planned: dict[str, dict] = {}
    order: list[str] = []

    def put(row: dict) -> None:
        if row["id"] not in planned:
            order.append(row["id"])
        planned[row["id"]] = row

    training_of = {f["id"]: f for f in flows if f["kind"] == "training"}
    reopen: list[dict] = []
    for c in cells:
        if c["date"] < src["first"] or c["date"] > src["last"]:
            continue
        row = active.get(c["house_code"] + "|" + c["row_id"])
        if not row:
            dropped["inactive_row"] += 1
            continue
        to = SCH.iso_add(c["date"], offset)
        if to > nxt["last"]:
            dropped["outside"] += 1
            continue
        text, state = s_(c["text"]), s_(c["state"]) or "scheduled"
        tf = training_of.get(c["flow_id"]) if state == "training" else None
        if tf and tf["source"] == "editor" and tf["state"] == "waiting" and text:
            reopen.append({"house": c["house_code"], "date": to, "text": text, "location": row["location"]})
            dropped["training_waiting"] += 1
        if state in SCH.ONE_OFF_STATES:
            if not s_(c["base"]):
                dropped["one_off"] += 1
                continue
            text = s_(c["base"])
        elif state == "open" and c["flow_id"]:
            if not s_(c["base"]):
                dropped["call_off_open"] += 1
                continue
            text = s_(c["base"])
        k = SCH.classify(text)
        if not k:
            dropped["one_off"] += 1
            continue
        if k.kind == "ro":
            dropped["ro"] += 1
            continue
        if k.kind == "alias" and SCH.names_house(text, tokens):
            dropped["echo"] += 1
            continue
        put(roll_cell(c["house_code"], c["row_id"], to, text,
                      "open" if row["row_kind"] == "open" and k.start is not None else "scheduled",
                      {"color": c["color"], "source": "roll:" + nxt["id"], "period_id": nxt["id"], "updated_at": now,
                       "updated_by": by}))
    new_rows: list[dict] = []
    applied: list[dict] = []
    flows_out: list[dict] = []
    cell_ids = {i: True for i in order if planned[i]["text"]}
    all_rows = list(rows)

    def open_row_at(house: str, day: str, location: str) -> str:
        pick = open_row_for(house, day, all_rows, cell_ids)
        if pick["fresh"]:
            rec = open_row_record(reads, house, pick["fresh"], None, now)
            if location:
                rec["location"] = location
            new_rows.append(rec)
            all_rows.append(rec)
        return pick["row_id"]

    for o in reopen:
        oc = roll_cell(o["house"], open_row_at(o["house"], o["date"], o["location"]), o["date"], o["text"], "open",
                       {"source": "roll:" + nxt["id"], "period_id": nxt["id"], "updated_at": now, "updated_by": by})
        put(oc)
        cell_ids[oc["id"]] = True
    for f in flows:
        if f["kind"] != "time_off" or f["state"] != "approved_future" or not f["person_key"] or not SCH.iso_valid(f["date"]):
            continue
        to = f["date_to"] if SCH.iso_valid(f["date_to"]) else f["date"]
        flog = SCH.jparse(f["outreach_log"], {})
        if not isinstance(flog, dict):
            flog = {}
        owed = [d for d in flog["future"] if SCH.iso_valid(d)] if isinstance(flog.get("future"), list) \
            else SCH.dates(f["date"], to)
        rolled_days: list[str] = []
        for d in owed:
            if d < nxt["first"] or d > nxt["last"]:
                continue
            rolled_days.append(d)
            for r in rows:
                if r["row_kind"] != "person" or r["person_key"] != f["person_key"] or r["active"] == "no":
                    continue
                c = planned.get(SCH.cell_id(r["house_code"], r["row_id"], d))
                k = SCH.classify(c["text"]) if c else None
                if not k or k.start is None:
                    continue
                shift = c["text"]
                put(roll_cell(r["house_code"], r["row_id"], d, "R/O", "time_off",
                              {"base": shift, "flow_id": f["id"], "source": "flow:" + f["id"], "period_id": nxt["id"],
                               "updated_at": now, "updated_by": by}))
                pick = open_row_for(r["house_code"], d, all_rows, cell_ids)
                if pick["fresh"]:
                    rec = open_row_record(reads, r["house_code"], pick["fresh"], None, now)
                    rec["location"] = r["location"]
                    new_rows.append(rec)
                    all_rows.append(rec)
                oc = roll_cell(r["house_code"], pick["row_id"], d, shift, "open",
                               {"flow_id": f["id"], "source": "flow:" + f["id"], "period_id": nxt["id"],
                                "updated_at": now, "updated_by": by})
                put(oc)
                cell_ids[oc["id"]] = True
                applied.append({"flow_id": f["id"], "house_code": r["house_code"], "date": d, "shift": shift,
                                "open_row_id": pick["row_id"]})
                flog["applied"] = (flog["applied"] if isinstance(flog.get("applied"), list) else []) + [
                    {"date": d, "house": r["house_code"], "open_row_id": pick["row_id"], "roll": nxt["id"]}]
        left = [d for d in owed if d > nxt["last"]]
        if owed and not rolled_days and len(left) == len(owed):
            continue
        done = dict(f)
        flog["future"] = left
        done["outreach_log"] = json.dumps(flog, separators=(",", ":"), ensure_ascii=False)
        done["updated_at"] = now
        if not left:
            done["state"] = "approved"
            done["closed_at"] = now
        flows_out.append(done)
    out_cells = [planned[i] for i in order]
    holds = SCH.hold_index(out_cells, all_rows, [], tokens)
    clashes: list[dict] = []
    for key, lst in holds.items():
        ordered = sorted(lst, key=lambda h: h["s"])
        for i in range(len(ordered)):
            j = i + 1
            while j < len(ordered) and ordered[j]["s"] < ordered[i]["e"]:
                a, b = ordered[i], ordered[j]
                j += 1
                if a["house_code"] == b["house_code"] or a["why"] == "off" or b["why"] == "off":
                    continue
                if (a.get("whole") and a.get("named") == b["house_code"]) or \
                        (b.get("whole") and b.get("named") == a["house_code"]):
                    continue
                if len(clashes) < 200:
                    clashes.append({"person_key": key, "date": a["date"], "a": {"house": a["house_code"], "text": a["text"]},
                                    "b": {"house": b["house_code"], "date": b["date"], "text": b["text"]}})
    return {"cells": out_cells, "rows": new_rows, "flows": flows_out, "applied": applied, "dropped": dropped,
            "clashes": clashes}


def roll(sess: L.Session, payload: dict) -> Decision:
    """schedulingRoll (schedRoll_): the last period's base pattern laid onto the next, a dry run unless `dry_run` is
    false; a real roll names the period it copies (`from`), so a second press rolls nothing."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    if not ctx["is_master"]:
        return W.refuse(403, "Only the master rolls the calendar forward.")
    reads = sess.reads
    dry = payload.get("dry_run") is not False
    books = verdict_books(reads)
    st = SCH.settings(reads)
    periods = st["periods"]
    if not dry:
        frm = s_(payload.get("from"))
        if frm and periods and periods[-1]["id"] != frm:
            return refused(SCH.refuse(409, "Already rolled: the last period is now " + periods[-1]["id"] + "."), books)
        W.gate(reads)
    now = SCH.now_iso(reads)
    src = periods[-1]
    first = SCH.iso_add(src["last"], 1)
    nxt = {"id": "P" + first, "first": first, "last": SCH.iso_add(first, st["cycle_days"] - 1), "state": "live",
           "rolled_from": src["id"], "rolled_at": now, "by": ctx["uid"]}
    plan = roll_plan(reads, src, nxt, SCH.read_tab(reads, "sched_cells"), SCH.read_tab(reads, "sched_rows"),
                     SCH.read_tab(reads, "sched_flows"), SCH.house_tokens(reads), now, ctx["uid"])
    report = {"ok": True, "dry_run": dry, "from": {"id": src["id"], "first": src["first"], "last": src["last"]},
              "period": {"id": nxt["id"], "first": nxt["first"], "last": nxt["last"]}, "cells": len(plan["cells"]),
              "open_rows_added": len(plan["rows"]), "time_off_applied": len(plan["applied"]),
              "dropped": plan["dropped"], "clashes": plan["clashes"]}
    said = (("Dry run: " if dry else "Rolled: ") + nxt["first"] + " to " + nxt["last"] + ", " + str(report["cells"]) +
            " cells, " + str(len(plan["clashes"])) + " clashes.")
    answer = {"status": 200, "data": {"ok": True, "dry_run": dry, "said": said, "report": report}}
    if dry:
        return Decision(answer, fresh=books)
    # the whole period in one write: each row kept by its id where it stands, else appended (the Builder's publish)
    edits = SB._upserts(reads, "sched_rows", plan["rows"], SCH.APP_ID) if plan["rows"] else []
    edits += SB._upserts(reads, "sched_cells", plan["cells"], SCH.APP_ID)
    if plan["flows"]:
        edits += SB._upserts(reads, "sched_flows", plan["flows"], SCH.APP_ID)
    edits += SB._appends(reads, "sched_log", [log_row(ctx, "", nxt["first"], "", src["id"], nxt["id"], "roll", "",
                                                      str(len(plan["cells"])) + " cells; " +
                                                      str(len(plan["clashes"])) + " clashes", now)], SCH.APP_ID)
    edits += SB._upserts(reads, SETTINGS_TAB, [{"key": "periods", "value": line_text(periods + [nxt]), "note": "",
                                                "updated_at": now, "updated_by": ctx["uid"]}], SCH.APP_ID)
    out = W.final(answer, edits, SCH.APP_ID)
    out.fresh = books
    return out


# ---- the Time Off house carried over ------------------------------------------------------------------------------

def to_source(reads: L.Reads) -> list[dict] | str:
    """schedTimeOffSourceRows_: the Time Off house's request rows, or why they cannot be read."""
    sid = reads.db.house_id(TO_TAB)
    if not sid:
        return "the Time Off house has no pointer (HUB_HOUSE_TIME_OFF_ID)"
    if time_off_rows.owned(reads.db):
        return [{h: s_(v) for h, v in cells.items() if h} for _n, cells in time_off_rows.rows_of(reads.db, TO_TAB)
                if s_(cells.get("id"))]
    ref = reads.db.tab(sid, TO_TAB)
    if ref is None:
        if reads.db.book(sid) is None:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the Time Off house")
        raise Defer('the Time Off house\'s "time_off" tab is not in the copy')
    reads.db.note_book(sid)
    header = [s_(h) for h in ref.headers]
    if "id" not in header or "status" not in header:
        return 'the Time Off house\'s "' + TO_TAB + '" tab has no id or status column'
    out = []
    for _rn, raw in reads.db.rows(ref):
        row: dict[str, str] = {}
        for h, src in zip(header, ref.headers):
            if not h:
                continue
            v = hubdb.typed(raw.get(src), "hub")
            row[h] = v.at.astimezone(NY).strftime("%Y-%m-%d") if isinstance(v, SheetDate) else s_(v)
        if row.get("id"):
            out.append(row)
    return out


def to_day(v: Any) -> str:
    """schedTimeOffDay_."""
    SCH = _S()
    s = s_(v)
    m = re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}", s)
    if m:
        return m.group(0) if SCH.iso_valid(m.group(0)) else ""
    m = re.fullmatch(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})", s)
    iso = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else ""
    return iso if SCH.iso_valid(iso) else ""


def to_words(name: Any) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", s_(name).lower()) if len(w) > 1]


def to_roster(reads: L.Reads) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in _S().read_tab(reads, "sched_rows"):
        if r["row_kind"] != "person" or not r["person_key"] or r["active"] == "no":
            continue
        p = out.setdefault(r["person_key"], {"key": r["person_key"], "name": r["name"], "houses": []})
        if r["house_code"] not in p["houses"]:
            p["houses"].append(r["house_code"])
    return out


def to_who(row: dict, roster: dict) -> dict | None:
    """schedTimeOffWho_: the name key, else the one roster name with the same first and last words."""
    SCH = _S()
    for k in (SCH.fold(row.get("person_key")), SCH.fold(row.get("person"))):
        if k and k in roster:
            return roster[k]
    wa = to_words(row.get("person"))
    if len(wa) < 2:
        return None
    hits = [k for k in roster if len(to_words(roster[k]["name"])) >= 2 and to_words(roster[k]["name"])[0] == wa[0]
            and to_words(roster[k]["name"])[-1] == wa[-1]]
    return roster[hits[0]] if len(hits) == 1 else None


def to_houses(raw: Any, tokens: dict) -> dict[str, list[str]]:
    codes: list[str] = []
    unknown: list[str] = []
    for t in re.split(r"[,;]+", s_(raw)):
        up = s_(t).upper()
        if not up:
            continue
        code = tokens.get(up) or tokens.get(re.sub(r"\s+", "", up)) or ""
        if code:
            if code not in codes:
                codes.append(code)
        elif up not in unknown:
            unknown.append(up)
    return {"codes": codes, "unknown": unknown}


def to_held(reads: L.Reads, cells: list[dict], key: str, frm: str, to: str) -> list[str]:
    SCH = _S()
    got = [c for c in cells if c["row_id"] == "P:" + key and frm <= c["date"] <= to and SCH.flow_holds(c)]
    got.sort(key=functools.cmp_to_key(lambda a, b: -1 if a["date"] < b["date"] else (1 if a["date"] > b["date"] else 0)))
    return [c["date"] + " " + SCH.house_label(reads, c["house_code"]) + " " + c["text"] for c in got]


def to_at(v: Any) -> str:
    """schedTimeOffAt_: an instant as toISOString, '' for what Date.parse cannot read."""
    ms = gsjs.date_parse(s_(v))
    return "" if ms is None else gsjs.iso(datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc))


def to_flow(plan: Plan, ctx: dict, row: dict, who: dict, uid: str, frm: str, to: str, taken: str,
            askable: list[dict]) -> dict:
    """schedTimeOffFlow_: one carried-over request as a time-off flow — approved as a closed record, pending waiting
    on the directors."""
    import scheduling_timeoff as ST  # noqa: PLC0415 - the flow rows build on this module
    ref = s_(row.get("id"))
    by = s_(row.get("dir_by")) or s_(row.get("closed_by")) or "the Time Off app"
    at = to_at(row.get("dir_at")) or to_at(row.get("decided_at")) or plan.now
    seat = {"seat": "director", "to": askable, "state": "waiting", "by": "", "at": "", "note": "", "why": ""} \
        if taken == "waiting" else \
        {"seat": "director", "to": [], "state": "approved", "by": by, "at": at, "note": "", "why": "carried over"}
    f = ST._flow_row(plan, {
        "id": "SF" + hashlib.sha256((_S().TO_SOURCE + "|" + ref).encode("utf-8")).hexdigest()[:10].upper(),
        "kind": "time_off", "state": taken, "date": frm, "date_to": to, "row_id": "P:" + who["key"],
        "person": who["name"], "person_key": who["key"], "person_uid": uid,
        "reason": SF._text(row.get("time_off_reason"), 500),
        "note": "Carried over from the Time Off app (" + ref + ").",
        "source": _S().TO_SOURCE, "source_ref": ref, "created_at": to_at(row.get("createdAt")),
        "created_by": s_(ctx.get("uid")), "seats": ST._json([seat])})
    if taken == "approved":
        f["closed_at"] = at
        f["closed_by"] = by
        f["outreach_log"] = ST._json({"applied": [], "future": [], "carried": True})
    return f


def to_import(reads: L.Reads, source: list[dict], plan: Plan | None = None, ctx: dict | None = None) -> dict[str, Any]:
    """schedTimeOffImport_: what is carried over (written into `plan` when one is given, else a dry run), and why the
    rest is not."""
    SCH = _S()
    apply = plan is not None
    flows: list[dict] = []
    items: list[dict] = []
    today = reads.today()
    roster = to_roster(reads)
    tokens = SCH.house_tokens(reads)
    cells = SCH.read_tab(reads, "sched_cells")
    dirs = SCH.directors(reads, SCH.settings(reads))
    done: dict[str, dict] = {}
    standing: list[dict] = []
    for f in SCH.read_tab(reads, "sched_flows"):
        if f["kind"] != "time_off":
            continue
        if f["source"] == SCH.TO_SOURCE and f["source_ref"]:
            done[f["source_ref"]] = f
        if f["state"] in TO_STANDING:
            standing.append(f)
    counts: dict[str, Any] = {"rows": 0, "by_status": {}, "imported": 0, "approved": 0, "waiting": 0,
                              "already_imported": 0, "unmatched": 0, "skipped": 0, "with_conflicts": 0}
    lines: list[dict] = []
    for row in source:
        ref = s_(row.get("id"))
        if not ref:
            continue
        counts["rows"] += 1
        status = s_(row.get("status")).lower() or "blank"
        counts["by_status"][status] = counts["by_status"].get(status, 0) + 1
        taken = TO_TAKEN.get(status, "")
        if status == "history":
            counts["skipped"] += 1
            continue
        frm = to_day(row.get("start_date"))
        to = to_day(row.get("end_date")) or frm
        hs = to_houses(row.get("houses"), tokens)
        line: dict[str, Any] = {"ref": ref, "person": s_(row.get("person")), "status": status, "from": frm, "to": to,
                                "houses": hs["codes"], "houses_unknown": hs["unknown"], "matched": "", "as": taken,
                                "outcome": "skipped", "why": "", "conflicts": []}
        lines.append(line)

        def skip(why: str, line: dict = line) -> None:
            line["why"] = why
            counts["skipped"] += 1

        if not taken:
            skip("a " + status + " request is not carried over")
            continue
        if ref in done:
            line["outcome"] = "already_imported"
            line["flow_id"] = done[ref]["id"]
            counts["already_imported"] += 1
            continue
        who = to_who(row, roster)
        if not who:
            line["outcome"] = "unmatched"
            line["why"] = "nobody on a Scheduling roster answers this name"
            counts["unmatched"] += 1
            continue
        line["matched"] = who["name"]
        if not frm or to < frm:
            skip("the dates cannot be read")
            continue
        if taken == "waiting" and frm < today:
            skip("still pending, but its first day has passed")
            continue
        hit = next((f for f in standing if f["person_key"] == who["key"] and f["date"] <= to
                    and (f.get("date_to") or f["date"]) >= frm), None)
        if hit:
            skip("overlaps time off already in Scheduling (" + hit["date"] + " to " + (hit.get("date_to") or hit["date"]) + ")")
            continue
        uid = (SCH.user_by_key(reads, who["key"]) or {}).get("uid") or ""
        askable: list[dict] = []
        if taken == "waiting":
            if not dirs["readable"]:
                skip("nobody can decide it: " + dirs["why"])
                continue
            askable = [d for d in dirs["list"] if d["uid"] != uid]
            if not askable:
                skip("no director but the person can decide it")
                continue
        else:
            line["conflicts"] = to_held(reads, cells, who["key"], frm, to)
            if line["conflicts"]:
                counts["with_conflicts"] += 1
        if not hs["codes"] and not hs["unknown"]:
            line["why"] = "no houses on the request — carried against the person"
        line["outcome"] = "imported" if apply else "would_import"
        counts["imported"] += 1
        counts[taken] += 1
        if not apply:
            standing.append({"person_key": who["key"], "date": frm, "date_to": to})
            continue
        f = to_flow(plan, ctx or {}, row, who, uid, frm, to, taken, askable)
        standing.append(f)
        line["flow_id"] = f["id"]
        flows.append(f)
        if taken != "waiting":
            continue
        head = "Time off — " + who["name"] + " · " + SF._day_words(frm) + " to " + SF._day_words(to)
        body = (('"' + f["reason"] + '" — ') if f["reason"] else "") + (
            "Carried over from the Time Off app. Approve to put every shift of theirs in those days up as an open "
            "shift; days beyond the last calendar period are applied when the roll creates them.")
        items.extend({"flow": f, "to": d, "title": head, "body": body} for d in askable)
    if apply:
        import scheduling_timeoff as ST  # noqa: PLC0415 - the flow rows build on this module
        for f in flows:
            plan.upsert("sched_flows", f)
        ST._inbox(plan, [ST._item(reads, it["flow"], "work", "approval", "director", it["to"], it["title"],
                                  it["body"]) for it in items])

    def cmp(a: dict, b: dict) -> int:
        ra, rb = TO_RANK[a["outcome"]], TO_RANK[b["outcome"]]
        if ra != rb:
            return ra - rb
        return -1 if a["from"] < b["from"] else (1 if a["from"] > b["from"] else 0)
    lines.sort(key=functools.cmp_to_key(cmp))
    said = (("Carried over " if apply else "Dry run: would carry over ") + str(counts["imported"]) + " (" +
            str(counts["approved"]) + " approved, " + str(counts["waiting"]) + " waiting on the directors); " +
            str(counts["already_imported"]) + " already here, " + str(counts["unmatched"]) + " not matched, " +
            str(counts["skipped"]) + " left behind.")
    return {"ok": True, "dry_run": not apply, "said": said, "report": {"counts": counts, "lines": lines}}


def time_off_import(sess: L.Session, payload: dict) -> Decision:
    """schedulingTimeOffImport: the master's carry-over of the Time Off house — a dry run unless `apply` is true; run
    twice, it carries nothing new."""
    SCH, ctx = _gate(sess)
    if not ctx["open"]:
        return refused(SCH.closed())
    if not ctx["is_master"]:
        return W.refuse(403, "Only the master carries the time off over.")
    apply = payload.get("apply") is True or payload.get("apply") == "true"
    reads = sess.reads
    source = to_source(reads)
    books = verdict_books(reads) + SCH.books_of(reads, TO_TAB)
    if isinstance(source, str):
        return W.refuse(503, "The Time Off house could not be read just now — " + source, fresh=books)
    if not apply:
        return Decision({"status": 200, "data": to_import(reads, source)}, fresh=books)
    W.gate(reads)
    plan = Plan(reads, ctx)
    data = to_import(reads, source, plan, ctx)
    import scheduling_flow_writes as FW  # noqa: PLC0415 - the system log line, as the flows write it
    FW.logged(sess.user, "schedulingTimeOffImport", data["said"])
    out = W.final({"status": 200, "data": data}, plan.records(SCH.APP_ID), SCH.APP_ID)
    out.fresh = books
    return out


BOARD_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "schedulingCellSave": cell_save, "schedulingAddPerson": add_person, "schedulingUndo": undo,
    "schedulingSettingsSet": settings_set, "schedulingSeed": seed, "schedulingRoll": roll,
    "schedulingTimeOffImport": time_off_import}
# every Scheduling write kept in app.edits: the board's, the Builder's and the flows'
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {**BOARD_ACTIONS, **SB.WRITE_ACTIONS, **SF.ACTIONS}
_ROLES = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each write is declared for, and its typed params
BOARD_POLICY: dict[str, dict[str, Any]] = {
    "schedulingCellSave": {"roles": _ROLES, "params": {
        "house": "string", "row_id": "string", "person": "string", "date": "string", "value": "string",
        "start": "string", "end": "string", "note": "string", "via": "string", "open_row_id": "string",
        "from_row_id": "string", "cancel_pending": "boolean", "override": "boolean", "seen": "string",
        "from_date": "string", "to_row_id": "string", "to_date": "string", "preview": "boolean", "seen_from": "string",
        "seen_to": "string"}},
    "schedulingAddPerson": {"roles": _ROLES, "params": {"house": "string", "person": "string", "override": "boolean"}},
    "schedulingUndo": {"roles": _ROLES, "params": {"house": "string"}},
    "schedulingSettingsSet": {"roles": _ROLES, "params": {"values": "object", "seen": "object"}},
    "schedulingSeed": {"roles": _ROLES, "params": {"first": "string", "last": "string", "dry_run": "boolean"}},
    "schedulingRoll": {"roles": _ROLES, "params": {"dry_run": "boolean", "from": "string"}},
    "schedulingTimeOffImport": {"roles": _ROLES, "params": {"apply": "boolean"}}}
POLICY: dict[str, dict[str, Any]] = {**BOARD_POLICY, **{a: SB.POLICY[a] for a in SB.WRITE_ACTIONS}, **SF.POLICY}
# a held lock is answered in schedLock_'s own sentence
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": SF.BUSY} for a in (*BOARD_ACTIONS, *SF.ACTIONS)}


class Store(RR.Store):
    """app.scheduling_writes and app.scheduling_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="scheduling", label="Scheduling")
