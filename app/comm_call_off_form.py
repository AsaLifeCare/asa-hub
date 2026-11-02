"""Calendar Builder's call-offs on Python (CommCallOffForm.gs, its calendar half): a call-off marked on the Builder,
owed by the relay's road (server/calloff_road.py) to callOffFromCalendar, keyed on the pool ref so nothing is filed
twice. Here is what one of them becomes before it is filed — its Call Off Tracker row, the mock outbox's row that
stands for it while test mode holds every write of a call-off, and the place the call-off lane hears beside its facts
(commCallOffPlace_). The filing is app/comm_call_off_form_writes.py's."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import locations as L
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import smart_comms_writes as SW
from gsjs import NY

APP_ID = "comm-call-off-form"
# CALLOFF_CAL_MAX, CALLOFF_CAL_SOURCE, CALLOFF_CAL_REF
CAL_MAX = 4
CAL_SOURCE = "calendar"
CAL_REF = re.compile(r"SP[0-9A-F]{10}")
MOCK_BODY_MAX = 4000

s_ = gsjs.str_


def text(v: Any) -> str:
    """String(v || '')."""
    return gsjs.or_text(v)


def test_mode_held(reads: L.Reads) -> bool:
    """callOffCalTestMode_: hubTestModeOn_ — a reading that throws, or a word the switch does not know, counts as test
    mode."""
    try:
        st = SCD.test_mode_state(reads.config())
    except Exception:  # noqa: BLE001 - an unreadable switch holds every write of a call-off
        return True
    return True if st["unrecognized"] else bool(st["on"])


def us_day(iso: Any) -> str:
    """callOffCalUsDay_: 2026-09-24 → 9/24/2026, anything else as it came."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", gsjs.trim(text(iso)))
    return f"{int(m[2])}/{int(m[3])}/{m[1]}" if m else text(iso)


def tracker_row(p: dict, now_iso: str) -> dict[str, str]:
    """callOffCalTrackerRow_: the Call Off Tracker's row for one Builder call-off."""
    return {"timestamp": now_iso, "employee_name": text(p.get("employee_name")), "date": us_day(p.get("date")),
            "type": "Call Off", "notes": text(p.get("reason")),
            "your_name": "Calendar Builder" + (" (" + gsjs.js_str(p["marked_by"]) + ")"
                                               if not gsjs.falsy(p.get("marked_by")) else ""),
            "call_id": text(p.get("instance")), "name_from": "person"}


def mock_row(p: dict, tracker: dict[str, str], now: datetime) -> dict[str, Any]:
    """callOffCalMockRow_: what stands for the tracker row in the mock outbox while test mode holds it."""
    local = now.astimezone(NY)
    body = "\n".join(["Type: Call Off", "Employee: " + tracker["employee_name"], "Shift date: " + tracker["date"],
                      "House: " + (text(p.get("house")) or "(not named)"), "Shift: " + text(p.get("shift")),
                      "Reported by: " + tracker["your_name"], "Notes: " + (tracker["notes"] or "(none)")])
    return {
        "id": "web_" + hashlib.sha256(("callofftracker|" + tracker["call_id"]).encode("utf-8")).hexdigest()[:20],
        "at": gsjs.iso(now.astimezone(timezone.utc)), "day": local.strftime("%Y-%m-%d"),
        "hour": local.strftime("%H:%M"),
        "pass_id": "", "seq": 1, "situation": "call_off_tracker_row",
        "purpose": "Call Off Tracker row · Calendar Builder · " + text(p.get("house")),
        "method": "callOffsRow", "send_at": "", "person_name": tracker["employee_name"],
        "to_masked": "Call Off Tracker", "audience": 1, "channel": "tracker_row",
        "subject": "Call Off — " + tracker["employee_name"] + " (" + tracker["date"] + ")",
        "body": SW.js_slice(body, MOCK_BODY_MAX), "body_chars": SCO.utf16_len(body),
        "result": "held", "held_by": "held: test mode",
        "reason": "test mode holds every write of a call-off — the tracker row is written here, not to the Call Off "
                  "Tracker",
        "dial": "", "test_mode": "on", "send_switch": "", "ledger_key": "callofftracker|" + tracker["call_id"],
        "tenant": ""}


def place_of(queued: dict | None) -> dict[str, Any]:
    """commCallOffPlace_: the place the shift was, carried beside the facts and never inside them."""
    q = queued or {}
    day = gsjs.trim(text(q.get("shift_day")))
    start = gsjs.trim(text(q.get("shift_start")))
    return {"manager": gsjs.trim(text(q.get("manager") or q.get("house_manager"))),
            "house": gsjs.trim(text(q.get("house") or q.get("location"))),
            "reason": gsjs.trim(text(q.get("reason"))), "reason_lost": q.get("reason_lost") is True,
            "shift_day": day if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else "",
            "day_from_call": q.get("day_from_call") is True,
            "shift_start": start if re.fullmatch(r"\d{1,2}:\d{2}", start) else ""}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
