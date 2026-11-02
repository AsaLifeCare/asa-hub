"""The matrix's conditions engine on Python, its writes: each pass's verdicts recorded — the runtime book's Condition
Instances through app.edits (a moved status on its row, a new row otherwise, read again under the lock so nothing is
written twice), the Board's decline rule moved once (app.edits on the Board's book), a run a terminal decline ends (the
status, the archive marks and the team's letter, the one ending interviewSave's Decline shares), the schema facts fed
(the runtime's Facts), and the engine's own cursors, marks and Rounds ledger (app.hiring_marks,
app.hiring_engine_rounds). The looks (hiring_engine) judge first; these only record."""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_engine as HE
import hiring_hired as HH
import hiring_outreach_writes as HOW
import hubdb
import locations as L
import recon as RC
import resource_rows as RR
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_

STALE = "The look this sweep was pressed with is not this service's, or it is too old — press it again."
SKIP_NOTE = "skipped: no new facts since the last round"
COVERED_NOTE = "skipped: another runner already covered this window"
END_BY = "auto-interview-decline"


def ddl() -> tuple[str, ...]:
    """The Rounds ledger (db/hiring_engine.sql), made here too."""
    return (f"create table if not exists {HE.ROUNDS} (id bigserial primary key, round_id text not null,"
            " slice text not null, runner text not null default '', from_n integer, to_n integer, of_n integer,"
            " units integer, wrote integer, started_at timestamptz, finished_at timestamptz not null default now(),"
            " ms integer not null default 0, notes text not null default '', write_id text not null default '')",
            f"create index if not exists hiring_engine_rounds_slice on {HE.ROUNDS} (slice, id)",
            f"grant select on {HE.ROUNDS} to asa_hub_app_ro")


def _done(answer: dict[str, Any], recs: list[dict]) -> Decision:
    """The pass's answer, its kept edits, and the marks and rounds written under its lock."""
    kept = [e for e in recs if e and e.get("cells")]
    return Decision(answer, edits=kept or None, subject="", own=True)


def _prepared(payload: dict, look: str, by: str, door: str) -> tuple[dict | None, Decision | None]:
    """The look this write was handed, sealed by this service for this caller just now."""
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer(f"{door} is read by {look} first")
    got = RC.unsealed(look, by, p.get("prepared"))
    return (got, None) if got is not None else (None, W.refuse(409, STALE))


def _hex(n: int) -> str:
    return uuid.uuid4().hex[:n].upper()


# ---- the Rounds ledger (engineRoundStamp_) ---------------------------------------------------------------------------

def stamp(reads: L.Reads, name: str, detail: dict[str, Any]) -> None:
    """engineRoundStamp_: "slice X passed here, over these units, at this time" — a stamp never costs the round."""
    now = CND.now_ms(reads)
    ms = int(detail.get("ms") or 0)

    def n(key: str) -> int | None:
        v = detail.get(key)
        return None if v is None or v == "" else int(v)
    cur = RR._cur()
    try:
        with SC._guard(cur):
            cur.execute(f"insert into {HE.ROUNDS} (round_id, slice, runner, from_n, to_n, of_n, units, wrote,"
                        " started_at, finished_at, ms, notes, write_id) values (%s, %s, %s, %s, %s, %s, %s, %s,"
                        " to_timestamp(%s / 1000.0), to_timestamp(%s / 1000.0), %s, %s, %s)",
                        ("RND_" + _hex(16), name, HE.RUNNER, n("from"), n("to"), n("of"), n("units"), n("wrote"),
                         now - ms, now, ms, s_(detail.get("notes")), SC.write_id()))
    except Exception as exc:  # noqa: BLE001 - a stamp must never cost the round
        log.info("engine rounds: the %s round was not stamped (%s)", name, type(exc).__name__)


# ---- the runtime book's Condition Instances --------------------------------------------------------------------------

