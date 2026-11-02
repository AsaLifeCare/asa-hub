"""callOffFromCalendar (CommCallOffForm.gs) on Python, the relay's door: the Builder call-offs its road owes, each
keyed on the pool ref, filed a few seconds at a time — its Call Off Tracker row (never twice for one ref), or the mock
outbox's row while test mode holds every write of a call-off, then the call-off lane's answer (commCallOffRecorded_ as
Python runs it for the hotline's filing, app/hotline_calloff.py): the person who called off, the house manager the
relay named, the cover offer, everyone, and the 5558 group with the reason — each page raised through Smart Comms in
this write, the call-off house's row kept as an app.edits record. A pass that spends its seconds hands the rows it did
not reach back in `left`; the relay offers them again, and a ref the answer does not name filed stays owed."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import call_offs as CO
import call_offs_writes as COW
import comm_call_off as CCO
import comm_call_off_form as CF
import comm_mock_writes as CMW
import comm_replies_writes as CRW
import gsjs
import hotline_calloff as HCO
import locations as L
import resource_rows as RR
import scheduling_flows as SF
import scheduling_timeoff as ST
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import staff_views
import team_alerts as TA
import writes as W
from scope import Defer
from writes import Decision

# a call-off begun past this is handed back: one call-off's pages take seconds, and the write's budget is seven
PASS_S = 3.0
BUSY = "Another write holds the platform's lock; the road offers the call-offs again."
ACTOR = "asa-hub:calloffcal"
COMM_ACTOR = "asa-hub:comm"
NO_INSTANCE = 'no instance — "never twice" cannot be kept without a stable identity'

s_ = gsjs.str_
_db_fault = CRW._db_fault


def log_line(actor: str, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record({"email": actor}, action, detail, status)


def _why(exc: BaseException) -> str:
    """String((e && e.message) || e)."""
    return str(exc) or type(exc).__name__


def _told(pages: list[dict], state: str) -> int:
    return sum(1 for p in pages or [] if p.get("state") == state)


def recorded(reads: L.Reads, row: dict, instance: Any, source: str,
             queued: dict | None) -> tuple[dict[str, Any], list[dict]]:
    """commCallOffRecorded_(row, instance, source, queued): the row first (it carries both refusals), then the
    acknowledgement and the other four audiences at the place the queue named; (its answer, the row's records)."""
    out: dict[str, Any] = {"recorded": False, "said": 0, "others_sent": 0, "carried": 0, "rehearsed_rows": 0,
                           "state": "", "why": "", "others": None}
    facts = HCO.facts_of(row)
    inst = gsjs.or_text(instance)
    if not inst:
        out["why"] = NO_INSTANCE
        return out, []
    if not facts["person_key"]:
        out["why"] = "the recorded row names nobody this lane can key"
        return out, []
    try:
        now = reads.now if reads.now.tzinfo else reads.now.replace(tzinfo=timezone.utc)
        at_ms, now_iso = int(now.timestamp() * 1000), gsjs.iso(now)
        place = CF.place_of(queued)
        found = HCO.find_shift(reads, facts, place, now)
        shift = found["shift"]
        link = SF.PLATFORM_URL + "/#" + ST._link(shift.get("house_code"), found["day"]) if shift else ""
        rows = SC.read_situations(reads.db)
        cfg = reads.config()
        row_id = "COF_" + SCO.record_id(f"{inst}|{facts['person_key']}")
        if SCD.where(reads, HCO.HOUSE).ref is None:
            out["why"] = "the lane's own row could not be written: the call-off house holds no tab in the copy"
            return out, []
        known = SCD.call_off_rows(reads).get(row_id)
    except Exception as exc:  # noqa: BLE001 - commCallOffRecorded_'s own catch
        if _db_fault(exc):
            raise
        out["why"] = "the lane threw and the recorded row stands: " + _why(exc)
        log_line(COMM_ACTOR, "comm_call_off_threw", "a call-off was recorded and the lane could not answer it: "
                 + _why(exc), 500)
        return out, []
    a: dict[str, Any] = {"state": "planned", "why": "", "to_key": ""}
    legs: dict[str, dict] = {}
    threw = ""
    token = HCO.SPEAK.set(True)
    try:
        a = HCO.ack(reads, rows, facts, inst, at_ms)
        told: dict[str, str] = {a["to_key"]: "subject"} if a.get("to_key") else {}
        endings = {"subject": a["state"]}

        def run(name: str, fn: Any) -> None:
            try:
                r = fn()
            except Exception as exc:  # noqa: BLE001 - a leg never fails the call-off; its row says so
                if _db_fault(exc):
                    raise
                r = {"audience": name, "state": "held", "why": f"the {name} leg threw and the recorded row stands: "
                                                             f"{_why(exc)}", "heard": [], "pages": []}
            legs[name] = r
            endings[name] = r["state"]
            for k in r.get("heard") or []:
                told.setdefault(k, name)

        run("house_manager", lambda: HCO.tell_manager(rows, facts, inst, place, at_ms))
        run("cover_offer", lambda: HCO.offer_send(reads, cfg, rows, facts, inst, place, told, endings, at_ms))
        run("everyone", lambda: HCO.blast(reads, cfg, rows, facts, inst, place, told, endings, at_ms, now, link))
        run("directors", lambda: HCO.tell_directors(reads, cfg, rows, facts, inst, place, at_ms, now, link))
        if HCO.speaks_to(facts["kind"], "house_manager") and not gsjs.trim(s_(place.get("house"))):
            log_line(COMM_ACTOR, "call_off_house_unresolved",
                     "a call-off was recorded with no house on it — the caller never named one the hotline could "
                     f"match, so `{HCO.MANAGER_SITUATION}` had nobody to tell and the cover offer went out saying the "
                     "house was not named. The Desk carries the share of recent call-offs that did resolve a house.")
    except Exception as exc:  # noqa: BLE001 - commCallOffRecorded_'s own catch: the row stands
        if _db_fault(exc):
            raise
        threw = "the lane threw and the recorded row stands: " + _why(exc)
        log_line(COMM_ACTOR, "comm_call_off_threw", "a call-off was recorded and the lane could not answer it: "
                 + _why(exc), 500)
    finally:
        HCO.SPEAK.reset(token)
    patch: dict[str, Any] = {"id": row_id, "instance": inst, "person_key": facts["person_key"],
                             "person_name": facts["name"], "name_from": facts["name_from"], "kind": facts["kind"],
                             "shift_date": facts["date"], "source": source, "cover_state": "refused",
                             "cover_why": s_(CCO.cover_verdict(facts)["why"])[:500], "offer_state": "unreadable",
                             "offer_why": "the roster is Scheduling's, and no cover ranking is in this build",
                             "subject_state": a["state"], "subject_at": now_iso,
                             "subject_why": s_(a.get("why"))[:HCO.WHY_MAX], "subject_channel": s_(a.get("channel")),
                             "test_mode": "no", "updatedAt": now_iso}
    # the mark is never re-stamped
    if known is None:
        patch["recorded_at"] = now_iso
    for name, r in legs.items():
        state_col, at_col, why_col = HCO.STATE_COLS[name]
        patch[state_col], patch[at_col], patch[why_col] = r["state"], now_iso, s_(r["why"])[:HCO.WHY_MAX]
    ev = legs.get("everyone") or {}
    patch["everyone_count"] = f"{_told(ev.get('pages'), 'told')}/{ev.get('resolved', 0)}"
    if ev.get("audience_cell"):
        patch["everyone_audience"] = ev["audience_cell"]
    edits = HCO.house_row(reads, row_id, patch, "")
    # Smart Comms holds a page in test mode as written down (the rehearsal book), never redirected at the door
    others: dict[str, Any] = {n: {"audience": n, "state": r["state"], "why": s_(r["why"])[:300],
                                  "sent": _told(r.get("pages"), "told"), "redirected": 0,
                                  "resolved": int(r.get("resolved") or 0),
                                  "rehearsal_rows": _told(r.get("pages"), "recorded")} for n, r in legs.items()}
    sent = sum(o["sent"] for o in others.values())
    rehearsed = sum(o["rehearsal_rows"] for o in others.values())
    others.update(sent=sent, rehearsal_rows=rehearsed)
    out.update(recorded=True, said=1 if a["state"] == "told" else 0, state=a["state"], why=threw or s_(a.get("why")),
               others_sent=sent, others=others, rehearsed_rows=(1 if a["state"] == "recorded" else 0) + rehearsed)
    return out, edits


def tracker(reads: L.Reads, p: dict, held: bool, filed: set[str]) -> tuple[str, list[dict]]:
    """callOffCalTracker_: the tracker row, or its mock outbox row while test mode holds it; written, already, or
    held."""
    now = datetime.now(timezone.utc)
    row = CF.tracker_row(p, gsjs.iso(now))
    if held:
        _wrote, edits = CMW.web_write(reads, [CF.mock_row(p, row, now)])
        return "held: test mode", edits
    if row["call_id"] in filed or any(gsjs.or_text(r.get("call_id")) == row["call_id"] for r in CO.rows(reads)):
        return "already", []
    res = W.tab_of(reads, CO.TAB)
    if res.ref is None:
        raise Defer("the Call Offs house holds no tab in the copy")
    rec: dict[str, Any] = {**row, "id": W.mint(), "createdAt": row["timestamp"], "updatedAt": row["timestamp"]}
    if any(k not in res.ref.headers for k in rec):
        raise Defer("a call-off naming a column the Call Offs tab does not have")
    W.gate(reads)
    sid, tab = W.where_of(res)
    filed.add(row["call_id"])
    return "written", [W.kept_record(sid, tab, "append", "id", rec["id"], rec["id"],
                                     {h: COW.serialize(rec.get(h)) for h in res.ref.headers if h and h in rec})]


def file_one(reads: L.Reads, p: dict, held: bool, filed: set[str]) -> tuple[dict[str, Any], list[dict]]:
    """callOffCalFile_: one Builder call-off — the tracker row, then the lane's answer; (what the road reads, the
    records)."""
    out: dict[str, Any] = {"instance": gsjs.or_text(p.get("instance")), "ok": False, "recorded": False, "tracker": "",
                           "test_mode": bool(held), "why": ""}
    if not CF.CAL_REF.fullmatch(out["instance"]):
        out["why"] = "not a pool ref"
        return out, []
    if not gsjs.trim(gsjs.or_text(p.get("employee_name"))) or \
            not re.fullmatch(r"\d{4}-\d{2}-\d{2}", gsjs.or_text(p.get("date"))):
        out["why"] = "a call-off needs the person and the shift day"
        return out, []
    try:
        out["tracker"], edits = tracker(reads, p, held, filed)
    except Exception as exc:  # noqa: BLE001 - this call-off's refusal; the road offers it again
        if _db_fault(exc):
            raise
        out["why"] = "the tracker row could not be written: " + _why(exc)
        return out, []
    manager = gsjs.trim(gsjs.or_text(p.get("manager_name")))
    phone = gsjs.trim(gsjs.or_text(p.get("manager_phone")))
    if manager and phone:
        manager += " " + TA.e164(phone)
    said, kept = recorded(reads, {"employee_name": gsjs.or_text(p.get("employee_name")), "name_from": "person",
                                  "type": "Call Off", "date": gsjs.or_text(p.get("date"))},
                          out["instance"], CF.CAL_SOURCE,
                          {"manager": manager, "house": gsjs.or_text(p.get("house")),
                           "reason": gsjs.or_text(p.get("reason")), "shift_day": gsjs.or_text(p.get("date")),
                           "shift_start": gsjs.or_text(p.get("shift_start"))})
    out["recorded"] = bool(said.get("recorded"))
    out["ok"] = out["recorded"]
    out["state"] = s_(said.get("state"))
    out["said"] = int(said.get("said") or 0)
    out["others_sent"] = int(said.get("others_sent") or 0)
    out["rehearsed_rows"] = int(said.get("rehearsed_rows") or 0)
    every = (said.get("others") or {}).get("everyone")
    out["urgent"] = {"state": s_(every.get("state")), "sent": int(every.get("sent") or 0),
                     "redirected": int(every.get("redirected") or 0), "resolved": int(every.get("resolved") or 0),
                     "rehearsal_rows": int(every.get("rehearsal_rows") or 0),
                     "why": s_(every.get("why"))[:300]} if every else None
    if said.get("why"):
        out["why"] = s_(said["why"])[:300]
    return out, edits + kept


def from_calendar(sess: L.Session, payload: dict) -> Decision:
    """callOffFromCalendar: the service or an admin; at most CALLOFF_CAL_MAX call-offs, each answered by its ref."""
    user = sess.user or {}
    if not sess.user or (user.get("is_service") is not True and gsjs.js_str(user.get("role")) != "admin"):
        return Decision(dict(SCD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    rows = p.get("rows") if not gsjs.falsy(p.get("rows")) else []
    if not isinstance(rows, list):
        return Decision({"status": 400, "message": "rows: a list of call-offs"})
    reads = sess.reads
    started = time.monotonic()
    held = CF.test_mode_held(reads)
    filed: set[str] = set()
    out: list[dict[str, Any]] = []
    edits: list[dict] = []
    todo = rows[:CF.CAL_MAX]
    left: list[Any] = []
    for i, r in enumerate(todo):
        if i and time.monotonic() - started > PASS_S:
            left = todo[i:]
            break
        one, kept = file_one(reads, r if isinstance(r, dict) else {}, held, filed)
        out.append(one)
        edits += kept
    log_line(ACTOR, "calloff_calendar_filed",
             f"{len(out)} Calendar Builder call-off(s) · {sum(1 for o in out if o['ok'])} filed"
             + (" · test mode: the tracker row went to the mock outbox" if held else ""))
    data: dict[str, Any] = {"rows": out, "test_mode": held}
    if left:
        data["left"] = left
    return Decision({"status": 200, "data": data}, edits=edits or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"callOffFromCalendar": from_calendar}
# HUB_POLICY.callOffFromCalendar declares no roles: the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {"callOffFromCalendar": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"callOffFromCalendar": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_call_off_form_writes and _receipts; the tracker row, the mock outbox's and the call-off house's
    app.edits', the messages Smart Comms' outbox's — a void takes them back, and the road offers the call-off again."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_call_off_form", label="Calendar Builder call-offs")
