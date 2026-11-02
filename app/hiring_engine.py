"""The matrix's conditions engine on Python, its reads: what HiringMatrix.gs hiringConditionsSweepMaybe_ ran (the
Board's decline rule moved once, each candidate's conditions materialized, a run ended on a terminal decline, the data
books' migration verdicts), FlowEngine.gs (the rest's conditions, the schema feeder, the Rounds ledger and its trim,
flowEval and flowStatus) and RuntimeEngine.gs (the data books' conditions). Each clock pass is a look (…Due, the relay's
own) that judges, and a write (hiring_engine_writes) that records the verdicts in the runtime book's Condition Instances
through app.edits; a person's sweep is a prepare read before its write. The Registry is read directly, never through a
compiled copy; the cursors and marks Apps Script kept in Script Properties are app.hiring_marks, the Rounds ledger is
app.hiring_engine_rounds (db/hiring_engine.sql)."""
from __future__ import annotations

import functools
import json
import logging
import math
import re
import threading
import time
from collections import Counter
from typing import Any, Callable

import candidates as CND
import gsjs
import hiring_flow as HF
import hiring_hired as HH
import house_tables as HT
import hubdb
import locations as L
import recon as RC
import writes as W
from scope import Defer

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_

APP_ID = "hiring"
DENIED = dict(HH.DENIED)
SERVICE_ONLY = dict(HH.SERVICE_ONLY)
# flowRuntimeId_: the platform's own runtime, the Essencial
RUNTIME_PROP = "HUB_APPS_RUNTIME_ID"
# FLOW_FOREIGN_CONTEXTS: the contexts hiring's engine owns
FOREIGN = frozenset({"board", "hiring", "template"})
# RUNTIME_CTX_PREFIX: the data books the runtime engine judges
DATA_PREFIX = "data."
CI_TAB = "Condition Instances"
CI_ID = "Condition Instance ID"
CI_MATCH = W.COLS + CI_ID
ROUNDS = "app.hiring_engine_rounds"
ROUNDS_MAX = 2000
ROUNDS_WINDOW = 200
RUNNER = "python"
# ENGINE_PASS_CAP, ENGINE_BUDGET_MS, ENGINE_IDLE_FLOOR_MS
PASS_CAP = 15
HIRING_CAP = 200
BUDGET_S = 45.0
DUE_BUDGET_S = 95.0
IDLE_FLOOR_MS = 600000.0
RANGE_WITHIN_MS = 300000.0
DATA_EVERY_S, SCHEMA_EVERY_S, TRIM_EVERY_S, SAID_EVERY_S = 3600.0, 21600.0, 3600.0, 21600.0
# the cursors and marks Apps Script kept in Script Properties, and its cache gates kept beside them (epoch ms)
HIRING_CURSOR, MIGRATION_CURSOR, FLOW_CURSOR, RUNTIME_CURSOR, SCHEMA_CURSOR = (
    "HIRING_JUDGE_CURSOR", "MIGRATION_JUDGE_CURSOR", "FLOW_JUDGE_CURSOR", "RUNTIME_JUDGE_CURSOR", "SCHEMA_FEED_CURSOR")
DECLINE_MARK = "HIRING_BOARD_DECLINE_RULE_MOVED"
DATA_GATE, SCHEMA_GATE, TRIM_GATE = "HIRING_DATA_CI_SWEPT_AT", "FLOW_SCHEMA_SWEPT_AT", "ENGINE_ROUNDS_TRIMMED_AT"
# THE BOARD'S DECLINE RULE, MOVED ONCE IN THE LIVE BOOK
DECLINE_CONDITION = "hiring.interview_recommendation"
DECLINE_BEFORE = '{"fact":"hiring.interview.recommendation","present_and_not_equals_ci":"advance"}'
DECLINE_AFTER = '{"fact":"hiring.interview.recommendation","equals_ci":"decline"}'
# HIRING_TERMINAL_ENDS_RUN: a decline at the in-person interview ends the whole process
TERMINAL_ENDS_RUN = {DECLINE_CONDITION: {"stage": "interview", "fact": "hiring.interview.recommendation",
                                         "word": "decline"}}
DATA_NOTE = re.compile(r"data:\s*([A-Za-z0-9_]+)")
DUE_DOORS = ("hiringConditionsDue", "engineRoundsTrimDue", "flowConditionsDue", "flowSchemaDue", "runtimeConditionsDue")


def gate(user: dict | None) -> bool:
    """The engine doors' gate: the relay's identity, an admin or a manager."""
    u = user or {}
    return bool(u) and (u.get("is_service") is True or s_(u.get("role")) in ("admin", "manager"))


# ---- said once (CacheService's gates for a log line) -----------------------------------------------------------------

_SAID: dict[str, float] = {}
_SAID_LOCK = threading.Lock()


def said_once(key: str, every_s: float = SAID_EVERY_S) -> bool:
    """True the first time in `every_s` this process meets the key."""
    now = time.time()
    with _SAID_LOCK:
        if now - _SAID.get(key, 0.0) < every_s:
            return False
        _SAID[key] = now
        return True


# ---- the rule grammar (hiringRuleOk_ / flowRuleOk_), with JavaScript's patterns --------------------------------------

