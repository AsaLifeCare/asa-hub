"""The opt-out index's and the inbound log's writes (OptOut.gs), kept in Postgres alone (app/resource_rows.py
`entityOptOuts`, `entityInboundMessages`): a stop added or released by hand (optOutSet), a reply marked seen
(inboundMarkSeen), and the inbound sweep's filing (commsInboundKeep, the relay's own: what commsInboundFetch read —
each stop, start and wrong number into the index, each message into the log, the cursor moved, the automatic pass's
throttle held). add and release are optOutAdd_ and optOutRelease_ for any other door deciding under the write lock.
optOutsUpload brings both tabs into Postgres for the relay (rows nothing here has touched), or hands them back."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import opt_outs as OO
import resource_rows as RR
import smart_comms as SC
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the opt-out list right now — try again."
# HUB_POLICY's required params, said as hubPolicyGate_ says them
REQUIRED = {"optOutSet": ("target",), "inboundMarkSeen": ("message_id",)}
UPLOADS = {OO.OPT_OUT_RESOURCE: {"tab": OO.OPT_OUT_TAB}, OO.INBOUND_RESOURCE: {"tab": OO.INBOUND_TAB}}
AUTO_ERROR_BY = "auto-inbound"

s_ = gsjs.str_


def _now_iso() -> str:
    """new Date().toISOString(): the moment itself, never the request's."""
    return gsjs.iso(datetime.now(timezone.utc))


