"""What a candidate said on a call, as Staff Candidates › Interviews › Candidate preferences reads it: the relay's lane
(server/call_prefs.py) reads each owed call's words once with the platform's model and keeps the answer in asa-hub-db
(app.candidate_call_prefs); this side reads the answers and owes the lane the calls it has not read yet."""
from __future__ import annotations

import json
import logging
from typing import Any

import gsjs

log = logging.getLogger("asa-hub-app")

TABLE = "app.candidate_call_prefs"
# the phone screen's own Yes/No columns (candidate_writes.PREF_FIELDS), as the lane answers them
YES_NO = ("shift_day", "shift_afternoon", "shift_night", "hours_ft", "hours_pt", "hours_prn", "every_other_weekend",
          "male_care", "behavioral_care", "has_dl", "has_vehicle", "has_insurance", "cert_dodd", "cert_cpr_first_aid",
          "cert_med_del")
TEXTS = ("availability", "earliest_start", "preferred_location")
# the newest calls a candidate's preferences are heard on
CALLS_CAP = 3
_SINGLES = {"every_other_weekend": "every_other_weekend", "male_care": "male_care", "behavioral_care": "behavioral_care",
            "drivers_license": "has_dl", "vehicle": "has_vehicle", "insurance": "has_insurance"}
_SHIFTS = (("Day", "shift_day"), ("Afternoon", "shift_afternoon"), ("Night", "shift_night"))
_HOURS = (("Full time", "hours_ft"), ("Part time", "hours_pt"), ("PRN", "hours_prn"))
_CERTS = {"dodd": "cert_dodd", "cpr_first_aid": "cert_cpr_first_aid", "med_del": "cert_med_del"}
_BOUND: dict[str, Any] = {}


def bind(store: Any) -> None:
    """The write store whose connection owes the lane its calls (main.py's Staff Candidates store)."""
    _BOUND["store"] = store


def kept(reads: Any, call_ids: list[str]) -> dict[str, dict[str, Any] | None]:
    """{call: the lane's answer} of the calls already queued; None for one it has not read (yet, or ever)."""
    if not call_ids:
        return {}
    rows = reads.db.query(f"select call_id, state, prefs from {TABLE} where call_id = any(%s)", (list(call_ids),))
    out: dict[str, dict[str, Any] | None] = {}
    for cid, state, prefs in rows:
        p = prefs if isinstance(prefs, dict) else json.loads(prefs or "null")
        out[str(cid)] = p if state == "read" and isinstance(p, dict) else None
    return out


def owe(candidate: str, call_ids: list[str], sources: list[list[str]]) -> None:
    """The calls the lane has not been asked to read, queued once with the inboxes' copies (book, tab) that may hold
    their words; a queue that cannot be written never fails a read."""
    store = _BOUND.get("store")
    if not call_ids or not sources or store is None or not store.available:
        return
    try:
        c = store.conn()
        for cid in call_ids:
            c.execute(f"insert into {TABLE} (call_id, candidate, sources) values (%s, %s, %s)"
                      " on conflict (call_id) do nothing", (cid, candidate, json.dumps(sources)))
    except Exception as exc:  # noqa: BLE001 - the next read owes them again
        log.warning("call prefs: %d call(s) of %s not queued (%s)", len(call_ids), candidate, type(exc).__name__)


def _said(answers: list[dict[str, Any]], key: str) -> str:
    """The newest call's answer to one question: 'yes', 'no', or the words it gave; '' when no call said."""
    for a in answers:
        v = gsjs.trim(gsjs.or_blank(a.get(key)))
        if key in YES_NO:
            v = v.lower() if v.lower() in ("yes", "no") else ""
        if v:
            return v
    return ""


def overlay(prefs: dict[str, Any], answers: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """The preferences with each line the record leaves empty filled from the calls, and the lines so filled."""
    if not answers:
        return prefs, []
    out, filled = dict(prefs), []
    for name, rows in (("shifts", _SHIFTS), ("hours", _HOURS)):
        if not out.get(name):
            got = [word for word, key in rows if _said(answers, key) == "yes"]
            if got:
                out[name] = got
                filled.append(name)
    for name, key in _SINGLES.items():
        if not out.get(name) and _said(answers, key):
            out[name] = _said(answers, key)
            filled.append(name)
    certs = dict(out.get("certificates") or {})
    took = False
    for name, key in _CERTS.items():
        if not certs.get(name) and _said(answers, key):
            certs[name] = _said(answers, key)
            took = took or certs[name] == "yes"
    out["certificates"] = certs
    if took:
        filled.append("certificates")
    for name in TEXTS:
        if not gsjs.trim(gsjs.or_blank(out.get(name))) and _said(answers, name):
            out[name] = _said(answers, name)[:160]
            filled.append(name)
    return out, filled