def _new_row(kind: str, v: dict[str, Any], now: str) -> dict[str, str]:
    """The row each engine appends (hiringConditionsMaterialize_, hiringDataConditionsSweepMaybe_,
    flowConditionsSweepRun_, runtimeConditionsSweepRun_)."""
    st = s_(v.get("status"))
    resolved = now if st == "satisfied" else ""
    base = {"Condition ID": s_(v.get("cid")), "Subject ID": s_(v.get("sub")), "Status": st, "Resolved At": resolved}
    if kind == "matrix":
        return {HE.CI_ID: "CI_" + _hex(18), **base, "Stage": s_(v.get("stage")), "Opened At": now,
                "Resolved By": "matrix", "Notes": "materialized from the book"}
    if kind == "migration":
        tab = re.sub(r"[^A-Za-z0-9]+", "", s_(v.get("sub"))).upper()[:22]
        return {HE.CI_ID: "CI_MIG_" + tab, **base, "Stage": "migration", "Evidence": "book " + s_(v.get("book")),
                "Opened At": now, "Resolved By": "migration-sweep", "Notes": "answered from the platform itself"}
    if kind == "flow":
        return {HE.CI_ID: "CI_FL_" + _hex(16), **base, "Stage": "standing", "Evidence": "book " + s_(v.get("book")),
                "Opened At": now, "Resolved By": "flow-engine", "Notes": "judged by the generic sweep"}
    return {HE.CI_ID: "CI_RT_" + _hex(16), **base}


def ci_records(reads: L.Reads, rid: Any, verdicts: list[dict], kind: str, now: str) -> list[dict]:
    """The verdicts written into the runtime book's Condition Instances, as the tab stands under the lock: a status that
    moved on its row (Resolved At stamped on every move for the Board's instances, on a satisfied one for the others),
    a new row for a condition the subject has none of yet; nothing for a verdict already written."""
    rid = s_(rid)
    snap = HE.ci_snapshot(reads, rid) if rid and verdicts else None
    if snap is None:
        return []
    heads = set(snap["heads"])
    recs: list[dict] = []
    done: set[tuple[str, str]] = set()
    for v in verdicts:
        cid, sub, st = s_(v.get("cid")), s_(v.get("sub")), s_(v.get("status"))
        if not cid or not st or (cid, sub) in done:
            continue
        done.add((cid, sub))
        was = HE.ci_seen(snap, cid, sub)
        if was is not None:
            if was["status"] == st:
                continue
            cells = {"Status": st}
            if "Resolved At" in heads and (kind == "matrix" or st == "satisfied"):
                cells["Resolved At"] = now
            if was["id"] and snap["ids"][was["id"]] == 1:
                match, key = HE.CI_MATCH, was["id"]
            else:
                match, key = "row", f"r{was['row']}"
            recs.append(W.kept_record(rid, snap["tab"], "edit", match, key, "", cells,
                                      before={"Status": was["status"]}))
            continue
        if HE.CI_ID not in heads:
            continue
        cells = {h: val for h, val in _new_row(kind, v, now).items() if h in heads and val != ""}
        recs.append(W.kept_record(rid, snap["tab"], "append", HE.CI_MATCH, cells[HE.CI_ID], "", cells))
    return recs


# ---- a run ended -----------------------------------------------------------------------------------------------------

def end_run(sess: L.Session, cid: str, cand: dict, reason: str, stage: str, by: str,
            now: str) -> tuple[list[dict], dict[str, Any]]:
    """A run ended: hubSetStatus_(cid, 'Not Hiring', by), then hiringArchiveAndTell_ — the archive marks on the card and
    the team's letter through Smart Comms (hiring_candidate_left). interviewSave's Decline and the Board's terminal rule
    end a run this one way; the callers check the card is still open at its stage, so no run is ended twice."""
    actor = HH.as_actor(sess, by)
    recs = CW.status_move(actor, cid, cand, "Not Hiring", "", now)
    run = HOW.Run(actor)
    run.now = now
    done = HOW.archive_and_tell(run, cid, cand, reason, stage)
    return recs + run.recs, done