def _text(v: Any) -> str:
    """String(cell).trim() of the cell getValues() hands back."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "hub")))


def _missing(action: str, payload: dict) -> Decision | None:
    for key in REQUIRED.get(action, ()):
        if payload.get(key) is None or payload.get(key) == "":
            return W.refuse(400, f"Missing required parameter: {key}.")
    return None


def _owned(reads: L.Reads) -> None:
    if not (RR.uploaded(reads.db, OO.OPT_OUT_RESOURCE) and RR.uploaded(reads.db, OO.INBOUND_RESOURCE)):
        raise Defer("the opt-out list and the inbound log are not uploaded to Postgres yet")


def log_line(actor: dict, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record(actor, action, detail, status)


# ---- optOutAdd_ and optOutRelease_ -------------------------------------------------------------------------------

def add(reads: L.Reads, target: Any, info: dict[str, Any] | None = None) -> dict[str, Any]:
    """optOutAdd_: one row for a target not stopped yet; `info` carries name, candidateId, source, phrase,
    messageId, by and scope (kept for a wrong number only)."""
    info = info or {}
    key = OO.opt_out_key(target)
    if not key:
        return {"ok": False, "why": OO.NO_KEY}
    idx = OO.opt_out_index(reads)
    if not idx["error"] and key in idx["by"]:
        return {"ok": True, "already": True}
    RR._widen(reads, OO.OPT_OUT_RESOURCE, list(OO.OPT_OUT_COLUMNS))
    wrong = "wrong" in gsjs.or_text(info.get("source")).lower()
    by = s_(info.get("by"))
    RR.create(reads, OO.OPT_OUT_RESOURCE, {
        "target": gsjs.js_str(target), "kind": OO.opt_out_kind(target), "target_key": key,
        "person_name": s_(info.get("name")), "candidate_id": s_(info.get("candidateId")),
        "source": s_(info.get("source")) or "manual", "phrase": s_(info.get("phrase")),
        "message_id": s_(info.get("messageId")), "at": _now_iso(), "by": by,
        # Only a wrong number may carry a scope.
        "scope": s_(info.get("scope")) if wrong else ""}, by)
    return {"ok": True, "already": False}


def release(reads: L.Reads, target: Any, by_email: str) -> dict[str, Any]:
    """optOutRelease_: released_at stamped on every standing row of the target, the rows kept — the record outlives
    the release."""
    key = OO.opt_out_key(target)
    if not key:
        return {"ok": False, "why": OO.NO_KEY}
    RR._widen(reads, OO.OPT_OUT_RESOURCE, list(OO.OPT_OUT_COLUMNS))
    cols = RR.columns(reads, OO.OPT_OUT_RESOURCE)
    if "target_key" not in cols or "released_at" not in cols:
        return {"ok": False, "why": "the opt-out tab is missing its columns"}
    now = _now_iso()
    freed = []
    for row_key, cells in RR.table_rows(reads, OO.OPT_OUT_RESOURCE):
        if _text(cells.get("target_key")) != key or _text(cells.get("released_at")):
            continue
        changed = {"released_at": now}
        if "released_by" in cols:
            changed["released_by"] = s_(by_email)
        freed.append((row_key, cells, changed))
    RR.update_many(reads, OO.OPT_OUT_RESOURCE, freed, s_(by_email))
    return {"ok": True, "freed": len(freed)}


# ---- the doors ---------------------------------------------------------------------------------------------------

def opt_out_set(sess: L.Session, payload: dict) -> Decision:
    """optOutSet: an admin adds a stop by hand (source "by hand"), or releases one (`release` yes)."""
    p = payload if isinstance(payload, dict) else {}
    missing = _missing("optOutSet", p)
    if missing is not None:
        return missing
    user = sess.user or {}
    if gsjs.js_str(user.get("role")) != "admin":
        return Decision(dict(OO.DENIED))
    target = s_(p.get("target"))
    if not target:
        return W.refuse(400, "A number or an address is required.")
    if not OO.opt_out_key(target):
        return W.refuse(400, '"' + target + '" is not a ten-digit number or an e-mail address.')
    reads = sess.reads
    _owned(reads)
    rel = gsjs.or_text(p.get("release")).lower() in ("yes", "true", "1", "on")
    out = (release(reads, target, s_(user.get("email"))) if rel else
           add(reads, target, {"name": p.get("name"), "candidateId": p.get("candidate_id"), "source": "by hand",
                               "by": user.get("email")}))
    if not out["ok"]:
        return W.refuse(400, out.get("why") or "Nothing changed.")
    log_line(user, "opt_out_released" if rel else "opt_out_added", OO.opt_out_key(target))
    return Decision({"status": 200, "data": {
        "released": rel, "already": bool(out.get("already")), "freed": out.get("freed") or 0,
        "message": (("They can be contacted again." if out.get("freed") else "They were not on the list.") if rel
                    else ("They were already on the list." if out.get("already")
                          else "They will not be contacted again."))}}, subject="", own=True)


def inbound_mark_seen(sess: L.Session, payload: dict) -> Decision:
    """inboundMarkSeen: a filed reply marked read, once."""
    p = payload if isinstance(payload, dict) else {}
    missing = _missing("inboundMarkSeen", p)
    if missing is not None:
        return missing
    user = sess.user or {}
    if not OO.is_writer(user):
        return Decision(dict(OO.DENIED))
    mid = s_(p.get("message_id"))
    if not mid:
        return W.refuse(400, "Which message?")
    reads = sess.reads
    _owned(reads)
    RR._widen(reads, OO.INBOUND_RESOURCE, list(OO.INBOUND_COLUMNS))
    cols = RR.columns(reads, OO.INBOUND_RESOURCE)
    if "message_id" not in cols or "seen_at" not in cols:
        return W.refuse(500, "The inbound tab is missing its columns.")
    for row_key, cells in RR.table_rows(reads, OO.INBOUND_RESOURCE):
        if _text(cells.get("message_id")) != mid:
            continue
        if _text(cells.get("seen_at")):
            return Decision({"status": 200, "data": {"already": True}}, subject="", own=True)
        changed = {"seen_at": _now_iso()}
        if "seen_by" in cols:
            changed["seen_by"] = s_(user.get("email"))
        RR.update(reads, OO.INBOUND_RESOURCE, row_key, cells, changed, s_(user.get("email")))
        return Decision({"status": 200, "data": {"already": False}}, subject="", own=True)
    return W.refuse(404, "No message with that id.")


def _set_state(key: str, value: str, ttl_s: int | None = None) -> None:
    """hubPropSet_ (no ttl) or the script cache's put (ttl) on app.opt_out_state, the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {OO.STATE} as s (key, value, expires_at, prev, write_id) values (%s, %s,"
        " case when %s::integer is null then null else now() + make_interval(secs => %s::integer) end, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value,"
        " expires_at = excluded.expires_at, write_id = excluded.write_id, updated_at = now()",
        (key, value, ttl_s, ttl_s, SC.write_id()))


