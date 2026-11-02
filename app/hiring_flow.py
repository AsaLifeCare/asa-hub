"""The Hiring flow's reads (HiringFlow.gs, HiringMatrix.gs) off asa-hub-db: which Hiring views exist
(hiringViewsPolicy), the hiring calendar (hiringCalendarList), Flow Control — each stage's purpose, each Smart Comms
switch and what the ledger sent (hiringFlowControl) — and the matrix instruments (hiringMatrixEval,
hiringMatrixStatus). Two reads prepare a write: hiringFlowMintPrepare copies the Registry's template book in Drive as
the platform's account, and hiringScheduleCreatePrepare asks the model for the scheduled letter's kinder words when the
booking was the machine's."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import candidates as CND
import client_care_sweeps as CCS
import company_calendar as CAL
import editions
import gsjs
import house_tables as HT
import hubdb
import locations as L
import recon as RC
import smart_comms_desk as SCD
import staff_comms as STC

APP_ID = "hiring"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
# HIRING_VIEW_IDS: append only, never insert — a position is a promise (mirrored in the SPA's useHiringViewsStore)
VIEW_IDS = ("pipeline", "table", "calendar", "actions", "documents", "reports", "analysis", "scores", "archive")
# 'flow' is a legacy cell word standing for the old rail's views
FLOW_VIEW_IDS = ("table", "calendar", "actions", "documents", "reports")
CALENDAR_ROLES = ("admin", "director", "manager", "interviewer")
STAGE_PURPOSES = {
    "new": "Capture identity and contact facts; resume on file and background started.",
    "phone-screen": "The recruiter call — transcript, AI report, a date accepted, an advance decision.",
    "interview": "The in-person evaluation — scheduled, held, scored.",
    "onboarding": "The new-hire packet — seven documents, one signature.",
    "hired": "The graduation: account created, password set, Employee Database written.",
    "ready": "Finished and waiting — a manager begins their activities."}
LEDGER_TAB = "smart_comms_sent"
REGISTRY_TAB = "Registry"
RUNTIME_PROPS = ("HUB_APPS_RUNTIME_ID", "HUB_HIRING_RUNTIME_ID")
RULE_COLUMNS = ("Applicability Rule", "Satisfies Rule", "Partial Rule", "Failure Rule", "Terminal Rule")
MINT_NAME = re.compile(r"^[a-z][a-z0-9_-]{2,40}$")
# the binding tab: which Smart Comms row a purpose speaks through (commBindings_)
BINDINGS_TAB, BINDINGS_KEY, BINDINGS_VAL = "Smart Comms", "Config ID", "Smart Comms Situation ID"
BINDINGS_COMPILED = "COMM_BINDINGS_COMPILED"
EVENT_SIT_KEY, EVENT_SIT = "hiring.event.scheduled", "hiring_event_scheduled"
EVENT_MAIL_FALLBACK = {
    "email_subject": "{event} — {date}{time_line}",
    "email_text": "Hi {first_name},\n\nYour {event} with Asa LifeCare is scheduled.\n\n  When    {date}{time_line}\n"
                  "{where_line}{with_line}\n{notes}\n\nIf this day or time does not work, reply to this e-mail and we "
                  "will move it.\n\nAsa LifeCare"}
NOTICE_PROMPT = "ai_hiring_notice"
NOTICE_BUDGET_S = 90.0

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def _soft(fn: Callable[[], Any], fallback: Any) -> Any:
    got, why = CND.soft(fn)
    return fallback if why else got


# ---- the views (hiringViewsFromRaw_) -------------------------------------------------------------------------------

def views_from_raw(raw: Any) -> list[str]:
    """hiringViewsFromRaw_: blank or yes is every view, no is none, a list picks (flow standing for the old rail's)."""
    v = gsjs.trim(gsjs.or_blank(raw)).lower()
    if not v or v == "yes":
        return list(VIEW_IDS)
    if v == "no":
        return []
    wants: set[str] = set()
    for p in (x for x in re.split(r"[,;\s]+", v) if x):
        wants.update(FLOW_VIEW_IDS if p == "flow" else (p,))
    return [i for i in VIEW_IDS if i in wants]


def views_policy(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringViewsPolicy: which Hiring views exist, for every role; an unreadable config fails open."""
    views = _soft(lambda: views_from_raw(sess.reads.config().get("hiring_views_master")), list(VIEW_IDS))
    return {"status": 200, "data": {"views": views}}


# ---- the calendar --------------------------------------------------------------------------------------------------

def calendar_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringCalendarList: the calendar's live interviews and start dates, with the interviews it does not book."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in CALENDAR_ROLES:
        return dict(DENIED)
    return {"status": 200, "data": {"events": CAL.hiring_events(sess.reads), "types": dict(CND.HIRING_EVENT_TYPES)}}


# ---- Flow Control --------------------------------------------------------------------------------------------------

def ledger_rows(reads: L.Reads) -> list[dict]:
    """smartLedgerSheet_'s rows (key, situation, person, expires, channel, at), in sheet order; none while unborn."""
    def read() -> list[dict]:
        if HT.tabled(LEDGER_TAB):
            return STC._normalized_rows(*HT.raw(reads, LEDGER_TAB), False)
        res = reads.db.resolve(LEDGER_TAB)
        if res.runtime:
            raise hubdb.Unreadable(f"{LEDGER_TAB} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {LEDGER_TAB}")
            return []
        return STC._normalized(reads, res.ref, res.sheet_id == reads.db.prop("HUB_DB_ID"))
    return reads.once("hflow:ledger", read)


def ledger_keys(reads: L.Reads) -> set[str]:
    """smartAlreadySent_: every ledger key already written."""
    return {k for k in (s_(r.get("key")) for r in ledger_rows(reads)) if k}


def rehearsing(reads: L.Reads) -> bool:
    """!!hubTestRedirect_(): test mode on, in any position, or a switch nobody can read."""
    st = SCD.test_mode_state(reads.config())
    return bool(st["on"] or st["unrecognized"])


def flow_control(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringFlowControl: each stage's purpose, each Smart Comms switch, and what the ledger actually sent."""
    reads = sess.reads
    if not writer(sess.user):
        return dict(DENIED)
    stages = [{"id": i, "purpose": STAGE_PURPOSES.get(i, "")} for i in CND.TALENT_STAGE_ORDER]
    situations = [{"id": s_(x.get("id")), "label": s_(x.get("label")) or s_(x.get("id")),
                   "enabled": SCD.smart_on(x.get("enabled")), "kind": s_(x.get("kind")), "event": s_(x.get("event")),
                   "channels": s_(x.get("channels")), "to": s_(x.get("to")), "days_before": s_(x.get("days_before"))}
                  for x in _soft(lambda: SCD.situations(reads), [])]
    by_sit: dict[str, dict] = {}
    by_person: dict[str, dict] = {}
    total = 0
    rows = _soft(lambda: ledger_rows(reads), [])
    for r in rows:
        sit, person, at = s_(r.get("situation")), s_(r.get("person")), s_(r.get("at"))
        if not sit:
            continue
        total += 1
        one = by_sit.setdefault(sit, {"count": 0, "last": ""})
        one["count"] += 1
        if at > one["last"]:
            one["last"] = at
        # candidate ledger rows carry the id, sometimes suffixed ':type'
        cid = person.split(":")[0] if person.startswith("CAN_") else ""
        if cid:
            p = by_person.setdefault(cid, {"count": 0, "last": ""})
            p["count"] += 1
            if at > p["last"]:
                p["last"] = at
    recent = [{"situation": s_(r.get("situation")), "person": s_(r.get("person")),
               "channel": gsjs.or_text(r.get("channel")), "at": s_(r.get("at"))} for r in reversed(rows[-20:])]
    return {"status": 200, "data": {
        "stages": stages, "situations": situations,
        "ledger": {"total": total, "bySituation": by_sit, "byPerson": by_person, "recent": recent},
        "rehearsing": _soft(lambda: rehearsing(reads), False)}}


# ---- the Registry, every runtime's (hiringRegistry_ with each row's runtime) --------------------------------------

def runtime_ids(reads: L.Reads) -> list[str]:
    """hiringRuntimeIds_: every runtime book, ours first."""
    out: list[str] = []
    for k in RUNTIME_PROPS:
        v = gsjs.trim(reads.db.prop(k))
        if v and v not in out:
            out.append(v)
    return out


def registry(reads: L.Reads) -> dict[str, dict[str, str]]:
    """hiringRegistry_: context → {id, status, note, runtime}, the first runtime that declares it winning."""
    def read() -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for rid in runtime_ids(reads):
            got = CND._book_rows(reads, rid, REGISTRY_TAB)
            if got is None:
                continue
            heads, rows = got
            if "Context" not in heads or "Spreadsheet ID" not in heads or "Status" not in heads:
                continue
            i_ctx, i_id, i_st = heads.index("Context"), heads.index("Spreadsheet ID"), heads.index("Status")
            i_note = heads.index("Notes") if "Notes" in heads else -1
            for line in rows:
                ctx = gsjs.trim(gsjs.or_text(line[i_ctx])).lower()
                if not ctx or ctx.startswith("#") or ctx in out:
                    continue
                out[ctx] = {"id": gsjs.trim(gsjs.or_text(line[i_id])),
                            "status": gsjs.trim(gsjs.or_text(line[i_st])).lower(),
                            "note": gsjs.trim(gsjs.or_text(line[i_note])) if i_note != -1 else "", "runtime": rid}
        return out
    return reads.once("hflow:registry", read)


def runtime_for(reads: L.Reads, context: str = "") -> str:
    """hiringRuntimeFor_: the runtime book a context's operation is written to — its own, else ours."""
    row = registry(reads).get(gsjs.trim(context).lower()) if context else None
    return (row or {}).get("runtime") or CND.runtime_id(reads)


# ---- the matrix instruments ------------------------------------------------------------------------------------------

def _own_facts(reads: L.Reads, rid: str, ref: hubdb.TabRef, subject: str) -> list[tuple[str, str, str]]:
    """(fact key, value, type) of each fact Python's own writes keep for this subject that the copy does not hold."""
    groups = (getattr(hubdb.OWN.get(), "edits", None) or {}).get((rid, ref.tab)) or ()
    mine: list[tuple[str, str, str, str]] = []
    for g in groups:
        if not g.get("appended") or g.get("match") != editions.KEY_MATCH:
            continue
        cells = {f: v for f, (_id, v, _born) in g["cells"].items()}
        ev = gsjs.trim(gsjs.or_blank(cells.get("Evidence")))
        if gsjs.trim(gsjs.or_blank(cells.get("Subject ID"))) != subject or not ev:
            continue
        mine.append((s_(cells.get("Fact Key")), CND.entered_text(cells.get("Value")), s_(cells.get("Type")), ev))
    if not mine:
        return []
    held = CND._evidence_held(reads, ref, {ev for *_r, ev in mine})
    return [(k, v, t) for k, v, t, ev in mine if ev not in held]


def subject_facts(reads: L.Reads, subject: str, context: str) -> dict[str, Any]:
    """hiringSubjectFacts_: one subject's facts off its runtime's Facts, the last row winning, each typed."""
    want = s_(subject)
    if not want:
        return {}
    rid = runtime_for(reads, context)
    ref = reads.tab_of(rid, hubdb.FACTS_TAB, "the runtime's Facts")
    if ref is None:
        return {}
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the runtime's Facts")
    direct = STC._direct(reads, ref.sheet_id)
    out: dict[str, Any] = {}
    for key, value, typ, by in reads.db.query(
            f'select fact_key, value, type, recorded_by from {reads.db.from_sql(ref)}'  # noqa: S608
            " where subject_id = %s order by row_number", (want,)):
        if direct:
            v = gsjs.trim(STC._js_text(value, True))
        elif gsjs.trim(gsjs.or_blank(by)) == CND.FACT_DISSOLUTION_BY:
            v = gsjs.trim(gsjs.or_blank(value))
        else:
            v = CND.entered_text(value)
        out[s_(key)] = CND._fact_value(v, s_(typ))
    for key, v, typ in _own_facts(reads, rid, ref, want):
        out[key] = CND._fact_value(v, typ)
    return out


def rule_facts(row: dict) -> list[str]:
    """hiringRuleFacts_: every fact id a condition's rules name, in reading order."""
    seen: set[str] = set()
    out: list[str] = []
    for col in RULE_COLUMNS:
        for fid in re.findall(r'"fact"\s*:\s*"([^"]+)"', s_(row.get(col))):
            if fid not in seen:
                seen.add(fid)
                out.append(fid)
    return out


def _matrix_gate(user: dict | None) -> bool:
    u = user or {}
    return bool(u) and (bool(u.get("is_service")) or s_(u.get("role")) in ("admin", "manager"))


def matrix_eval(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringMatrixEval: watch a book judge a real person — every condition's status over the subject's facts."""
    reads = sess.reads
    if not _matrix_gate(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    context, subject = s_(p.get("context")).lower(), s_(p.get("subject_id"))
    mode = CND.registry(reads).get(context) or {"id": "", "status": ""}
    if not mode["id"]:
        return {"status": 404, "message": f'"{context}" is not in any Registry.'}
    if mode["status"] not in ("on", "shadow"):
        return {"status": 409, "message": f'"{context}" is {mode["status"] or "blank"} — flip it to shadow or on before '
                                          "the book can be read."}
    fact_map = subject_facts(reads, subject, context)
    # the hiring board also answers from the tabs the card is drawn from, so the verdict is the one the ride gives
    if subject and context in ("board", "hiring"):
        def from_evidence() -> None:
            for k, v in CND.facts_from_evidence(reads, context, CND.evidence(reads, subject)).items():
                fact_map.setdefault(k, v)
        CND.soft(from_evidence)
    out, asked = [], {}
    for c in CND.matrix_tab(reads, context, "Conditions"):
        names = rule_facts(c)
        for n in names:
            asked[n] = fact_map[n] if n in fact_map else None
        out.append({"id": s_(c.get("Condition ID")), "truth": s_(c.get("Truth")),
                    "status": CND.condition_status(c, fact_map), "legacy": s_(c.get("Legacy Checklist ID")),
                    "blocking": s_(c.get("Blocking")), "owner": s_(c.get("Owner Role")), "facts": names})
    tally: dict[str, int] = {}
    for r in out:
        tally[r["status"]] = tally.get(r["status"], 0) + 1
    return {"status": 200, "data": {"context": context, "book": mode["id"], "switch": mode["status"], "subject": subject,
                                    "tally": tally, "conditions": out, "facts_asked": asked,
                                    "facts_known": len(fact_map)}}


def matrix_status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringMatrixStatus: every runtime's Registry rows; `deep` says whether each book opens and how many tabs."""
    reads = sess.reads
    if not _matrix_gate(sess.user):
        return dict(DENIED)
    ids = runtime_ids(reads)
    if not ids:
        return {"status": 200, "data": {"runtime": "", "rows": []}}
    deep = bool((payload or {}).get("deep"))
    cat = reads.db.catalog() if deep else None
    rows = []
    for rid in ids:
        got = CND._book_rows(reads, rid, REGISTRY_TAB)
        heads, lines = got if got is not None else ([], [])

        def col(name: str) -> int:
            return heads.index(name) if name in heads else -1
        i_ctx, i_id, i_st, i_at = col("Context"), col("Spreadsheet ID"), col("Status"), col("Last Read")

        def cell(line: list, i: int) -> str:
            return gsjs.or_text(line[i]) if 0 <= i < len(line) else ""
        for line in lines:
            ctx = gsjs.trim(cell(line, i_ctx))
            if not ctx or ctx.startswith("#"):
                continue
            row: dict[str, Any] = {"context": ctx, "runtime": rid, "status": gsjs.trim(cell(line, i_st)).lower(),
                                   "last_read": "" if i_at == -1 else cell(line, i_at),
                                   "book": gsjs.trim(cell(line, i_id))}
            if deep and row["book"] and cat is not None:
                opens = row["book"] in cat["books"]
                if opens:
                    row["tabs"] = sum(1 for (sid, _t) in cat["tabs"] if sid == row["book"])
                row["opens"] = opens
            rows.append(row)
    return {"status": 200, "data": {"runtime": ",".join(ids), "runtimes": ids, "rows": rows}}


# ---- a parallel flow minted (hiringFlowMint's Drive half) -----------------------------------------------------------

def mint_refusal(reads: L.Reads, user: dict | None, raw: Any) -> tuple[dict | None, str, dict]:
    """hiringFlowMint's gates: (its refusal, the name, the Registry's template row)."""
    if not user or s_((user or {}).get("role")) != "admin":
        return dict(DENIED), "", {}
    name = s_(raw).lower()
    if not MINT_NAME.match(name):
        return {"status": 400, "message": "name: a lowercase slug, 3–41 chars (a-z 0-9 _ -)."}, name, {}
    reg = registry(reads)
    if name in reg:
        return {"status": 409, "message": f'"{name}" is already registered.'}, name, {}
    tpl = reg.get("template") or {}
    if not tpl.get("id"):
        return {"status": 400, "message": "the Registry has no template row."}, name, {}
    return None, name, tpl


def flow_mint_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The Registry's template book copied in Drive as the platform's account (makeCopy, beside the template), before
    hiringFlowMint registers the copy."""
    reads = sess.reads
    refused, name, tpl = mint_refusal(reads, sess.user, (payload or {}).get("name"))
    if refused:
        return refused
    drv = reads.drive
    try:
        if drv is None or not getattr(drv, "available", False):
            raise RuntimeError("Drive is not wired to this service")
        parents = drv.file(tpl["id"], "id,parents").get("parents") or []
        if not parents:
            raise RuntimeError("the template's folder could not be read")
        copy = drv.copy_into(tpl["id"], s_(parents[0]), "ASA Flow — " + name)
        if not copy:
            raise RuntimeError("Drive named no copy")
    except Exception as exc:  # noqa: BLE001 - the door's own refusal, said
        return {"status": 502, "message": "the template could not be copied: " + (str(exc)[:200] or type(exc).__name__)}
    return {"status": 200, "data": RC.seal("hiringFlowMint", RC.actor(sess.user), {"context": name, "book": copy})}


# ---- the scheduled letter (hiringEventNotify_'s words) ---------------------------------------------------------------

def bindings(reads: L.Reads) -> dict[str, str]:
    """commBindings_: Config ID → Smart Comms Situation ID off the generic config book's binding tab; its compiled
    copy when the tab answers nothing."""
    def read() -> dict[str, str]:
        sid = gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID")) or CND.GENERIC_CONFIG_FALLBACK
        out: dict[str, str] = {}
        got = CND._book_rows(reads, sid, BINDINGS_TAB)
        if got is not None and BINDINGS_KEY in got[0] and BINDINGS_VAL in got[0]:
            i_key, i_val = got[0].index(BINDINGS_KEY), got[0].index(BINDINGS_VAL)
            for line in got[1]:
                k = gsjs.trim(gsjs.or_text(line[i_key]))
                if k:
                    out[k] = gsjs.trim(gsjs.or_blank(line[i_val]))
        if not out:
            try:
                baked = json.loads(reads.db.prop(BINDINGS_COMPILED) or "{}")
                out = {str(k): s_(v) for k, v in baked.items()} if isinstance(baked, dict) else {}
            except ValueError:
                out = {}
        return out
    return reads.once("hflow:bindings", read)


def situation_id(reads: L.Reads, key: str, shipped: str) -> str:
    """commSituationId_: the binding's row, the shipped id when the binding is blank or names no situation."""
    v = gsjs.trim(_soft(lambda: bindings(reads), {}).get(key, ""))
    if not v or v == shipped:
        return shipped or v
    rows = _soft(lambda: SCD.situations(reads), None)
    if rows is None:
        return v
    return v if any(s_(r.get("id")) == v for r in rows) else shipped


def event_valid(p: dict) -> str:
    """hiringEventValid_: dates checked by shape, never parsed; '' when valid."""
    if not CAN_ID.match(s_(p.get("candidate_id"))):
        return "invalid candidate_id"
    if s_(p.get("event_type")) not in CND.HIRING_EVENT_TYPES:
        return "event_type must be one of: " + ", ".join(CND.HIRING_EVENT_TYPES)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s_(p.get("date"))):
        return "date must be YYYY-MM-DD"
    if s_(p.get("time")) and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", s_(p.get("time"))):
        return "time must be HH:MM (24h)"
    return ""


def event_vars(cand: dict | None, ev: dict) -> dict[str, str]:
    """hiringEventMailVars_."""
    name = s_((cand or {}).get("candidatename")) or s_(ev.get("candidate_name"))
    kind = s_(ev.get("event_type"))
    return {"name": name, "first_name": name.split(" ")[0] or name,
            "event": CND.HIRING_EVENT_TYPES.get(kind) or kind, "date": s_(ev.get("date")), "time": s_(ev.get("time")),
            "time_line": " at " + s_(ev.get("time")) if s_(ev.get("time")) else "",
            "where_line": "  Where   " + s_(ev.get("location")) + "\n" if s_(ev.get("location")) else "",
            "with_line": "  With    " + s_(ev.get("with_name")) + "\n" if s_(ev.get("with_name")) else "",
            "location": s_(ev.get("location")), "with_name": s_(ev.get("with_name")), "notes": s_(ev.get("notes"))}


def event_mail(reads: L.Reads, cand: dict | None, ev: dict) -> dict[str, Any]:
    """hiringEventNotify_'s words: the situation (fail closed: no enabled row, no e-mail), the address, the letter."""
    sid = _soft(lambda: situation_id(reads, EVENT_SIT_KEY, EVENT_SIT), EVENT_SIT)
    sit = _soft(lambda: SCD.situation_last(SCD.situations(reads), sid), None)
    if not sit or not SCD.smart_on(sit.get("enabled")):
        return {"sid": sid, "reason": "situation_off"}
    to = s_((cand or {}).get("email"))
    if not to:
        return {"sid": sid, "reason": "no_email"}
    v = event_vars(cand, ev)
    subject = CND.render(s_(sit.get("email_subject")) or EVENT_MAIL_FALLBACK["email_subject"], v)
    body = re.sub(r"\n{3,}", "\n\n", CND.render(s_(sit.get("email_text")) or EVENT_MAIL_FALLBACK["email_text"], v))
    return {"sid": sid, "reason": "", "to": to, "subject": subject, "body": body, "vars": v}


def event_of(p: dict, cand: dict | None) -> dict[str, str]:
    """The appointment a schedule press names."""
    return {"candidate_id": s_(p.get("candidate_id")), "candidate_name": s_((cand or {}).get("candidatename")),
            "event_type": s_(p.get("event_type")), "date": s_(p.get("date")), "time": s_(p.get("time")),
            "location": s_(p.get("location")), "with_name": s_(p.get("with_name")), "notes": s_(p.get("notes"))}


def schedule_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringEventNotify_'s model half for a booking the machine made (auto): the letter rewritten by the model through
    the Prompts book's ai_hiring_notice, before hiringScheduleCreate records the appointment and raises the letter."""
    reads = sess.reads
    if not writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    why = event_valid(p)
    if why:
        return {"status": 400, "message": why}
    cid = s_(p.get("candidate_id"))
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}
    mail = event_mail(reads, cand, event_of(p, cand))
    rewritten = ""
    if not mail["reason"] and p.get("auto") is True:
        tpl = _soft(lambda: CND.book_text(reads, "Prompts", NOTICE_PROMPT, ""), "")
        if tpl:
            chat = CCS.ai_chat(reads, tpl.replace("{body}", mail["body"]), 0.4, NOTICE_PROMPT,
                               time.monotonic() + NOTICE_BUDGET_S)
            try:
                got = json.loads(s_(chat.get("content"))) if chat.get("ok") else {}
                rewritten = s_(got.get("body")) if isinstance(got, dict) else ""
            except ValueError:
                rewritten = ""
    return {"status": 200, "data": RC.seal("hiringScheduleCreate", RC.actor(sess.user),
                                           {"candidate_id": cid, "body": mail.get("body", ""), "rewritten": rewritten})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiringViewsPolicy": views_policy, "hiringCalendarList": calendar_list, "hiringFlowControl": flow_control,
    "hiringMatrixEval": matrix_eval, "hiringMatrixStatus": matrix_status, "hiringFlowMintPrepare": flow_mint_prepare,
    "hiringScheduleCreatePrepare": schedule_prepare}
POLICY: dict[str, dict[str, Any]] = {
    "hiringViewsPolicy": {"roles": ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")},
    "hiringCalendarList": {"roles": CALENDAR_ROLES},
    "hiringFlowControl": {"roles": ("admin", "manager")},
    "hiringMatrixEval": {"roles": ("admin", "manager")},
    "hiringMatrixStatus": {"roles": ("admin", "manager")},
    "hiringFlowMintPrepare": {"roles": ("admin",)},
    "hiringScheduleCreatePrepare": {"roles": ("admin", "manager")}}
