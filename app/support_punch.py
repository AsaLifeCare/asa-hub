"""supportDeskPunch (apps-script/SupportDesk.gs) on Python behind its own switch (`support-punch`): the punch board's
first faults the relay hands over (server/punch_pairs.py first_faults, _support_punch_post), judged as
supportDeskPunchNoted_ judges them — the first missing punch per person per shift raised once on Support Requests as a
warning to the directors and the leads (each one Settings › Alerts I receive leaves in), an item in each one's My Inbox
and a text to each through Smart Comms; a later fault of the other direction on the same shift one note on its
decisions. Every row is kept in app.edits over the Support Requests houses as one final write (support_raise). A pass
starts no fault after its budget: those come back in `left`, for the relay's next pass. The hook that reaches
supportDeskPunchNoted_ inside Apps Script (supportDeskShiftRow_, from staffShiftReminder) stays there."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import scheduling_flows as SF
import support_desk_writes as SDW
import support_raise as SR
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "support-punch"
# SD_PUNCH_MAX: the faults one call judges
PUNCH_MAX = 200
# no fault starts past this: the relay's next pass hands the rest
START_BUDGET_S = 4.0
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the relay offers the faults again."
PART = "punch"

s_ = SDW.s_


def day_add(iso: Any, n: int) -> str:
    """sdDayAdd_."""
    p = gsjs.or_blank(iso).split("-")
    if len(p) != 3 or not all(x.isdigit() for x in p):
        return ""
    d = SF._utc_day(int(p[0]), int(p[1]), int(p[2]) + n)
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}" if d else ""


def utc_minute(v: Any) -> str:
    """sdUtcMinute_: an instant to the minute in UTC (yyyy-MM-ddTHH:mmZ), '' when unreadable."""
    ms = SDW.instant_ms(v)
    if ms is None:
        return ""
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime("%Y-%m-%dT%H:%M") + "Z"


def noted(rx: SR.Raise, facts: list, via: str, started: float) -> tuple[dict[str, Any], list]:
    """supportDeskPunchNoted_: the first missing punch per person per shift — a warning to the directors and the
    leads, and a text to each; the facts this pass did not start, for the next."""
    reads = rx.reads
    try:
        if not SR.auto_on(reads, PART):
            return {"off": True, "raised": 0, "already": 0}, []
        out: dict[str, Any] = {"raised": 0, "already": 0, "off": False, "skipped": 0, "why": ""}
        day0 = SDW.day_of_ms(SDW.now_ms(reads))
        for i, f in enumerate(facts):
            if time.time() - started > START_BUDGET_S:
                return out, facts[i:]
            fact = f if isinstance(f, dict) else {}
            verdict = s_(fact.get("verdict"))
            if verdict == "not_entered_yet" or fact.get("pair_fault") is not True or verdict not in ("missing", "open"):
                out["skipped"] += 1
                continue
            person = s_(fact.get("person"))
            minute = utc_minute(fact.get("shift_at"))
            if not person or not minute:
                out["skipped"] += 1
                continue
            day = SDW.day_of_(fact.get("shift_at"))
            if day < day_add(day0, -1):
                out["skipped"] += 1
                continue
            direction = "in" if verdict == "missing" else "out"
            source_ref = gsjs.name_key(person) + "|" + minute
            eid = SR.event_id("punch", source_ref)
            had = rx.event(eid)
            if had:
                was = SDW.obj_(had.get("details")).get("direction")
                if was and was != direction:
                    rx.also(eid, "Also not punching " + direction)
                out["already"] += 1
                continue
            dirs = SDW.directors(reads)["list"]
            leads = [lead for lead in SR.leads(reads)["list"] if not any(d["uid"] == lead["uid"] for d in dirs)]
            dirs_told, leads_told = SR.receivers(reads, dirs, PART), SR.receivers(reads, leads, PART)
            house = s_(fact.get("house_name")) or s_(fact.get("house"))
            title = person + " is not punching " + direction
            body = " · ".join(x for x in (house, s_(fact.get("shift_code")), SDW.day_words(day)) if x) + \
                ". Are you aware?"
            items = [SDW.item_(reads, eid, "warning", "director", d, title, body, house, day, PART) for d in dirs_told]
            items += [SDW.item_(reads, eid, "warning", "lead", lead, title, body, house, day, PART)
                      for lead in leads_told]
            details = {"direction": direction, "house_name": house, "shift_code": s_(fact.get("shift_code")),
                       "shift_at": s_(fact.get("shift_at")), "shift_end": s_(fact.get("shift_end")),
                       "read_at": s_(fact.get("read_at")), "verdict": verdict, "via": via}
            ev = {"id": eid, "kind": "punch", "ref": eid, "route": "", "source": via, "source_ref": source_ref,
                  "title": title, "category": "Attendance · Missing punch", "person": person,
                  "person_key": gsjs.name_key(person), "person_uid": uid_by_name(reads, person),
                  "house": s_(fact.get("house")), "day": day, "at": s_(fact.get("shift_at")), "details": details}
            if not rx.raise_(ev, items):
                out["already"] += 1
                continue
            out["raised"] += 1
            plan = SDW.text_plan(reads, rx.event_row(ev))
            rx.tell_all(plan["situation"], SR.union(dirs_told, leads_told), plan["vars"], eid, "warning")
        return out, []
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - sdHeld_: the hook never throws, it says why
        return {"held": True, "why": (str(e) or type(e).__name__)[:240]}, []


def uid_by_name(reads: L.Reads, name: Any) -> str:
    """sdUidByName_."""
    u = SDW.account_by_name(reads, name)
    return s_(u.get("userid")) if u else ""


def punch(sess: L.Session, payload: dict) -> Decision:
    """supportDeskPunch: the relay's punch board, transport only — the faults judged here, every row kept in app.edits;
    the faults this pass did not start come back in `left`."""
    started = time.time()
    user = sess.user or {}
    if not sess.user or user.get("is_service") is not True:
        return Decision(dict(DENIED))
    p = payload if isinstance(payload, dict) else {}
    rows = p.get("rows")[:PUNCH_MAX] if isinstance(p.get("rows"), list) else []
    rx = SR.Raise(sess.reads)
    got, left = noted(rx, rows, "board", started)
    data: dict[str, Any] = {"ok": not got.get("held"), "raised": got.get("raised") or 0,
                            "already": got.get("already") or 0, "off": bool(got.get("off")), "why": s_(got.get("why"))}
    if left:
        data["left"] = left
    log.info("supportDeskPunch: %d fault(s) — %s raised, %s already%s%s", len(rows), data["raised"], data["already"],
             ", the switch is off" if data["off"] else "", f", {len(left)} left" if left else "")
    d = W.final({"status": 200, "data": data}, rx.edits, APP_ID)
    d.fresh = rx.books() if rx.edits else False
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"supportDeskPunch": punch}
# HUB_POLICY: SupportDesk.gs's roles (the service passes them) and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "supportDeskPunch": {"roles": ("admin", "director", "manager", "staff"), "params": {"rows": "array"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"supportDeskPunch": {"status": 409, "message": BUSY}}


class Store(W.Store):
    """app.support_punch_writes and _receipts; the rows app.edits' over the Support Requests houses, the texts Smart
    Comms' outbox's."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="support_punch", label="Support Requests — the missing punches")