@functools.lru_cache(maxsize=512)
def js_pattern(src: str) -> re.Pattern | None:
    """new RegExp(src): JavaScript's $ (the input's end alone), its named groups and its ASCII classes; None when the
    pattern does not compile."""
    out: list[str] = []
    i, in_class = 0, False
    while i < len(src):
        ch = src[i]
        if ch == "\\" and i + 1 < len(src):
            out.append(src[i:i + 2])
            i += 2
            continue
        if in_class:
            in_class = ch != "]"
            out.append(ch)
        elif ch == "[":
            in_class = True
            out.append(ch)
        elif ch == "$":
            out.append(r"\Z")
        elif src.startswith("(?<", i) and src[i + 3:i + 4] not in ("=", "!"):
            out.append("(?P<")
            i += 3
            continue
        else:
            out.append(ch)
        i += 1
    try:
        return re.compile("".join(out), re.ASCII)
    except (re.error, ValueError, OverflowError):
        return None


def compare(rule: dict, got: Any, facts: dict[str, Any], engine: str) -> bool:
    """hiringCompare_ / flowCompare_: the comparator table; a pattern tested as JavaScript tests it, and an operator
    the engine does not implement read as not satisfied, said once."""
    first = next((op for op in CND._RULE_OPS if op in rule), None)
    if first == "matches":
        rx = js_pattern(gsjs.js_str(rule["matches"]))
        return bool(rx is not None and rx.search("" if got is None else gsjs.js_str(got)))
    if first is None:
        op = next((k for k in rule if k not in ("fact", "otherwise")), None)
        if op is not None:
            fact = gsjs.js_str(rule.get("fact"))
            if said_once(f"rule_op_unknown:{engine}:{op}:{fact}"[:240]):
                log.warning("%s: rule_operator_unknown — the rule on %s uses \"%s\", which this engine does not "
                            "implement — read as NOT satisfied", engine, fact, op)
            return False
    return CND._compare(rule, got, facts)


def rule_ok(rule: Any, facts: dict[str, Any], engine: str) -> bool:
    """hiringRuleOk_ / flowRuleOk_: {"fact",<op>}, {"all":[…]}, {"any":[…]}; blank is true, broken is false."""
    if rule is None or rule == "":
        return True
    if isinstance(rule, str):
        t = rule.strip()
        if not t:
            return True
        try:
            rule = json.loads(t)
        except ValueError:
            return False
    if not isinstance(rule, dict):
        return False
    if "all" in rule:
        return all(rule_ok(x, facts, engine) for x in (rule["all"] or []))
    if "any" in rule:
        return any(rule_ok(x, facts, engine) for x in (rule["any"] or []))
    if "fact" in rule:
        return compare(rule, facts.get(gsjs.js_str(rule["fact"])), facts, engine)
    return False


def condition_status(row: dict, facts: dict[str, Any], engine: str) -> str:
    """hiringConditionStatus_ / flowConditionStatus_: satisfied | open | not_applicable | failed | terminal."""
    app = s_(row.get("Applicability Rule"))
    if app and not rule_ok(app, facts, engine):
        return "not_applicable"
    if s_(row.get("Terminal Rule")) and rule_ok(row.get("Terminal Rule"), facts, engine):
        return "terminal"
    if s_(row.get("Failure Rule")) and rule_ok(row.get("Failure Rule"), facts, engine):
        return "failed"
    sat = s_(row.get("Satisfies Rule"))
    if not sat:
        return "satisfied"
    return "satisfied" if rule_ok(sat, facts, engine) else "open"


# ---- the Registry and the books (flowRegistry_, flowTab_) ------------------------------------------------------------

def runtime_id(reads: L.Reads) -> str:
    """flowRuntimeId_."""
    return gsjs.trim(reads.db.prop(RUNTIME_PROP))


def hub_runtime_id(reads: L.Reads) -> str:
    """hubRuntimeId_: ours, else hiring's."""
    return runtime_id(reads) or gsjs.trim(reads.db.prop("HUB_HIRING_RUNTIME_ID"))


def flow_registry(reads: L.Reads) -> dict[str, dict[str, str]]:
    """flowRegistry_: the platform runtime's Registry, Context → {id, status, note, app}; hiring's contexts left out,
    the first row of a context winning."""
    def read() -> dict[str, dict[str, str]]:
        rid = runtime_id(reads)
        out: dict[str, dict[str, str]] = {}
        got = CND._book_rows(reads, rid, HF.REGISTRY_TAB) if rid else None
        if got is None:
            return out
        heads, rows = got
        if "Context" not in heads or "Spreadsheet ID" not in heads or "Status" not in heads:
            return out
        i_ctx, i_id, i_st = heads.index("Context"), heads.index("Spreadsheet ID"), heads.index("Status")
        i_note = heads.index("Notes") if "Notes" in heads else -1
        i_app = heads.index("App") if "App" in heads else -1

        def cell(line: list, i: int) -> str:
            return gsjs.trim(gsjs.or_text(line[i])) if 0 <= i < len(line) else ""
        for line in rows:
            ctx = cell(line, i_ctx).lower()
            if not ctx or ctx.startswith("#") or ctx in out or ctx in FOREIGN:
                continue
            app = cell(line, i_app).lower() or re.split(r"[-.]", ctx)[0]
            out[ctx] = {"id": cell(line, i_id), "status": cell(line, i_st).lower(), "note": cell(line, i_note),
                        "app": app}
        return out
    return reads.once("heng:flow_registry", read)


