"""The comm-bindings book seeded on Python (HiringSimConfig.gs commBindingsSeedMaybe_): what Apps Script's hiring sweep
did first on every pass, rung by the relay's clock instead. The generic config book's Smart Comms tab names which
situation row each purpose speaks through; a shipped binding the tab lacks is appended with its fallback, and one it
holds with a blank Situation ID is given the shipped id. The look (commBindingsSeedDue) is a read and plans each
binding; comm_bindings_writes carries the plans under the write lock, kept in app.edits for the sheet. A tab the book
lacks is still made by Apps Script, since a kept edit cannot make one."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L

APP_ID = "comm-bindings"
DENIED = {"status": 403, "message": "This is the relay's own door."}
# HiringSimConfig.gs COMM_BINDINGS_*
TAB = "Smart Comms"
KEY_COL = "Config ID"
VAL_COL = "Smart Comms Situation ID"
FB_COL = "Current Fallback"
BOOK_PROP = "HUB_GENERIC_CONFIG_ID"
# COMM_BINDINGS_DEFAULTS: (Config ID, the shipped Smart Comms Situation ID)
DEFAULTS: tuple[tuple[str, str], ...] = (
    ("hiring.welcome", "hiring_welcome"),
    ("hiring.ask", "hiring_ask"),
    ("hiring.shortlist", "hiring_shortlist"),
    ("hiring.outreach", "hiring_outreach"),
    ("hiring.first_contact", "hiring_first_contact"),
    ("hiring.resume.request", "hiring_resume_request"),
    ("hiring.cjis.request", "hiring_cjis_request"),
    ("hiring.cjis.missing_at_interview", "hiring_cjis_gate"),
    ("hiring.decision.request", "hiring_decision_ask"),
    ("hiring.screen.invitation", "hiring_screen_call"),
    ("hiring.screen.redo", "hiring_screen_redo"),
    ("hiring.screen.report_ready", "hiring_screen_report"),
    ("hiring.date_accepted", "hiring_date_accepted"),
    ("hiring.phone.collect", "hiring_phone_collect"),
    ("hiring.phone.confirm", "hiring_phone_confirm"),
    ("hiring.contact_failed", "hiring_contact_failed"),
    ("hiring.unreachable_archived", "hiring_unreachable_archived"),
    ("hiring.referral.contact", "hiring_referral_contact"),
    ("hiring.interview.days_request", "interview_days_ask"),
    ("hiring.interview.slots_request", "interview_slots_ask"),
    ("hiring.interview.invitation", "interview_invite"),
    ("hiring.interview.supervisor_request", "interview_supervisor_ask"),
    ("hiring.interview.supervisor_slots", "interview_supervisor_slots_request"),
    ("hiring.interview.slots_offer", "interview_slots_offer"),
    ("hiring.interview.candidate_confirmed", "interview_candidate_confirmed"),
    ("hiring.interview.confirmed", "interview_confirmed"),
    ("hiring.interview.scorecard_report", "hiring_scorecard_report"),
    ("hiring.packet.request", "hiring_packet_request"),
    ("hiring.event.scheduled", "hiring_event_scheduled"),
    ("hiring.onboarding.finish_request", "hiring_onboarding_finish"),
    ("hiring.screen.day_reminder", "hiring_screen_day_reminder"),
    ("hiring.onboarding.start", "hiring_onboarding_start"),
    ("hiring.bci.howto", "hiring_bci_howto"),
    ("hiring.onboarding.stalled", "hiring_onboarding_stalled"),
    ("hiring.hired.complete", "hiring_hired_complete"),
    ("hiring.hired.missing", "hiring_hired_missing"),
    ("hiring.hired.congratulations", "hiring_hired_congrats"),
    ("hiring.ready.notification", "hiring_ready_to_start"),
    ("referral.no_contact", "referral_no_contact"),
    ("referral.already_known", "referral_already_known"),
    ("staff.late_show", "staff_late_show"),
    ("staff.no_call", "staff_no_call"),
    ("recon.punch_reminder", "recon_punch_reminder"))


def default_of(key: str) -> str | None:
    """The shipped Situation ID of a binding COMM_BINDINGS_DEFAULTS names; None for any other key."""
    return next((v for k, v in DEFAULTS if k == key), None)


def _cell(v: Any) -> str:
    """String(v || '').trim() of a cell as getValues() hands it back."""
    return gsjs.trim(gsjs.or_text(hubdb.typed(v, "hub")))


def read_tab(reads: L.Reads) -> dict[str, Any]:
    """The binding tab as commBindingsSeedMaybe_ reads it: `tab` missing when the book holds no such tab, `shape`
    unknown when its raw header lacks Config ID or Smart Comms Situation ID; else its ref, the headers each cell is
    written under (the fallback's None when the tab has none), its rows and, by Config ID, the last row naming it with
    its Situation ID."""
    sid = gsjs.trim(reads.db.prop(BOOK_PROP))
    if not sid:
        return {"book": "unnamed"}
    ref = HT.tab_of(reads, sid, TAB, "the comm bindings")
    if ref is None:
        return {"tab": "missing"}
    heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]

    def src(name: str) -> str | None:
        return ref.headers[heads.index(name)] if name in heads else None

    key, val = src(KEY_COL), src(VAL_COL)
    if key is None or val is None:
        return {"shape": "unknown"}
    rows = reads.db.rows(ref)
    have: dict[str, tuple[int, str]] = {}
    for i, (_rn, raw) in enumerate(rows):
        k = _cell(raw.get(key))
        if k:
            have[k] = (i, _cell(raw.get(val)))
    return {"ref": ref, "key": key, "val": val, "fb": src(FB_COL), "rows": rows, "have": have}


def work(have: dict[str, tuple[int, str]]) -> list[dict[str, str]]:
    """The shipped bindings the tab lacks or holds with a blank Situation ID, in COMM_BINDINGS_DEFAULTS' order."""
    return [{"key": k, "value": v} for k, v in DEFAULTS if k not in have or not have[k][1]]


# ---- the door -----------------------------------------------------------------------------------------------------

def seed_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commBindingsSeedDue: the relay's look before it rings commBindingsSeed — each shipped binding the tab lacks or
    holds blank, a plan."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    got = read_tab(sess.reads)
    if "have" not in got:
        return {"status": 200, "data": {"due": False, "plans": [], **got}}
    plans = work(got["have"])
    return {"status": 200, "data": {"due": bool(plans), "plans": plans, "rows": len(got["rows"]),
                                    "bindings": len(got["have"])}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"commBindingsSeedDue": seed_due}
POLICY: dict[str, dict[str, Any]] = {"commBindingsSeedDue": {}}
