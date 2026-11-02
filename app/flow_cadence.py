"""Settings › Flow admin's rearm (apps-script/FlowAdmin.gs flowCadenceRearm) off asa-hub-db: the cadence one hiring step
asks with now (HiringSimConfig.gs simAttemptsFor_) carried onto its asks already in flight in hiring_sim_asks, kept in
app.edits — as facts on the depot's Facts while the tab is dissolved, else on the tab's rows."""
from __future__ import annotations

import re
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hubdb
import locations as L
import staff_views
import writes as W
from writes import Decision

ASKS_TAB = "hiring_sim_asks"
CFG_TAB = "hiring_sim_config"
# FlowAdmin.gs FLOW_CADENCE_STEPS: each asking step's id
STEPS = ("ask", "shortlist", "outreach", "screen_call", "resume_request", "cjis_request", "manual_contact", "invite",
         "referral_relay", "manual_adder", "director_docs", "ready_parked", "ready_ask")
# HiringSimConfig.gs HIRING_SIM_CFG_DEFAULTS: the shipped attempts and retry minutes (first entry per key)
DEFAULTS = {
    "sim_attempts": "1", "sim_attempts_resume_request": "3", "sim_retry_minutes_referral_relay": "120",
    "sim_attempts_referral_relay": "7", "sim_retry_minutes": "30", "sim_attempts_manual_contact": "7",
    "sim_retry_minutes_manual_contact": "120", "sim_attempts_manual_resume": "3",
    "sim_retry_minutes_manual_resume": "1440", "sim_attempts_interview_days": "7",
    "sim_retry_minutes_interview_days": "30", "sim_attempts_phone_collect": "7",
    "sim_retry_minutes_phone_collect": "120", "sim_attempts_phone_confirm": "7",
    "sim_retry_minutes_phone_confirm": "120", "sim_attempts_interview_slots": "7",
    "sim_retry_minutes_interview_slots": "120", "sim_attempts_onboarding_finish": "7",
    "sim_retry_minutes_onboarding_finish": "120", "sim_attempts_screen_call": "7",
    "sim_retry_minutes_screen_call": "120", "sim_attempts_packet_request": "7",
    "sim_retry_minutes_packet_request": "1440", "sim_attempts_ready_ask": "7", "sim_retry_minutes_ready_ask": "1440",
    "sim_attempts_manual_adder": "2", "sim_retry_minutes_manual_adder": "720", "sim_attempts_director_docs": "3",
    "sim_retry_minutes_director_docs": "720", "sim_attempts_ready_parked": "4",
    "sim_retry_minutes_ready_parked": "10080", "sim_attempts_ask": "", "sim_attempts_shortlist": "",
    "sim_attempts_outreach": "7", "sim_retry_minutes_outreach": "205", "sim_attempts_invite": "",
}
_INT = re.compile(r"^\s*([+-]?\d+)")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def _parse_int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    m = _INT.match(gsjs.or_blank(v))
    return int(m.group(1)) if m else None


def sim_cfg(reads: L.Reads) -> dict[str, str]:
    """hiringSimCfg_: the whole config as {key: value}."""
    cfg: dict[str, str] = {}
    for r in CND.read_tab(reads, CFG_TAB):
        k = gsjs.trim(gsjs.or_blank(r.get("key")))
        if k:
            cfg[k] = gsjs.or_blank(r.get("value"))
    return cfg


def cfg_val(cfg: dict[str, str], key: str) -> str:
    """simCfgVal_: one value, with the shipped default as the floor."""
    v = s_(cfg.get(key))
    return v if v else s_(DEFAULTS.get(key))