def flow_mode(reads: L.Reads, context: Any) -> dict[str, str]:
    """flowBookMode_."""
    want = gsjs.trim(gsjs.or_text(context)).lower()
    row = flow_registry(reads).get(want) if want else None
    return {"id": row["id"], "status": row["status"], "app": row["app"]} if row else {"id": "", "status": "", "app": ""}


def book_tab(reads: L.Reads, sid: str, tab: str) -> list[dict[str, str]]:
    """flowBookTab_ / hiringBookTab_: a book's tab as rows of String() cells, blank rows dropped; [] for no such tab."""
    def read() -> list[dict[str, str]]:
        got = CND._book_rows(reads, sid, tab)
        if got is None:
            return []
        heads, rows = got
        out = []
        for line in rows:
            row: dict[str, str] = {}
            anyv = False
            for j, h in enumerate(heads):
                if not h:
                    continue
                v = gsjs.or_blank(line[j]) if j < len(line) else ""
                anyv = anyv or bool(v)
                row[h] = v
            if anyv:
                out.append(row)
        return out
    return reads.once(f"heng:tab:{sid}:{tab}", read)


def flow_tab(reads: L.Reads, context: str, tab: str) -> list[dict[str, str]]:
    """flowTab_: one matrix tab of an 'on' or 'shadow' context."""
    mode = flow_mode(reads, context)
    if not mode["id"] or mode["status"] not in ("on", "shadow"):
        return []
    return book_tab(reads, mode["id"], tab)


def tab_home(reads: L.Reads, tab: str) -> str:
    """hubTabHomeId_."""
    key = hubdb.HUB_TAB_HOME.get(tab)
    return s_(reads.db.prop(key)) if key else ""


def platform_facts(reads: L.Reads, context: str, note: Any) -> dict[str, Any]:
    """flowPlatformFacts_: what the platform itself can answer about a data book — whether its tab dissolved, moved."""
    facts: dict[str, Any] = {"context": gsjs.or_blank(context)}
    m = DATA_NOTE.search(gsjs.or_text(note))
    tab = m.group(1) if m else ""
    if not tab:
        return facts
    facts["tab"] = tab
    try:
        kv = reads.db.switchboard("dissolved")
        dissolved = hubdb.HubDb.on(kv.get("*")) or hubdb.HubDb.on(kv.get(tab))
    except hubdb.Unreadable:
        dissolved = False
    facts[tab + ".dissolved"] = dissolved
    try:
        home = tab_home(reads, tab)
    except hubdb.Unreadable:
        home = ""
    facts[tab + ".moved_home"] = bool(home)
    facts[tab + ".migrated"] = dissolved or bool(home)
    return facts


def context_facts(reads: L.Reads, subject: str, context: str, note: Any) -> dict[str, Any]:
    """flowSubjectFacts_(subject) with the platform's own facts under them."""
    facts = HF.subject_facts(reads, subject, "")
    for k, v in platform_facts(reads, context, note).items():
        facts.setdefault(k, v)
    return facts


# ---- the engine's state: the marks, the gates, the idleness signal, the Rounds ledger --------------------------------

def cursor_of(reads: L.Reads, key: str) -> int:
    """parseInt(hubProp_(key) || '0', 10) || 0."""
    n = CND.js_parse_int(HH.mark(reads, key) or "0")
    return 0 if math.isnan(n) else max(int(n), 0)


def gate_open(reads: L.Reads, key: str, every_s: float) -> bool:
    """A CacheService gate: open when its mark is older than its period (or was never set)."""
    at = CND.js_parse_int(HH.mark(reads, key))
    return math.isnan(at) or CND.now_ms(reads) - at >= every_s * 1000.0


def facts_count(reads: L.Reads) -> int:
    """The runtime's Facts getLastRow(): the copy's rows, the header and the facts Python appended since; the Facts
    kept in their own table, its rows and the header."""
    rid, ref = CND.facts_ref(reads)
    if reads.db.facts_kept(ref):
        got = reads.db.query(f"select count(*) from {reads.db.from_sql(ref)} t")  # noqa: S608
        return int(got[0][0] or 0) + 1 if got else 1
    groups = (getattr(hubdb.OWN.get(), "edits", None) or {}).get((rid, ref.tab)) or ()
    return max(ref.row_count, 0) + 1 + sum(1 for g in groups if g.get("appended"))


def nothing_moved(reads: L.Reads, name: str) -> tuple[bool, str]:
    """engineNothingMoved_: (skip, the mark a judging pass writes) — the Facts not grown since this engine last judged
    and the floor not expired; an unreadable signal judges, never skips."""
    try:
        count = facts_count(reads)
        was = HH.mark(reads, "ENGINE_MARK_" + name.upper()).split("|")
    except (hubdb.Unreadable, Defer):
        return False, ""
    now = CND.now_ms(reads)
    last_count = CND.js_parse_int(was[0])
    last_at = CND.js_parse_int(was[1] if len(was) > 1 else "")
    if not math.isnan(last_at) and now - last_at < IDLE_FLOOR_MS and not math.isnan(last_count) \
            and int(last_count) == count:
        return True, ""
    return False, f"{count}|{int(now)}"


