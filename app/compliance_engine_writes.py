"""The Compliance Engine's writes on Python (Requirements.gs, RequirementStates.gs): a requirement added, changed or
removed, and the states rebuilt — delta only, every state change an event in the trail (the events house, through
app.edits), the `since` moving only when the state moved. The relay rings the rebuild every six hours once Apps Script
no longer does; an admin rings it by hand."""
from __future__ import annotations

import json
import secrets
from typing import Any, Callable

import compliance_engine as CE
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff as SP
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Another update is in progress — try again."
EVENTS_TAB = "events"
EVENTS_MATCH = "cols:event_id"
EVENTS_PAYLOAD_MAX = 2000
# past this, a change wave writes one summary event instead of one per change
EVENT_CAP = 250

s_ = gsjs.str_


def _admin(user: dict | None) -> bool:
    return bool(user) and s_((user or {}).get("role")) == "admin"


def _owned(reads: L.Reads, resource: str) -> None:
    if not CE.owned(reads.db, resource):
        raise Defer(f"{resource} is not uploaded to Postgres yet")


def _valid(row: Any) -> bool:
    """requirementRowValid_."""
    return isinstance(row, dict) and bool(s_(row.get("req_id"))) and bool(s_(row.get("label")))


def upsert(sess: L.Session, payload: dict) -> Decision:
    """requirementUpsert: the row written whole under its req_id — changed in place, or added."""
    user = sess.user or {}
    if not _admin(user):
        return Decision(dict(CE.DENIED))
    row = (payload or {}).get("row")
    if not _valid(row):
        return W.refuse(400, "row.req_id and row.label are required.")
    reads = sess.reads
    _owned(reads, CE.REQS)
    req_id = s_(row.get("req_id"))[:60]
    now = W.now_iso(reads)
    line = {h: now if h == "updated_at" else s_(user.get("email")) if h == "updated_by" else req_id if h == "req_id"
            else (s_(row.get(h)) if h in row else "") for h in CE.HEADER}
    hit = next(((k, c) for k, c in RR.table_rows(reads, CE.REQS) if s_(c.get("req_id")) == req_id), None)
    if hit is not None:
        RR.update(reads, CE.REQS, hit[0], hit[1], line, s_(user.get("email")))
    else:
        RR.create(reads, CE.REQS, line, s_(user.get("email")))
    return Decision({"status": 200, "data": {"req_id": req_id, "updated": hit is not None}}, subject="", own=True)


def delete(sess: L.Session, payload: dict) -> Decision:
    """requirementDelete: every row under the req_id removed."""
    user = sess.user or {}
    if not _admin(user):
        return Decision(dict(CE.DENIED))
    req_id = s_((payload or {}).get("req_id"))
    if not req_id:
        return W.refuse(400, "req_id is required.")
    reads = sess.reads
    _owned(reads, CE.REQS)
    removed = 0
    for k, c in RR.table_rows(reads, CE.REQS):
        if s_(c.get("req_id")) == req_id:
            RR.remove(reads, CE.REQS, k, c, s_(user.get("email")))
            removed += 1
    return Decision({"status": 200, "data": {"req_id": req_id, "removed": removed}}, subject="", own=True)


# ---- the states rebuild ---------------------------------------------------------------------------------------

def _event(reads: L.Reads, where: tuple[str, str], kind: str, subject: dict, payload: dict, at: str) -> dict:
    """eventAppend_: one row of the trail, kept in app.edits."""
    eid = "evt_" + secrets.token_hex(6)
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)[:EVENTS_PAYLOAD_MAX]
    cells = {"event_id": eid, "type": kind, "actor": "", "subject_type": s_(subject.get("type")),
             "subject_key": s_(subject.get("key")), "subject_name": s_(subject.get("name")), "payload": body,
             "source": "requirementStatesRebuild_", "at": at, "tenant": ""}
    return W.kept_record(where[0], where[1], "append", EVENTS_MATCH, eid, s_(subject.get("key")), cells)