def end_by_rule(sess: L.Session, end: dict[str, Any], now: str) -> list[dict] | None:
    """hiringTerminalEndsRun_'s write: the card read again as it stands, still open at the rule's stage and still a
    terminal decline by the Board's cell and by the word, then its run ended; None when it no longer is."""
    reads = sess.reads
    cid, condition = s_(end.get("cid")), s_(end.get("condition"))
    rule = HE.TERMINAL_ENDS_RUN.get(condition)
    if not rule or not cid:
        return None
    ev = dict(CND.evidence(reads, cid))
    cand = ev.get("cand")
    if not cand or s_(cand.get("archived")).lower() == "true" or CND.stage_of(cand.get("status")) != rule["stage"]:
        return None
    row = next((c for c in CND.matrix_tab(reads, "board", "Conditions") if s_(c.get("Condition ID")) == condition),
               None)
    if row is None or not HE.terminal_is_the_word(row, rule, CND.facts_from_evidence(reads, "board", ev)):
        return None
    iv = CND._evidence_interview(reads, ev) or {}
    reason = ("Interview declined" + (" by " + s_(iv.get("interviewername"))[:120] if s_(iv.get("interviewername"))
                                      else "")
              + (" — score " + s_(iv.get("score")) if s_(iv.get("score")) else "")
              + " · the run ended on the Board rule " + condition)
    recs, _told = end_run(sess, cid, cand, reason, rule["stage"], END_BY, now)
    return recs


# ---- the clock's writes ----------------------------------------------------------------------------------------------