def rounds(reads: L.Reads) -> list[dict[str, Any]]:
    """engineRounds_: the newest two hundred rounds on the ledger, oldest first; [] when it cannot be read."""
    try:
        got = reads.db.query(f"select slice, from_n, to_n, finished_at from {ROUNDS} order by id desc limit %s",
                             (ROUNDS_WINDOW,))
    except hubdb.Unreadable:
        return []
    return [{"slice": s_(a), "from": b, "to": c, "finished_at": d} for a, b, c, d in reversed(got)]


def range_covered(reads: L.Reads, name: str, frm: int, to: int, within_ms: float) -> bool:
    """engineRangeCovered_: a round of this slice, recent enough, already walked [frm, to] (a wrapped window covers
    from its start to the end and from 0 to its end)."""
    floor = CND.now_ms(reads) - within_ms
    for r in rounds(reads):
        if r["slice"] != name or r["from"] is None or r["to"] is None or r["finished_at"] is None:
            continue
        at = r["finished_at"].timestamp() * 1000.0 if hasattr(r["finished_at"], "timestamp") else math.nan
        if math.isnan(at) or at < floor:
            continue
        rf, rt = int(r["from"]), int(r["to"])
        if (frm >= rf and to <= rt) if rf <= rt else (frm >= rf or to <= rt):
            return True
    return False


def rounds_count(reads: L.Reads) -> int:
    try:
        got = reads.db.query(f"select count(*) from {ROUNDS}")
    except hubdb.Unreadable:
        return 0
    return int(got[0][0] or 0) if got else 0


# ---- the runtime book's Condition Instances --------------------------------------------------------------------------

def ci_snapshot(reads: L.Reads, rid: str) -> dict[str, Any] | None:
    """hiringConditionsSnapshot_: the runtime book's Condition Instances as the copy and Python's own kept edits hold
    them — each (Condition ID, Subject ID) → its last row's status, id and sheet row; None when the tab or its columns
    are missing (an unreadable tab writes nothing)."""
    def read() -> dict[str, Any] | None:
        ref = HT.tab_of(reads, rid, CI_TAB, "the runtime's Condition Instances") if rid else None
        if ref is None:
            return None
        heads = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
        if any(h not in heads for h in ("Condition ID", "Subject ID", "Status")):
            return None

        def cell(raw: dict, name: str) -> str:
            h = heads.get(name)
            return s_(raw.get(h)) if h is not None else ""
        rows = reads.db.rows(ref)
        at: dict[tuple[str, str], dict[str, Any]] = {}
        ids: Counter = Counter()
        for rn, raw in rows:
            cid = cell(raw, CI_ID)
            ids[cid] += 1
            at[(cell(raw, "Condition ID"), cell(raw, "Subject ID"))] = {"status": cell(raw, "Status"), "id": cid,
                                                                       "row": rn}
        return {"sid": rid, "tab": ref.tab, "heads": list(heads), "at": at, "ids": ids}
    return reads.once("heng:ci:" + rid, read)


def ci_seen(snap: dict[str, Any], cid: str, sub: str) -> dict[str, Any] | None:
    return snap["at"].get((cid, sub))


# ---- the hiring conditions sweep (hiringConditionsSweepMaybe_) -------------------------------------------------------

def decline_plan(reads: L.Reads) -> dict[str, Any]:
    """hiringBoardDeclineRuleOnce_'s reading: whether the Board's decline rule still reads the old words, and the cell
    to move — once, on the machine lane; words somebody else wrote there stand."""
    cur = None
    for c in CND.matrix_tab(reads, "board", "Conditions"):
        if s_(c.get("Condition ID")) == DECLINE_CONDITION:
            cur = s_(c.get("Terminal Rule"))
    if cur is None:
        return {"done": False, "reason": "the board carries no such condition"}
    if cur == DECLINE_AFTER or s_(HH.mark(reads, DECLINE_MARK)):
        return {"done": False, "reason": "already"}
    book = s_((CND.registry(reads).get("board") or {}).get("id"))
    ref = reads.tab_of(book, "Conditions", "the board's Conditions") if book else None
    if ref is None:
        return {"done": False, "reason": "the board could not be opened"}
    heads = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
    if "Condition ID" not in heads or "Terminal Rule" not in heads:
        return {"done": False, "reason": "the columns are not there"}
    write, kept, found = False, "", False
    for rn, raw in reads.db.rows(ref):
        if gsjs.trim(gsjs.or_blank(raw.get(heads["Condition ID"]))) != DECLINE_CONDITION:
            continue
        found = True
        words = gsjs.trim(gsjs.or_blank(raw.get(heads["Terminal Rule"])))
        if words == DECLINE_BEFORE:
            write = True
        elif words != DECLINE_AFTER:
            kept = (f"Conditions row {rn} ({DECLINE_CONDITION}.Terminal Rule) holds words somebody wrote, and they "
                    f"stand: {words}")
        break
    return {"done": True, "book": book, "tab": ref.tab, "write": write, "kept": kept, "found": found}