def rebuild(reads: L.Reads, by: str) -> tuple[dict[str, Any], list[dict]]:
    """requirementStatesRebuild_: the states computed again, only what changed written, each change an event."""
    _owned(reads, CE.STATES)
    computed = SP.req_states_all(reads)
    existing: dict[str, tuple[str, dict, dict[str, str]]] = {}
    for k, raw in RR.table_rows(reads, CE.STATES):
        # a day the sheet kept as a Date reads back as the day it means, never as the instant
        text = {h: s_(hubdb.cell_text(hubdb.typed(v, "hub"))) for h, v in raw.items()}
        text["expires"] = text.get("expires", "")[:10]
        key = text.get("person_key", "") + "|" + text.get("req_id", "")
        if key != "|":
            existing[key] = (k, raw, text)
    now = W.now_iso(reads)
    updates: list[tuple[str, dict, dict[str, str]]] = []
    inserts: list[dict[str, str]] = []
    changes: list[dict[str, Any]] = []
    for key, c in computed.items():
        ex = existing.get(key)
        row = {"login": c["login"], "person_key": c["person_key"], "person_name": c["person_name"],
               "req_id": c["req_id"], "state": c["state"], "expires": c["expires"],
               "days_left": gsjs.js_str(c["days_left"]), "computed_at": now, "tenant": ""}
        if ex is None:
            inserts.append({**row, "prev_state": "", "since": now})
            changes.append({"prev": "", **c})
            continue
        was = ex[2]
        if was.get("state") != c["state"] or was.get("expires") != c["expires"]:
            moved = was.get("state") != c["state"]
            updates.append((ex[0], ex[1], {**row, "prev_state": was.get("state", ""),
                                           "since": now if moved else was.get("since", "")}))
            if moved:
                changes.append({"prev": was.get("state", ""), **c})
    RR.update_many(reads, CE.STATES, updates, by)
    RR.create_many(reads, CE.STATES, [{h: r.get(h, "") for h in CE.STATES_HEADER} for r in inserts], by)
    by_id = {s_(r.get("req_id")): r for r in CE.catalogue(reads)["rows"]}

    def outcome(ch: dict) -> int:
        """requirementOutcomeDispatch_: a consequence named, and the state now expiring or expired."""
        req = by_id.get(ch["req_id"]) or {}
        return 1 if s_(req.get("consequence")) and ch["state"] in ("expiring", "expired") else 0

    edits: list[dict] = []
    where = W.where_of(W.tab_of(reads, EVENTS_TAB))
    if not existing:
        counts: dict[str, int] = {}
        for ch in changes:
            counts[ch["state"]] = counts.get(ch["state"], 0) + 1
        edits.append(_event(reads, where, "requirement_states_baseline",
                            {"type": "system", "key": CE.STATES_TAB, "name": "First rebuild"},
                            {"pairs": len(changes), "by_state": counts}, now))
    else:
        for ch in changes[:EVENT_CAP]:
            edits.append(_event(reads, where, "requirement_state_changed",
                                {"type": "person", "key": ch["person_key"], "name": ch["person_name"]},
                                {"req_id": ch["req_id"], "prev_state": ch["prev"], "state": ch["state"],
                                 "expires": ch["expires"], "days_left": ch["days_left"]}, now))
        if len(changes) > EVENT_CAP:
            edits.append(_event(reads, where, "requirement_state_changes_overflow",
                                {"type": "system", "key": CE.STATES_TAB, "name": "Change wave"},
                                {"total": len(changes), "recorded": EVENT_CAP}, now))
    summary = {"computed": len(computed), "updated": len(updates), "inserted": len(inserts), "changes": len(changes),
               "outcomes": sum(outcome(ch) for ch in changes)}
    return summary, edits


def states_run(sess: L.Session, payload: dict) -> Decision:
    """requirementStatesRun: the admin's own rebuild."""
    user = sess.user or {}
    if not _admin(user):
        return Decision(dict(CE.DENIED))
    summary, edits = rebuild(sess.reads, s_(user.get("email")))
    return Decision({"status": 200, "data": summary}, edits=edits or None, subject="", own=True)


def states_sweep(sess: L.Session, payload: dict) -> Decision:
    """The six-hourly rebuild on the relay's clock (requirementStatesSweepMaybe_), Apps Script's no longer."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(CE.DENIED))
    summary, edits = rebuild(sess.reads, "asa-hub:requirement-states")
    return Decision({"status": 200, "data": summary}, edits=edits or None, subject="", own=True)


_RELEASE = RR.upload_door({CE.REQS: {"tab": CE.REQS_TAB}, CE.STATES: {"tab": CE.STATES_TAB}})


def upload(sess: L.Session, payload: dict) -> Decision:
    """The relay's own upload as the app is given to Python (or its release back): the catalogue as the copy holds
    it, the states with each row's login — the person's e-mail, else their phone's digits, which the copy withholds —
    worked out again from People as the rebuild works it out."""
    if (sess.user or {}).get("is_service") is not True or (payload or {}).get("release") is True:
        return _RELEASE(sess, payload)
    reads = sess.reads
    logins: dict[str, str] = {}
    for p in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))):
        key = SP.name_key(p.get("name"))
        if key:
            logins[key] = s_(p.get("email")).strip().lower() or "".join(ch for ch in s_(p.get("phone")) if ch.isdigit())
    done = {CE.REQS: RR.upload(reads, CE.REQS, CE.REQS_TAB),
            CE.STATES: RR.upload(reads, CE.STATES, CE.STATES_TAB,
                                 {"login": lambda c: logins.get(s_(c.get("person_key")), "")})}
    return Decision({"status": 200, "data": done}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "requirementUpsert": upsert, "requirementDelete": delete, "requirementStatesRun": states_run,
    "requirementStatesSweep": states_sweep, "complianceEngineUpload": upload}
POLICY: dict[str, dict[str, Any]] = {"requirementUpsert": {"roles": ("admin",)}, "requirementDelete": {"roles": ("admin",)},
                                     "requirementStatesRun": {"roles": ("admin",)}, "requirementStatesSweep": {},
                                     "complianceEngineUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.compliance_engine_writes and _receipts; the catalogue and the states app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="compliance_engine", label="Compliance Engine")
