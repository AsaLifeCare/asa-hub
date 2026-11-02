"""The call-off lane's own doors on Python (CommCallOff.gs section 9). callOffLaneState is the honest reading of the
lane (commCallOffLaneState_): what the call-off book last held, whether the acknowledgement can fire, why the cover
audience is refused, the three other audiences and their reach, the roster's readability, the dial — a zero never
read as an answer. callOffSpeak (app/comm_call_off_writes.py) answers one call-off again the way the hotline's filing
answers it on Python (app/hotline_calloff.py)."""
from __future__ import annotations

from typing import Any, Callable

import call_offs as CO
import comm_record as CR
import comm_repair as CRP
import gsjs
import hotline_calloff as HCO
import hubdb
import locations as L
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD

APP_ID = "comm-call-off"
SUBJECT_PURPOSE = "shift"
OFFER_PURPOSE = "roster"
PRESHIFT_MIN = 30

s_ = gsjs.str_


def either(*vals: Any) -> Any:
    """a || b || …."""
    for v in vals:
        if not gsjs.falsy(v):
            return v
    return vals[-1] if vals else None


def purpose_ok(purpose: str) -> bool:
    """commCallOffPurposeOk_."""
    return purpose in CR.EMPLOYMENT_PURPOSES


def subject_unreached() -> dict[str, Any]:
    """commCallOffSubjectIsUnreached_: nothing else on this platform addresses the caller."""
    d = SK.EVENTS.get("hotline_call_off")
    if not d:
        return {"ok": True, "why": "the hotline situation does not exist in this build, so nothing there can address "
                                   "the caller"}
    if d.get("to_subject"):
        return {"ok": False, "why": "SMART_EVENTS.hotline_call_off now carries to_subject — the hotline lane can "
                                    "address the caller itself, and a second acknowledgement would be the duplication "
                                    "this lane exists to prevent. Nothing was said."}
    return {"ok": True, "why": "SMART_EVENTS.hotline_call_off carries no to_subject, so its sweep can only address a "
                               "team — the caller is reached by nothing on this platform"}


def cover_verdict(facts: dict | None) -> dict[str, Any]:
    """commCallOffCoverVerdict_: whoever covers the house — refused by design."""
    f = facts or {}
    return {"send": False, "audience": "cover", "rung_if_ever": "repair",
            "why": "REFUSED BY DESIGN. The hotline's Call Off Processor already texts the House Lead, and nothing the "
                   "rest of the platform can read says whether THIS lead was told about THIS call-off"
                   + (" (" + gsjs.js_str(f["name"]) + ")" if f.get("name") else "")
                   + (" on " + gsjs.js_str(f["date"]) if f.get("date") else "")
                   + ". The queue's `processed` cell says a row was acted on, not who was told; the processor's own "
                     "audit log is a book this workbook does not own and is not registered in asa_sheet_tables; "
                     "`staff_alerts` records the mailbox lane and the Late Show recipient list, not this lead and not "
                     "this absence. An unprovable \"probably not sent\" is how somebody gets two texts about one "
                     "absence, so this audience is refused entirely rather than guessed at.",
            "lifts_when": "A per-call-off record of the hotline's own send — recipient, time and receipt, keyed by the "
                          "same call id this lane uses — is readable by the platform (a registered mirror, or a tab in "
                          "this workbook). Then this becomes a lookup instead of a guess, and the rung argued above "
                          "applies."}


def newest(reads: L.Reads) -> dict[str, Any]:
    """commCallOffNewest_: "nothing has arrived since <the source's newest date>", never "nothing has arrived"."""
    out: dict[str, Any] = {"rows": 0, "newest": "", "unreadable": 0, "kinds": {}, "read": False, "why": ""}
    try:
        rows = CO.rows(reads)
    except Exception:  # noqa: BLE001 - "we cannot see", never "nobody called off"
        out["why"] = 'the call-off house could not be read — this is "we cannot see", never "nobody called off"'
        return out
    out["read"] = True
    out["rows"] = len(rows)
    for r in rows:
        kind = HCO.kind_of(either(r.get("kind"), r.get("type"), r.get("type_of_request"), ""))
        day = SCD.call_off_date(either(r.get("date"), r.get("shift_date"), r.get("date_received"), ""))
        if not day:
            out["unreadable"] += 1
            continue
        if not out["newest"] or day > out["newest"]:
            out["newest"] = day
        k = kind or "unrecognised"
        out["kinds"][k] = out["kinds"].get(k, 0) + 1
    if out["rows"]:
        out["why"] = (("nothing has arrived since " + out["newest"]
                       + (f" — and {out['unreadable']} row(s) carry a date this lane could not read, so the real "
                          "newest may be later than that" if out["unreadable"] else ""))
                      if out["newest"] else
                      f"the house holds {out['rows']} row(s) and NOT ONE of them carries a date this lane can read — "
                      "the freshness of this source is unknown, which is not the same as old")
    else:
        out["why"] = ("the call-off house is empty. That is a statement about the HOUSE, not about the world: a "
                      "call-off arrives by telephone through the Employee Support Hotline, and if the hotline port is "
                      "not running, people are calling off into a book nothing writes.")
    return out


