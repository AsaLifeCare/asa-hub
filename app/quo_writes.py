"""quoIngestBatch (Quo.gs) on Python, the relay's door: the inbox it kept, verified events handed over in batches and
filed a few seconds at a time. A transcript, a summary or a text becomes one appended row of quo_transcripts,
quo_summaries or quo_messages — an app.edits record of this write, as createRow_ appends it — a text never twice by its
message id (the batch's snapshot of the ids filed, or the whole column for an event re-offered with `recheck`). An
incoming text is heard by the mailbox ear's own commInboundCapture_ (app/comm_replies_writes.py Ear, its houses kept
the same way) and its STOP, START or wrong number floored on the opt-out list (quoOptOutFloor_, through
app/opt_outs_writes.py); a transcript filed live is named back in `kick` for the relay to post to the phone-call
lane's door, as quoCommCallsKick_ posts it. A pass that spends its seconds stops early with `reached` and `left` said,
and the relay hands the rest again."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import call_offs_writes as COW
import comm_replies as CR
import comm_replies_writes as CRW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import opt_outs as OO
import opt_outs_writes as OOW
import quo as Q
import resource_rows as RR
import smart_comms_writes as SW
import staff_views
import writes as W
from scope import Defer
from writes import Decision

# inside the write's own budget, with room left for the reads
PASS_S = 4.0
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the relay offers the batch again."
QUO_ACTOR = "asa-hub:quo"
COMM_ACTOR = "asa-hub:comm"

s_ = gsjs.str_
_db_fault = CRW._db_fault


def log_line(actor: str, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record({"email": actor}, action, detail, status)


def _why(exc: BaseException) -> str:
    """String((e && e.message) || e)."""
    return str(exc) or type(exc).__name__


def _now_iso() -> str:
    """new Date().toISOString()."""
    return gsjs.iso(datetime.now(timezone.utc))


class Filer:
    """One pass of the batch: the three books as the copy holds them (this write's own rows laid), the snapshot of the
    filed message ids, the ear, and the records this pass keeps."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        self.cfg = reads.config()
        self.edits: list[dict] = []
        self.kicks: list[dict] = []
        self.added: dict[str, list[dict]] = {}
        self._columns: dict[tuple[str, str], tuple[int, list[str] | None] | None] = {}
        self.houses: CRW.Houses | None = None
        self.ear: CRW.Ear | None = None
        self._gated = False

    # -- the books --

    def ref(self, tab: str) -> hubdb.TabRef | None:
        """hubTabSheet_: the tab, or None."""
        return W.tab_of(self.reads, tab).ref

    def _copy(self, tab: str, field: str) -> tuple[int, list[str] | None] | None:
        """(how many rows the copy holds, that column of them in sheet order as getValues hands it back — None when
        the tab has no such column); None when there is no tab. Read once a pass."""
        key = (tab, field)
        if key not in self._columns:
            ref = self.ref(tab)
            if ref is None:
                self._columns[key] = None
            else:
                rows = self.reads.db.rows(ref)
                head = next((h for h in ref.headers if gsjs.js_str(h) == field), None)
                self._columns[key] = (len(rows), None if head is None else
                                      [gsjs.or_blank(hubdb.typed(raw.get(head), "hub")) for _rn, raw in rows])
        return self._columns[key]

    # -- a book kept in its own table (db/quo_tables.sql): asked of it, its id lookups by their index --

    @staticmethod
    def _kept(tab: str) -> str:
        return (HT.resource_of(tab) or "") if HT.tabled(tab) else ""

    def _kept_tail(self, resource: str, field: str, n: int) -> list[str]:
        """One column of the newest `n` rows, oldest first, each as getValues hands it back."""
        if not re.fullmatch(r"[a-z_]{1,63}", field):
            raise Defer(f"{field} is not a column name")
        got = RR._q(self.reads, f"select cells->>'{field}' from {RR.rows_of(resource)}"  # noqa: S608
                                " where resource = %s and removed_at is null"
                                " order by position desc, created_at desc, row_key desc limit %s",
                    (resource, max(1, n)))
        return [gsjs.or_blank(hubdb.typed(v, "hub")) for (v,) in reversed(got)]

    def _kept_has(self, resource: str, field: str, want: str) -> bool:
        """Whether any row holds this id, by the column's index."""
        if not re.fullmatch(r"[a-z_]{1,63}", field):
            raise Defer(f"{field} is not a column name")
        return bool(RR._q(self.reads, f"select 1 from {RR.rows_of(resource)} where resource = %s"  # noqa: S608
                                      f" and cells->>'{field}' = %s and removed_at is null limit 1", (resource, want)))

    def cells(self, tab: str, field: str) -> list[str] | None:
        """One column of the tab in sheet order, the rows this pass appended after; None when the tab holds no such
        column."""
        got = self._copy(tab, field)
        if got is None or got[1] is None:
            return None
        return got[1] + [gsjs.or_blank(r.get(field)) for r in self.added.get(tab, [])]

    def create(self, tab: str, record: dict[str, Any]) -> dict[str, Any]:
        """createRow_: the record with an id, createdAt and updatedAt, appended whole (quoCellSafe_'s apostrophe is the
        write's, not the cell's); made in the book's own table once kept there."""
        resource = self._kept(tab)
        if resource:
            if not self._gated:
                W.gate(self.reads)
                self._gated = True
            now = _now_iso()
            rec = dict(record)
            if gsjs.falsy(rec.get("id")):
                rec["id"] = W.mint()
            if gsjs.falsy(rec.get("createdAt")):
                rec["createdAt"] = now
            rec["updatedAt"] = now
            RR.create(self.reads, resource, {k: COW.serialize(v) for k, v in rec.items()}, QUO_ACTOR)
            return rec
        res = W.tab_of(self.reads, tab)
        if res.ref is None:
            raise Defer(f"the {tab} house holds no tab in the copy")
        if not self._gated:
            W.gate(self.reads)
            self._gated = True
        now = _now_iso()
        rec = dict(record)
        if gsjs.falsy(rec.get("id")):
            rec["id"] = W.mint()
        if gsjs.falsy(rec.get("createdAt")):
            rec["createdAt"] = now
        rec["updatedAt"] = now
        if any(k not in res.ref.headers for k in rec):
            raise Defer(f"a row naming a column the {tab} tab does not have")
        sid, name = W.where_of(res)
        rid = gsjs.js_str(rec["id"])
        self.edits.append(W.kept_record(sid, name, "append", "id", rid, "",
                                        {k: COW.serialize(v) for k, v in rec.items()}))
        self.added.setdefault(tab, []).append(rec)
        return rec

    def filed_anywhere(self, tab: str, field: str, rid: Any) -> bool | None:
        """quoFiledAnywhere_: the whole column, for a `recheck` event only; None when it cannot be read."""
        want = gsjs.trim(gsjs.or_text(rid))
        if not want:
            return False
        try:
            if self._kept(tab):
                return self._kept_has(self._kept(tab), field, want)
            got = self._copy(tab, field)
            if got is None:
                return None
            if not got[0] and not self.added.get(tab):
                return False
            col = self.cells(tab, field)
            if col is None:
                return None
            return want in col
        except Exception as exc:  # noqa: BLE001 - unreadable is never "new"
            if _db_fault(exc):
                raise
            return None

    def seen_ids(self, depth: int) -> set[str] | None:
        """quoSeenMessageIds_: the ids of the last `depth` texts filed; None (never an empty set) when unreadable."""
        try:
            kept = self._kept(Q.MESSAGES_TAB)
            col = self._kept_tail(kept, "message_id", depth) if kept else self.cells(Q.MESSAGES_TAB, "message_id")
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            return None
        if col is None:
            return None
        return {gsjs.trim(v) for v in col[-max(1, depth):] if gsjs.trim(v)}

    def message_seen(self, message_id: Any) -> bool:
        """quoMessageSeen_: the newest rows only, a retry arrives within seconds; unreadable files it twice rather than
        lose a reply."""
        want = gsjs.or_text(message_id)
        if not want:
            return False
        try:
            kept = self._kept(Q.MESSAGES_TAB)
            col = self._kept_tail(kept, "message_id", Q.SEEN_TAIL_ROWS + 1) if kept else \
                self.cells(Q.MESSAGES_TAB, "message_id")
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            return False
        return bool(col) and want in {gsjs.trim(v) for v in col[-(Q.SEEN_TAIL_ROWS + 1):]}

    # -- the ear --

    def capture(self, m: dict[str, Any]) -> dict[str, Any]:
        """commInboundCapture_, as the mailbox ear captures it, its houses read once a pass."""
        if self.ear is None:
            self.houses = CRW.Houses(self.reads)
            self.ear = CRW.Ear(self.reads, self.houses, CR.people_by_contact(self.reads))
        return self.ear.capture(m)

    def opt_out_floor(self, record: dict[str, Any], source: str) -> str:
        """quoOptOutFloor_: the brake for every sender — a STOP or a wrong number added, a START released (never off
        history); the intent acted on, or ''."""
        try:
            intent = OO.opt_out_intent(record.get("body"), self.cfg)
            if intent not in ("opt-out", "wrong-number", "opt-in"):
                return ""
            frm = s_(record.get("from_number"))
            digits = re.sub(r"\D", "", frm)[-10:]
            if not digits or OO.is_ours(self.reads, digits):
                return ""
            if intent == "opt-in":
                if Q.is_history(source):
                    return ""
                OOW.release(self.reads, frm, QUO_ACTOR)
                return intent
            wrong = intent == "wrong-number"
            OOW.add(self.reads, frm, {
                "source": "wrong number" if wrong else "sms reply", "phrase": SW.js_slice(s_(record.get("body")), 120),
                "messageId": record.get("message_id"), "by": QUO_ACTOR,
                "scope": OO.scope_for_line(Q.our_line(self.reads, record.get("to_number")),
                                           OO.comm_test_mode(self.cfg)) if wrong else ""})
            return intent
        except Exception as exc:  # noqa: BLE001 - the filing stands either way
            if _db_fault(exc):
                raise
            log_line(QUO_ACTOR, "quo_opt_out_failed", _why(exc), 500)
            return ""

    # -- the handlers --

    def transcript(self, body: dict, source: str) -> dict[str, Any]:
        """quoHandleTranscript_: never classified here; the phone-call lane reads it."""
        record, turns = Q.transcript_record(self.reads, body, source, _now_iso())
        self.create(Q.TRANSCRIPTS_TAB, record)
        if not Q.is_history(source):
            self.kicks.append(record)
        return {"kind": "transcript", "id": record["call_id"], "turns": turns}

    def summary(self, body: dict, source: str) -> dict[str, Any]:
        """quoHandleSummary_."""
        record = Q.summary_record(body, source, _now_iso())
        self.create(Q.SUMMARIES_TAB, record)
        return {"kind": "summary", "id": record["call_id"]}

    def message(self, body: dict, source: str, seen: set[str] | None) -> dict[str, Any]:
        """quoHandleMessage_: one message, one row; an incoming one heard and floored only after its row is safe."""
        record = Q.message_record(body, source, _now_iso())
        mid = record["message_id"]
        if mid and (mid in seen if seen is not None else self.message_seen(mid)):
            return {"kind": "message", "id": mid, "duplicate": True}
        self.create(Q.MESSAGES_TAB, record)
        if seen is not None and mid:
            seen.add(mid)
        incoming = s_(record.get("direction")).lower() == "incoming"
        if incoming and not Q.is_history(source):
            try:
                self.capture({"channel": "sms", "message_id": mid, "from": record["from_number"],
                              "to": record["to_number"], "text": record["body"],
                              "at": record["message_created"] or record["received_at"],
                              "thread_id": record["conversation_id"], "source": source})
            except Exception as exc:  # noqa: BLE001 - never able to fail this door
                if _db_fault(exc):
                    raise
                log_line(COMM_ACTOR, "comm_inbound_failed", _why(exc), 500)
        if incoming:
            self.opt_out_floor(record, source)
        return {"kind": "message", "id": mid}

    def all_edits(self) -> list[dict]:
        return self.edits + (self.houses.edits() if self.houses is not None else [])


def ingest_batch(sess: L.Session, payload: dict) -> Decision:
    """quoIngestBatch: many verified events, one write — the relay's alone. Each result is the relay's to drain
    (filed, already) or to keep (refused, error); the events a pass did not reach are counted in `left`."""
    p = payload if isinstance(payload, dict) else {}
    if p.get("events") is None or p.get("events") == "":
        return W.refuse(400, "Missing required parameter: events.")
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(DENIED))
    events = p.get("events")
    if not isinstance(events, list):
        return Decision({"status": 400, "message": "events must be a list."})
    reads = sess.reads
    CR.owned(reads)
    started = time.monotonic()
    f = Filer(reads)
    seen: set[str] | None = None
    seen_read = False
    results: list[dict[str, Any]] = []
    total = min(len(events), Q.BATCH_MAX)
    i = 0
    while i < total:
        if i and time.monotonic() - started > PASS_S:
            break
        item = events[i] if isinstance(events[i], dict) else {}
        i += 1
        event = item.get("event")
        rid, kind_said = s_(item.get("id")), s_(item.get("type"))
        if not isinstance(event, dict) or gsjs.falsy(event.get("type")):
            results.append({"id": rid, "type": kind_said, "result": "refused", "why": "no event"})
            continue
        source = "relay:" + (s_(item.get("source")) or "inbox")
        try:
            kind = gsjs.or_text(event.get("type"))
            if Q.is_transcript_type(kind) or Q.is_summary_type(kind):
                is_tr = Q.is_transcript_type(kind)
                filed: bool | None = False
                if item.get("recheck") is True:
                    filed = f.filed_anywhere(Q.TRANSCRIPTS_TAB if is_tr else Q.SUMMARIES_TAB, "call_id",
                                             Q.event_call_id(event))
                    if filed is None:
                        raise RuntimeError("the filed call ids could not be read to recheck it")
                data = ({"kind": "transcript" if is_tr else "summary", "id": Q.event_call_id(event), "duplicate": True}
                        if filed else f.transcript(event, source) if is_tr else f.summary(event, source))
            elif Q.is_message_type(kind):
                anywhere: bool | None = False
                if item.get("recheck") is True:
                    anywhere = f.filed_anywhere(Q.MESSAGES_TAB, "message_id", Q.event_message_id(event))
                    if anywhere is None:
                        raise RuntimeError("the filed ids could not be read to recheck it")
                if not anywhere and not seen_read:
                    seen, seen_read = f.seen_ids(Q.BATCH_SEEN_ROWS), True
                data = ({"kind": "message", "id": Q.event_message_id(event), "duplicate": True} if anywhere
                        else f.message(event, source, seen))
            else:
                data = {"kind": "ignored", "type": kind}
            out = Q.batch_outcome(data)
            results.append({"id": rid, "type": kind_said, "result": out["result"], "why": out["why"]})
        except Exception as exc:  # noqa: BLE001 - this event's error, the batch goes on
            if _db_fault(exc):
                raise
            log_line(QUO_ACTOR, "quo_ingest_failed", f"{kind_said} {rid}: {_why(exc)}", 500)
            results.append({"id": rid, "type": kind_said, "result": "error", "why": SW.js_slice(_why(exc), 200)})
    data: dict[str, Any] = {"results": results, "reached": len(results), "left": len(events) - i,
                            "stopped_early": i < total, "ms": int((time.monotonic() - started) * 1000)}
    if f.kicks:
        data["kick"] = f.kicks
    return Decision({"status": 200, "data": data}, edits=f.all_edits() or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"quoIngestBatch": ingest_batch}
# HUB_POLICY.quoIngestBatch: admins (the service passes), `events` a list
POLICY: dict[str, dict[str, Any]] = {"quoIngestBatch": {"roles": ("admin",), "params": {"events": "array"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"quoIngestBatch": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.quo_writes and _receipts; the three books' rows and the ear's houses app.edits', the opt-out list
    app.resource_rows' — a void takes them back, and the relay offers the same events again."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="quo", label="The Quo inbox")