def terminal_is_the_word(row: dict, end: dict[str, str], facts: dict[str, Any], context: str = "board") -> bool:
    """hiringTerminalIsTheWord_: terminal by the Board's cell AND by the one ending word; a cell broader than the word
    closes nobody, said once."""
    if condition_status(row, facts, "matrix-engine") != "terminal":
        return False
    got = facts.get(end["fact"]) if facts else None
    if s_(got).lower() == end["word"]:
        return True
    if said_once(f"terminal_not_the_word_{context}_{s_(row.get('Condition ID'))}"):
        log.info("matrix-engine: terminal_rule_broader_than_the_word — %s.Terminal Rule reads terminal over \"%s\" — "
                 "only a \"%s\" ends a run, so nobody was closed on it: %s", s_(row.get("Condition ID")), s_(got),
                 end["word"], s_(row.get("Terminal Rule")))
    return False


def terminal_end(cand: dict, conditions: list[dict], facts: dict[str, Any]) -> dict[str, str] | None:
    """hiringTerminalEndsRun_'s reading: the first condition that ends this candidate's run at its stage."""
    cid = s_(cand.get("candidateid"))
    if not cid or s_(cand.get("archived")).lower() == "true":
        return None
    stage = CND.stage_of(cand.get("status"))
    for c in conditions:
        end = TERMINAL_ENDS_RUN.get(s_(c.get("Condition ID")))
        if not end or not stage or end["stage"] != stage:
            continue
        if terminal_is_the_word(c, end, facts):
            return {"cid": cid, "condition": s_(c.get("Condition ID"))}
    return None


def hiring_plan(reads: L.Reads, deadline: float) -> dict[str, Any]:
    """The materialization and the terminal ends over up to two hundred candidates from where the last pass stopped:
    each condition of the Board whose verdict differs from its instance, and each run a terminal decline ends."""
    cands = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB) or []
    n = len(cands)
    cursor = cursor_of(reads, HIRING_CURSOR)
    if n and cursor >= n:
        cursor = 0
    ordered = cands[cursor:] + cands[:cursor]
    rid = HF.runtime_for(reads, "board")
    snap = ci_snapshot(reads, rid) if rid else None
    conditions = CND.matrix_tab(reads, "board", "Conditions")
    verdicts: list[dict[str, Any]] = []
    ends: list[dict[str, str]] = []
    examined = seen = 0
    for cand in ordered[:HIRING_CAP]:
        if time.monotonic() > deadline:
            break
        examined += 1
        if s_(cand.get("archived")).lower() == "true":
            continue
        seen += 1
        subject = s_(cand.get("candidateid"))
        try:
            facts = CND.facts_from_evidence(reads, "board", {"cand": cand})
        except (hubdb.Unreadable, Defer):
            raise
        except Exception as exc:  # noqa: BLE001 - one candidate the engine cannot read writes nothing
            log.info("matrix-engine: %s not judged (%s)", subject, type(exc).__name__)
            continue
        if snap is not None and subject:
            for c in conditions:
                cid = s_(c.get("Condition ID"))
                if not cid:
                    continue
                st = condition_status(c, facts, "matrix-engine")
                if st == "not_applicable":
                    continue
                was = ci_seen(snap, cid, subject)
                if was is None or was["status"] != st:
                    verdicts.append({"cid": cid, "sub": subject, "status": st, "stage": s_(cand.get("status"))})
        end = terminal_end(cand, conditions, facts)
        if end:
            ends.append(end)
    return {"rid": rid, "verdicts": verdicts, "ends": ends, "seen": seen,
            "cursor": {"from": cursor, "to": (cursor + examined) % n if n else 0, "of": n, "units": examined}}


def migration_plan(reads: L.Reads, deadline: float) -> dict[str, Any]:
    """hiringDataConditionsSweepMaybe_'s reading: each data book of the Registry (every runtime's) judged migrated or
    not by the platform itself — dissolved, moved to its house, or homed in its book — fifteen books a pass."""
    started = time.monotonic()
    rid = hub_runtime_id(reads)
    snap = ci_snapshot(reads, rid) if rid else None
    reg = HF.registry(reads)
    order = sorted(reg)
    if snap is None or not order:
        return {"rid": rid, "verdicts": [], "cursor": None}
    cursor = cursor_of(reads, MIGRATION_CURSOR)
    if cursor >= len(order):
        cursor = 0
    verdicts: list[dict[str, Any]] = []
    walked = judged = 0
    for ctx in order[cursor:] + order[:cursor]:
        if judged >= PASS_CAP or time.monotonic() > deadline:
            break
        walked += 1
        row = reg.get(ctx)
        if not row or row.get("status") != "on":
            continue
        m = DATA_NOTE.search(s_(row.get("note")))
        if not m:
            continue
        tab = m.group(1)
        judged += 1
        try:
            moved = reads.db.house_moved(tab)
        except hubdb.Unreadable:
            moved = False
        if reads.db.dissolved(tab) or moved or tab_home(reads, tab):
            status = "satisfied"
        else:
            status = "open"
        was = ci_seen(snap, tab + ".migrated", tab)
        if was is None or was["status"] != status:
            verdicts.append({"cid": tab + ".migrated", "sub": tab, "status": status, "book": s_(row.get("id"))})
    return {"rid": rid, "verdicts": verdicts, "judged": judged,
            "cursor": {"from": cursor, "to": (cursor + walked) % len(order), "of": len(order), "units": walked},
            "ms": int((time.monotonic() - started) * 1000)}


