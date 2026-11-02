"""commsInboundSweepMaybe_'s filing on Python while the opt-out list is still Apps Script's (app/opt_outs_writes.py
commsInboundKeep files it once both tabs are uploaded, and this door hands it there then): what commsInboundFetch read
off the copy filed as commsInboundRun_ filed it — each stop, start and wrong number into entity_opt_outs, each message
into entity_inbound_messages — every row an app.edits record of the tab Apps Script still reads, which the two-way
sync carries there; the cursor and the automatic pass's throttle in app.opt_out_state, as commsInboundKeep keeps them.
A pass with no cursor of its own yet seeds it where Apps Script's passes stand (the Messages tab's last row less
optOutsUpload's margin) and files nothing, so the next pass reads on from there."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import opt_outs as OO
import opt_outs_writes as OOW
import resource_rows as RR
import writes as W
from scope import Defer
from writes import Decision

OPT_OUT_MATCH = ("target_key", "at")
INBOUND_MATCH = ("message_id",)

s_ = gsjs.str_


def _now_iso() -> str:
    """new Date().toISOString(): the moment itself, never the request's."""
    return gsjs.iso(datetime.now(timezone.utc))


def _uploaded(reads: L.Reads) -> bool:
    return RR.uploaded(reads.db, OO.OPT_OUT_RESOURCE) and RR.uploaded(reads.db, OO.INBOUND_RESOURCE)


class Tab:
    """One of the two tabs as hubAppendRow_ and a row's own cells see it in the copy, with what this pass kept."""

    def __init__(self, reads: L.Reads, name: str, match: tuple[str, ...]) -> None:
        res = W.tab_of(reads, name)
        if res.runtime:
            raise Defer(f"{name} lives in the depot's facts")
        if res.ref is None:
            raise Defer(f"the copy holds no {name} tab: Apps Script makes it (hubTabEnsure_)")
        self.reads, self.ref = reads, res.ref
        self.sid, self.tab = W.where_of(res)
        self.heads = [gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers]
        missing = [c for c in match if c not in self.heads]
        if missing:
            raise Defer(f"the {name} tab lost a column its rows are found by ({', '.join(missing)})")
        self.match = W.COLS + W.COLS_SEP.join(match)
        self.match_heads = [res.ref.headers[self.heads.index(c)] for c in match]
        self.appended: list[dict] = []
        self.edited: set[str] = set()

    def rows(self) -> list[tuple[int, dict]]:
        return self.reads.db.rows(self.ref)

    def append(self, vals: dict[str, Any]) -> dict:
        """hubAppendRow_: the row laid on the tab's own header, a column it lacks left out."""
        cells = {h: gsjs.or_blank(vals[h]) for h in self.heads if h and h in vals}
        key = "\x1f".join(gsjs.trim(gsjs.or_blank(vals.get(c))) for c in self.match[len(W.COLS):].split(W.COLS_SEP))
        rec = W.kept_record(self.sid, self.tab, "append", self.match, key, "", cells)
        self.appended.append(rec)
        return rec

    def edit(self, raw: dict, cells: dict[str, str]) -> dict:
        """One standing row's cells, found again by its match columns."""
        key = W.cols_key(raw, self.match_heads)
        self.edited.add(key)
        before = {h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(self.ref.headers[self.heads.index(h)]), "raw")))
                  for h in cells if h in self.heads}
        return W.kept_record(self.sid, self.tab, "edit", self.match, key, "", cells, before)


def add(opt: Tab, target: Any, info: dict[str, Any], standing: dict[str, bool]) -> dict[str, Any]:
    """optOutAdd_ over the copy: one row for a target not stopped yet; `standing` is what this pass changed."""
    key = OO.opt_out_key(target)
    if not key:
        return {"ok": False, "why": OO.NO_KEY}
    idx = OO.opt_out_index(opt.reads)
    stopped = standing[key] if key in standing else key in idx["by"]
    if not idx["error"] and stopped:
        return {"ok": True, "already": True}
    wrong = "wrong" in gsjs.or_text(info.get("source")).lower()
    opt.append({"target": gsjs.js_str(target), "kind": OO.opt_out_kind(target), "target_key": key,
                "person_name": s_(info.get("name")), "candidate_id": s_(info.get("candidateId")),
                "source": s_(info.get("source")) or "manual", "phrase": s_(info.get("phrase")),
                "message_id": s_(info.get("messageId")), "at": _now_iso(), "by": s_(info.get("by")),
                # Only a wrong number may carry a scope.
                "scope": s_(info.get("scope")) if wrong else ""})
    standing[key] = True
    return {"ok": True, "already": False}


def release(opt: Tab, target: Any, by_email: str, standing: dict[str, bool]) -> tuple[dict[str, Any], list[dict]]:
    """optOutRelease_ over the copy: released_at stamped on every standing row of the target (this pass's own rows
    too), the rows kept — the record outlives the release."""
    key = OO.opt_out_key(target)
    if not key:
        return {"ok": False, "why": OO.NO_KEY}, []
    if "target_key" not in opt.heads or "released_at" not in opt.heads:
        return {"ok": False, "why": "the opt-out tab is missing its columns"}, []
    now = _now_iso()
    stamp = {"released_at": now}
    if "released_by" in opt.heads:
        stamp["released_by"] = s_(by_email)
    head = {h: opt.ref.headers[opt.heads.index(h)] for h in ("target_key", "released_at")}
    edits: list[dict] = []
    for _rn, raw in opt.rows():
        if gsjs.trim(gsjs.or_blank(raw.get(head["target_key"]))) != key or \
                gsjs.trim(gsjs.or_blank(raw.get(head["released_at"]))) or \
                W.cols_key(raw, opt.match_heads) in opt.edited:
            continue
        edits.append(opt.edit(raw, dict(stamp)))
    freed = len(edits)
    for rec in opt.appended:
        cells = rec["cells"]
        if gsjs.trim(cells.get("target_key", "")) == key and not gsjs.trim(cells.get("released_at", "")):
            cells.update({k: v for k, v in stamp.items() if k in opt.heads})
            freed += 1
    standing[key] = False
    return {"ok": True, "freed": freed}, edits


