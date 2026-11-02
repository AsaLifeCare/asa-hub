"""callOffSpeak (CommCallOff.gs) on Python, an admin's door: one call-off answered again by its instance, through
commCallOffRecorded_ as Python runs it for the hotline's filing (app/hotline_calloff.py) — the person who called off,
the house manager, the cover offer, everyone, and the 5558 group with the reason, each page raised through Smart Comms
in this write, the call-off house's row kept as an app.edits record. The door names no place (commCallOffPlace_ of
nothing) and Scheduling is not told again. One person hears about one call-off once: each page keeps its key, so a
second press is answered `already`."""
from __future__ import annotations

from datetime import timezone
from typing import Any, Callable

import comm_call_off as CCO
import gsjs
import hotline as H
import hotline_calloff as HCO
import locations as L
import resource_rows as RR
import scheduling_flows as SF
import scheduling_timeoff as ST
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
from writes import Decision

BUSY = "Another write holds the platform's lock; press it again in a moment."
NO_INSTANCE = ("This door needs `instance` — the stable identity of ONE call-off. Without it the \"one acknowledgement "
               "per person per call-off\" mark has nothing to hold on to, and a second press would be a second message "
               "to somebody who already heard from us.")

s_ = gsjs.str_


def recorded(reads: L.Reads, facts: dict, instance: str, source: str) -> tuple[dict[str, Any], list[dict]]:
    """commCallOffRecorded_(row, instance, source, undefined): the row first (it carries both refusals), then the
    acknowledgement and the other four audiences; (its answer, the row's records)."""
    out: dict[str, Any] = {"recorded": False, "said": 0, "others_sent": 0, "carried": 0, "rehearsed_rows": 0,
                           "state": "", "why": "", "others": None}
    if SCD.where(reads, HCO.HOUSE).ref is None:
        out["why"] = "the lane's own row could not be written: the call-off house holds no tab in the copy"
        return out, []
    now = reads.now if reads.now.tzinfo else reads.now.replace(tzinfo=timezone.utc)
    at_ms, now_iso = int(now.timestamp() * 1000), gsjs.iso(now)
    place: dict[str, Any] = {"manager": "", "house": "", "reason": "", "shift_day": "", "day_from_call": False}
    found = HCO.find_shift(reads, facts, place, now)
    shift = found["shift"]
    link = SF.PLATFORM_URL + "/#" + ST._link(shift.get("house_code"), found["day"]) if shift else ""
    rows = SC.read_situations(reads.db)
    cfg = reads.config()
    row_id = "COF_" + SCO.record_id(f"{instance}|{facts['person_key']}")
    known = SCD.call_off_rows(reads).get(row_id)
    legs: dict[str, dict] = {}
    token = HCO.SPEAK.set(True)
    try:
        a = HCO.ack(reads, rows, facts, instance, at_ms)
        told: dict[str, str] = {a["to_key"]: "subject"} if a.get("to_key") else {}
        endings = {"subject": a["state"]}

        def run(name: str, fn: Any) -> None:
            try:
                r = fn()
            except Exception as exc:  # noqa: BLE001 - a leg never fails the call-off; its row says so
                r = {"audience": name, "state": "held", "why": f"the {name} leg threw and the recorded row stands: "
                                                             f"{type(exc).__name__}", "heard": [], "pages": []}
            legs[name] = r
            endings[name] = r["state"]
            for k in r.get("heard") or []:
                told.setdefault(k, name)

        run("house_manager", lambda: HCO.tell_manager(rows, facts, instance, place, at_ms))
        run("cover_offer", lambda: HCO.offer_send(reads, cfg, rows, facts, instance, place, told, endings, at_ms))
        run("everyone", lambda: HCO.blast(reads, cfg, rows, facts, instance, place, told, endings, at_ms, now, link))
        run("directors", lambda: HCO.tell_directors(reads, cfg, rows, facts, instance, place, at_ms, now, link))
    finally:
        HCO.SPEAK.reset(token)
    patch: dict[str, Any] = {"id": row_id, "instance": instance, "person_key": facts["person_key"],
                             "person_name": facts["name"], "name_from": facts["name_from"], "kind": facts["kind"],
                             "shift_date": facts["date"], "source": source, "cover_state": "refused",
                             "cover_why": s_(CCO.cover_verdict(facts)["why"])[:500], "offer_state": "unreadable",
                             "offer_why": "the roster is Scheduling's, and no cover ranking is in this build",
                             "subject_state": a["state"], "subject_at": now_iso,
                             "subject_why": s_(a["why"])[:HCO.WHY_MAX], "subject_channel": s_(a.get("channel")),
                             "test_mode": "no", "updatedAt": now_iso}
    # the mark is never re-stamped
    if known is None:
        patch["recorded_at"] = now_iso
    for name, r in legs.items():
        state_col, at_col, why_col = HCO.STATE_COLS[name]
        patch[state_col], patch[at_col], patch[why_col] = r["state"], now_iso, s_(r["why"])[:HCO.WHY_MAX]
    ev = legs.get("everyone") or {}
    patch["everyone_count"] = f"{[p['state'] for p in ev.get('pages', [])].count('told')}/{ev.get('resolved', 0)}"
    if ev.get("audience_cell"):
        patch["everyone_audience"] = ev["audience_cell"]
    edits = HCO.house_row(reads, row_id, patch, "")
    out.update(recorded=True, said=1 if a["state"] == "told" else 0, state=a["state"], why=s_(a["why"]),
               others_sent=sum(1 for r in legs.values() for p in r.get("pages") or [] if p.get("state") == "told"),
               others={n: {"state": r["state"], "why": s_(r["why"])[:300]} for n, r in legs.items()})
    return out, edits


def speak(sess: L.Session, payload: dict) -> Decision:
    """callOffSpeak: the replay, by the call-off's instance, the person's name, the type and the date."""
    user = sess.user or {}
    if not sess.user or (user.get("is_service") is not True and gsjs.js_str(user.get("role")) != "admin"):
        return Decision(dict(SCD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    instance = gsjs.trim(gsjs.or_text(p.get("instance")))
    if not instance:
        return Decision({"status": 400, "message": NO_INSTANCE})
    reads = sess.reads
    fill = H.caller_name(reads, p.get("employee_name"), "")
    facts = HCO.facts_of({"employee_name": fill["name"], "name_from": fill["from"], "type": p.get("type"),
                          "date": p.get("date")})
    if not facts["person_key"]:
        return Decision({"status": 400, "message": "No employee_name this lane can key."})
    if not facts["kind"]:
        return Decision({"status": 400, "message": f"The type \"{gsjs.or_text(p.get('type'))}\" is not one this "
                                                   "platform declares. The four are Call Off, No Show No Call, Late "
                                                   "Show and Sent Home — and they are not one fact."})
    out, edits = recorded(reads, facts, instance, "door:" + (gsjs.or_text(user.get("email")) or "admin"))
    return Decision({"status": 200, "data": out}, edits=edits or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"callOffSpeak": speak}
# HUB_POLICY.callOffSpeak: admins
POLICY: dict[str, dict[str, Any]] = {"callOffSpeak": {"roles": ("admin",),
                                                      "params": {"instance": "string", "employee_name": "string",
                                                                 "type": "string", "date": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"callOffSpeak": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_call_off_writes and _receipts; the call-off row app.edits', the messages Smart Comms' outbox's."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_call_off", label="The call-off replay")