def conditions_sweep(sess: L.Session, payload: dict) -> Decision:
    """hiringConditionsSweepMaybe_'s write, after hiringConditionsDue: the Board's decline rule moved once; a pass with
    nothing moved stamped; else the candidates' instances written, the runs a terminal decline ends ended, the cursor
    moved — and once an hour the data books' migration verdicts."""
    if not HH.service(sess):
        return Decision(dict(HE.SERVICE_ONLY))
    plan, refused = _prepared(payload, "hiringConditionsDue", "service", "hiringConditionsSweep")
    if refused:
        return refused
    reads = sess.reads
    if plan.get("off"):
        return Decision({"status": 200, "data": {"swept": False, "off": True}})
    now, now_ms = W.now_iso(reads), int(CND.now_ms(reads))
    recs: list[dict] = []
    out: dict[str, Any] = {"swept": True}
    if plan.get("decline_failed") and HE.said_once("board_decline_rule_failed"):
        log.warning("matrix-engine: board_decline_rule_failed — %s", s_(plan["decline_failed"]))
    dec = plan.get("decline") or {}
    if dec.get("done"):
        if dec.get("write"):
            recs.append(W.kept_record(s_(dec["book"]), s_(dec["tab"]), "edit", W.COLS + "Condition ID",
                                      HE.DECLINE_CONDITION, "", {"Terminal Rule": HE.DECLINE_AFTER},
                                      before={"Terminal Rule": HE.DECLINE_BEFORE}))
        HH.mark_set(HE.DECLINE_MARK, now)
        if dec.get("write"):
            said = HE.DECLINE_CONDITION + ".Terminal Rule now reads " + HE.DECLINE_AFTER + \
                " — a Decline ends the run, Hold stays open"
        elif dec.get("found"):
            said = s_(dec.get("kept")) or "the cell already carries the decline rule — nothing written"
        else:
            said = HE.DECLINE_CONDITION + " is not on the board — nothing written"
        log.info("matrix-engine: %s — %s", "board_decline_rule_kept" if dec.get("kept") else "board_decline_rule_moved",
                 said)
        out["decline_rule"] = "moved" if dec.get("write") else "kept" if dec.get("kept") else "unchanged"
    if plan.get("skip"):
        stamp(reads, "hiring", {"units": 0, "wrote": 0, "ms": 0, "notes": SKIP_NOTE})
        return _done({"status": 200, "data": {**out, "skipped": True}}, recs)
    if plan.get("mark"):
        HH.mark_set("ENGINE_MARK_HIRING", s_(plan["mark"]))
    hp = plan.get("hiring") or {}
    got = ci_records(reads, hp.get("rid"), hp.get("verdicts") or [], "matrix", now)
    recs += got
    ended = 0
    cur = W.HELD.get()
    for end in hp.get("ends") or []:
        try:
            with SC._guard(cur):
                more = end_by_rule(sess, end, now)
        except (hubdb.Unreadable, Defer):
            raise
        except Exception as exc:  # noqa: BLE001 - said once per candidate; the next pass tries again
            if HE.said_once("terminal_end_failed_" + s_(end.get("cid"))):
                log.warning("matrix-engine: terminal_end_run_failed — %s — %s", s_(end.get("cid")),
                            (str(exc) or type(exc).__name__)[:200])
            continue
        if more is not None:
            recs += more
            ended += 1
    cursor = hp.get("cursor") or {}
    if cursor.get("of"):
        HH.mark_set(HE.HIRING_CURSOR, str(cursor["to"]))
    if got:
        log.info("matrix-instances: condition_instances_materialized — %d instance(s) written or moved across %d "
                 "subject(s)", len(got), int(hp.get("seen") or 0))
    if ended:
        log.info("matrix-engine: terminal_ended_runs — %d candidate(s) left the process on a terminal decline", ended)
    out.update(wrote=len(got), ended=ended, examined=int(cursor.get("units") or 0))
    mp = plan.get("migration")
    if mp is not None:
        HH.mark_set(HE.DATA_GATE, str(now_ms))
        mig = ci_records(reads, mp.get("rid"), mp.get("verdicts") or [], "migration", now)
        recs += mig
        if mp.get("cursor"):
            HH.mark_set(HE.MIGRATION_CURSOR, str(mp["cursor"]["to"]))
            stamp(reads, "migration", {**mp["cursor"], "wrote": len(mig), "ms": mp.get("ms")})
        if mig:
            log.info("matrix-instances: migration_instances_materialized — %d migration verdict(s) written or moved "
                     "across %d book(s)", len(mig), int(mp.get("judged") or 0))
        out["migration_wrote"] = len(mig)
    return _done({"status": 200, "data": out}, recs)


def rounds_trim_sweep(sess: L.Session, payload: dict) -> Decision:
    """engineRoundsTrimMaybe_: the ledger kept to its two thousand newest rounds."""
    if not HH.service(sess):
        return Decision(dict(HE.SERVICE_ONLY))
    reads = sess.reads
    cur = RR._cur()
    cur.execute(f"select count(*) from {HE.ROUNDS}")
    over = int((cur.fetchone() or (0,))[0] or 0) - HE.ROUNDS_MAX
    if over > 0:
        cur.execute(f"delete from {HE.ROUNDS} where id in (select id from {HE.ROUNDS} order by id limit %s)", (over,))
    HH.mark_set(HE.TRIM_GATE, str(int(CND.now_ms(reads))))
    return _done({"status": 200, "data": {"trimmed": max(over, 0)}}, [])