def keep_copy(sess: L.Session, payload: dict) -> Decision:
    """commsInboundKeepCopy (the relay's own): commsInboundRun_'s writes for what commsInboundFetch read, over the
    copy — commsInboundKeep's own once the list and the log are uploaded."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    if _uploaded(reads):
        return OOW.inbound_keep(sess, payload)
    p = payload if isinstance(payload, dict) else {}
    run = p.get("run") if isinstance(p.get("run"), dict) else {}
    if not OO.state(reads, OO.INBOUND_CURSOR_PROP)["value"]:
        sid = gsjs.trim(gsjs.or_blank(reads.db.prop("QUO_SYNC_SHEET_ID")))
        ref = reads.db.tab(sid, OO.QUO_MESSAGES_TAB) if sid else None
        if ref is not None:
            at = max(0, OO._last_row(reads, ref) - OOW.CURSOR_MARGIN_ROWS)
            OOW._set_state(OO.INBOUND_CURSOR_PROP, str(at))
            return Decision({"status": 200, "data": {
                "recorded": 0, "stops": 0, "starts": 0, "wrongNumbers": 0, "alreadySeen": 0, "remaining": 0,
                "replies": [], "noFeed": False, "seeded": at,
                "message": "The sweep's place in the message mirror was set where the earlier passes stood; "
                           "nothing was filed this time, and the next pass reads on from there."}},
                subject="", own=True)
    if s_(run.get("mode")) == "auto":
        OOW._set_state(OO.INBOUND_THROTTLE_KEY, "1", OO.INBOUND_THROTTLE_S)
    if s_(run.get("error")):
        OOW.log_line({"email": OOW.AUTO_ERROR_BY}, "comms_inbound_sweep_error", s_(run.get("error")), 500)
        return Decision({"status": 500, "message": s_(run.get("error"))}, subject="", own=True)
    if isinstance(run.get("answer"), dict):
        return Decision(run["answer"], subject="", own=True)
    if not isinstance(run.get("items"), list) or run.get("reached") is None:
        return W.refuse(400, "commsInboundFetch's batch is required: nothing was kept.")
    opt = Tab(reads, OO.OPT_OUT_TAB, OPT_OUT_MATCH)
    log = Tab(reads, OO.INBOUND_TAB, INBOUND_MATCH)
    by = s_(run.get("by")) or "asa-hub"
    seen = OO.inbound_index(reads)
    if seen["error"]:
        raise hubdb.Unreadable("the inbound record could not be read: " + seen["error"])
    have = set(seen["have"])
    already = int(run.get("already") or 0)
    stops = starts = wrong = 0
    standing: dict[str, bool] = {}
    edits: list[dict] = []
    filed: list[dict] = []
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
            add(opt, from_num, {"name": name, "candidateId": cid, "source": "sms reply", "phrase": it.get("phrase"),
                                "messageId": mid, "by": "asa-hub:inbound"}, standing)
            stops += 1
        elif intent == "opt-in":
            _freed, kept = release(opt, from_num, "asa-hub:inbound", standing)
            edits += kept
            starts += 1
        elif intent == "wrong-number":
            add(opt, from_num, {"name": name, "candidateId": cid, "source": "wrong number",
                                "phrase": it.get("phrase"), "messageId": mid, "by": "asa-hub:inbound",
                                "scope": it.get("scope")}, standing)
            wrong += 1
        filed.append({"message_id": mid, "received_at": s_(it.get("received_at")), "from_number": from_num,
                      "from_key": s_(it.get("from_key")), "candidate_id": cid, "person_name": name,
                      "body": gsjs.or_blank(it.get("body")), "intent": intent, "our_number": s_(it.get("our_number")),
                      "recorded_at": _now_iso()})
        if intent == "reply":
            replies.append({"name": name if it.get("who") else from_num,
                            "body": OO.js_cut(gsjs.or_blank(it.get("body")), 140)})
        have.add(mid)
    for row in filed:
        log.append(row)
    reached = int(run.get("reached") or 0)
    OOW._set_state(OO.INBOUND_CURSOR_PROP, str(reached))
    recorded = len(filed)
    passed_over, ours = int(run.get("passed_over") or 0), int(run.get("ours") or 0)
    remaining = max(0, int(run.get("last_row") or 0) - reached)
    OOW.log_line({"email": by}, "comms_inbound_sweep",
                 f"{recorded} new, {stops} opt-out, {starts} opt-in, {wrong} wrong number, {passed_over} read and "
                 f"not filed, {ours} our own lines, {remaining} rows behind")
    kept = opt.appended + edits + log.appended
    return Decision({"status": 200, "data": {
        "recorded": recorded, "stops": stops, "starts": starts, "wrongNumbers": wrong, "alreadySeen": already,
        "ourOwnLines": ours, "outgoing": int(run.get("outgoing") or 0), "passedOver": passed_over,
        "remaining": remaining, "replies": replies[:20], "noFeed": False,
        "message": OOW._sweep_message(recorded, stops, starts, wrong, passed_over, remaining)}},
        edits=kept or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commsInboundKeepCopy": keep_copy}
POLICY: dict[str, dict[str, Any]] = {"commsInboundKeepCopy": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commsInboundKeepCopy": {"status": 409, "message": OOW.BUSY}}