def conditions_plan(reads: L.Reads) -> dict[str, Any]:
    """hiringConditionsSweepMaybe_'s reading, whole: off while the Board is not on; the decline rule moved once; a pass
    skipped (and stamped) when nothing moved; else the candidates judged, then the data books once an hour."""
    started = time.monotonic()
    mode = CND.registry(reads).get("board") or {}
    if mode.get("status") != "on":
        return {"due": 0, "off": True}
    plan: dict[str, Any] = {"due": 1}
    try:
        plan["decline"] = decline_plan(reads)
    except Exception as exc:  # noqa: BLE001 - said once by the write; the next pass tries again
        plan["decline_failed"] = (str(exc) or type(exc).__name__)[:300]
    skip, mark = nothing_moved(reads, "hiring")
    if skip:
        plan["skip"] = True
        return plan
    plan["mark"] = mark
    plan["hiring"] = hiring_plan(reads, started + BUDGET_S)
    if gate_open(reads, DATA_GATE, DATA_EVERY_S):
        plan["migration"] = migration_plan(reads, min(time.monotonic() + BUDGET_S, started + DUE_BUDGET_S))
    plan["ms"] = int((time.monotonic() - started) * 1000)
    return plan


# ---- the rest's conditions (flowConditionsSweepRun_) and the data books' (runtimeConditionsSweepRun_) ----------------

def judge_books(reads: L.Reads, reg: dict[str, dict], ordered: list[str], snap: dict[str, Any], deadline: float,
                engine: str) -> dict[str, Any]:
    """Each 'on' context's Conditions judged over the facts the runtime holds about it and the platform's own — a rule
    whose facts cannot all be answered here skipped, never guessed — fifteen books a pass at most."""
    verdicts: list[dict[str, Any]] = []
    walked = judged = skipped = 0
    unread: list[str] = []
    for ctx in ordered:
        if judged >= PASS_CAP or time.monotonic() > deadline:
            break
        walked += 1
        row = reg.get(ctx)
        if not row or row.get("status") != "on":
            continue
        try:
            conditions = flow_tab(reads, ctx, "Conditions")
        except hubdb.Unreadable:
            unread.append(ctx)
            continue
        if not conditions:
            continue
        judged += 1
        facts = context_facts(reads, ctx, ctx, row.get("note"))
        for c in conditions:
            cid = s_(c.get("Condition ID"))
            if not cid:
                continue
            if any(n not in facts for n in HF.rule_facts(c)):
                skipped += 1
                continue
            st = condition_status(c, facts, engine)
            if st == "not_applicable":
                continue
            was = ci_seen(snap, cid, ctx)
            if was is None or was["status"] != st:
                verdicts.append({"cid": cid, "sub": ctx, "status": st, "book": s_(row.get("id"))})
    return {"verdicts": verdicts, "walked": walked, "judged": judged, "skipped": skipped, "unread": unread}


def flow_plan(reads: L.Reads, idle: bool) -> dict[str, Any]:
    """flowConditionsSweepMaybe_'s reading (`idle`: skipped and stamped when nothing moved), else
    flowConditionsSweepRun_'s: fifteen books a pass, but not the same fifteen."""
    started = time.monotonic()
    mark = ""
    if idle:
        skip, mark = nothing_moved(reads, "flow")
        if skip:
            return {"due": 1, "skip": True}
    rid = runtime_id(reads)
    snap = ci_snapshot(reads, rid) if rid else None
    if snap is None:
        return {"due": 1 if mark else 0, "mark": mark}
    reg = flow_registry(reads)
    order = sorted(c for c in reg if not c.startswith(DATA_PREFIX))
    cursor = cursor_of(reads, FLOW_CURSOR)
    if cursor >= len(order):
        cursor = 0
    got = judge_books(reads, reg, order[cursor:] + order[:cursor], snap, started + BUDGET_S, "flow-engine")
    return {"due": 1, "mark": mark, "rid": rid, **got,
            "cursor": {"from": cursor, "to": (cursor + got["walked"]) % len(order) if order else 0, "of": len(order),
                       "units": got["walked"]},
            "ms": int((time.monotonic() - started) * 1000)}


def runtime_registry(reads: L.Reads) -> dict[str, dict[str, str]]:
    """runtimeRegistry_: the data books, the runtime engine's own."""
    return {c: r for c, r in flow_registry(reads).items() if c.startswith(DATA_PREFIX)}