def _shifts(reads: L.Reads) -> list[dict] | None:
    """listRows_('shifts'): the tab's rows (a book the copy knows holding no copy of the tab holds none), None when
    it cannot be read."""
    try:
        import sheet_resources as SR  # noqa: PLC0415 - the tab kept in Postgres once uploaded
        kept = SR.kept_rows(reads, "shifts")
        if kept is not None:
            return kept
        res = reads.db.resolve("shifts")
        if res.runtime:
            return None
        if res.ref is None:
            return [] if res.book_known else None
        return [dict(r) for r in reads.db.sheetdb_rows(res.ref)]
    except (hubdb.Unreadable, Exception):  # noqa: BLE001 - a read that failed is not an empty house
        return None


def working_that_day(shifts: list[dict], day: str) -> bool:
    """commCallOffWorkingThatDay_: OPEN is an unfilled shift and WORKSHOP is not a person."""
    if not day:
        return False
    for s in shifts or ():
        if SCD.call_off_date((s or {}).get("date")) != day:
            continue
        who = gsjs.trim(gsjs.or_text((s or {}).get("staff"))).upper()
        if who == "OPEN" or "WORKSHOP" in who:
            continue
        return True
    return False


def inside_pre_shift(reads: L.Reads, now_ms: float, start_ms: float) -> dict[str, Any] | None:
    """commCallOffInsidePreShift_."""
    if not start_ms or not now_ms:
        return None
    width = SCD.digest_setting(reads, "comm_call_off_preshift_min", PRESHIFT_MIN, 0, 720) * 60000
    if now_ms > start_ms or start_ms - now_ms > width:
        return None
    return {"ok": False, "why": "inside their own pre-shift window — that window belongs to the shift they already "
                                "have, and it is the only reason this platform may reach anybody at this hour at all"}


def cover_candidates(reads: L.Reads, facts: dict, now_ms: float) -> dict[str, Any]:
    """commCallOffCoverCandidates_: who could be asked — and today, nobody, with the reason said out loud."""
    out: dict[str, Any] = {"ok": False, "why": "", "candidates": [], "refused": [], "roster_rows": 0}
    rows = _shifts(reads)
    if rows is None:
        out["why"] = ("the roster could not be read at all — nobody was asked. A read that failed is not a house with "
                      "nobody in it.")
        return out
    out["roster_rows"] = len(rows)
    if not rows:
        out["why"] = ("the roster is not readable from here: the `shifts` tab in this workbook is empty by design, "
                      "because the real roster lives in Postgres and reaches the browser as a live slice this backend "
                      "cannot read back. NOBODY was asked, and that is a refusal rather than a finding — an empty list "
                      "here would read as \"nobody could cover it\", which is a claim about seventeen houses full of "
                      "people that this lane has no way to make.")
        return out
    by_person: dict[str, dict] = {}
    for s in rows:
        key = gsjs.name_key((s or {}).get("staff"))
        if not key:
            continue
        by_person.setdefault(key, {"key": key, "name": gsjs.or_text((s or {}).get("staff")), "rows": []})
        by_person[key]["rows"].append(s)
    day = gsjs.or_text(facts.get("date"))
    for key in CR.js_keys(by_person):
        person = by_person[key]
        if key == gsjs.or_text(facts.get("person_key")):
            out["refused"].append({"person_key": key, "why": "this is the person who called off"})
            continue
        if not working_that_day(person["rows"], day):
            out["refused"].append({"person_key": key,
                                   "why": "off that day themselves — a day off is not spare capacity"})
            continue
        pre = None
        for r in person["rows"]:
            start = gsjs.date_parse(gsjs.or_text((r or {}).get("startsAt")))
            got = None if start is None else inside_pre_shift(reads, now_ms, start)
            if got:
                pre = got
                break
        if pre:
            out["refused"].append({"person_key": key, "why": pre["why"]})
            continue
        out["candidates"].append({"person_key": key, "name": person["name"]})
    out["ok"] = True
    out["why"] = (f"{len(out['candidates'])} could be asked; {len(out['refused'])} were refused by the lane's own rules"
                  if out["candidates"] else "the roster answered and nobody on it passed both refusals")
    return out


def keyword_label(word: str) -> str:
    """commCallOffKeywordLabel_."""
    return next((label for k, label in SCD.SMART_TO_KEYWORDS if k == word), "")