def _flow_records(reads: L.Reads, fp: dict[str, Any], now: str, name: str, kind: str) -> tuple[list[dict], int]:
    """flowConditionsSweepRun_'s / runtimeConditionsSweepRun_'s writes: the verdicts, the cursor, the round."""
    cursor = fp.get("cursor") or None
    if fp.get("covered") and cursor:
        HH.mark_set(HE.RUNTIME_CURSOR, str(cursor["to"]))
        stamp(reads, name, {**cursor, "units": 0, "wrote": 0, "ms": 0, "notes": COVERED_NOTE})
        return [], 0
    recs = ci_records(reads, fp.get("rid"), fp.get("verdicts") or [], kind, now)
    if cursor:
        HH.mark_set(HE.FLOW_CURSOR if name == "flow" else HE.RUNTIME_CURSOR, str(cursor["to"]))
        stamp(reads, name, {**cursor, "wrote": len(recs), "ms": fp.get("ms")})
    if fp.get("unread"):
        log.info("%s: %d book(s) not in the copy were not judged: %s", "flow-engine" if name == "flow" else
                 "runtime-engine", len(fp["unread"]), ", ".join(fp["unread"])[:300])
    if recs:
        if name == "flow":
            log.info("flow-engine: flow_instances_materialized — %d verdict(s) written or moved across %d book(s); %d "
                     "rule(s) unanswerable by the clock", len(recs), int(fp.get("judged") or 0),
                     int(fp.get("skipped") or 0))
        else:
            log.info("runtime-engine: runtime_conditions_judged — %d verdict(s) across %d data book(s); %d rule(s) "
                     "unanswerable by the clock", len(recs), int(fp.get("judged") or 0), int(fp.get("skipped") or 0))
    return recs, len(recs)


def _engine_sweep(sess: L.Session, payload: dict, look: str, door: str, name: str, kind: str) -> Decision:
    if not HH.service(sess):
        return Decision(dict(HE.SERVICE_ONLY))
    plan, refused = _prepared(payload, look, "service", door)
    if refused:
        return refused
    reads = sess.reads
    if plan.get("skip"):
        stamp(reads, name, {"units": 0, "wrote": 0, "ms": 0, "notes": SKIP_NOTE})
        return _done({"status": 200, "data": {"skipped": True}}, [])
    if plan.get("mark"):
        HH.mark_set("ENGINE_MARK_" + name.upper(), s_(plan["mark"]))
    recs, wrote = _flow_records(reads, plan, W.now_iso(reads), name, kind)
    return _done({"status": 200, "data": {"wrote": wrote, "judged": int(plan.get("judged") or 0),
                                          "covered": bool(plan.get("covered"))}}, recs)


def flow_sweep(sess: L.Session, payload: dict) -> Decision:
    """flowConditionsSweepMaybe_'s write, after flowConditionsDue."""
    return _engine_sweep(sess, payload, "flowConditionsDue", "flowConditionsSweep", "flow", "flow")


def runtime_sweep(sess: L.Session, payload: dict) -> Decision:
    """runtimeConditionsSweepMaybe_'s write, after runtimeConditionsDue."""
    return _engine_sweep(sess, payload, "runtimeConditionsDue", "runtimeConditionsSweep", "runtime", "runtime")


def _schema_records(reads: L.Reads, sp: dict[str, Any], now: str) -> tuple[list[dict], int]:
    """flowSchemaSweepRun_'s writes: each changed header appended to the runtime's Facts (the newest fact per tab read
    again under the lock), the cursor, the round."""
    rid = s_(sp.get("rid"))
    recs: list[dict] = []
    if rid and sp.get("facts"):
        have: dict[str, str] = {}
        for _sub, val, src in CND.facts(reads, "schema:"):
            if src.endswith(".header"):
                have[src] = val
        for f in sp["facts"]:
            src = "schema:" + s_(f.get("tab")) + ".header"
            if have.get(src) == f.get("body"):
                continue
            evidence = CW.EVIDENCE + str(uuid.uuid4())
            cells = {"Fact Key": "schema." + s_(f.get("tab")) + ".header", "Subject ID": "__schema",
                     "Value": gsjs.or_blank(f.get("body")), "Source": src, "Evidence": evidence, "Recorded At": now,
                     "Recorded By": "flow-engine"}
            recs.append(W.kept_record(rid, hubdb.FACTS_TAB, "append", CW.FACT_MATCH,
                                      "\x1f".join(("__schema", src, evidence)), "", cells))
            have[src] = gsjs.or_blank(f.get("body"))
    cursor = sp.get("cursor")
    if cursor:
        HH.mark_set(HE.SCHEMA_CURSOR, str(cursor["to"]))
        stamp(reads, "schema-feed", {**cursor, "wrote": len(recs), "ms": sp.get("ms")})
    if sp.get("unread"):
        log.info("flow-engine: %d data tab(s) not in the copy were not fed: %s", len(sp["unread"]),
                 ", ".join(sp["unread"])[:300])
    if recs:
        log.info("flow-engine: schema_headers_fed — %d header(s) written across %d data book(s)", len(recs),
                 int(sp.get("walked") or 0))
    return recs, len(recs)