def _sweep_message(recorded: int, stops: int, starts: int, wrong: int, passed_over: int, remaining: int) -> str:
    if recorded:
        return (f"{recorded} new message(s): {stops} asked us to stop, {starts} asked to resume, {wrong} wrong number, "
                f"{recorded - stops - starts - wrong} are replies to read."
                + (f" {passed_over} older message(s) from numbers nobody on the board owns were read and not filed."
                   if passed_over else "")
                + (f" {remaining} row(s) still behind — the next pass continues." if remaining else ""))
    if remaining:
        return f"Nothing new in this batch. {remaining} row(s) still behind."
    return "Nothing new — every message in the mirror is already recorded."


def inbound_keep(sess: L.Session, payload: dict) -> Decision:
    """commsInboundKeep (the relay's own): commsInboundRun_'s writes for what commsInboundFetch read — under the lock a
    message filed since is counted as already seen, each decision is applied in the mirror's order, the batch is
    filed, the cursor moved and the pass logged; its answer is the sweep's."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    run = p.get("run") if isinstance(p.get("run"), dict) else {}
    if s_(run.get("mode")) == "auto":
        _set_state(OO.INBOUND_THROTTLE_KEY, "1", OO.INBOUND_THROTTLE_S)
    if s_(run.get("error")):
        log_line({"email": AUTO_ERROR_BY}, "comms_inbound_sweep_error", s_(run.get("error")), 500)
        return Decision({"status": 500, "message": s_(run.get("error"))}, subject="", own=True)
    if isinstance(run.get("answer"), dict):
        return Decision(run["answer"], subject="", own=True)
    if not isinstance(run.get("items"), list) or run.get("reached") is None:
        return W.refuse(400, "commsInboundFetch's batch is required: nothing was kept.")
    _owned(reads)
    by = s_(run.get("by")) or "asa-hub"
    have = {i for i in (_text(c.get("message_id")) for _k, c in RR.table_rows(reads, OO.INBOUND_RESOURCE)) if i}
    already = int(run.get("already") or 0)
    stops = starts = wrong = 0
    out: list[dict[str, str]] = []
    replies: list[dict[str, str]] = []
    for it in run.get("items") or []:
        if not isinstance(it, dict):
            continue
        mid, intent, from_num = s_(it.get("message_id")), s_(it.get("intent")), s_(it.get("from_number"))
        if not mid:
            continue
        if mid in have:
            already += 1
            continue
        name, cid = s_(it.get("person_name")), s_(it.get("candidate_id"))
        if intent == "opt-out":
            add(reads, from_num, {"name": name, "candidateId": cid, "source": "sms reply",
                                  "phrase": it.get("phrase"), "messageId": mid, "by": "asa-hub:inbound"})
            stops += 1
        elif intent == "opt-in":
            release(reads, from_num, "asa-hub:inbound")
            starts += 1
        elif intent == "wrong-number":
            add(reads, from_num, {"name": name, "candidateId": cid, "source": "wrong number",
                                  "phrase": it.get("phrase"), "messageId": mid, "by": "asa-hub:inbound",
                                  "scope": it.get("scope")})
            wrong += 1
        out.append({"message_id": mid, "received_at": s_(it.get("received_at")), "from_number": from_num,
                    "from_key": s_(it.get("from_key")), "candidate_id": cid, "person_name": name,
                    "body": gsjs.or_blank(it.get("body")), "intent": intent, "our_number": s_(it.get("our_number")),
                    "recorded_at": _now_iso()})
        if intent == "reply":
            replies.append({"name": name if it.get("who") else from_num,
                            "body": OO.js_cut(gsjs.or_blank(it.get("body")), 140)})
        have.add(mid)
    if out:
        RR._widen(reads, OO.INBOUND_RESOURCE, list(OO.INBOUND_COLUMNS))
        RR.create_many(reads, OO.INBOUND_RESOURCE, out, by)
    reached = int(run.get("reached") or 0)
    _set_state(OO.INBOUND_CURSOR_PROP, str(reached))
    recorded = len(out)
    passed_over, ours = int(run.get("passed_over") or 0), int(run.get("ours") or 0)
    remaining = max(0, int(run.get("last_row") or 0) - reached)
    log_line({"email": by}, "comms_inbound_sweep",
             f"{recorded} new, {stops} opt-out, {starts} opt-in, {wrong} wrong number, {passed_over} read and not "
             f"filed, {ours} our own lines, {remaining} rows behind")
    return Decision({"status": 200, "data": {
        "recorded": recorded, "stops": stops, "starts": starts, "wrongNumbers": wrong, "alreadySeen": already,
        "ourOwnLines": ours, "outgoing": int(run.get("outgoing") or 0), "passedOver": passed_over,
        "remaining": remaining, "replies": replies[:20], "noFeed": False,
        "message": _sweep_message(recorded, stops, starts, wrong, passed_over, remaining)}}, subject="", own=True)


_upload = RR.upload_door(UPLOADS)
# HUB_INBOUND_CURSOR stays in Apps Script's Script Properties, and its passes keep up with the tab: on the move the
# cursor starts this many rows behind the Messages tab's last row, which a pass reads again (a message filed is
# skipped by its id)
CURSOR_MARGIN_ROWS = 200


def upload(sess: L.Session, payload: dict) -> Decision:
    """optOutsUpload (the flip's): both tabs uploaded, then the inbound cursor seeded where Apps Script's stands."""
    got = _upload(sess, payload)
    reads = sess.reads
    if (got.answer or {}).get("status") != 200 or OO.state(reads, OO.INBOUND_CURSOR_PROP)["value"]:
        return got
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop("QUO_SYNC_SHEET_ID")))
    ref = reads.db.tab(sid, OO.QUO_MESSAGES_TAB) if sid else None
    if ref is not None:
        _set_state(OO.INBOUND_CURSOR_PROP, str(max(0, OO._last_row(reads, ref) - CURSOR_MARGIN_ROWS)))
    return got


WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "optOutSet": opt_out_set, "inboundMarkSeen": inbound_mark_seen, "commsInboundKeep": inbound_keep,
    "optOutsUpload": upload}
ACTIONS = WRITE_ACTIONS
# HUB_POLICY's roles and param types; the relay's own doors gate themselves
POLICY: dict[str, dict[str, Any]] = {
    "optOutSet": {"roles": ("admin",), "params": {"target": "string", "release": "string", "name": "string",
                                                  "candidate_id": "string"}},
    "inboundMarkSeen": {"roles": ("admin", "manager"), "params": {"message_id": "string"}},
    "commsInboundKeep": {}, "optOutsUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in WRITE_ACTIONS}


class Store(RR.Store):
    """app.opt_outs_writes and app.opt_outs_receipts; the rows app.resource_rows', the cursor app.opt_out_state — a
    void takes the rows back and puts the cursor where it was, so no message it filed is passed over."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="opt_outs", label="Opt-outs")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {OO.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("opt-outs: the void of %s left the cursor (%s)", write_id[:40], type(exc).__name__)
        return done