def runtime_plan(reads: L.Reads, idle: bool) -> dict[str, Any]:
    """runtimeConditionsSweepMaybe_'s reading (`idle`), else runtimeConditionsSweepRun_'s: its own cursor, a window
    another runner already walked in the last five minutes skipped (and stamped)."""
    started = time.monotonic()
    mark = ""
    if idle:
        skip, mark = nothing_moved(reads, "runtime")
        if skip:
            return {"due": 1, "skip": True}
    rid = runtime_id(reads)
    snap = ci_snapshot(reads, rid) if rid else None
    reg = runtime_registry(reads)
    order = sorted(reg)
    if snap is None or not order:
        return {"due": 1 if mark else 0, "mark": mark, "books": len(reg)}
    cursor = cursor_of(reads, RUNTIME_CURSOR)
    if cursor >= len(order):
        cursor = 0
    window = min(PASS_CAP, len(order))
    if range_covered(reads, "runtime", cursor, cursor + window, RANGE_WITHIN_MS):
        return {"due": 1, "mark": mark, "covered": True, "books": len(reg),
                "cursor": {"from": cursor, "to": (cursor + window) % len(order), "of": len(order), "units": 0}}
    got = judge_books(reads, reg, order[cursor:] + order[:cursor], snap, started + BUDGET_S, "flow-engine")
    return {"due": 1, "mark": mark, "rid": rid, "books": len(reg), **got,
            "cursor": {"from": cursor, "to": (cursor + got["walked"]) % len(order), "of": len(order),
                       "units": got["walked"]},
            "ms": int((time.monotonic() - started) * 1000)}


# ---- the schema feeder (flowSchemaSweepRun_) -------------------------------------------------------------------------

def tab_header(reads: L.Reads, tab: str, prior: str | None) -> list[str] | None:
    """The header hubTabSheet_ hands the feeder: a dissolved tab's runtime sheet (its captured header, then every key
    its rows carry), else the tab where the router keeps it. The copy keeps a sheet's columns but not their order, so a
    header whose names did not change (the copy trims them) is the one already fed, as it was spelled, and new names
    follow the ones known; None when unread."""
    if reads.db.dissolved(tab):
        out: list[str] = []
        seen: set[str] = set()
        for h in CND.legacy_header(reads, tab) or []:
            k = hubdb.norm_key(h)
            if k and k not in seen:
                seen.add(k)
                out.append(gsjs.js_str(h))
        if not out:
            seen.add("candidateid")
            out.append("candidateid")
        for r in CND.legacy_rows(reads, tab) or []:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    out.append(k)
        return [h for h in out if gsjs.trim(h)]
    res = reads.db.resolve(tab)
    if res.ref is None:
        return None
    names = [hubdb.twin_base(gsjs.js_str(h)) for h in res.ref.headers]
    names = [h for h in names if gsjs.trim(h)]
    try:
        known = json.loads(prior) if prior else []
    except ValueError:
        known = []
    if not isinstance(known, list):
        known = []
    left = Counter(gsjs.trim(h) for h in names)
    ordered: list[str] = []
    for h in [gsjs.or_blank(x) for x in known] + names:
        if left[gsjs.trim(h)] > 0:
            left[gsjs.trim(h)] -= 1
            ordered.append(h)
    return ordered


def schema_plan(reads: L.Reads) -> dict[str, Any]:
    """flowSchemaSweepRun_'s reading: each 'on' data book's header, fed as the runtime's schema fact when it changed —
    fifteen data books a pass, the cursor moved by every context examined."""
    started = time.monotonic()
    rid = runtime_id(reads)
    if not rid:
        return {"facts": [], "cursor": None}
    have: dict[str, str] = {}
    for _sub, val, src in CND.facts(reads, "schema:"):
        if src.endswith(".header"):
            have[src] = val
    reg = flow_registry(reads)
    order = sorted(reg)
    if not order:
        return {"rid": rid, "facts": [], "cursor": None}
    cursor = cursor_of(reads, SCHEMA_CURSOR)
    if cursor >= len(order):
        cursor = 0
    facts: list[dict[str, str]] = []
    walked = examined = 0
    unread: list[str] = []
    for ctx in order[cursor:] + order[:cursor]:
        if walked >= PASS_CAP or time.monotonic() > started + BUDGET_S:
            break
        examined += 1
        row = reg[ctx]
        if row.get("status") != "on":
            continue
        m = DATA_NOTE.search(s_(row.get("note")))
        if not m:
            continue
        tab = m.group(1)
        walked += 1
        src = "schema:" + tab + ".header"
        try:
            hdr = tab_header(reads, tab, have.get(src))
        except hubdb.Unreadable:
            unread.append(tab)
            continue
        if not hdr:
            continue
        body = json.dumps(hdr, ensure_ascii=False, separators=(",", ":"))
        if have.get(src) == body:
            continue
        facts.append({"tab": tab, "body": body})
        have[src] = body
    return {"rid": rid, "facts": facts, "walked": walked, "unread": unread,
            "cursor": {"from": cursor, "to": (cursor + examined) % len(order), "of": len(order), "units": examined},
            "ms": int((time.monotonic() - started) * 1000)}


# ---- the doors -------------------------------------------------------------------------------------------------------

def _due(sess: L.Session, door: str, plan: Callable[[L.Reads], dict[str, Any]]) -> dict[str, Any]:
    if (sess.user or {}).get("is_service") is not True:
        return dict(SERVICE_ONLY)
    return {"status": 200, "data": RC.seal(door, "service", plan(sess.reads))}