def schema_sweep(sess: L.Session, payload: dict) -> Decision:
    """flowSchemaSweepMaybe_'s write, after flowSchemaDue: the gate set for six hours, the headers fed."""
    if not HH.service(sess):
        return Decision(dict(HE.SERVICE_ONLY))
    plan, refused = _prepared(payload, "flowSchemaDue", "service", "flowSchemaSweep")
    if refused:
        return refused
    reads = sess.reads
    HH.mark_set(HE.SCHEMA_GATE, str(int(CND.now_ms(reads))))
    recs, fed = _schema_records(reads, plan, W.now_iso(reads))
    return _done({"status": 200, "data": {"schema_fed": fed}}, recs)


# ---- the doors a person presses -------------------------------------------------------------------------------------

def flow_sweep_now(sess: L.Session, payload: dict) -> Decision:
    """flowSweepNow: the rest's conditions judged now and the schema feeder while its six hours have passed, after
    flowSweepNowPrepare read them."""
    user = sess.user or {}
    if not HE.gate(user):
        return Decision(dict(HE.DENIED))
    plan, refused = _prepared(payload, "flowSweepNowPrepare", RC.actor(user), "flowSweepNow")
    if refused:
        return refused
    reads = sess.reads
    now = W.now_iso(reads)
    recs, wrote = _flow_records(reads, plan.get("flow") or {}, now, "flow", "flow")
    fed = 0
    if plan.get("schema") is not None:
        HH.mark_set(HE.SCHEMA_GATE, str(int(CND.now_ms(reads))))
        more, fed = _schema_records(reads, plan["schema"], now)
        recs += more
    log.info("%s: flow_sweep_now — %d verdict(s), %d schema header(s)", s_(user.get("email")), wrote, fed)
    return _done({"status": 200, "data": {"wrote": wrote, "schema_fed": fed}}, recs)


def runtime_sweep_now(sess: L.Session, payload: dict) -> Decision:
    """runtimeSweepNow: the data books judged now, after runtimeSweepNowPrepare read them."""
    user = sess.user or {}
    if not HE.gate(user):
        return Decision(dict(HE.DENIED))
    plan, refused = _prepared(payload, "runtimeSweepNowPrepare", RC.actor(user), "runtimeSweepNow")
    if refused:
        return refused
    reads = sess.reads
    recs, wrote = _flow_records(reads, plan, W.now_iso(reads), "runtime", "runtime")
    log.info("%s: runtime_sweep_now — %d verdict(s) over %d data book(s)", s_(user.get("email")), wrote,
             int(plan.get("books") or 0))
    return _done({"status": 200, "data": {"wrote": wrote, "books": int(plan.get("books") or 0)}}, recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "hiringConditionsSweep": conditions_sweep, "engineRoundsTrimSweep": rounds_trim_sweep,
    "flowConditionsSweep": flow_sweep, "flowSchemaSweep": schema_sweep, "runtimeConditionsSweep": runtime_sweep,
    "flowSweepNow": flow_sweep_now, "runtimeSweepNow": runtime_sweep_now}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY.update({a: {"roles": ("admin", "manager")} for a in ("flowSweepNow", "runtimeSweepNow")})
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