def lane_state(reads: L.Reads) -> dict[str, Any]:
    """commCallOffLaneState_: what this lane can and cannot do right now, in one answer."""
    now_ms = reads.now.timestamp() * 1000.0
    source = newest(reads)
    try:
        rows: list[dict] = SC.read_situations(reads.db)
    except Exception:  # noqa: BLE001 - no situation is on
        rows = []
    sit = SCD.situation_on(rows, HCO.SUBJECT_SITUATION)
    offer_sit = SCD.situation_on(rows, HCO.OFFER_SITUATION)
    unreached = subject_unreached()
    roster = cover_candidates(reads, {"person_key": "", "date": ""}, now_ms)
    told = deferred = held = not_owed = 0
    try:
        for r in SCD.call_off_rows(reads).values():
            st = gsjs.or_text(r.get("subject_state"))
            if st == "told":
                told += 1
            elif st == "deferred":
                deferred += 1
            elif st == "not_owed":
                not_owed += 1
            elif st:
                held += 1
    except Exception:  # noqa: BLE001 - the house may not exist yet: a state, not an error
        pass
    reach = SCD.call_off_reach(reads)
    quiet = SC.QUIET_WORDS
    try:
        dial = CRP.dial_word(reads)
    except Exception:  # noqa: BLE001 - an unread dial is off
        dial = "off"
    try:
        test = CRP.test_mode(reads)
    except Exception:  # noqa: BLE001 - commTestMode_ answers false on a throw
        test = False
    return {
        "source": source,
        "can_fire": bool(sit and unreached["ok"] and purpose_ok(SUBJECT_PURPOSE)),
        "subject": {"situation": HCO.SUBJECT_SITUATION, "declared": bool(sit),
                    "why": "the situation is on and carries words" if sit else
                    "the situation is absent, switched off, or still wordless — nothing can be said",
                    "nothing_else_reaches_them": unreached["ok"], "nothing_else_why": unreached["why"],
                    "purpose": SUBJECT_PURPOSE, "purpose_declared": purpose_ok(SUBJECT_PURPOSE),
                    "told": told, "deferred": deferred, "held": held, "not_owed": not_owed},
        "cover": cover_verdict(None),
        "others": {
            "house_manager": {
                "situation": HCO.MANAGER_SITUATION, "declared": bool(HCO.other_situation(rows, HCO.MANAGER_SITUATION)),
                "sender": "hotline_calloff.tell_manager",
                "audience": "the manager the hotline resolves for that shift — no cell, and no guess",
                "reach": reach, "also_sent_by": SCD.COMM_CALLOFF_LEGACY_SENDER,
                "why": "fired by the write that records the call-off, once per call-off; wordless means silent; the "
                       f"send door's quiet window ({quiet}) holds it to 08:00, when it goes if the shift has not "
                       "ended; and the shift's own manager hears about a call-off from this row rather than from the "
                       "cover offer"},
            "everyone": {
                "situation": HCO.EVERYONE_SITUATION,
                "declared": bool(HCO.other_situation(rows, HCO.EVERYONE_SITUATION)),
                "sender": "hotline_calloff.blast",
                "audience": "the row's own `Goes to`, where `allstaff` resolves to " + keyword_label("allstaff"),
                "why": "fires only for a kind that leaves a shift with nobody in it; never retried once it starts; the "
                       "row records how many were reached AS IT GOES; the send door's quiet window "
                       f"({quiet}) holds it before it starts and it goes at 08:00 if the shift has not ended; and "
                       "anybody already told about this call-off as the house manager or as a decider is not asked "
                       "again here"},
            "cover_offer": {
                "situation": HCO.OFFER_SITUATION, "declared": bool(HCO.other_situation(rows, HCO.OFFER_SITUATION)),
                "sender": "hotline_calloff.offer_send",
                "audience": "the row's own `Goes to`, where `housemanagers` resolves to "
                            + keyword_label("housemanagers") + " — minus the manager of that shift, who is told by `"
                            + HCO.MANAGER_SITUATION + "` instead",
                "suggestion": "NOT IN THIS BUILD — the cover ranking arrives with the cover-suggestion engine, and "
                              "there is no {suggestion} placeholder until it does",
                "why": "fired by the write that records the call-off, once per call-off; the send door's quiet window "
                       f"({quiet}) holds it to 08:00, when it goes if the shift has not ended — the same law the "
                       "blast is under"}},
        "offer": {"situation": HCO.OFFER_SITUATION, "declared": bool(offer_sit), "purpose": OFFER_PURPOSE,
                  "roster_readable": roster["ok"], "roster_rows": roster["roster_rows"],
                  "why": (f"the roster answered with {roster['roster_rows']} row(s); who could be asked is computed "
                          "per call-off, against that call-off's own day") if roster["ok"] else roster["why"]},
        "dial": dial,
        "test_mode": test}


def lane_state_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """callOffLaneState: the reading, for admins, managers and the service."""
    user = sess.user or {}
    if not sess.user:
        return dict(SCD.DENIED)
    if user.get("is_service") is not True and gsjs.js_str(user.get("role")) not in ("admin", "manager"):
        return dict(SCD.DENIED)
    return {"status": 200, "data": lane_state(sess.reads)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"callOffLaneState": lane_state_door}
# HUB_POLICY.callOffLaneState: admins and managers
POLICY: dict[str, dict[str, Any]] = {"callOffLaneState": {"roles": ("admin", "manager")}}