def conditions_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringConditionsSweepMaybe_'s look on the relay's clock, sealed for hiringConditionsSweep."""
    return _due(sess, "hiringConditionsDue", conditions_plan)


def rounds_trim_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """engineRoundsTrimMaybe_'s look: the ledger past its two thousand rows, once an hour."""
    def plan(reads: L.Reads) -> dict[str, Any]:
        over = rounds_count(reads) - ROUNDS_MAX
        return {"due": max(over, 0) if gate_open(reads, TRIM_GATE, TRIM_EVERY_S) else 0}
    return _due(sess, "engineRoundsTrimDue", plan)


def flow_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """flowConditionsSweepMaybe_'s look, sealed for flowConditionsSweep."""
    return _due(sess, "flowConditionsDue", lambda reads: flow_plan(reads, True))


def schema_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """flowSchemaSweepMaybe_'s look (every six hours), sealed for flowSchemaSweep."""
    def plan(reads: L.Reads) -> dict[str, Any]:
        if not gate_open(reads, SCHEMA_GATE, SCHEMA_EVERY_S):
            return {"due": 0}
        return {"due": 1, **schema_plan(reads)}
    return _due(sess, "flowSchemaDue", plan)


def runtime_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """runtimeConditionsSweepMaybe_'s look, sealed for runtimeConditionsSweep."""
    return _due(sess, "runtimeConditionsDue", lambda reads: runtime_plan(reads, True))


def flow_sweep_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """flowSweepNow's reading, by hand: the rest's conditions judged now (no idleness check), and the schema feeder
    while its six hours have passed."""
    if not gate(sess.user):
        return dict(DENIED)
    reads = sess.reads
    data = {"flow": flow_plan(reads, False),
            "schema": schema_plan(reads) if gate_open(reads, SCHEMA_GATE, SCHEMA_EVERY_S) else None}
    return {"status": 200, "data": RC.seal("flowSweepNowPrepare", RC.actor(sess.user), data)}


def runtime_sweep_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """runtimeSweepNow's reading, by hand: the data books judged now."""
    if not gate(sess.user):
        return dict(DENIED)
    return {"status": 200, "data": RC.seal("runtimeSweepNowPrepare", RC.actor(sess.user),
                                           runtime_plan(sess.reads, False))}


def flow_eval(sess: L.Session, payload: dict) -> dict[str, Any]:
    """flowEval: watch a book judge — every condition's verdict with the facts it asked, 'unanswerable_here' where the
    runtime cannot answer them all."""
    if not gate(sess.user):
        return dict(DENIED)
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    context = s_(p.get("context")).lower()
    mode = flow_mode(reads, context)
    if not mode["id"]:
        return {"status": 404, "message": f'"{context}" is not in the Registry (or is hiring\'s).'}
    if mode["status"] not in ("on", "shadow"):
        return {"status": 409, "message": f'"{context}" is {mode["status"] or "blank"} — flip it to shadow or on '
                                          "before the book can be read."}
    subject = s_(p.get("subject_id")) or context
    facts = context_facts(reads, subject, context, (flow_registry(reads).get(context) or {}).get("note"))
    out, asked = [], {}
    for c in flow_tab(reads, context, "Conditions"):
        names = HF.rule_facts(c)
        answerable = True
        for n in names:
            if n not in facts:
                answerable = False
            asked[n] = facts[n] if n in facts else None
        out.append({"id": s_(c.get("Condition ID")), "truth": s_(c.get("Truth")),
                    "status": condition_status(c, facts, "flow-engine") if answerable else "unanswerable_here",
                    "blocking": s_(c.get("Blocking")), "owner": s_(c.get("Owner Role")), "facts": names})
    tally: dict[str, int] = {}
    for r in out:
        tally[r["status"]] = tally.get(r["status"], 0) + 1
    return {"status": 200, "data": {"context": context, "app": mode["app"], "book": mode["id"],
                                    "switch": mode["status"], "subject": subject, "tally": tally, "conditions": out,
                                    "facts_asked": asked, "facts_known": len(facts)}}


def flow_status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """flowStatus: the Registry of the rest, grouped by app — the board of what is wired."""
    if not gate(sess.user):
        return dict(DENIED)
    reads = sess.reads
    reg = flow_registry(reads)
    apps: dict[str, list[dict[str, str]]] = {}
    for ctx, row in reg.items():
        apps.setdefault(row.get("app") or "other", []).append(
            {"context": ctx, "status": row["status"], "book": row["id"]})
    return {"status": 200, "data": {"runtime": runtime_id(reads), "apps": apps, "contexts": len(reg)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiringConditionsDue": conditions_due, "engineRoundsTrimDue": rounds_trim_due, "flowConditionsDue": flow_due,
    "flowSchemaDue": schema_due, "runtimeConditionsDue": runtime_due, "flowSweepNowPrepare": flow_sweep_prepare,
    "runtimeSweepNowPrepare": runtime_sweep_prepare, "flowEval": flow_eval, "flowStatus": flow_status}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in DUE_DOORS}
POLICY.update({a: {"roles": ("admin", "manager")} for a in
               ("flowSweepNowPrepare", "runtimeSweepNowPrepare", "flowEval", "flowStatus")})