def attempts_for(cfg: dict[str, str], step: str) -> dict[str, int]:
    """simAttemptsFor_: attempts and interval for one step — the per-step cell, then the global."""
    per = _parse_int(cfg_val(cfg, "sim_attempts_" + step))
    every = _parse_int(cfg_val(cfg, "sim_attempts"))
    per_min = _parse_int(cfg_val(cfg, "sim_retry_minutes_" + step))
    minutes = _parse_int(cfg_val(cfg, "sim_retry_minutes"))
    attempts = per if per is not None and per > 0 else (every if every is not None and every > 0 else 1)
    return {"attempts": min(attempts, 50),
            "minutes": per_min if per_min is not None and per_min >= 5 else (
                minutes if minutes is not None and minutes >= 5 else 30)}


def _drifting(row: dict, step: str, force: dict[str, int]) -> bool:
    if s_(row.get("step")) != step or s_(row.get("state")) != "open":
        return False
    cur_max = _parse_int(s_(row.get("maxattempts"))) or 0
    cur_min = _parse_int(s_(row.get("intervalminutes"))) or 0
    return not (cur_max == force["attempts"] and cur_min == force["minutes"])


def rearm(sess: L.Session, payload: dict) -> Decision:
    """flowCadenceRearm: the current cadence numbers carried onto the asks already in flight for one step."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    reads = sess.reads
    step = s_(p.get("step"))
    if step not in STEPS:
        return W.refuse(400, f'There is no asking step "{step}". They are {", ".join(STEPS)}.')
    force = attempts_for(sim_cfg(reads), step)
    edits: list[dict] = []
    touched = 0
    if reads.db.dissolved(ASKS_TAB):
        # the runtime sheet's setValue: one hiringLegacyWrite_ per cell, by 'runtime-sheet'
        sid, _ref = CW.facts_where(reads)
        fresh: bool | tuple = (sid,)
        for sub, row in CW.dissolved_rows(reads, ASKS_TAB).items():
            if _drifting(row, step, force):
                edits += CW.facts_of(reads, ASKS_TAB, sub, {"max_attempts": str(force["attempts"])}, "runtime-sheet",
                                     "", "")
                edits += CW.facts_of(reads, ASKS_TAB, sub, {"interval_minutes": str(force["minutes"])},
                                     "runtime-sheet", "", "")
                touched += 1
    else:
        res = W.tab_of(reads, ASKS_TAB)
        heads = {hubdb.norm_key(h): h for h in (res.ref.headers if res.ref is not None else ())}
        need = ("step", "state", "maxattempts", "intervalminutes")
        if res.ref is None or any(k not in heads for k in need) or "simaskid" not in heads:
            return W.refuse(500, "The ask book is missing a column this needs.")
        sid, tab = W.where_of(res)
        fresh = (sid,)
        idh = heads["simaskid"]
        for _rn, raw in reads.db.rows(res.ref):
            row = {k: gsjs.js_str(hubdb.typed(raw.get(h), "raw")) for k, h in heads.items()}
            key = gsjs.trim(gsjs.or_blank(raw.get(idh)))
            if not _drifting(row, step, force):
                continue
            if not key:
                return W.refuse(409, W.NOT_TOLD_APART)
            cells = {heads["maxattempts"]: str(force["attempts"]), heads["intervalminutes"]: str(force["minutes"])}
            edits.append(W.kept_record(sid, tab, "edit", "cols:" + gsjs.trim(gsjs.js_str(idh)), key, "", cells,
                                       before={heads["maxattempts"]: row["maxattempts"],
                                               heads["intervalminutes"]: row["intervalminutes"]}))
            touched += 1
    if edits:
        W.gate(reads)
    staff_views.record(user, "flow_cadence_rearm",
                       f"{step} — {touched} open ask(s) now run on {force['attempts']}×{force['minutes']}min")
    answer = {"status": 200, "data": {"step": step, "rearmed": touched, "attempts": force["attempts"],
                                      "minutes": force["minutes"]}}
    d = W.final(answer, edits, "")
    d.fresh = fresh
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"flowCadenceRearm": rearm}
POLICY: dict[str, dict[str, Any]] = {"flowCadenceRearm": {"roles": ("admin",), "params": {"step": "string"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"flowCadenceRearm": {"status": 409, "message": W.BUSY}}
